export class ProviderRequestError extends Error {
  constructor(
    readonly provider: "Gnani Prisma" | "Gnani Timbre" | "OpenRouter" | "Gemini",
    readonly status: number,
    readonly retryAfter: string | null,
    readonly source: "provider" | "shop" = "provider",
  ) {
    super(`${provider} request failed (${status}).`);
    this.name = "ProviderRequestError";
  }
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : null;
}

function retryable(response: Response): boolean {
  return [408, 429, 500, 502, 503, 504].includes(response.status);
}

/** One bounded retry for idempotent provider reads/intent proposals. */
export async function retryProviderRequest(
  request: () => Promise<Response>,
  options: { attempts?: number; baseDelayMs?: number; maxRetryAfterMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.min(2, options.attempts ?? 2));
  const wait = options.wait ?? ((duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) throw error;
      await wait(options.baseDelayMs ?? 250);
      continue;
    }
    if (!retryable(response) || attempt + 1 >= attempts) return response;
    const serverDelay = retryAfterSeconds(response.headers.get("retry-after"));
    const delayMs = serverDelay === null ? (options.baseDelayMs ?? 250) * (attempt + 1) : serverDelay * 1000;
    if (delayMs > (options.maxRetryAfterMs ?? 1200)) return response;
    await wait(delayMs);
  }
  throw lastError instanceof Error ? lastError : new Error("Provider request failed.");
}
