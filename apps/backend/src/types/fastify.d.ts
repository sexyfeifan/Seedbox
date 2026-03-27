import type { DataStore } from "../store/store.js";
import type { ErrorReporter } from "../observability/error-reporter.js";

declare module "fastify" {
  interface FastifyInstance {
    store: DataStore;
    errorReporter: ErrorReporter;
  }
}
