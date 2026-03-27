import { buildServer } from "./server.js";
import { resolveBackendVersion, resolveParserVersion, resolveReleaseVersion } from "./lib/version.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

async function main() {
  const app = await buildServer();
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    app.log.info({ signal }, "graceful shutdown");
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      await app.errorReporter.capture(error, { phase: "process" });
      app.log.error(error, "shutdown failed");
      process.exit(1);
    }
  };

  process.on("unhandledRejection", (reason) => {
    void app.errorReporter.capture(reason, { phase: "process" });
  });

  process.on("uncaughtException", (error) => {
    void app.errorReporter.capture(error, { phase: "process" });
    app.log.error(error, "uncaught exception");
    process.exit(1);
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await app.listen({ host, port });
    app.log.info(
      {
        releaseVersion: resolveReleaseVersion(),
        backendVersion: resolveBackendVersion(),
        parserVersion: resolveParserVersion()
      },
      "seedbox backend ready"
    );
  } catch (error) {
    await app.errorReporter.capture(error, { phase: "startup" });
    app.log.error(error);
    process.exit(1);
  }
}

void main();
