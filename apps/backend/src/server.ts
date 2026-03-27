import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { annotationRoutes } from "./modules/annotations/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { captureRoutes } from "./modules/captures/routes.js";
import { collectionRoutes } from "./modules/collections/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { internalParserRoutes } from "./modules/internal-parser/routes.js";
import { itemRoutes } from "./modules/items/routes.js";
import { syncRoutes } from "./modules/sync/routes.js";
import { webRoutes } from "./modules/web/routes.js";
import { isCommercialModeEnabled } from "./lib/runtime-flags.js";
import { createErrorReporter } from "./observability/error-reporter.js";
import { InMemoryStore } from "./store/in-memory-store.js";
import { PostgresStore } from "./store/postgres-store.js";
import type { DataStore } from "./store/store.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard"
              }
            }
    }
  });

  const driver = process.env.STORE_DRIVER ?? "memory";
  const memoryStore =
    driver === "memory"
      ? new InMemoryStore({
          persistPath: process.env.MEMORY_STORE_PERSIST_PATH,
          persistDebounceMs: toNumberOrUndefined(process.env.MEMORY_STORE_PERSIST_DEBOUNCE_MS)
        })
      : null;
  if (memoryStore) {
    await memoryStore.loadFromDisk();
  }
  const store: DataStore =
    memoryStore ??
    PostgresStore.fromDatabaseUrl(
      process.env.DATABASE_URL ?? "postgresql://seedbox:seedbox@localhost:5432/seedbox"
    );

  app.decorate("store", store);
  app.decorate("errorReporter", await createErrorReporter(app.log));

  app.addHook("onClose", async () => {
    if (store instanceof InMemoryStore) {
      await store.flushToDisk();
    }
    if (store instanceof PostgresStore) {
      await store.close();
    }
  });

  app.register(cors, { origin: true, credentials: true });
  app.register(sensible);

  const clientAccessToken = (process.env.CLIENT_ACCESS_TOKEN ?? "").trim();
  const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (clientAccessToken) {
    app.addHook("preHandler", async (request, reply) => {
      const method = request.method.toUpperCase();
      if (!writeMethods.has(method)) {
        return;
      }
      const path = request.url.split("?", 1)[0];
      if (path.startsWith("/app") || path.startsWith("/v1/internal/") || path.startsWith("/v1/health")) {
        return;
      }

      const incoming = request.headers["x-client-token"];
      if (typeof incoming === "string" && incoming.trim() === clientAccessToken) {
        return;
      }
      return reply.code(401).send({ message: "Client token required" });
    });
  }

  app.register(healthRoutes);
  if (isCommercialModeEnabled()) {
    app.register(authRoutes);
  }
  app.register(annotationRoutes);
  if (isCommercialModeEnabled()) {
    app.register(billingRoutes);
  }
  app.register(captureRoutes);
  app.register(collectionRoutes);
  app.register(itemRoutes);
  app.register(syncRoutes);
  app.register(internalParserRoutes);
  app.register(webRoutes);

  app.setErrorHandler(async (error, request, reply) => {
    const handledError = error as {
      statusCode?: number;
      message?: string;
      name?: string;
      validation?: unknown;
    };
    const isValidationError =
      handledError.name === "ZodError" || Array.isArray(handledError.validation);
    const statusCode =
      typeof handledError.statusCode === "number"
        ? handledError.statusCode
        : isValidationError
          ? 400
          : 500;

    if (statusCode >= 500) {
      await app.errorReporter.capture(error, {
        phase: "request",
        statusCode,
        reqId: request.id,
        method: request.method,
        url: request.url
      });
    }

    if (reply.sent) {
      return;
    }

    if (statusCode >= 500) {
      return reply.status(500).send({
        error: "internal_server_error",
        message: "Internal Server Error",
        statusCode: 500
      });
    }

    return reply.status(statusCode).send({
      error: "request_error",
      message: isValidationError
        ? "Invalid request payload"
        : (handledError.message ?? "Request failed"),
      statusCode
    });
  });

  return app;
}

function toNumberOrUndefined(raw: string | undefined): number | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}
