import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveUserId } from "../../lib/user.js";

const clientOperationSchema = z.object({
  opId: z.string().min(1),
  entityType: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown())
});

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/sync/pull", async (request) => {
    const userId = resolveUserId(request);
    const body = z
      .object({
        sinceEventId: z.coerce.number().int().nonnegative()
      })
      .parse(request.body);

    return app.store.pullSync(userId, body.sinceEventId);
  });

  app.post("/v1/sync/push", async (request) => {
    const userId = resolveUserId(request);
    const body = z
      .object({
        operations: z.array(clientOperationSchema)
      })
      .parse(request.body);

    return app.store.pushSync(userId, body.operations);
  });
};
