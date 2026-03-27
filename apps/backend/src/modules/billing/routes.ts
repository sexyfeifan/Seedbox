import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { BillingSubscription } from "../../domain/models.js";
import { resolveAuthenticatedUser } from "../../lib/user.js";

const subscribeSchema = z.object({
  plan: z.enum(["pro_monthly"]),
  provider: z.string().trim().min(1).max(40).optional()
});

function resolveEntitlements(subscription: BillingSubscription) {
  const now = Date.now();
  const periodEndTs = subscription.currentPeriodEnd ? Date.parse(subscription.currentPeriodEnd) : NaN;
  const hasGraceAccess =
    subscription.status === "canceled" && Number.isFinite(periodEndTs) && periodEndTs > now;
  const isPro = subscription.plan === "pro_monthly" && (subscription.status === "active" || hasGraceAccess);
  return {
    isPro,
    canUsePrioritySummary: isPro,
    unlimitedCollections: isPro
  };
}

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/billing/plans", async () => {
    return {
      plans: [
        {
          id: "free",
          title: "Free",
          priceCnyMonthly: 0,
          features: ["基础收藏", "解析与阅读", "离线同步"]
        },
        {
          id: "pro_monthly",
          title: "Pro Monthly",
          priceCnyMonthly: 18,
          features: ["优先摘要队列", "更高配额", "高级功能优先体验"]
        }
      ]
    };
  });

  app.get("/v1/billing/subscription", async (request, reply) => {
    const user = resolveAuthenticatedUser(request);
    if (!user) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const subscription = await app.store.getSubscription(user.id);
    return {
      subscription,
      entitlements: resolveEntitlements(subscription)
    };
  });

  app.post("/v1/billing/subscribe", async (request, reply) => {
    const user = resolveAuthenticatedUser(request);
    if (!user) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const body = subscribeSchema.parse(request.body);
    const subscription = await app.store.subscribe(user.id, body);
    return reply.code(201).send({
      subscription,
      entitlements: resolveEntitlements(subscription)
    });
  });

  app.post("/v1/billing/cancel", async (request, reply) => {
    const user = resolveAuthenticatedUser(request);
    if (!user) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const subscription = await app.store.cancelSubscription(user.id);
    return {
      subscription,
      entitlements: resolveEntitlements(subscription)
    };
  });
};
