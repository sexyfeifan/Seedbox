import { z } from "zod";
import type { ParseResult } from "./types.js";

const claimSchema = z.object({
  job: z
    .object({
      jobId: z.string(),
      itemId: z.string(),
      sourceUrl: z.string().url(),
      userId: z.string()
    })
    .nullable()
});

export interface ClaimedApiJob {
  jobId: string;
  itemId: string;
  sourceUrl: string;
  userId: string;
}

export class InternalApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async claim(): Promise<ClaimedApiJob | null> {
    const response = await this.request("/v1/internal/parser/claim", {
      method: "POST",
      headers: { "x-internal-token": this.token }
    });
    if (!response.ok) {
      throw new Error(`claim failed with status ${response.status}`);
    }
    const parsed = claimSchema.parse(await response.json());
    return parsed.job;
  }

  async complete(jobId: string, result: ParseResult): Promise<void> {
    const response = await this.request(`/v1/internal/parser/${jobId}/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": this.token
      },
      body: JSON.stringify(result)
    });
    if (!response.ok) {
      throw new Error(`complete failed with status ${response.status}`);
    }
  }

  async fail(jobId: string, reason: string): Promise<void> {
    const response = await this.request(`/v1/internal/parser/${jobId}/fail`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": this.token
      },
      body: JSON.stringify({ reason })
    });
    if (!response.ok) {
      throw new Error(`fail failed with status ${response.status}`);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await fetch(url, init);
    } catch (error) {
      const reason =
        error instanceof Error
          ? `${error.message}${error.cause ? ` (cause: ${String(error.cause)})` : ""}`
          : String(error);
      throw new Error(`request ${url} failed: ${reason}`);
    }
  }
}
