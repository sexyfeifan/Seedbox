import type { FastifyRequest } from "fastify";
import { isUuid, verifyAccessToken } from "./auth.js";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEV_AUTH_BYPASS_ENABLED =
  process.env.ALLOW_DEV_AUTH_BYPASS === "true" ||
  (process.env.ALLOW_DEV_AUTH_BYPASS === undefined && process.env.NODE_ENV !== "production");

export interface ResolvedUser {
  id: string;
  email?: string;
  displayName?: string;
}

export function resolveAuthenticatedUser(request: FastifyRequest): ResolvedUser | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const claims = verifyAccessToken(token);
    if (claims) {
      return {
        id: claims.sub,
        email: claims.email,
        displayName: claims.displayName
      };
    }
  }
  return null;
}

export function resolveUser(request: FastifyRequest): ResolvedUser {
  const authed = resolveAuthenticatedUser(request);
  if (authed) {
    return authed;
  }

  if (!DEV_AUTH_BYPASS_ENABLED) {
    return { id: DEMO_USER_ID };
  }
  const headerValue = request.headers["x-user-id"];
  if (typeof headerValue === "string" && isUuid(headerValue.trim())) {
    return { id: headerValue.trim() };
  }

  return { id: DEMO_USER_ID };
}

export function resolveUserId(request: FastifyRequest): string {
  return resolveUser(request).id;
}

export function isDevBypassEnabled(): boolean {
  return DEV_AUTH_BYPASS_ENABLED;
}
