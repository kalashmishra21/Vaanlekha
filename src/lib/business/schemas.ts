import { z } from "zod";
import { hasDecimalPlaces } from "./precision";

const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(300);
const money = z.number().finite().min(0).max(999999999).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use at most two decimal places");
const uuid = z.uuid();
export const measuredAmount = z.number().finite().min(0).max(100000).refine((value) => hasDecimalPlaces(value, 3), "Use at most three decimal places");
export const measuredQuantity = measuredAmount.positive();

export const businessActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shop.seed") }).strict(),
  z.object({ kind: z.literal("shop.reset") }).strict(),
  z.object({ kind: z.literal("product.create"), name, sku: z.string().trim().max(60).optional(), unit: name, sellingPrice: money, costPrice: money.optional(), threshold: z.number().int().min(0).max(100000), openingStock: measuredAmount }).strict(),
  z.object({ kind: z.literal("product.edit"), id: uuid, name, sku: z.string().trim().max(60).optional(), unit: name, sellingPrice: money, costPrice: money.nullable(), threshold: z.number().int().min(0).max(100000) }).strict(),
  z.object({ kind: z.literal("product.adjust"), id: uuid, delta: z.number().finite().min(-100000).max(100000).refine((n) => n !== 0 && hasDecimalPlaces(n, 3), "Use at most three decimal places"), note: note.optional() }).strict(),
  z.object({ kind: z.literal("product.archive"), id: uuid }).strict(),
  z.object({ kind: z.literal("customer.create"), name, phone: z.string().trim().min(6).max(20).optional() }).strict(),
  z.object({ kind: z.literal("khata.add"), customerId: uuid, type: z.enum(["gave", "received"]), amount: money.positive(), note: note.optional() }).strict(),
  z.object({ kind: z.literal("sale.record"), items: z.array(z.object({ productId: uuid, quantity: measuredQuantity.max(10000) }).strict()).min(1).max(30), paymentMethod: z.enum(["cash", "upi", "card"]).nullable() }).strict(),
  z.object({ kind: z.literal("supplier.create"), name, contactName: name.optional(), phone: z.string().trim().min(6).max(20).optional() }).strict(),
  z.object({ kind: z.literal("supplier.edit"), id: uuid, name, contactName: name.nullable(), phone: z.string().trim().min(6).max(20).nullable() }).strict(),
  z.object({ kind: z.literal("order.createDraft"), supplierId: uuid, note: note.optional(), items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(10000), unitCost: money.nullable() }).strict()).min(1).max(30) }).strict(),
  z.object({ kind: z.literal("order.transition"), id: uuid, action: z.enum(["place", "receive", "cancel"]) }).strict(),
]);

export type BusinessAction = z.infer<typeof businessActionSchema>;

export const productSchema = z.object({
  id: uuid, name, sku: z.string().nullable(), unit: name,
  selling_price: z.coerce.number(), cost_price: z.coerce.number().nullable(),
  current_stock: z.coerce.number(), low_stock_threshold: z.coerce.number(),
  created_at: z.string(), updated_at: z.string(), archived_at: z.string().nullable().optional(),
});
export type Product = z.infer<typeof productSchema>;

export const customerSchema = z.object({ id: uuid, name, phone: z.string().nullable(), created_at: z.string() });
export type Customer = z.infer<typeof customerSchema>;

export const khataEntrySchema = z.object({
  id: uuid, customer_id: uuid, type: z.enum(["gave", "received"]),
  amount: z.coerce.number(), note: z.string().nullable(), created_at: z.string(),
});
export type KhataEntry = z.infer<typeof khataEntrySchema>;

export const movementSchema = z.object({
  id: uuid, product_id: uuid, movement_type: z.enum(["restock", "adjustment", "sale"]),
  quantity_delta: z.coerce.number(), note: z.string().nullable(), created_at: z.string(),
});
export type InventoryMovement = z.infer<typeof movementSchema>;

export const saleSchema = z.object({
  id: uuid, total_amount: z.coerce.number(),
  payment_method: z.enum(["cash", "upi", "card"]).nullable(), created_at: z.string(),
});
export type Sale = z.infer<typeof saleSchema>;

export const customerReviewSchema = z.object({ id: uuid, sale_id: uuid, rating: z.number().int().min(1).max(5),
  customer_name: z.string().nullable(), comment: z.string(), created_at: z.string() });
export type CustomerReview = z.infer<typeof customerReviewSchema>;

export const supplierSchema = z.object({ id: uuid, name, contact_name: z.string().nullable(), phone: z.string().nullable(), created_at: z.string() });
export type Supplier = z.infer<typeof supplierSchema>;
export const purchaseOrderSchema = z.object({ id: uuid, supplier_id: uuid, status: z.enum(["draft", "placed", "received", "cancelled"]), note: z.string().nullable(), created_at: z.string(), updated_at: z.string() });
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export const purchaseOrderItemSchema = z.object({ id: uuid, order_id: uuid, product_id: uuid, quantity: z.number().int().positive(), unit_cost: z.coerce.number() });
export type PurchaseOrderItem = z.infer<typeof purchaseOrderItemSchema>;
