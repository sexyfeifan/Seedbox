import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { extractFirstHttpUrl, extractTitleHintFromShareText, resolveCaptureSourceUrl } from "../../lib/url-extract.js";
import { resolveUser } from "../../lib/user.js";

const captureSchema = z.object({
  sourceUrl: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : String(value ?? "")),
    z.string()
  ),
  titleHint: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : undefined),
    z.string().optional()
  ),
  sourceApp: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : undefined),
    z.string().optional()
  ),
  collectionId: z.preprocess((value) => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().uuid().optional().catch(undefined)),
  tags: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return undefined;
  }, z.array(z.string()).optional())
});

export const captureRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/captures", async (request, reply) => {
    const user = resolveUser(request);

    const body = captureSchema.parse(request.body);
    const sourceUrl = extractFirstHttpUrl(body.sourceUrl);
    if (!sourceUrl) {
      throw app.httpErrors.badRequest("sourceUrl must contain a valid http/https URL");
    }
    const resolvedSourceUrl = await resolveCaptureSourceUrl(sourceUrl);
    const titleHint = body.titleHint ?? extractTitleHintFromShareText(body.sourceUrl);
    const item = await app.store.createItem(user.id, {
      sourceUrl: resolvedSourceUrl,
      titleHint,
      tags: body.tags,
      collectionId: body.collectionId
    });

    return reply.code(202).send({
      itemId: item.id,
      status: item.status
    });
  });
};
