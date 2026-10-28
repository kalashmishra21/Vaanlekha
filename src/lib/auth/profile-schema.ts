import { z } from "zod";

const cleanName = (maximum: number) => z.string().trim().min(2).max(maximum).regex(/^[^\p{Cc}]+$/u);

export const profileUpdateSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("displayName"), value: cleanName(80) }),
  z.object({ field: z.literal("shopName"), value: cleanName(120) }),
  z.object({ field: z.literal("phone"), value: z.union([z.null(), z.string().trim().regex(/^[+0-9()\s-]{6,20}$/)]) }),
]);
