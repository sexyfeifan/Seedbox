import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = resolveJwtSecret();

function resolveJwtSecret(): string {
  const env = process.env.JWT_SECRET;
  if (env && env.trim().length > 0) {
    return env;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production. Aborting.");
  }
  console.warn("[seedbox] JWT_SECRET not set — using insecure dev default. Set JWT_SECRET in production.");
  return "seedbox-dev-jwt-secret";
}
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = Number(process.env.ACCESS_TOKEN_EXPIRES_IN_SECONDS ?? 900); // 15m
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_SECONDS ?? 2592000); // 30d
const UUID_NAMESPACE = "seedbox-auth-namespace-v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthIdentity {
  sub: string;
  email?: string;
  displayName?: string;
}

interface AccessClaims extends AuthIdentity {
  typ: "access";
}

interface RefreshClaims extends AuthIdentity {
  typ: "refresh";
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export function issueTokenPair(identity: AuthIdentity): TokenPair {
  const accessPayload: AccessClaims = {
    ...identity,
    typ: "access"
  };
  const refreshPayload: RefreshClaims = {
    ...identity,
    typ: "refresh"
  };

  const accessToken = jwt.sign(accessPayload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: `${ACCESS_TOKEN_EXPIRES_IN_SECONDS}s`
  });
  const refreshToken = jwt.sign(refreshPayload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: `${REFRESH_TOKEN_EXPIRES_IN_SECONDS}s`
  });

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    accessExpiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    refreshExpiresIn: REFRESH_TOKEN_EXPIRES_IN_SECONDS
  };
}

export function verifyAccessToken(token: string): AuthIdentity | null {
  const payload = verifyToken(token);
  if (!payload || payload.typ !== "access") {
    return null;
  }
  return {
    sub: payload.sub,
    email: payload.email,
    displayName: payload.displayName
  };
}

export function verifyRefreshToken(token: string): AuthIdentity | null {
  const payload = verifyToken(token);
  if (!payload || payload.typ !== "refresh") {
    return null;
  }
  return {
    sub: payload.sub,
    email: payload.email,
    displayName: payload.displayName
  };
}

function verifyToken(token: string): (AuthIdentity & { typ: "access" | "refresh" }) | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!isUuid(sub)) {
      return null;
    }
    const typ = payload.typ;
    if (typ !== "access" && typ !== "refresh") {
      return null;
    }
    return {
      sub,
      typ,
      email: typeof payload.email === "string" ? payload.email : undefined,
      displayName: typeof payload.displayName === "string" ? payload.displayName : undefined
    };
  } catch {
    return null;
  }
}

export function stableUserIdFromEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const bytes = crypto.createHash("sha256").update(`${UUID_NAMESPACE}:${normalized}`).digest().subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [
    bytes.subarray(0, 4).toString("hex"),
    bytes.subarray(4, 6).toString("hex"),
    bytes.subarray(6, 8).toString("hex"),
    bytes.subarray(8, 10).toString("hex"),
    bytes.subarray(10, 16).toString("hex")
  ].join("-");
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}
