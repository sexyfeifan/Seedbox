import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { issueTokenPair, stableUserIdFromEmail, verifyRefreshToken } from "../../lib/auth.js";
import { resolveAuthenticatedUser } from "../../lib/user.js";

const CODE_TTL_MS = Number(process.env.AUTH_CODE_TTL_MS ?? 10 * 60 * 1000);
const EXPOSE_DEV_CODE = process.env.EXPOSE_DEV_AUTH_CODE === "true" || process.env.NODE_ENV !== "production";

const pendingCodes = new Map<
  string,
  {
    code: string;
    expiresAt: number;
    displayName?: string;
  }
>();

const requestCodeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(80).optional()
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().trim().regex(/^\d{6}$/),
  displayName: z.string().trim().min(1).max(80).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/auth/request-code", async (request) => {
    const body = requestCodeSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();
    const code = generateCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    pendingCodes.set(email, {
      code,
      expiresAt,
      displayName: body.displayName
    });

    app.log.info({ email, code, expiresAt }, "Generated auth code");

    return {
      ok: true,
      expiresInMs: CODE_TTL_MS,
      ...(EXPOSE_DEV_CODE ? { devCode: code } : {})
    };
  });

  app.post("/v1/auth/verify-code", async (request, reply) => {
    const body = verifyCodeSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();
    const pending = pendingCodes.get(email);
    if (!pending) {
      return reply.code(400).send({ message: "Verification code not requested" });
    }
    if (pending.expiresAt < Date.now()) {
      pendingCodes.delete(email);
      return reply.code(400).send({ message: "Verification code expired" });
    }
    if (pending.code !== body.code) {
      return reply.code(400).send({ message: "Verification code invalid" });
    }

    pendingCodes.delete(email);

    const userId = stableUserIdFromEmail(email);
    const displayName = body.displayName ?? pending.displayName ?? email.split("@")[0];
    const tokenPair = issueTokenPair({
      sub: userId,
      email,
      displayName
    });

    return {
      ...tokenPair,
      user: {
        id: userId,
        email,
        displayName
      }
    };
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const identity = verifyRefreshToken(body.refreshToken);
    if (!identity) {
      return reply.code(401).send({ message: "Invalid refresh token" });
    }
    const tokenPair = issueTokenPair(identity);
    return tokenPair;
  });

  app.get("/v1/auth/whoami", async (request, reply) => {
    const user = resolveAuthenticatedUser(request);
    if (!user) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      }
    };
  });
};

function generateCode(): string {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
