import { z } from "zod";
import { InternalApiClient } from "./internal-api-client.js";
import { JobRepository } from "./job-repository.js";
import { runParseJob } from "./worker.js";
import type { ParseJob } from "./types.js";

const parseJobSchema = z.object({
  jobId: z.string().min(1),
  itemId: z.string().min(1),
  sourceUrl: z.string().url()
});

const MAX_RETRIES = Number(process.env.WORKER_MAX_RETRIES ?? 3);
const BACKOFF_BASE_MS = Number(process.env.WORKER_BACKOFF_BASE_MS ?? 5000);
const BACKOFF_MAX_MS = Number(process.env.WORKER_BACKOFF_MAX_MS ?? 120000);

function getBackoffMs(attempt: number): number {
  const jitter = Math.random() * 1000;
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt) + jitter, BACKOFF_MAX_MS);
}

function isRetryableError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes("playwright_unavailable")) return false;
  if (msg.includes("401") || msg.includes("403") || msg.includes("forbidden")) return false;
  if (msg.includes("not found") || msg.includes("404") || msg.includes("410")) return false;
  return true;
}

async function runWithRetry(job: ParseJob, maxRetries: number): Promise<import("./types.js").ParseResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runParseJob(job);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }
      const backoffMs = getBackoffMs(attempt);
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[retry] job ${job.jobId} attempt ${attempt + 1}/${maxRetries + 1} failed: ${reason} — retrying in ${Math.round(backoffMs)}ms`
      );
      await sleep(backoffMs);
    }
  }
  throw lastError;
}

async function main() {
  const workerVersion = (process.env.SEEDBOX_PARSER_VERSION ?? "v0.1.72").trim() || "v0.1.72";
  const sample = process.env.SAMPLE_JOB;
  if (sample) {
    const job = parseJobSchema.parse(JSON.parse(sample));
    const result = await runParseJob(job);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const mode = process.env.WORKER_MODE ?? "api";
  const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 3000);

  if (mode === "db") {
    const databaseUrl = process.env.DATABASE_URL ?? "postgresql://seedbox:seedbox@localhost:5432/seedbox";
    const repository = JobRepository.fromDatabaseUrl(databaseUrl);

    let stopped = false;
    const stop = async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await repository.close();
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    console.log(`parser_worker ${workerVersion} started in db mode (poll ${intervalMs}ms, maxRetries ${MAX_RETRIES})`);
    while (!stopped) {
      const job = await repository.claimNextJob();
      if (!job) {
        await sleep(intervalMs);
        continue;
      }

      try {
        const result = await runWithRetry(job, MAX_RETRIES);
        await repository.completeJob(job, result);
        console.log(`job ${job.jobId} done: ${job.sourceUrl}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await repository.failJob(job, reason);
        console.error(`job ${job.jobId} failed: ${reason}`);
      }
    }
    return;
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
  const token = process.env.INTERNAL_API_TOKEN ?? "seedbox-dev-token";
  const apiClient = new InternalApiClient(apiBaseUrl, token);
  console.log(
    `parser_worker ${workerVersion} started in api mode (poll ${intervalMs}ms, base ${apiBaseUrl}, maxRetries ${MAX_RETRIES})`
  );

  while (true) {
    let job: Awaited<ReturnType<typeof apiClient.claim>>;
    try {
      job = await apiClient.claim();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`claim error (retrying in ${intervalMs}ms): ${reason}`);
      await sleep(intervalMs);
      continue;
    }

    if (!job) {
      await sleep(intervalMs);
      continue;
    }

    try {
      const result = await runWithRetry(job, MAX_RETRIES);
      await apiClient.complete(job.jobId, result);
      console.log(`job ${job.jobId} done: ${job.sourceUrl}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      try {
        await apiClient.fail(job.jobId, reason);
      } catch { /* best-effort */ }
      console.error(`job ${job.jobId} failed: ${reason}`);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
