function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isCommercialModeEnabled(): boolean {
  return parseBooleanFlag(process.env.COMMERCIAL_MODE_ENABLED, false);
}

export function resolveClientFeatures() {
  const commercialModeEnabled = isCommercialModeEnabled();
  return {
    commercialModeEnabled,
    authEnabled: commercialModeEnabled,
    billingEnabled: commercialModeEnabled
  };
}
