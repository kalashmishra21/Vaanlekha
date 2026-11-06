import { z } from "zod";

export const indianMobileSchema = z.string().regex(/^[6-9]\d{9}$/);

export function indianMobileError(value: string): string | null {
  if (!value) return null;
  if (/\D/u.test(value)) return "Only digits are allowed";
  return indianMobileSchema.safeParse(value).success ? null : "Enter a valid 10-digit Indian mobile number";
}

export function indianMobileInsertionError(value: string, start: number | null, end: number | null, inserted: string): string | null {
  const left = start ?? value.length;
  const right = end ?? left;
  const candidate = value.slice(0, left) + inserted + value.slice(right);
  return candidate.length > 10 ? indianMobileError(candidate) : null;
}
