import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveUser, resolveUserId } from "../../lib/user.js";

const itemParamsSchema = z.object({
  itemId: z.string().uuid()
});

const highlightParamsSchema = z.object({
  itemId: z.string().uuid(),
  highlightId: z.string().uuid()
});

const noteParamsSchema = z.object({
  itemId: z.string().uuid(),
  noteId: z.string().uuid()
});

const createHighlightSchema = z.object({
  quote: z.string().trim().min(1).max(4000),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  color: z.string().trim().min(1).max(32).optional(),
  note: z.string().trim().max(2000).optional()
});

const createNoteSchema = z.object({
  title: z.string().trim().max(200).optional(),
  bodyMd: z.string().min(1).max(20000)
});

const updateNoteSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    bodyMd: z.string().min(1).max(20000).optional()
  })
  .refine((value) => value.title !== undefined || value.bodyMd !== undefined, {
    message: "At least one field is required"
  });

export const annotationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/items/:itemId/highlights", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId } = itemParamsSchema.parse(request.params);
    const body = createHighlightSchema.parse(request.body);
    const created = await app.store.createHighlight(user.id, itemId, body);
    if (!created) {
      return reply.notFound("Item not found");
    }
    return reply.code(201).send(created);
  });

  app.get("/v1/items/:itemId/highlights", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = itemParamsSchema.parse(request.params);
    const highlights = await app.store.listHighlights(userId, itemId);
    const item = await app.store.getItem(userId, itemId);
    if (!item) {
      return reply.notFound("Item not found");
    }
    return highlights;
  });

  app.delete("/v1/items/:itemId/highlights/:highlightId", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId, highlightId } = highlightParamsSchema.parse(request.params);
    const deleted = await app.store.deleteHighlight(user.id, itemId, highlightId);
    if (!deleted) {
      return reply.notFound("Highlight not found");
    }
    return reply.code(204).send();
  });

  app.post("/v1/items/:itemId/notes", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId } = itemParamsSchema.parse(request.params);
    const body = createNoteSchema.parse(request.body);
    const created = await app.store.createNote(user.id, itemId, body);
    if (!created) {
      return reply.notFound("Item not found");
    }
    return reply.code(201).send(created);
  });

  app.get("/v1/items/:itemId/notes", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId } = itemParamsSchema.parse(request.params);
    const notes = await app.store.listNotes(userId, itemId);
    const item = await app.store.getItem(userId, itemId);
    if (!item) {
      return reply.notFound("Item not found");
    }
    return notes;
  });

  app.patch("/v1/items/:itemId/notes/:noteId", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId, noteId } = noteParamsSchema.parse(request.params);
    const body = updateNoteSchema.parse(request.body);
    const updated = await app.store.updateNote(user.id, itemId, noteId, body);
    if (!updated) {
      return reply.notFound("Note not found");
    }
    return updated;
  });

  app.delete("/v1/items/:itemId/notes/:noteId", async (request, reply) => {
    const user = resolveUser(request);
    const { itemId, noteId } = noteParamsSchema.parse(request.params);
    const deleted = await app.store.deleteNote(user.id, itemId, noteId);
    if (!deleted) {
      return reply.notFound("Note not found");
    }
    return reply.code(204).send();
  });
};
