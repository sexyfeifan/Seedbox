import { Pool, type PoolClient } from "pg";
import {
  appendBylineToTitle,
  deriveTopicTitle,
  extractTagsFromText,
  mergeTags,
  sanitizeParserBodyText,
  sanitizeParserExcerpt,
  sanitizeParserMetaText,
  shouldDiscardParsedHtml
} from "../lib/content-extract.js";
import { buildStableParsedAssets, scheduleAssetCacheWarmup } from "../lib/parsed-assets.js";
import { generateSummary } from "../lib/summarizer.js";
import { buildCanonicalItemUrl, resolveCaptureSourceUrl } from "../lib/url-extract.js";
import type {
  BillingSubscription,
  Collection,
  Highlight,
  Item,
  ItemAsset,
  ItemContent,
  ItemStatus,
  ItemSummarySnapshot,
  Note,
  SyncEvent
} from "../domain/models.js";
import type {
  ClientOperation,
  CreateCollectionInput,
  CreateHighlightInput,
  CreateItemInput,
  CreateNoteInput,
  DataStore,
  ListItemsInput,
  ListItemsResult,
  ParserJobClaim,
  ParserJobDiagnostics,
  ParserResultInput,
  RequestItemSummaryInput,
  SubscribeInput,
  UpdateCollectionInput,
  UpdateNoteInput,
  UpdateItemInput
} from "./store.js";

