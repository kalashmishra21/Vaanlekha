import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GeminiAttachmentExtractor, GeminiAttachmentOutputError } from "@/server/ai/gemini-attachment";
import { canFallbackFromGeminiAttachment, extractWithGeminiFallback } from "@/server/ai/attachment-fallback";
import { ProviderRequestError } from "@/lib/ai/provider-http";
import { createGeminiUploadTicket, verifyGeminiUploadTicket } from "@/server/ai/gemini-upload-ticket";
import { forwardGeminiPdfChunk, startGeminiPdfUpload } from "@/server/ai/gemini-files";
import { PendingProductPriceCard } from "@/components/assistant/pending-product-price-card";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseUnitSellingPrice } from "@/lib/assistant/pending-price";

describe("Gemini multimodal attachment reasoning", () => {
  it("prefers native Gemini PDF input and returns validated shopping-list items", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"items":[{"product":"Maggi","quantity":2,"unit":"packet"}]}' }] } }] }));
    const extractor = new GeminiAttachmentExtractor("server-key", "gemini-3.5-flash-lite", request);
    await expect(extractor.extract({
      pdfUri: "https://generativelanguage.googleapis.com/v1beta/files/test-file",
      images: [],
      question: "Read the quantity column",
    })).resolves.toEqual({ items: [{ product: "Maggi", quantity: 2, unit: "packet" }] });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toContain("gemini-3.5-flash-lite:generateContent");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("server-key");
    const body = JSON.parse(String(init?.body));
    expect(body.contents[0].parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ file_data: { mime_type: "application/pdf", file_uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file" } }),
    ]));
    expect(body.contents[0].parts.some((part: { inline_data?: unknown }) => part.inline_data)).toBe(false);
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        required: ["items"],
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["product"],
              additionalProperties: false,
              properties: {
                product: { type: "string" },
                quantity: { type: "number", minimum: 0.001, maximum: 10000 },
                unit: { type: "string" },
              },
            },
          },
          answer: { type: "string" },
        },
      },
    });
    expect(body.generationConfig).not.toHaveProperty("responseSchema");
    expect(String(init?.body)).not.toContain("server-key");
  });

  it("fails closed on invalid Gemini output", async () => {
    const request: typeof fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "not json" }] } }] });
    await expect(new GeminiAttachmentExtractor("server-key", "gemini-3.5-flash-lite", request)
      .extract({ images: [{ mimeType: "image/jpeg", bytes: new Uint8Array([1]) }] })).rejects.toBeInstanceOf(GeminiAttachmentOutputError);
  });

  it("rejects valid JSON that uses fields outside the attachment contract", async () => {
    const request: typeof fetch = async () => Response.json({ candidates: [{ content: { parts: [{
      text: '{"tuesday_quantity":18,"taller_bar":"blue"}',
    }] } }] });
    await expect(new GeminiAttachmentExtractor("server-key", "gemini-3.5-flash-lite", request)
      .extract({ images: [{ mimeType: "image/png", bytes: new Uint8Array([1]) }] }))
      .rejects.toBeInstanceOf(GeminiAttachmentOutputError);
  });

  it("answers document questions from native PDF visual content without inventing a stock list", async () => {
    const request: typeof fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"items":[],"answer":"The chart shows sales rising from 12 to 18 units."}' }] } }] });
    await expect(new GeminiAttachmentExtractor("server-key", "gemini-3.5-flash-lite", request).extract({
      images: [], pdfUri: "https://generativelanguage.googleapis.com/v1beta/files/chart", question: "What trend does the chart show?",
    })).resolves.toEqual({ items: [], answer: "The chart shows sales rising from 12 to 18 units." });
  });

  it("uses OpenRouter only after a retryable Gemini failure, not after success or auth errors", async () => {
    const primary = vi.fn(async () => ["Gemini result"]);
    const fallback = vi.fn(async () => ["OpenRouter result"]);
    await expect(extractWithGeminiFallback(primary, fallback)).resolves.toEqual(["Gemini result"]);
    expect(fallback).not.toHaveBeenCalled();

    const unavailable = vi.fn(async () => { throw new ProviderRequestError("Gemini", 503, null); });
    await expect(extractWithGeminiFallback(unavailable, fallback)).resolves.toEqual(["OpenRouter result"]);
    expect(fallback).toHaveBeenCalledTimes(1);

    expect(canFallbackFromGeminiAttachment(new ProviderRequestError("Gemini", 401, null))).toBe(false);
    await expect(extractWithGeminiFallback(
      async () => { throw new ProviderRequestError("Gemini", 401, null); }, fallback,
    )).rejects.toMatchObject({ status: 401 });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe("temporary PDF upload session", () => {
  const claims = {
    userId: "11111111-1111-4111-8111-111111111111",
    shopId: "22222222-2222-4222-8222-222222222222",
    conversationId: "33333333-3333-4333-8333-333333333333",
    size: 5_000_000,
    displayName: "vaanlekha-44444444-4444-4444-8444-444444444444.pdf",
    uploadUrl: "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=session-id",
    expiresAt: 2_000,
  };

  it("binds a signed upload ticket to the account and expires it", () => {
    const ticket = createGeminiUploadTicket(claims, "server-key");
    expect(verifyGeminiUploadTicket(ticket, "server-key", 1_000)).toMatchObject({ userId: claims.userId, shopId: claims.shopId });
    expect(verifyGeminiUploadTicket(ticket, "other-key", 1_000)).toBeNull();
    expect(verifyGeminiUploadTicket(ticket, "server-key", 2_000)).toBeNull();
    expect(verifyGeminiUploadTicket(`${ticket}x`, "server-key", 1_000)).toBeNull();
  });

  it("starts only a Google resumable PDF upload and validates the returned origin", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 200, headers: {
      "x-goog-upload-url": claims.uploadUrl,
    } }));
    await expect(startGeminiPdfUpload({ apiKey: "server-key", size: claims.size, displayName: claims.displayName, request }))
      .resolves.toBe(claims.uploadUrl);
    expect(new Headers(request.mock.calls[0][1]?.headers).get("x-goog-api-key")).toBe("server-key");
    const malicious: typeof fetch = async () => new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://example.com/upload" } });
    await expect(startGeminiPdfUpload({ apiKey: "server-key", size: 100, displayName: claims.displayName, request: malicious })).rejects.toThrow("invalid upload session");
  });

  it("forwards PDF chunks in order and finalizes only the last chunk", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("X-Goog-Upload-Command") === "upload, finalize") {
        return Response.json({ file: { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "application/pdf", sizeBytes: "3", displayName: claims.displayName, state: "ACTIVE" } });
      }
      return new Response(null, { status: 200 });
    });
    await expect(forwardGeminiPdfChunk({ uploadUrl: claims.uploadUrl, offset: 0, bytes: new Uint8Array([1, 2]), totalSize: 3, request }))
      .resolves.toEqual({ nextOffset: 2, file: null });
    const last = await forwardGeminiPdfChunk({ uploadUrl: claims.uploadUrl, offset: 2, bytes: new Uint8Array([3]), totalSize: 3, request });
    expect(last.file?.name).toBe("files/abc");
    expect(new Headers(request.mock.calls[0][1]?.headers).get("X-Goog-Upload-Command")).toBe("upload");
    expect(new Headers(request.mock.calls[1][1]?.headers).get("X-Goog-Upload-Command")).toBe("upload, finalize");
    expect(new Headers(request.mock.calls[1][1]?.headers).has("x-goog-api-key")).toBe(false);
  });

  it("rejects non-HTTPS Gemini file URIs before they can be sent for reasoning", async () => {
    const request: typeof fetch = async () => Response.json({ file: {
      name: "files/abc", uri: "http://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "application/pdf",
      sizeBytes: "3", displayName: claims.displayName, state: "ACTIVE",
    } });
    await expect(forwardGeminiPdfChunk({ uploadUrl: claims.uploadUrl, offset: 0, bytes: new Uint8Array([1, 2, 3]), totalSize: 3, request }))
      .rejects.toThrow("invalid uploaded-file record");
  });
});

describe("inline product price card", () => {
  it("renders an explicit rupee input and Create & Add Stock action", () => {
    const html = renderToStaticMarkup(createElement(PendingProductPriceCard, {
      product: "Maggi", unit: "packet", openingStock: 10, busy: false, onSubmit: vi.fn(),
      label: "Selling price per", actionLabel: "Create & Add Stock",
    }));
    expect(html).toContain("type=\"number\"");
    expect(html).toContain("₹");
    expect(html).toContain("Create &amp; Add Stock");
    expect(html).toContain("10 packet will be added");
  });

  it.each([["20", 20], ["20.50", 20.5], ["0", null], ["-2", null], ["1e3", null], ["20.555", null], ["", null]])
  ("validates unit selling price %s", (input, expected) => {
    expect(parseUnitSellingPrice(input)).toBe(expected);
  });
});
