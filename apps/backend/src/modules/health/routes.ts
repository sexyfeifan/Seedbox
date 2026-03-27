import type { FastifyPluginAsync } from "fastify";
import { resolveClientFeatures } from "../../lib/runtime-flags.js";
import {
  resolveBackendVersion,
  resolveMobileVersion,
  resolveParserVersion,
  resolveReleaseVersion
} from "../../lib/version.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/health", async () => {
    return {
      ok: true,
      service: "seedbox-backend",
      timestamp: new Date().toISOString(),
      features: resolveClientFeatures(),
      version: {
        release: resolveReleaseVersion(),
        backend: resolveBackendVersion(),
        parser: resolveParserVersion(),
        mobile: resolveMobileVersion()
      }
    };
  });

  app.get("/v1/health/errors", async (request, reply) => {
    const internalToken = process.env.INTERNAL_API_TOKEN ?? "seedbox-dev-token";
    const headerToken = request.headers["x-internal-token"];
    const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (token !== internalToken) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return app.errorReporter.getStats();
  });
};