type ItemRow = {
  id: string;
  user_id: string;
  collection_id: string | null;
  source_url: string;
  canonical_url: string | null;
  domain: string | null;
  title: string | null;
  cover_image_url: string | null;
  status: ItemStatus;
  is_favorite: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type CollectionRow = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

type ContentRow = {
  html_content: string | null;
  markdown_content: string | null;
  plain_text: string | null;
  summary_short: string | null;
  word_count: number | null;
  reading_minutes: number | null;
};

type AssetRow = {
  id: string;
  item_id: string;
  asset_type: "image" | "video" | "file";
  asset_url: string;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: Date;
};

type SummaryRow = {
  provider: string;
  model: string;
  summary_md: string;
  key_points: unknown;
  created_at: Date;
};

type HighlightRow = {
  id: string;
  item_id: string;
  user_id: string;
  quote: string;
  start_offset: number | null;
  end_offset: number | null;
  color: string;
  note: string | null;
  created_at: Date;
};

type NoteRow = {
  id: string;
  item_id: string;
  user_id: string;
  title: string | null;
  body_md: string;
  created_at: Date;
  updated_at: Date;
};

type BillingSubscriptionRow = {
  user_id: string;
  plan: "free" | "pro_monthly";
  status: "active" | "canceled";
  provider: string;
  started_at: Date;
  current_period_end: Date | null;
  canceled_at: Date | null;
  updated_at: Date;
};

type ParserJobRow = {
  item_id: string;
  job_id: string | null;
  status: "queued" | "running" | "done" | "failed" | null;
  attempts: number | null;
  error_message: string | null;
  created_at: Date | null;
  updated_at: Date | null;
};

export class PostgresStore implements DataStore {
  private readonly processedSyncOperationIds = new Set<string>();
  private readonly summarySnapshots = new Map<string, ItemSummarySnapshot>();
  private readonly summaryTimers = new Map<string, NodeJS.Timeout>();
  private billingSchemaReady = false;

  constructor(private readonly pool: Pool) {}

  static fromDatabaseUrl(databaseUrl: string): PostgresStore {
    return new PostgresStore(
      new Pool({
        connectionString: databaseUrl
      })
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureBillingSchema(): Promise<void> {
    if (this.billingSchemaReady) {
      return;
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (plan IN ('free', 'pro_monthly')),
        status TEXT NOT NULL CHECK (status IN ('active', 'canceled')),
        provider TEXT NOT NULL DEFAULT 'mock',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        current_period_end TIMESTAMPTZ,
        canceled_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    this.billingSchemaReady = true;
  }

  async createItem(userId: string, input: CreateItemInput): Promise<Item> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureUser(client, userId);

      const canonicalUrl = buildCanonicalItemUrl(input.sourceUrl);
      const domain = safeDomain(input.sourceUrl);
      const collectionId = await resolveCollectionId(client, userId, input.collectionId);
      const inserted = await client.query<ItemRow>(
        `
          INSERT INTO items (user_id, collection_id, source_url, canonical_url, domain, title, status, is_favorite)
          VALUES ($1, $2, $3, $4, $5, $6, 'queued', false)
          ON CONFLICT (user_id, url_key)
          DO UPDATE SET
            updated_at = NOW(),
            archived_at = NULL,
            source_url = EXCLUDED.source_url,
            canonical_url = EXCLUDED.canonical_url,
            domain = EXCLUDED.domain,
            status = 'queued',
            parsed_at = NULL,
            collection_id = COALESCE(EXCLUDED.collection_id, items.collection_id),
            title = COALESCE(EXCLUDED.title, items.title)
          RETURNING *
        `,
        [userId, collectionId, input.sourceUrl, canonicalUrl, domain, input.titleHint ?? null]
      );
      const row = inserted.rows[0];

      await client.query(`INSERT INTO item_contents (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING`, [row.id]);
      await client.query(`INSERT INTO parser_jobs (item_id, status) VALUES ($1, 'queued')`, [row.id]);

      if (input.tags) {
        await replaceItemTags(client, userId, row.id, input.tags);
      }

      await addSyncEvent(client, userId, "item", row.id, "created", {
        sourceUrl: row.source_url
      });

      await client.query("COMMIT");
      const tags = await listTagsByItemId(this.pool, row.id);
      return mapItem(row, tags);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getItem(userId: string, itemId: string): Promise<{ item: Item; content?: ItemContent; assets: ItemAsset[] } | null> {
    const itemResult = await this.pool.query<ItemRow>(
      `SELECT * FROM items WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [itemId, userId]
    );
    if (itemResult.rowCount === 0) {
      return null;
    }

    const itemRow = itemResult.rows[0];
    const tags = await listTagsByItemId(this.pool, itemId);
    const contentResult = await this.pool.query<ContentRow>(
      `
        SELECT html_content, markdown_content, plain_text, summary_short, word_count, reading_minutes
        FROM item_contents
        WHERE item_id = $1
      `,
      [itemId]
    );
    const contentRow = contentResult.rows[0];

    const content = contentRow
      ? {
          itemId,
          htmlContent: contentRow.html_content ?? undefined,
          markdownContent: contentRow.markdown_content ?? undefined,
          plainText: contentRow.plain_text ?? undefined,
          summaryShort: contentRow.summary_short ?? undefined,
          wordCount: contentRow.word_count ?? undefined,
          readingMinutes: contentRow.reading_minutes ?? undefined
        }
      : undefined;

    const assetsResult = await this.pool.query<AssetRow>(
      `
        SELECT id, item_id, asset_type, asset_url, width, height, sort_order, created_at
        FROM item_assets
        WHERE item_id = $1
        ORDER BY sort_order ASC, created_at ASC
      `,
      [itemId]
    );

    return {
      item: mapItem(itemRow, tags),
      content,
      assets: assetsResult.rows.map(mapAsset)
    };
  }

  async listItems(userId: string, input: ListItemsInput): Promise<ListItemsResult> {
    const filters: string[] = [`i.user_id = $1`];
    const values: unknown[] = [userId];
    let index = values.length;

    if (input.status) {
      index += 1;
      filters.push(`i.status = $${index}`);
      values.push(input.status);
    }
    if (input.archived !== undefined) {
      filters.push(input.archived ? `i.archived_at IS NOT NULL` : `i.archived_at IS NULL`);
    }
    if (input.tag) {
      index += 1;
      filters.push(
        `EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = $${index})`
      );
      values.push(input.tag);
    }
    if (input.collectionId) {
      index += 1;
      filters.push(`i.collection_id = $${index}`);
      values.push(input.collectionId);
    }

    index += 1;
    const limitIndex = index;
    values.push(input.limit + 1);

    index += 1;
    const offsetIndex = index;
    values.push(input.offset);

    const query = `
      SELECT i.*
      FROM items i
      WHERE ${filters.join(" AND ")}
      ORDER BY i.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const result = await this.pool.query<ItemRow>(query, values);
    const hasNext = result.rows.length > input.limit;
    const rows = hasNext ? result.rows.slice(0, input.limit) : result.rows;
    const tagsMap = await listTagsByItemIds(this.pool, rows.map((row) => row.id));

    return {
      items: rows.map((row) => mapItem(row, tagsMap.get(row.id) ?? [])),
      nextOffset: hasNext ? input.offset + input.limit : null
    };
  }

  async updateItem(userId: string, itemId: string, input: UpdateItemInput): Promise<Item | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const exists = await client.query<ItemRow>(
        `SELECT * FROM items WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [itemId, userId]
      );
      if (exists.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const updates: string[] = [];
      const values: unknown[] = [itemId, userId];
      let index = values.length;

      if (input.title !== undefined) {
        index += 1;
        updates.push(`title = $${index}`);
        values.push(input.title);
      }
      if (input.isFavorite !== undefined) {
        index += 1;
        updates.push(`is_favorite = $${index}`);
        values.push(input.isFavorite);
      }
      if (input.status !== undefined) {
        index += 1;
        updates.push(`status = $${index}`);
        values.push(input.status);
      }
      if (input.collectionId !== undefined) {
        index += 1;
        const collectionId =
          input.collectionId === null ? null : await resolveCollectionId(client, userId, input.collectionId);
        updates.push(`collection_id = $${index}`);
        values.push(collectionId);
      }
      if (input.archived !== undefined) {
        updates.push(input.archived ? `archived_at = NOW()` : `archived_at = NULL`);
      }

      let itemRow = exists.rows[0];
      if (updates.length > 0) {
        const updated = await client.query<ItemRow>(
          `
            UPDATE items
            SET ${updates.join(", ")}, updated_at = NOW()
            WHERE id = $1 AND user_id = $2
            RETURNING *
          `,
          values
        );
        itemRow = updated.rows[0];
      }

      if (input.tags) {
        await replaceItemTags(client, userId, itemId, input.tags);
      }

      await addSyncEvent(client, userId, "item", itemId, "updated", {
        title: input.title,
        tags: input.tags,
        status: input.status,
        collectionId: input.collectionId,
        isFavorite: input.isFavorite,
        archived: input.archived
      });

      await client.query("COMMIT");
      const tags = await listTagsByItemId(this.pool, itemId);
      return mapItem(itemRow, tags);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async clearItemContent(userId: string, itemId: string): Promise<boolean> {
    if (!isUuid(itemId)) {
      return false;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string }>(
        `
          SELECT id
          FROM items
          WHERE id = $1 AND user_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [itemId, userId]
      );
      if (found.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `
          INSERT INTO item_contents (item_id)
          VALUES ($1)
          ON CONFLICT (item_id) DO NOTHING
        `,
        [itemId]
      );
      await client.query(
        `
          UPDATE item_contents
          SET
            html_content = NULL,
            markdown_content = NULL,
            plain_text = NULL,
            summary_short = NULL,
            word_count = 0,
            reading_minutes = 0,
            updated_at = NOW()
          WHERE item_id = $1
        `,
        [itemId]
      );
      await addSyncEvent(client, userId, "item", itemId, "content_cleared", {});
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async permanentlyDeleteItem(userId: string, itemId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM items
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [itemId, userId]
      );

      if (deleted.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }

      await addSyncEvent(client, userId, "item", itemId, "deleted", {
        permanent: true
      });
      await client.query("COMMIT");
      this.clearSummaryRuntimeState(userId, itemId);
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async purgeArchivedItems(userId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM items
          WHERE user_id = $1 AND archived_at IS NOT NULL
          RETURNING id
        `,
        [userId]
      );

      const deletedCount = deleted.rowCount ?? 0;
      if (deletedCount > 0) {
        await addSyncEvent(
          client,
          userId,
          "item",
          "00000000-0000-0000-0000-000000000000",
          "purged_archived",
          {
            deletedCount
          }
        );
      }

      await client.query("COMMIT");
      for (const row of deleted.rows) {
        this.clearSummaryRuntimeState(userId, row.id);
      }
      return deletedCount;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async searchItems(userId: string, query: string, limit: number): Promise<Item[]> {
    const needle = `%${query.trim()}%`;
    const result = await this.pool.query<ItemRow>(
      `
        SELECT i.*
        FROM items i
        LEFT JOIN item_contents c ON c.item_id = i.id
        WHERE i.user_id = $1
          AND i.archived_at IS NULL
          AND (
            i.title ILIKE $2
            OR i.source_url ILIKE $2
            OR i.domain ILIKE $2
            OR c.plain_text ILIKE $2
          )
        ORDER BY i.created_at DESC
        LIMIT $3
      `,
      [userId, needle, limit]
    );
    const tagsMap = await listTagsByItemIds(this.pool, result.rows.map((row) => row.id));
    return result.rows.map((row) => mapItem(row, tagsMap.get(row.id) ?? []));
  }

  async requestItemSummary(
    userId: string,
    itemId: string,
    input: RequestItemSummaryInput = {}
  ): Promise<ItemSummarySnapshot | null> {
    if (!isUuid(itemId)) {
      return null;
    }
    const itemResult = await this.pool.query<{ id: string }>(
      `
        SELECT id
        FROM items
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [itemId, userId]
    );
    if ((itemResult.rowCount ?? 0) === 0) {
      return null;
    }

    const key = summaryRuntimeKey(userId, itemId);
    const runtime = this.summarySnapshots.get(key);
    const persisted = await this.readLatestSummary(userId, itemId);
    const existing = pickPreferredSummary(runtime, persisted);
    const shouldReuse =
      !input.force &&
      existing &&
      (existing.status === "queued" || existing.status === "running" || existing.status === "ready");
    if (shouldReuse) {
      return existing;
    }

    this.clearSummaryTimer(key);
    const queued: ItemSummarySnapshot = {
      itemId,
      status: "queued",
      keyPoints: [],
      updatedAt: new Date().toISOString()
    };
    this.summarySnapshots.set(key, queued);
    this.summaryTimers.set(
      key,
      setTimeout(() => {
        void this.runSummaryJob(userId, itemId);
      }, 300)
    );
    return queued;
  }

  async getItemSummary(userId: string, itemId: string): Promise<ItemSummarySnapshot | null> {
    if (!isUuid(itemId)) {
      return null;
    }
    const key = summaryRuntimeKey(userId, itemId);
    const runtime = this.summarySnapshots.get(key);
    if (runtime && (runtime.status === "queued" || runtime.status === "running" || runtime.status === "failed")) {
      return runtime;
    }

    const persisted = await this.readLatestSummary(userId, itemId);
    return pickPreferredSummary(runtime, persisted);
  }

  async createHighlight(userId: string, itemId: string, input: CreateHighlightInput): Promise<Highlight | null> {
    if (!isUuid(itemId)) {
      return null;
    }
    const result = await this.pool.query<HighlightRow>(
      `
        INSERT INTO highlights (item_id, user_id, quote, start_offset, end_offset, color, note)
        SELECT $1, $2, $3, $4, $5, $6, $7
        WHERE EXISTS (
          SELECT 1
          FROM items
          WHERE id = $1 AND user_id = $2
        )
        RETURNING *
      `,
      [
        itemId,
        userId,
        input.quote.trim(),
        input.startOffset ?? null,
        input.endOffset ?? null,
        input.color?.trim() || "yellow",
        input.note?.trim() || null
      ]
    );
    if ((result.rowCount ?? 0) === 0) {
      return null;
    }
    return mapHighlight(result.rows[0]);
  }

  async listHighlights(userId: string, itemId: string): Promise<Highlight[]> {
    if (!isUuid(itemId)) {
      return [];
    }
    const result = await this.pool.query<HighlightRow>(
      `
        SELECT h.*
        FROM highlights h
        JOIN items i ON i.id = h.item_id
        WHERE h.item_id = $1
          AND h.user_id = $2
          AND i.user_id = $2
        ORDER BY h.created_at DESC
      `,
      [itemId, userId]
    );
    return result.rows.map((row) => mapHighlight(row));
  }

  async deleteHighlight(userId: string, itemId: string, highlightId: string): Promise<boolean> {
    if (!isUuid(itemId) || !isUuid(highlightId)) {
      return false;
    }
    const result = await this.pool.query<{ id: string }>(
      `
        DELETE FROM highlights
        WHERE id = $1 AND item_id = $2 AND user_id = $3
        RETURNING id
      `,
      [highlightId, itemId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createNote(userId: string, itemId: string, input: CreateNoteInput): Promise<Note | null> {
    if (!isUuid(itemId)) {
      return null;
    }
    const result = await this.pool.query<NoteRow>(
      `
        INSERT INTO notes (item_id, user_id, title, body_md)
        SELECT $1, $2, $3, $4
        WHERE EXISTS (
          SELECT 1
          FROM items
          WHERE id = $1 AND user_id = $2
        )
        RETURNING *
      `,
      [itemId, userId, input.title?.trim() || null, input.bodyMd]
    );
    if ((result.rowCount ?? 0) === 0) {
      return null;
    }
    return mapNote(result.rows[0]);
  }

  async listNotes(userId: string, itemId: string): Promise<Note[]> {
    if (!isUuid(itemId)) {
      return [];
    }
    const result = await this.pool.query<NoteRow>(
      `
        SELECT n.*
        FROM notes n
        JOIN items i ON i.id = n.item_id
        WHERE n.item_id = $1
          AND n.user_id = $2
          AND i.user_id = $2
        ORDER BY n.updated_at DESC
      `,
      [itemId, userId]
    );
    return result.rows.map((row) => mapNote(row));
  }

  async updateNote(userId: string, itemId: string, noteId: string, input: UpdateNoteInput): Promise<Note | null> {
    if (!isUuid(itemId) || !isUuid(noteId)) {
      return null;
    }

    const current = await this.pool.query<NoteRow>(
      `
        SELECT *
        FROM notes
        WHERE id = $1 AND item_id = $2 AND user_id = $3
        LIMIT 1
      `,
      [noteId, itemId, userId]
    );
    if ((current.rowCount ?? 0) === 0) {
      return null;
    }

    const existing = current.rows[0];
    const result = await this.pool.query<NoteRow>(
      `
        UPDATE notes
        SET title = $4, body_md = $5, updated_at = NOW()
        WHERE id = $1 AND item_id = $2 AND user_id = $3
        RETURNING *
      `,
      [
        noteId,
        itemId,
        userId,
        input.title !== undefined ? input.title.trim() || null : existing.title,
        input.bodyMd !== undefined ? input.bodyMd : existing.body_md
      ]
    );
    if ((result.rowCount ?? 0) === 0) {
      return null;
    }
    return mapNote(result.rows[0]);
  }

  async deleteNote(userId: string, itemId: string, noteId: string): Promise<boolean> {
    if (!isUuid(itemId) || !isUuid(noteId)) {
      return false;
    }
    const result = await this.pool.query<{ id: string }>(
      `
        DELETE FROM notes
        WHERE id = $1 AND item_id = $2 AND user_id = $3
        RETURNING id
      `,
      [noteId, itemId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createCollection(userId: string, input: CreateCollectionInput): Promise<Collection> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureUser(client, userId);
      const parentId = await resolveCollectionId(client, userId, input.parentId);
      const inserted = await client.query<CollectionRow>(
        `
          INSERT INTO collections (user_id, parent_id, name, sort_order)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [userId, parentId, input.name.trim(), input.sortOrder ?? 0]
      );
      const row = inserted.rows[0];
      await addSyncEvent(client, userId, "collection", row.id, "created", {
        parentId: row.parent_id,
        name: row.name,
        sortOrder: row.sort_order
      });
      await client.query("COMMIT");
      return mapCollection(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCollections(userId: string): Promise<Collection[]> {
    const result = await this.pool.query<CollectionRow>(
      `
        SELECT *
        FROM collections
        WHERE user_id = $1
        ORDER BY sort_order ASC, created_at ASC
      `,
      [userId]
    );
    return result.rows.map((row) => mapCollection(row));
  }

  async updateCollection(
    userId: string,
    collectionId: string,
    input: UpdateCollectionInput
  ): Promise<Collection | null> {
    if (!isUuid(collectionId)) {
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query<CollectionRow>(
        `SELECT * FROM collections WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [collectionId, userId]
      );
      if ((exists.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const current = exists.rows[0];
      let nextParentId = current.parent_id;
      if (input.parentId !== undefined) {
        nextParentId =
          input.parentId === null ? null : await resolveCollectionId(client, userId, input.parentId);
      }
      if (nextParentId === collectionId) {
        nextParentId = null;
      }

      const updated = await client.query<CollectionRow>(
        `
          UPDATE collections
          SET
            name = $3,
            parent_id = $4,
            sort_order = $5,
            updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING *
        `,
        [
          collectionId,
          userId,
          input.name !== undefined ? input.name.trim() : current.name,
          nextParentId,
          input.sortOrder ?? current.sort_order
        ]
      );
      const row = updated.rows[0];
      await addSyncEvent(client, userId, "collection", collectionId, "updated", {
        parentId: row.parent_id,
        name: row.name,
        sortOrder: row.sort_order
      });
      await client.query("COMMIT");
      return mapCollection(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteCollection(userId: string, collectionId: string): Promise<boolean> {
    if (!isUuid(collectionId)) {
      return false;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM collections
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [collectionId, userId]
      );
      if ((deleted.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await addSyncEvent(client, userId, "collection", collectionId, "deleted", {});
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSubscription(userId: string): Promise<BillingSubscription> {
    await this.ensureBillingSchema();
    const result = await this.pool.query<BillingSubscriptionRow>(
      `
        SELECT *
        FROM billing_subscriptions
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return createDefaultSubscription(userId);
    }
    return mapBillingSubscription(result.rows[0]);
  }

  async subscribe(userId: string, input: SubscribeInput): Promise<BillingSubscription> {
    await this.ensureBillingSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureUser(client, userId);
      const now = new Date();
      const currentPeriodEnd = input.plan === "pro_monthly" ? addDays(now, 30) : null;
      const upserted = await client.query<BillingSubscriptionRow>(
        `
          INSERT INTO billing_subscriptions (
            user_id, plan, status, provider, started_at, current_period_end, canceled_at
          )
          VALUES ($1, $2, 'active', $3, $4, $5, NULL)
          ON CONFLICT (user_id)
          DO UPDATE SET
            plan = EXCLUDED.plan,
            status = 'active',
            provider = EXCLUDED.provider,
            started_at = EXCLUDED.started_at,
            current_period_end = EXCLUDED.current_period_end,
            canceled_at = NULL,
            updated_at = NOW()
          RETURNING *
        `,
        [userId, input.plan, input.provider?.trim() || "mock", now, currentPeriodEnd]
      );
      await addSyncEvent(client, userId, "billing_subscription", userId, "subscribed", {
        plan: input.plan,
        provider: input.provider?.trim() || "mock"
      });
      await client.query("COMMIT");
      return mapBillingSubscription(upserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelSubscription(userId: string): Promise<BillingSubscription> {
    await this.ensureBillingSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureUser(client, userId);

      const existing = await client.query<BillingSubscriptionRow>(
        `SELECT * FROM billing_subscriptions WHERE user_id = $1 LIMIT 1`,
        [userId]
      );

      if ((existing.rowCount ?? 0) === 0) {
        const now = new Date();
        const inserted = await client.query<BillingSubscriptionRow>(
          `
            INSERT INTO billing_subscriptions (
              user_id, plan, status, provider, started_at, current_period_end, canceled_at
            )
            VALUES ($1, 'free', 'active', 'none', $2, NULL, NULL)
            RETURNING *
          `,
          [userId, now]
        );
        await client.query("COMMIT");
        return mapBillingSubscription(inserted.rows[0]);
      }

      const row = existing.rows[0];
      const canceled = await client.query<BillingSubscriptionRow>(
        `
          UPDATE billing_subscriptions
          SET
            status = CASE WHEN plan = 'free' THEN status ELSE 'canceled' END,
            canceled_at = CASE WHEN plan = 'free' THEN canceled_at ELSE NOW() END,
            updated_at = NOW()
          WHERE user_id = $1
          RETURNING *
        `,
        [userId]
      );
      await addSyncEvent(client, userId, "billing_subscription", userId, "canceled", {
        plan: row.plan
      });
      await client.query("COMMIT");
      return mapBillingSubscription(canceled.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pullSync(userId: string, sinceEventId: number): Promise<{ events: SyncEvent[]; lastEventId: number }> {
    const eventsResult = await this.pool.query<{
      id: number;
      user_id: string;
      entity_type: string;
      entity_id: string;
      action: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `
        SELECT id, user_id, entity_type, entity_id, action, payload, created_at
        FROM sync_events
        WHERE user_id = $1 AND id > $2
        ORDER BY id ASC
        LIMIT 500
      `,
      [userId, sinceEventId]
    );

    const lastResult = await this.pool.query<{ max_id: number | null }>(
      `SELECT MAX(id) AS max_id FROM sync_events WHERE user_id = $1`,
      [userId]
    );
    const lastEventId = lastResult.rows[0]?.max_id ?? 0;

    return {
      events: eventsResult.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        action: row.action,
        payload: row.payload ?? {},
        createdAt: row.created_at.toISOString()
      })),
      lastEventId
    };
  }

  async pushSync(
    userId: string,
    operations: ClientOperation[]
  ): Promise<{ accepted: number; rejected: number; lastEventId: number }> {
    let accepted = 0;
    let rejected = 0;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureUser(client, userId);
      for (const operation of operations) {
        const opKey = `${userId}:${operation.opId}`;
        if (this.processedSyncOperationIds.has(opKey)) {
          accepted += 1;
          continue;
        }
        if (await hasProcessedSyncOperation(client, userId, operation.opId)) {
          this.processedSyncOperationIds.add(opKey);
          accepted += 1;
          continue;
        }

        const applied = await applySyncOperation(client, userId, operation);
        this.processedSyncOperationIds.add(opKey);
        if (applied) {
          accepted += 1;
        } else {
          rejected += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const last = await this.pool.query<{ max_id: number | null }>(
      `SELECT MAX(id) AS max_id FROM sync_events WHERE user_id = $1`,
      [userId]
    );
    return {
      accepted,
      rejected,
      lastEventId: last.rows[0]?.max_id ?? 0
    };
  }

  async claimParserJob(): Promise<ParserJobClaim | null> {
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

  async completeParserJob(jobId: string, result: ParserResultInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rowResult = await client.query<{ item_id: string; user_id: string; title: string | null; source_url: string }>(
        `
          SELECT pj.item_id, i.user_id, i.title, i.source_url
          FROM parser_jobs pj
          JOIN items i ON i.id = pj.item_id
          WHERE pj.id = $1
          LIMIT 1
        `,
        [jobId]
      );
      if (rowResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return;
      }
      const row = rowResult.rows[0];
      const cleanedPlainText = sanitizeParserBodyText(result.plainText);
      const cleanedMarkdownContent = sanitizeParserBodyText(result.markdownContent ?? result.plainText);
      const cleanedExcerpt = sanitizeParserExcerpt(result.excerpt);
      const cleanedMetaText = sanitizeParserMetaText(
        [result.markdownContent, result.plainText, result.excerpt].filter(Boolean).join("\n")
      );
      const cleanedHtmlContent = shouldDiscardParsedHtml(result.htmlContent) ? undefined : result.htmlContent;
      const normalizedAssets = buildStableParsedAssets(row.item_id, result.assets);
      const firstImageUrl = normalizedAssets.find((asset) => asset.type === "image")?.url ?? null;
      const currentTags = await listTagsByItemIdWithClient(client, row.item_id);
      const autoTags = extractTagsFromText(
        [result.title, cleanedExcerpt, cleanedMetaText, result.plainText].filter(Boolean).join("\n")
      );
      const mergedTags = mergeTags(currentTags, autoTags);
      const titleCandidate = deriveTopicTitle({
        currentTitle: row.title ?? undefined,
        parsedTitle: result.title,
        plainText: cleanedPlainText,
        excerpt: cleanedExcerpt
      });
      const resolvedTitle = appendBylineToTitle(titleCandidate, result.byline);

      await client.query(
        `
          UPDATE items
          SET
            status = 'ready',
            title = COALESCE($2, title),
            parsed_at = NOW(),
            parser_version = $3,
            cover_image_url = COALESCE($4, cover_image_url),
            updated_at = NOW()
          WHERE id = $1
        `,
        [row.item_id, resolvedTitle ?? null, result.parserVersion, firstImageUrl]
      );
      await replaceItemTags(client, row.user_id, row.item_id, mergedTags);

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
          row.item_id,
          cleanedHtmlContent ?? null,
          (cleanedMetaText || cleanedMarkdownContent) || null,
          cleanedPlainText || null,
          result.wordCount,
          result.readingMinutes,
          cleanedExcerpt ?? null
        ]
      );

      await client.query(`DELETE FROM item_assets WHERE item_id = $1`, [row.item_id]);
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
            INSERT INTO item_assets (id, item_id, asset_type, asset_url, width, height, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [asset.id, row.item_id, asset.type, asset.url, width, height, index]
        );
      }

      await client.query(
        `
          UPDATE parser_jobs
          SET status = 'done', updated_at = NOW(), error_message = NULL
          WHERE id = $1
        `,
        [jobId]
      );

      await addSyncEvent(client, row.user_id, "item", row.item_id, "parsed", {
        parserVersion: result.parserVersion,
        wordCount: result.wordCount
      });

      await client.query("COMMIT");
      scheduleAssetCacheWarmup(row.item_id, row.source_url, normalizedAssets);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failParserJob(jobId: string, reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rowResult = await client.query<{ item_id: string; user_id: string }>(
        `
          SELECT pj.item_id, i.user_id
          FROM parser_jobs pj
          JOIN items i ON i.id = pj.item_id
          WHERE pj.id = $1
          LIMIT 1
        `,
        [jobId]
      );
      if (rowResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return;
      }
      const row = rowResult.rows[0];

      await client.query(
        `
          UPDATE parser_jobs
          SET status = 'failed', updated_at = NOW(), error_message = $2
          WHERE id = $1
        `,
        [jobId, reason.slice(0, 2000)]
      );

      await client.query(
        `
          UPDATE items
          SET status = 'failed', updated_at = NOW()
          WHERE id = $1
        `,
        [row.item_id]
      );

      await addSyncEvent(client, row.user_id, "item", row.item_id, "parse_failed", {
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

  async requestItemReparse(userId: string, itemId: string): Promise<ParserJobDiagnostics | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query<{ id: string; source_url: string }>(
        `
          SELECT id, source_url
          FROM items
          WHERE id = $1 AND user_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [itemId, userId]
      );
      if ((owned.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const activeResult = await client.query<{
        id: string;
        status: "queued" | "running";
        attempts: number;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `
          SELECT id, status, attempts, error_message, created_at, updated_at
          FROM parser_jobs
          WHERE item_id = $1
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [itemId]
      );

      let diagnostics: ParserJobDiagnostics;
      if ((activeResult.rowCount ?? 0) > 0) {
        const row = activeResult.rows[0];
        diagnostics = mapParserDiagnostics(itemId, {
          item_id: itemId,
          job_id: row.id,
          status: row.status,
          attempts: row.attempts,
          error_message: row.error_message,
          created_at: row.created_at,
          updated_at: row.updated_at
        });
      } else {
        const inserted = await client.query<{
          id: string;
          status: "queued" | "running" | "done" | "failed";
          attempts: number;
          error_message: string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `
            INSERT INTO parser_jobs (item_id, status)
            VALUES ($1, 'queued')
            RETURNING id, status, attempts, error_message, created_at, updated_at
          `,
          [itemId]
        );
        const row = inserted.rows[0];
        diagnostics = mapParserDiagnostics(itemId, {
          item_id: itemId,
          job_id: row.id,
          status: row.status,
          attempts: row.attempts,
          error_message: row.error_message,
          created_at: row.created_at,
          updated_at: row.updated_at
        });
        await addSyncEvent(client, userId, "item", itemId, "reparse_requested", {
          jobId: row.id
        });
      }

      await client.query(
        `
          UPDATE items
          SET status = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [itemId, diagnostics.status === "running" ? "parsing" : "queued"]
      );

      await client.query("COMMIT");
      return diagnostics;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getParserDiagnostics(userId: string, itemId: string): Promise<ParserJobDiagnostics | null> {
    const result = await this.pool.query<ParserJobRow>(
      `
        SELECT
          i.id AS item_id,
          pj.id AS job_id,
          pj.status AS status,
          pj.attempts AS attempts,
          pj.error_message AS error_message,
          pj.created_at AS created_at,
          pj.updated_at AS updated_at
        FROM items i
        LEFT JOIN LATERAL (
          SELECT id, status, attempts, error_message, created_at, updated_at
          FROM parser_jobs
          WHERE item_id = i.id
          ORDER BY created_at DESC
          LIMIT 1
        ) pj ON true
        WHERE i.id = $1
          AND i.user_id = $2
        LIMIT 1
      `,
      [itemId, userId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return null;
    }
    return mapParserDiagnostics(itemId, result.rows[0]);
  }

  private async runSummaryJob(userId: string, itemId: string): Promise<void> {
    const key = summaryRuntimeKey(userId, itemId);
    this.summaryTimers.delete(key);
    this.updateSummaryRuntime(userId, itemId, {
      status: "running",
      keyPoints: []
    });

    type SummarySourceRow = {
      status: ItemStatus;
      plain_text: string | null;
      markdown_content: string | null;
      html_content: string | null;
    };

    const sourceResult = await this.pool.query<SummarySourceRow>(
      `
        SELECT i.status, c.plain_text, c.markdown_content, c.html_content
        FROM items i
        LEFT JOIN item_contents c ON c.item_id = i.id
        WHERE i.id = $1 AND i.user_id = $2
        LIMIT 1
      `,
      [itemId, userId]
    );
    if ((sourceResult.rowCount ?? 0) === 0) {
      this.updateSummaryRuntime(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: "条目不存在或无权限访问"
      });
      return;
    }

    const source = sourceResult.rows[0];
    if (source.status !== "ready") {
      this.updateSummaryRuntime(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: "内容尚未解析完成"
      });
      return;
    }

    const generated = generateSummary({
      plainText: source.plain_text ?? undefined,
      markdownContent: source.markdown_content ?? undefined,
      htmlContent: source.html_content ?? undefined
    });
    if (!generated) {
      this.updateSummaryRuntime(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: "正文为空，无法生成摘要"
      });
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO ai_summaries (item_id, user_id, provider, model, summary_md, key_points)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [itemId, userId, "seedbox-local", "extractive-v1", generated.summaryText, JSON.stringify(generated.keyPoints)]
      );
      await client.query(
        `
          INSERT INTO item_contents (item_id, summary_short)
          VALUES ($1, $2)
          ON CONFLICT (item_id)
          DO UPDATE SET
            summary_short = EXCLUDED.summary_short,
            updated_at = NOW()
        `,
        [itemId, generated.summaryShort]
      );
      await addSyncEvent(client, userId, "ai_summary", itemId, "updated", {
        provider: "seedbox-local",
        model: "extractive-v1"
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      this.updateSummaryRuntime(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : "摘要任务失败"
      });
      return;
    } finally {
      client.release();
    }

    this.updateSummaryRuntime(userId, itemId, {
      status: "ready",
      summaryText: generated.summaryText,
      keyPoints: generated.keyPoints,
      provider: "seedbox-local",
      model: "extractive-v1",
      errorMessage: undefined
    });
  }

  private async readLatestSummary(userId: string, itemId: string): Promise<ItemSummarySnapshot | null> {
    const result = await this.pool.query<SummaryRow>(
      `
        SELECT provider, model, summary_md, key_points, created_at
        FROM ai_summaries
        WHERE user_id = $1 AND item_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId, itemId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    const row = result.rows[0];
    const parsedKeyPoints = parseKeyPoints(row.key_points);
    return {
      itemId,
      status: "ready",
      summaryText: row.summary_md,
      keyPoints: parsedKeyPoints.length > 0 ? parsedKeyPoints : [row.summary_md],
      provider: row.provider,
      model: row.model,
      updatedAt: row.created_at.toISOString()
    };
  }

  private updateSummaryRuntime(
    userId: string,
    itemId: string,
    patch: Omit<ItemSummarySnapshot, "itemId" | "updatedAt"> & Partial<Pick<ItemSummarySnapshot, "updatedAt">>
  ): ItemSummarySnapshot {
    const key = summaryRuntimeKey(userId, itemId);
    const next: ItemSummarySnapshot = {
      itemId,
      status: patch.status,
      summaryText: patch.summaryText,
      keyPoints: patch.keyPoints,
      errorMessage: patch.errorMessage,
      provider: patch.provider,
      model: patch.model,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    this.summarySnapshots.set(key, next);
    return next;
  }

  private clearSummaryTimer(key: string): void {
    const timer = this.summaryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.summaryTimers.delete(key);
    }
  }

  private clearSummaryRuntimeState(userId: string, itemId: string): void {
    const key = summaryRuntimeKey(userId, itemId);
    this.clearSummaryTimer(key);
    this.summarySnapshots.delete(key);
  }
}

async function ensureUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO users (id, display_name)
      VALUES ($1, 'Seedbox User')
      ON CONFLICT (id) DO NOTHING
    `,
    [userId]
  );
}

async function replaceItemTags(client: PoolClient, userId: string, itemId: string, tags: string[]): Promise<void> {
  const normalized = uniqTags(tags);
  await client.query(`DELETE FROM item_tags WHERE item_id = $1`, [itemId]);
  for (const tag of normalized) {
    const tagInsert = await client.query<{ id: string }>(
      `
        INSERT INTO tags (user_id, name)
        VALUES ($1, $2)
        ON CONFLICT (user_id, name)
        DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `,
      [userId, tag]
    );
    const tagId = tagInsert.rows[0].id;
    await client.query(
      `
        INSERT INTO item_tags (item_id, tag_id)
        VALUES ($1, $2)
        ON CONFLICT (item_id, tag_id) DO NOTHING
      `,
      [itemId, tagId]
    );
  }
}

async function listTagsByItemIdWithClient(client: PoolClient, itemId: string): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `
      SELECT t.name
      FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = $1
      ORDER BY t.name ASC
    `,
    [itemId]
  );
  return result.rows.map((row) => row.name);
}

async function resolveCollectionId(
  client: PoolClient,
  userId: string,
  collectionId: string | null | undefined
): Promise<string | null> {
  if (!collectionId || !isUuid(collectionId)) {
    return null;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM collections
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [collectionId, userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return result.rows[0].id;
}

async function listTagsByItemId(pool: Pool, itemId: string): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    `
      SELECT t.name
      FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = $1
      ORDER BY t.name ASC
    `,
    [itemId]
  );
  return result.rows.map((row) => row.name);
}

async function listTagsByItemIds(pool: Pool, itemIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (itemIds.length === 0) {
    return map;
  }

  const result = await pool.query<{ item_id: string; name: string }>(
    `
      SELECT it.item_id, t.name
      FROM item_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.item_id = ANY($1::uuid[])
      ORDER BY it.item_id, t.name
    `,
    [itemIds]
  );

  for (const row of result.rows) {
    const existing = map.get(row.item_id) ?? [];
    existing.push(row.name);
    map.set(row.item_id, existing);
  }
  return map;
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

async function hasProcessedSyncOperation(client: PoolClient, userId: string, opId: string): Promise<boolean> {
  const result = await client.query<{ exists: number }>(
    `
      SELECT 1 AS exists
      FROM sync_events
      WHERE user_id = $1
        AND payload->>'opId' = $2
      LIMIT 1
    `,
    [userId, opId]
  );
  return (result.rowCount ?? 0) > 0;
}

async function applySyncOperation(
  client: PoolClient,
  userId: string,
  operation: ClientOperation
): Promise<boolean> {
  const clientTs = readClientTimestamp(operation.payload);
  switch (operation.action) {
    case "create_capture": {
      const sourceUrl = readString(operation.payload, "sourceUrl");
      if (!sourceUrl) {
        return false;
      }
      const resolvedSourceUrl = await resolveCaptureSourceUrl(sourceUrl);
      const titleHint = readString(operation.payload, "titleHint");
      const tags = readStringArray(operation.payload, "tags");
      const collectionId = await resolveCollectionId(client, userId, readString(operation.payload, "collectionId"));
      const canonicalUrl = buildCanonicalItemUrl(resolvedSourceUrl);
      const domain = safeDomain(resolvedSourceUrl);

      const inserted = await client.query<ItemRow>(
        `
          INSERT INTO items (user_id, collection_id, source_url, canonical_url, domain, title, status, is_favorite)
          VALUES ($1, $2, $3, $4, $5, $6, 'queued', false)
          ON CONFLICT (user_id, url_key)
          DO UPDATE SET
            updated_at = NOW(),
            archived_at = NULL,
            source_url = EXCLUDED.source_url,
            canonical_url = EXCLUDED.canonical_url,
            domain = EXCLUDED.domain,
            status = 'queued',
            parsed_at = NULL,
            collection_id = COALESCE(EXCLUDED.collection_id, items.collection_id),
            title = COALESCE(EXCLUDED.title, items.title)
          RETURNING *
        `,
        [userId, collectionId, resolvedSourceUrl, canonicalUrl, domain, titleHint]
      );
      const row = inserted.rows[0];

      await client.query(`INSERT INTO item_contents (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING`, [row.id]);
      await client.query(`INSERT INTO parser_jobs (item_id, status) VALUES ($1, 'queued')`, [row.id]);
      if (tags.length > 0) {
        await replaceItemTags(client, userId, row.id, tags);
      }
      await addSyncEvent(client, userId, "item", row.id, "created", {
        sourceUrl: row.source_url,
        opId: operation.opId
      });
      return true;
    }
    case "archive": {
      const itemId = readEntityId(operation.payload);
      if (!isUuid(itemId)) {
        return false;
      }
      if (!(await shouldApplyLwwForItem(client, userId, itemId, clientTs))) {
        return false;
      }
      const updated = await client.query<{ id: string }>(
        `
          UPDATE items
          SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [itemId, userId]
      );
      if (updated.rowCount) {
        await addSyncEvent(client, userId, "item", itemId, "updated", {
          archived: true,
          opId: operation.opId
        });
        return true;
      }
      return false;
    }
    case "restore": {
      const itemId = readEntityId(operation.payload);
      if (!isUuid(itemId)) {
        return false;
      }
      if (!(await shouldApplyLwwForItem(client, userId, itemId, clientTs))) {
        return false;
      }
      const updated = await client.query<{ id: string }>(
        `
          UPDATE items
          SET archived_at = NULL, updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [itemId, userId]
      );
      if (updated.rowCount) {
        await addSyncEvent(client, userId, "item", itemId, "updated", {
          archived: false,
          opId: operation.opId
        });
        return true;
      }
      return false;
    }
    case "permanent_delete": {
      const itemId = readEntityId(operation.payload);
      if (!isUuid(itemId)) {
        return false;
      }
      if (!(await shouldApplyLwwForItem(client, userId, itemId, clientTs))) {
        return false;
      }
      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM items
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [itemId, userId]
      );
      if (deleted.rowCount) {
        await addSyncEvent(client, userId, "item", itemId, "deleted", {
          permanent: true,
          opId: operation.opId
        });
        return true;
      }
      return false;
    }
    case "purge_archived": {
      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM items
          WHERE user_id = $1 AND archived_at IS NOT NULL
          RETURNING id
        `,
        [userId]
      );
      const deletedCount = deleted.rowCount ?? 0;
      if (deletedCount > 0) {
        await addSyncEvent(
          client,
          userId,
          "item",
          "00000000-0000-0000-0000-000000000000",
          "purged_archived",
          {
            deletedCount,
            opId: operation.opId
          }
        );
      }
      return true;
    }
    default: {
      const entityId = readEntityId(operation.payload);
      await addSyncEvent(client, userId, operation.entityType, entityId, operation.action, {
        opId: operation.opId,
        ...operation.payload
      });
      return true;
    }
  }
}

function summaryRuntimeKey(userId: string, itemId: string): string {
  return `${userId}:${itemId}`;
}

function parseKeyPoints(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function pickPreferredSummary(
  runtime: ItemSummarySnapshot | undefined,
  persisted: ItemSummarySnapshot | null
): ItemSummarySnapshot | null {
  if (!runtime) {
    return persisted;
  }
  if (!persisted) {
    return runtime;
  }
  const runtimeTs = Date.parse(runtime.updatedAt);
  const persistedTs = Date.parse(persisted.updatedAt);
  if (Number.isNaN(runtimeTs) || Number.isNaN(persistedTs)) {
    return runtime;
  }
  return runtimeTs >= persistedTs ? runtime : persisted;
}

function mapHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    quote: row.quote,
    startOffset: row.start_offset ?? undefined,
    endOffset: row.end_offset ?? undefined,
    color: row.color,
    note: row.note ?? undefined,
    createdAt: row.created_at.toISOString()
  };
}

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    title: row.title ?? undefined,
    bodyMd: row.body_md,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id ?? undefined,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapBillingSubscription(row: BillingSubscriptionRow): BillingSubscription {
  return {
    userId: row.user_id,
    plan: row.plan,
    status: row.status,
    provider: row.provider,
    startedAt: row.started_at.toISOString(),
    currentPeriodEnd: row.current_period_end?.toISOString(),
    canceledAt: row.canceled_at?.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function createDefaultSubscription(userId: string): BillingSubscription {
  const now = new Date().toISOString();
  return {
    userId,
    plan: "free",
    status: "active",
    provider: "none",
    startedAt: now,
    updatedAt: now
  };
}

function mapItem(row: ItemRow, tags: string[]): Item {
  return {
    id: row.id,
    userId: row.user_id,
    collectionId: row.collection_id ?? undefined,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url ?? undefined,
    domain: row.domain ?? undefined,
    title: row.title ?? undefined,
    coverImageUrl: row.cover_image_url ?? undefined,
    status: row.status,
    tags,
    isFavorite: row.is_favorite,
    archivedAt: row.archived_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapAsset(row: AssetRow): ItemAsset {
  return {
    id: row.id,
    itemId: row.item_id,
    type: row.asset_type,
    url: row.asset_url,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString()
  };
}

function mapParserDiagnostics(itemId: string, row?: ParserJobRow): ParserJobDiagnostics {
  if (!row || !row.job_id || !row.status) {
    return {
      itemId,
      status: "idle",
      attempts: 0
    };
  }
  return {
    itemId,
    status: row.status,
    attempts: row.attempts ?? 0,
    errorMessage: row.error_message ?? undefined,
    jobId: row.job_id,
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString()
  };
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function uniqTags(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function readEntityId(payload: Record<string, unknown>): string {
  const value = payload.itemId;
  if (typeof value === "string" && isUuid(value)) {
    return value;
  }
  return "00000000-0000-0000-0000-000000000000";
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqTags(value.filter((entry): entry is string => typeof entry === "string"));
}

function readClientTimestamp(payload: Record<string, unknown>): number | null {
  const raw = payload.clientTs;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    return null;
  }
  return ts;
}

async function shouldApplyLwwForItem(
  client: PoolClient,
  userId: string,
  itemId: string,
  incomingClientTs: number | null
): Promise<boolean> {
  const result = await client.query<{ updated_at: Date }>(
    `
      SELECT updated_at
      FROM items
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [itemId, userId]
  );
  if ((result.rowCount ?? 0) === 0) {
    return false;
  }
  if (incomingClientTs === null) {
    return true;
  }
  const updatedAt = result.rows[0]?.updated_at;
  if (!updatedAt) {
    return true;
  }
  return incomingClientTs >= updatedAt.getTime();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
