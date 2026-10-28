import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const reviewTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export function newReviewToken(): string { return randomBytes(32).toString("base64url"); }
export function hashReviewToken(token: string): string {
  return createHash("sha256").update(reviewTokenSchema.parse(token)).digest("hex");
}
