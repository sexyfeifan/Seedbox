const DEFAULT_RELEASE_VERSION = "v0.1.57";

function normalizeVersion(raw: string | undefined, fallback: string): string {
  const value = (raw ?? "").trim();
  if (!value) {
    return fallback;
  }
  return value;
}

export function resolveReleaseVersion(): string {
  return normalizeVersion(process.env.SEEDBOX_RELEASE_VERSION, DEFAULT_RELEASE_VERSION);
}

export function resolveBackendVersion(): string {
  return normalizeVersion(process.env.SEEDBOX_BACKEND_VERSION, resolveReleaseVersion());
}

export function resolveParserVersion(): string {
  return normalizeVersion(process.env.SEEDBOX_PARSER_VERSION, resolveReleaseVersion());
}

export function resolveMobileVersion(): string {
  return normalizeVersion(process.env.SEEDBOX_MOBILE_VERSION, resolveReleaseVersion());
}
