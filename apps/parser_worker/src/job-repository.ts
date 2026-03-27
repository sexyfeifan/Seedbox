import { Pool, type PoolClient } from "pg";
import type { ParseJob, ParseResult } from "./types.js";

export interface ClaimedJob extends ParseJob {
  userId: string;
}

export class JobRepository {
  constructor(private readonly pool: Pool) {}

  static fromDatabaseUrl(databaseUrl: string): JobRepository {
    return new JobRepository(
      new Pool({
        connectionString: databaseUrl
      })
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async claimNextJob(): Promise<ClaimedJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const next = await client.query<{
        job_id: string;
        item_id: string;
        user_id: string;
        source_url: string;
      }>(
        `
          SELECT pj.id AS job_id, i.id AS item_id, i.user_id, i.source_url
          FROM parser_jobs pj
          JOIN items i ON i.id = pj.item_id
          WHERE pj.status = 'queued'
          ORDER BY pj.created_at ASC
          LIMIT 1
          FOR UPDATE OF pj SKIP LOCKED
        `
      );

      if (next.rowCount === 0) {
        await client.query("COMMIT");
        return null;
      }

      const row = next.rows[0];
      await client.query(
        `
          UPDATE parser_jobs
          SET status = 'running', attempts = attempts + 1, updated_at = NOW(), error_message = NULL
          WHERE id = $1
        `,
        [row.job_id]
      );
      await client.query(
        `
          UPDATE items
          SET status = 'parsing', updated_at = NOW()
          WHERE id = $1
        `,
        [row.item_id]
      );
      await client.query("COMMIT");

      return {
        jobId: row.job_id,
        itemId: row.item_id,
        sourceUrl: row.source_url,
        userId: row.user_id
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJob(job: ClaimedJob, result: ParseResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const normalizedAssets = (result.assets ?? [])
        .filter((asset) => typeof asset.url === "string" && /^https?:\/\//i.test(asset.url))
        .slice(0, 50);
      const firstImageUrl = normalizedAssets.find((asset) => asset.type === "image")?.url ?? null;
      const resolvedTitle = composeTitleWithByline(result.title, result.byline);
      await client.query(
        `
          UPDATE items
          SET
            status = 'ready',
            title = COALESCE(title, $2),
            parsed_at = NOW(),
            parser_version = $3,
            cover_image_url = COALESCE($4, cover_image_url),
            updated_at = NOW()
          WHERE id = $1
        `,
        [job.itemId, resolvedTitle ?? null, result.parserVersion, firstImageUrl]
      );

      await client.query(
        `
          INSERT INTO item_contents (item_id, html_content, markdown_content, plain_text, word_count, reading_minutes, summary_short)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (item_id)
          DO UPDATE SET
            html_content = EXCLUDED.html_content,
            markdown_content = EXCLUDED.markdown_content,
            plain_text = EXCLUDED.plain_text,
            word_count = EXCLUDED.word_count,
            reading_minutes = EXCLUDED.reading_minutes,
            summary_short = EXCLUDED.summary_short,
            updated_at = NOW()
        `,
        [
          job.itemId,
          result.htmlContent ?? null,
          result.markdownContent ?? null,
          result.plainText ?? null,
          result.wordCount,
          result.readingMinutes,
          result.excerpt ?? null
        ]
      );

      await client.query(`DELETE FROM item_assets WHERE item_id = $1`, [job.itemId]);
      for (let index = 0; index < normalizedAssets.length; index += 1) {
        const asset = normalizedAssets[index];
        const width =
          typeof asset.width === "number" && Number.isFinite(asset.width) ? Math.max(1, Math.trunc(asset.width)) : null;
        const height =
          typeof asset.height === "number" && Number.isFinite(asset.height)
            ? Math.max(1, Math.trunc(asset.height))
            : null;
        await client.query(
          `
            INSERT INTO item_assets (item_id, asset_type, asset_url, width, height, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [job.itemId, asset.type, asset.url, width, height, index]
        );
      }

      await client.query(
        `
          UPDATE parser_jobs
          SET status = 'done', updated_at = NOW(), error_message = NULL
          WHERE id = $1
        `,
        [job.jobId]
      );

      await addSyncEvent(client, job.userId, "item", job.itemId, "parsed", {
        parserVersion: result.parserVersion,
        wordCount: result.wordCount
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failJob(job: ClaimedJob, reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          UPDATE parser_jobs
          SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [job.jobId, reason.slice(0, 2000)]
      );

      await client.query(
        `
          UPDATE items
          SET status = 'failed', updated_at = NOW()
          WHERE id = $1
        `,
        [job.itemId]
      );

      await addSyncEvent(client, job.userId, "item", job.itemId, "parse_failed", {
        reason: reason.slice(0, 500)
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function composeTitleWithByline(title: string | undefined, byline: string | undefined): string | undefined {
  const safeTitle = String(title || "").trim();
  if (!safeTitle) {
    return undefined;
  }
  const safeByline = String(byline || "")
    .replace(/^(by|作者|博主|发布者)\s*[:：]?\s*/i, "")
    .replace(/\s*(关注|已关注|粉丝|赞过).*$/u, "")
    .trim();
  if (!safeByline || safeByline.length > 32) {
    return safeTitle;
  }
  if (safeTitle.includes(` - ${safeByline}`)) {
    return safeTitle;
  }
  return `${safeTitle} - ${safeByline}`;
}

async function addSyncEvent(
  client: PoolClient,
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  await client.query(
    `
      INSERT INTO sync_events (user_id, entity_type, entity_id, action, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [userId, entityType, entityId, action, JSON.stringify(payload)]
  );
}
