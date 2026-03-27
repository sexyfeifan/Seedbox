import { createHash } from "node:crypto";
import { getOrCacheAssetFile } from "./asset-cache.js";
import type { ItemAssetType } from "../domain/models.js";
import type { ParserResultInput } from "../store/store.js";

type ParsedAssetInput = NonNullable<ParserResultInput["assets"]>[number];

export type StableParsedAsset = {
  id: string;
  type: ItemAssetType;
  url: string;
  width?: number;
  height?: number;
  sortOrder: number;
};

const EPHEMERAL_QUERY_KEYS = new Set([
  "expires",
  "expire",
  "exp",
  "e",
  "ssig",
  "sig",
  "signature",
  "token",
  "auth_key",
  "authkey",
  "xsec_token",
  "xsec_source",
  "_t",
  "_",
  "timestamp",
  "ts"
]);

export function buildStableParsedAssets(
  itemId: string,
  assets: ParserResultInput["assets"] | undefined,
  limit = 50
): StableParsedAsset[] {
  const normalizedAssets = (assets ?? [])
    .filter((asset): asset is ParsedAssetInput => Boolean(asset && typeof asset.url === "string" && /^https?:\/\//i.test(asset.url)))
    .slice(0, limit);

  const occurrenceMap = new Map<string, number>();
  return normalizedAssets.map((asset, index) => {
    const identity = buildAssetIdentity(asset);
    const occurrence = occurrenceMap.get(identity) ?? 0;
    occurrenceMap.set(identity, occurrence + 1);
    return {
      id: buildStableAssetId(itemId, identity, occurrence),
      type: asset.type,
      url: asset.url,
      width: asset.width,
      height: asset.height,
      sortOrder: index
    };
  });
}

export function scheduleAssetCacheWarmup(
  itemId: string,
  pageUrl: string | undefined,
  assets: Array<{ id: string; type: ItemAssetType; url: string }>
): void {
  const candidates = assets.filter((asset) => shouldWarmAsset(asset));
  if (candidates.length === 0) {
    return;
  }
  void (async () => {
    const results = await Promise.allSettled(
      candidates.map((asset) =>
        getOrCacheAssetFile(itemId, asset.id, asset.url, {
          pageUrl,
          expectedType: asset.type === "image" || asset.type === "video" ? asset.type : undefined,
          preferBrowserCompatible: asset.type !== "video"
        })
      )
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      console.warn(
        `[seedbox] asset warmup incomplete for item ${itemId}: ${failed.length}/${candidates.length} failed`
      );
    }
  })();
}

function shouldWarmAsset(asset: { type: ItemAssetType; url: string }): boolean {
  if (asset.type === "video") {
    return true;
  }
  return hasEphemeralSignature(asset.url);
}

function hasEphemeralSignature(input: string): boolean {
  try {
    const parsed = new URL(input);
    for (const key of parsed.searchParams.keys()) {
      if (EPHEMERAL_QUERY_KEYS.has(key.toLowerCase())) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function buildAssetIdentity(asset: ParsedAssetInput): string {
  return [asset.type, normalizeAssetUrl(asset.url)].join("|");
}

function normalizeAssetUrl(input: string): string {
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    const entries = [...parsed.searchParams.entries()]
      .filter(([key]) => !EPHEMERAL_QUERY_KEYS.has(key.toLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        if (leftKey === rightKey) {
          return leftValue.localeCompare(rightValue);
        }
        return leftKey.localeCompare(rightKey);
      });
    parsed.search = "";
    for (const [key, value] of entries) {
      parsed.searchParams.append(key, value);
    }
    return parsed.toString();
  } catch {
    return String(input || "").trim();
  }
}

function buildStableAssetId(itemId: string, identity: string, occurrence: number): string {
  const hash = createHash("sha1")
    .update(`${itemId}|${identity}|${occurrence}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  if (hash.length < 32) {
    return "00000000-0000-5000-a000-000000000000";
  }
  hash[12] = "5";
  hash[16] = "a";
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}
