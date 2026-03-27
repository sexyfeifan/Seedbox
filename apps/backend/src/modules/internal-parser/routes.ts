import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const parseResultSchema = z.object({
  title: z.string().optional(),
  byline: z.string().optional(),
  excerpt: z.string().optional(),
  htmlContent: z.string().optional(),
  markdownContent: z.string().optional(),
  plainText: z.string().optional(),
  assets: z
    .array(
      z.object({
        type: z.enum(["image", "video", "file"]),
        url: z.string().url(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional()
      })
    )
    .max(100)
    .optional(),
  wordCount: z.number().int().nonnegative(),
  readingMinutes: z.number().int().nonnegative(),
  parserVersion: z.string().min(1)
});

const failBodySchema = z.object({
  reason: z.string().min(1).max(2000)
});

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? "seedbox-dev-token";

function isAuthorized(tokenValue: unknown): boolean {
  return typeof tokenValue === "string" && tokenValue === INTERNAL_TOKEN;
}

export const internalParserRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/internal/parser/claim", async (request, reply) => {
    if (!isAuthorized(request.headers["x-internal-token"])) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const job = await app.store.claimParserJob();
    return { job };
  });

  app.post("/v1/internal/parser/:jobId/complete", async (request, reply) => {
    if (!isAuthorized(request.headers["x-internal-token"])) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = parseResultSchema.parse(request.body);
    await app.store.completeParserJob(jobId, body);
    return reply.code(204).send();
  });

  app.post("/v1/internal/parser/:jobId/fail", async (request, reply) => {
    if (!isAuthorized(request.headers["x-internal-token"])) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = failBodySchema.parse(request.body);
    await app.store.failParserJob(jobId, body.reason);
    return reply.code(204).send();
  });
};
