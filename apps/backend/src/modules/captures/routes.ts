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
  }, z.array(z.string()).optional()),
  plainText: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined),
    z.string().optional()
  )
});

export const captureRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/captures", async (request, reply) => {
    const user = resolveUser(request);

    const body = captureSchema.parse(request.body);
    const sourceUrl = extractFirstHttpUrl(body.sourceUrl);

    if (!sourceUrl && body.plainText) {
      const now = new Date().toISOString();
      const title = body.titleHint || body.plainText.slice(0, 80).replace(/\n/g, " ").trim();
      const pseudoUrl = `note://${Date.now()}`;
      const item = await app.store.createItem(user.id, {
        sourceUrl: pseudoUrl,
        titleHint: title,
        tags: body.tags,
        collectionId: body.collectionId
      });
      await app.store.updateItemContent(user.id, item.id, {
        plainText: body.plainText,
        markdownContent: body.plainText
      });
      await app.store.updateItem(user.id, item.id, { status: "ready" });
      return reply.code(201).send({
        itemId: item.id,
        status: "ready"
      });
    }

    if (!sourceUrl) {
      throw app.httpErrors.badRequest("sourceUrl must contain a valid http/https URL, or provide plainText for note capture");
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
