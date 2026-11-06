import { z } from "zod";
import { indianMobileSchema } from "../business/indian-mobile";

const cleanName = (maximum: number) => z.string().trim().min(2).max(maximum).regex(/^[^\p{Cc}]+$/u);

export const profileUpdateSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("displayName"), value: cleanName(80) }),
  z.object({ field: z.literal("shopName"), value: cleanName(120) }),
  z.object({ field: z.literal("phone"), value: z.union([z.null(), indianMobileSchema]) }),
  z.object({ field: z.literal("preferredLanguage"), value: z.enum(["en", "hi"]) }),
]);
