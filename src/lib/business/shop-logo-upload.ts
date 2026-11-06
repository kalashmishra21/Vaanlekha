export type ShopLogoUploadProgress = { loaded: number; total: number; percent: number };

export class ShopLogoUploadError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ShopLogoUploadError";
  }
}

type UploadResponse = { ok?: boolean; logoUrl?: unknown; error?: unknown; code?: unknown };

function parseResponse(value: string): UploadResponse | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as UploadResponse : null;
  } catch { return null; }
}

function responseMessage(status: number, body: UploadResponse | null): string {
  if (typeof body?.error === "string" && body.error.length > 0 && body.error.length <= 240) return body.error;
  if (status === 401) return "Your sign-in expired. Sign in again, then retry the upload.";
  if (status === 403) return "Secure image storage denied the upload. Refresh your sign-in and try again.";
  if (status === 413 || status === 422) return "Choose a JPEG, PNG or WebP image no larger than 2 MB.";
  if (status === 409) return "Create your shop before adding a shop image.";
  if (status === 0) return "The upload could not reach the server. Check your connection and retry.";
  return "The image could not be saved. Check your connection and retry.";
}

export function uploadShopLogo(
  file: File,
  options: {
    onProgress?: (progress: ShopLogoUploadProgress) => void;
    signal?: AbortSignal;
    createXhr?: () => XMLHttpRequest;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ShopLogoUploadError("Upload cancelled.", 0, "aborted"));
      return;
    }
    const xhr = options.createXhr?.() ?? new XMLHttpRequest();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      xhr.abort();
      finish(() => reject(new ShopLogoUploadError("Upload cancelled.", 0, "aborted")));
    };

    xhr.open("POST", "/api/profile/logo");
    xhr.withCredentials = true;
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress?.({ loaded: event.loaded, total: event.total, percent: Math.min(100, Math.round(event.loaded * 100 / event.total)) });
    };
    xhr.onload = () => {
      const body = parseResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok === true && typeof body.logoUrl === "string") {
        finish(() => resolve(body.logoUrl as string));
        return;
      }
      const code = typeof body?.code === "string" && /^[a-z0-9_-]{1,32}$/i.test(body.code) ? body.code : undefined;
      finish(() => reject(new ShopLogoUploadError(responseMessage(xhr.status, body), xhr.status, code)));
    };
    xhr.onerror = () => finish(() => reject(new ShopLogoUploadError(responseMessage(0, null), 0, "network")));
    xhr.ontimeout = () => finish(() => reject(new ShopLogoUploadError("The upload took too long. Check your connection and retry.", 0, "timeout")));
    xhr.onabort = () => finish(() => reject(new ShopLogoUploadError("Upload cancelled.", 0, "aborted")));
    options.signal?.addEventListener("abort", abort, { once: true });

    const form = new FormData();
    form.set("image", file);
    if (options.signal?.aborted) {
      abort();
      return;
    }
    xhr.send(form);
  });
}
