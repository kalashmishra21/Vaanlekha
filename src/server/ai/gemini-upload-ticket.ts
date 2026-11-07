import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const claimsSchema = z.object({
  userId: z.uuid(),
  shopId: z.uuid(),
  conversationId: z.uuid(),
  size: z.number().int().positive().max(5_000_000),
  displayName: z.string().regex(/^vaanlekha-[a-f0-9-]{36}\.pdf$/),
  uploadUrl: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "generativelanguage.googleapis.com" && url.pathname.startsWith("/upload/");
  }),
  expiresAt: z.number().int().positive(),
}).strict();

export type GeminiUploadClaims = z.infer<typeof claimsSchema>;

function signature(payload: string, apiKey: string): Buffer {
  return createHmac("sha256", apiKey).update(`vaanlekha-gemini-upload-v1:${payload}`).digest();
}

export function createGeminiUploadTicket(claims: GeminiUploadClaims, apiKey: string): string {
  const payload = Buffer.from(JSON.stringify(claimsSchema.parse(claims))).toString("base64url");
  return `${payload}.${signature(payload, apiKey).toString("base64url")}`;
}

export function verifyGeminiUploadTicket(token: string, apiKey: string, now = Date.now()): GeminiUploadClaims | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expected = signature(payload, apiKey);
  let actual: Buffer;
  try { actual = Buffer.from(suppliedSignature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (claims.expiresAt <= now) return null;
    return claims;
  } catch { return null; }
}
