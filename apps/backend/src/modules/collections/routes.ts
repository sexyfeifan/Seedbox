import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveUser } from "../../lib/user.js";

const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().optional(),
  sortOrder: z.number().int().optional()
});

const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.union([z.string().uuid(), z.null()]).optional(),
  sortOrder: z.number().int().optional()
});

export const collectionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/collections", async (request) => {
    const user = resolveUser(request);
    const collections = await app.store.listCollections(user.id);
    return { items: collections };
  });

  app.post("/v1/collections", async (request, reply) => {
    const user = resolveUser(request);
    const body = createCollectionSchema.parse(request.body);
    const created = await app.store.createCollection(user.id, body);
    return reply.code(201).send(created);
  });

  app.patch("/v1/collections/:collectionId", async (request, reply) => {
    const user = resolveUser(request);
    const { collectionId } = z.object({ collectionId: z.string().uuid() }).parse(request.params);
    const body = updateCollectionSchema.parse(request.body);
    const updated = await app.store.updateCollection(user.id, collectionId, body);
    if (!updated) {
      return reply.notFound("Collection not found");
    }
    return updated;
  });

  app.delete("/v1/collections/:collectionId", async (request, reply) => {
    const user = resolveUser(request);
    const { collectionId } = z.object({ collectionId: z.string().uuid() }).parse(request.params);
    const deleted = await app.store.deleteCollection(user.id, collectionId);
    if (!deleted) {
      return reply.notFound("Collection not found");
    }
    return reply.code(204).send();
  });
};
