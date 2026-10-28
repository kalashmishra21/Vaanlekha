import { z } from "zod";
import { shoppingItemSchema } from "../../assistant/shopping-list";
import { measuredAmount, measuredQuantity } from "../../business/schemas";
import { hasDecimalPlaces } from "../../business/precision";

const name = z.string().trim().min(1).max(120);
const quantity = z.number().int().positive();

export const toolCallSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("product.create"), arguments: z.object({
    name, unit: name, sellingPrice: z.number().finite().positive().max(999999999),
    openingStock: measuredAmount, threshold: z.number().int().min(0).max(100000).default(5),
  }).strict() }).strict(),
  z.object({
    intent: z.literal("inventory.adjust"),
    arguments: z.object({ product: name, delta: z.number().finite().min(-100000).max(100000).refine((value) => value !== 0 && hasDecimalPlaces(value, 3)), unit: name.optional() }).strict(),
  }).strict(),
  z.object({
    intent: z.literal("inventory.getStock"),
    arguments: z.object({ product: name }).strict(),
  }).strict(),
  z.object({
    intent: z.literal("khata.getBalance"),
    arguments: z.object({ customer: name }).strict(),
  }).strict(),
  z.object({
    intent: z.literal("khata.addEntry"),
    arguments: z.object({ customer: name, type: z.enum(["gave", "received"]), amountRupees: quantity.max(10000000), note: name.optional() }).strict(),
  }).strict(),
  z.object({ intent: z.literal("customer.create"), arguments: z.object({ customer: name }).strict() }).strict(),
  z.object({ intent: z.literal("khata.openAccount"), arguments: z.object({ customer: name, amountRupees: quantity.max(10000000) }).strict() }).strict(),
  z.object({ intent: z.literal("inventory.checkList"), arguments: z.object({ items: z.array(shoppingItemSchema).min(1).max(30) }).strict() }).strict(),
  z.object({ intent: z.literal("sales.prepareSpoken"), arguments: z.object({
    product: name, quantity: measuredQuantity.max(10000), unit: z.enum(["kg", "g", "litre", "ml", "packet", "piece"]),
    unitPrice: z.number().finite().positive().max(999999999), priceUnit: z.enum(["kg", "g", "litre", "ml", "packet", "piece"]),
  }).strict() }).strict(),
  z.object({ intent: z.literal("sales.recordConfirmedBasket"), arguments: z.object({
    items: z.array(z.object({ productId: z.uuid(), quantity: measuredQuantity.max(10000), expectedUnitPrice: z.number().finite().min(0).max(999999999).optional() }).strict()).min(1).max(30),
    paymentMethod: z.enum(["cash", "upi", "card"]),
  }).strict() }).strict(),
  z.object({
    intent: z.literal("sales.getDailySummary"),
    arguments: z.object({ date: z.iso.date() }).strict(),
  }).strict(),
  z.object({ intent: z.literal("inventory.getReorderSuggestions"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("supplier.list"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("supplier.create"), arguments: z.object({ name }).strict() }).strict(),
  z.object({ intent: z.literal("orders.getOpen"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("orders.getStatus"), arguments: z.object({ order: name }).strict() }).strict(),
  z.object({ intent: z.literal("orders.transition"), arguments: z.object({ order: name, action: z.enum(["place", "receive", "cancel"]) }).strict() }).strict(),
  // This intent is only produced by the server-validated clarification state machine.
  // It is intentionally absent from the OpenRouter function list.
  z.object({ intent: z.literal("orders.transitionConfirmed"), arguments: z.object({ orderId: z.uuid(), expectedStatus: z.enum(["draft", "placed", "received", "cancelled"]), action: z.enum(["place", "receive", "cancel"]) }).strict() }).strict(),
  z.object({ intent: z.literal("orders.createDraft"), arguments: z.object({
    supplier: name,
    items: z.array(z.object({ product: name, quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(30),
  }).strict() }).strict(),
]);

export const pendingClarificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open-account-amount"), customer: name }).strict(),
  z.object({ kind: z.literal("product-create-price"), product: name, unit: name, openingStock: measuredAmount }).strict(),
  z.object({ kind: z.literal("product-create-confirm"), product: name, unit: name, openingStock: measuredAmount, sellingPrice: z.number().finite().positive().max(999999999) }).strict(),
  z.object({ kind: z.literal("product-create-unit"), product: name, openingStock: measuredQuantity }).strict(),
  z.object({ kind: z.literal("product-action-choice"), product: name, unit: name, quantity: measuredQuantity }).strict(),
  z.object({ kind: z.literal("product-existing-confirm"), product: name, delta: measuredQuantity }).strict(),
  z.object({ kind: z.literal("khata-create-confirm"), customer: name, amountRupees: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("khata-currency-confirm"), customer: name, amountRupees: z.number().int().positive(), type: z.enum(["gave", "received"]) }).strict(),
  z.object({ kind: z.literal("customer-name") }).strict(),
  z.object({ kind: z.literal("supplier-name") }).strict(),
  z.object({ kind: z.literal("order-supplier"), items: z.array(z.object({ product: name, quantity: z.number().int().positive() }).strict()).min(1).max(30) }).strict(),
  z.object({ kind: z.literal("order-transition-confirm"), orderId: z.uuid(), orderLabel: name, currentStatus: z.enum(["draft", "placed", "received", "cancelled"]), action: z.enum(["place", "receive", "cancel"]) }).strict(),
  z.object({ kind: z.literal("order-transition-select"), query: name, action: z.enum(["place", "receive", "cancel"]), candidates: z.array(z.object({ id: z.uuid(), label: name, status: z.enum(["draft", "placed", "received", "cancelled"]) }).strict()).min(2).max(10) }).strict(),
]);

export const reasoningResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool_call"), tool: toolCallSchema }).strict(),
  z.object({ kind: z.literal("clarify"), question: z.string().trim().min(1).max(400), pending: pendingClarificationSchema.optional(),
    intent: z.enum([
      "inventory.adjust", "inventory.getStock", "inventory.checkList", "inventory.getReorderSuggestions", "product.create",
      "sales.prepareSpoken",
      "orders.getOpen", "orders.getStatus", "orders.createDraft", "orders.transition", "orders.transitionConfirmed",
      "customer.create", "khata.getBalance", "khata.addEntry", "khata.openAccount", "supplier.list", "supplier.create",
      "sales.getDailySummary", "sales.recordConfirmedBasket",
    ]).optional(),
  }).strict(),
  z.object({ kind: z.literal("unsupported"), message: z.string().trim().min(1).max(500) }).strict(),
]);
export const recentTurnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(500) }).strict();

export type ToolCall = z.infer<typeof toolCallSchema>;
export type ReasoningResult = z.infer<typeof reasoningResultSchema>;
export type PendingClarification = z.infer<typeof pendingClarificationSchema>;
