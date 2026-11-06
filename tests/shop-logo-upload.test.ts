import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { uploadShopLogo } from "../src/lib/business/shop-logo-upload";

class FakeXhr {
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  status = 0;
  responseText = "";
  withCredentials = false;
  timeout = 0;
  body: XMLHttpRequestBodyInit | Document | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  send = vi.fn((body: XMLHttpRequestBodyInit | Document | null) => { this.body = body; });
  abort = vi.fn(() => this.onabort?.());
}

const image = () => new File([new Uint8Array([1, 2, 3])], "shop.png", { type: "image/png" });

describe("private shop image upload transport and interaction contract", () => {
  it("sends the selected file with same-origin credentials and reports byte progress", async () => {
    const xhr = new FakeXhr();
    const progress = vi.fn();
    const result = uploadShopLogo(image(), { createXhr: () => xhr as unknown as XMLHttpRequest, onProgress: progress });
    expect(xhr.open).toHaveBeenCalledWith("POST", "/api/profile/logo");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.timeout).toBe(60_000);
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get("image")).toBeInstanceOf(File);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    expect(progress).toHaveBeenCalledWith({ loaded: 25, total: 100, percent: 25 });
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ ok: true, logoUrl: "https://storage.example/private-signed-url" });
    xhr.onload?.();
    await expect(result).resolves.toBe("https://storage.example/private-signed-url");
  });

  it("shows the safe storage permission response and preserves its HTTP status", async () => {
    const xhr = new FakeXhr();
    const result = uploadShopLogo(image(), { createXhr: () => xhr as unknown as XMLHttpRequest });
    xhr.status = 403;
    xhr.responseText = JSON.stringify({ error: "Secure image storage denied this upload. Refresh your sign-in and try again." });
    xhr.onload?.();
    await expect(result).rejects.toMatchObject({
      name: "ShopLogoUploadError", status: 403, message: expect.stringContaining("Secure image storage denied"),
    });
  });

  it("handles network, timeout and explicit cancellation without returning an image URL", async () => {
    const networkXhr = new FakeXhr();
    const network = uploadShopLogo(image(), { createXhr: () => networkXhr as unknown as XMLHttpRequest });
    networkXhr.onerror?.();
    await expect(network).rejects.toMatchObject({ name: "ShopLogoUploadError", code: "network", status: 0 });

    const timeoutXhr = new FakeXhr();
    const timeout = uploadShopLogo(image(), { createXhr: () => timeoutXhr as unknown as XMLHttpRequest });
    timeoutXhr.ontimeout?.();
    await expect(timeout).rejects.toThrow("took too long");

    const controller = new AbortController();
    const abortedXhr = new FakeXhr();
    const aborted = uploadShopLogo(image(), { createXhr: () => abortedXhr as unknown as XMLHttpRequest, signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "ShopLogoUploadError", code: "aborted" });
    expect(abortedXhr.abort).toHaveBeenCalledTimes(1);
  });

  it("keeps the complete card associated with the file input and responsive drag target", () => {
    const ui = readFileSync("src/components/layout/profile-control.tsx", "utf8");
    const styles = readFileSync("src/app/phase11.css", "utf8");
    expect(ui).toContain('label htmlFor="profile-logo" className={`profile-logo-card');
    expect(ui).toContain('onDrop={handleLogoDrop}');
    expect(ui).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(styles).toContain(".profile-logo-card");
    expect(styles).toContain("@media (max-width: 640px)");
  });
});
