import { z } from "zod";
import { measuredQuantity } from "../business/schemas";

const itemName = z.string().trim().min(1).max(120);
export const shoppingItemSchema = z.object({
  product: itemName,
  // A document can contain a readable product with an unreadable quantity.
  // Keep the row and mark that field as uncertain instead of inventing a value.
  quantity: measuredQuantity.max(10000).nullable().optional(),
  unit: itemName.optional(),
}).strict();
export const shoppingExtractionSchema = z.object({ items: z.array(shoppingItemSchema).min(1).max(30) }).strict();

export const shoppingDraftSchema = z.object({
  items: z.array(z.object({
    requestedName: itemName,
    quantity: measuredQuantity.max(10000).nullable().optional(),
    status: z.enum(["available", "short", "missing", "unit-unclear"]),
    productId: z.uuid().optional(),
    productName: itemName.optional(),
    stock: z.number().finite().min(0).optional(),
    unit: itemName.optional(),
    unitPrice: z.number().nonnegative().optional(),
    lineTotal: z.number().nonnegative().optional(),
    note: z.string().trim().min(1).max(180).optional(),
  }).strict()).min(1).max(30),
  estimatedTotal: z.number().nonnegative(),
  canConfirm: z.boolean(),
  source: z.enum(["shopping-list", "spoken-sale"]).default("shopping-list"),
}).strict();

export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
export type ShoppingDraft = z.infer<typeof shoppingDraftSchema>;
