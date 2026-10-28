import { z } from "zod";
import { measuredQuantity } from "../business/schemas";

const itemName = z.string().trim().min(1).max(120);
export const shoppingItemSchema = z.object({ product: itemName, quantity: z.number().int().min(1).max(10000) }).strict();
export const shoppingExtractionSchema = z.object({ items: z.array(shoppingItemSchema).min(1).max(30) }).strict();

export const shoppingDraftSchema = z.object({
  items: z.array(z.object({
    requestedName: itemName,
    quantity: measuredQuantity.max(10000),
    status: z.enum(["available", "short", "missing"]),
    productId: z.uuid().optional(),
    productName: itemName.optional(),
    stock: z.number().finite().min(0).optional(),
    unit: itemName.optional(),
    unitPrice: z.number().nonnegative().optional(),
    lineTotal: z.number().nonnegative().optional(),
  }).strict()).min(1).max(30),
  estimatedTotal: z.number().nonnegative(),
  canConfirm: z.boolean(),
  source: z.enum(["shopping-list", "spoken-sale"]).default("shopping-list"),
}).strict();

export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
export type ShoppingDraft = z.infer<typeof shoppingDraftSchema>;
