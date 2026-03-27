import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

const publicDir = path.resolve(process.cwd(), "src/modules/web/public");

const assetSchema = z.object({
  asset: z.string().regex(/^[a-zA-Z0-9._-]+$/)
});

const contentTypeByExt: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export const webRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_, reply) => {
    return reply.redirect("/app");
  });

  app.get("/app", async (_, reply) => {
    return sendPublicFile(reply, "index.html");
  });

  app.get("/app/:asset", async (request, reply) => {
    const { asset } = assetSchema.parse(request.params);
    return sendPublicFile(reply, asset);
  });
};

async function sendPublicFile(reply: FastifyReply, fileName: string) {
  const filePath = path.join(publicDir, fileName);
  const ext = path.extname(fileName).toLowerCase();
  const contentType = contentTypeByExt[ext];
  if (!contentType) {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  }
  try {
    const content = await readFile(filePath, "utf8");
    return reply.type(contentType).send(content);
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  }
}
