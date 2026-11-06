function safeCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[a-z0-9_-]{1,32}$/i.test(value) ? value : undefined;
}

/** Logs only a fixed stage, HTTP-like status, safe error code, and timestamp. */
export function reportShopLogoFailure(stage: string, error: unknown) {
  const item = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(item.statusCode ?? item.status);
  console.warn("Shop image operation failed", {
    stage,
    statusCode: Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined,
    errorCode: safeCode(item.code),
    timestamp: new Date().toISOString(),
  });
}
