import type { FastifyBaseLogger } from "fastify";

type ErrorContext = {
  phase: "request" | "startup" | "process";
  reqId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
};

type ErrorEvent = {
  at: string;
  message: string;
  name: string;
  phase: ErrorContext["phase"];
  statusCode?: number;
  reqId?: string;
  method?: string;
  url?: string;
};

export interface ErrorReporter {
  capture(error: unknown, context: ErrorContext): Promise<void>;
  getStats(): {
    total: number;
    byPhase: Record<ErrorContext["phase"], number>;
    recent: ErrorEvent[];
  };
}

const MAX_RECENT_EVENTS = 20;

function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === "string" ? value : JSON.stringify(value));
}

async function buildSentryCapture(dsn: string, environment: string, release: string) {
  try {
    const dynamicImport = new Function("moduleName", "return import(moduleName);") as (
      moduleName: string
    ) => Promise<any>;
    const sentryModule = await dynamicImport("@sentry/node");
    sentryModule.init({
      dsn,
      environment,
      release
    });
    return (error: Error, context: ErrorContext) => {
      sentryModule.withScope((scope: any) => {
        scope.setTag("phase", context.phase);
        if (context.statusCode) {
          scope.setTag("status_code", String(context.statusCode));
        }
        if (context.reqId) {
          scope.setTag("req_id", context.reqId);
        }
        if (context.method) {
          scope.setTag("method", context.method);
        }
        if (context.url) {
          scope.setTag("url", context.url);
        }
        sentryModule.captureException(error);
      });
    };
  } catch {
    return null;
  }
}

export async function createErrorReporter(logger: FastifyBaseLogger): Promise<ErrorReporter> {
  const dsn = process.env.SENTRY_DSN?.trim();
  const environment = process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development";
  const release = process.env.SENTRY_RELEASE?.trim() || "seedbox-backend@dev";

  const sentryCapture = dsn ? await buildSentryCapture(dsn, environment, release) : null;
  if (dsn && !sentryCapture) {
    logger.warn("SENTRY_DSN is set but @sentry/node is not installed, fallback to logger only");
  }

  let total = 0;
  const byPhase: Record<ErrorContext["phase"], number> = {
    request: 0,
    startup: 0,
    process: 0
  };
  const recent: ErrorEvent[] = [];

  return {
    async capture(rawError: unknown, context: ErrorContext) {
      const error = asError(rawError);
      const event: ErrorEvent = {
        at: new Date().toISOString(),
        name: error.name,
        message: error.message,
        phase: context.phase,
        statusCode: context.statusCode,
        reqId: context.reqId,
        method: context.method,
        url: context.url
      };

      total += 1;
      byPhase[context.phase] += 1;
      recent.unshift(event);
      if (recent.length > MAX_RECENT_EVENTS) {
        recent.pop();
      }

      logger.error(
        {
          err: error,
          phase: context.phase,
          reqId: context.reqId,
          method: context.method,
          url: context.url,
          statusCode: context.statusCode
        },
        "captured error event"
      );

      if (sentryCapture) {
        sentryCapture(error, context);
      }
    },

    getStats() {
      return {
        total,
        byPhase: { ...byPhase },
        recent: [...recent]
      };
    }
  };
}
