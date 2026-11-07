import { z } from "zod";
import { shoppingItemSchema } from "../../assistant/shopping-list";
import { measuredAmount, measuredQuantity } from "../../business/schemas";
import { hasDecimalPlaces } from "../../business/precision";

const name = z.string().trim().min(1).max(120);
const quantity = z.number().int().positive();
const saleItems = z.array(z.object({
  product: name,
  quantity: measuredQuantity.max(10000),
  unit: name.optional(),
  unitPrice: z.number().finite().positive().max(999999999).optional(),
  priceUnit: name.optional(),
}).strict()).min(1).max(30);
const customerOption = z.object({
  id: z.uuid(),
  customerCode: name,
  maskedPhone: name.optional(),
}).strict();
const orderOption = z.object({
  id: z.uuid(),
  orderNumber: name,
  supplier: name,
  orderDate: z.iso.datetime(),
  items: z.array(name).max(30),
  status: z.enum(["draft", "placed", "received", "cancelled"]),
}).strict();

export const toolCallSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("product.create"), arguments: z.object({
    name, unit: name, sellingPrice: z.number().finite().positive().max(999999999),
    openingStock: measuredAmount, threshold: z.number().int().min(0).max(100000).default(5),
  }).strict() }).strict(),
  z.object({
    intent: z.literal("inventory.adjust"),
    arguments: z.object({ product: name, delta: z.number().finite().min(-100000).max(100000).refine((value) => value !== 0 && hasDecimalPlaces(value, 3)), unit: name.optional() }).strict(),
  }).strict(),
  // Only the server-owned confirmation state can produce this intent.
  z.object({ intent: z.literal("inventory.adjustConfirmed"), arguments: z.object({
    product: name, delta: z.number().finite().min(-100000).max(100000).refine((value) => value !== 0 && hasDecimalPlaces(value, 3)), unit: name.optional(),
  }).strict() }).strict(),
  z.object({
    intent: z.literal("inventory.getStock"),
    arguments: z.object({ product: name }).strict(),
  }).strict(),
  z.object({
    intent: z.literal("khata.getBalance"),
    arguments: z.object({ customer: name }).strict(),
  }).strict(),
  z.object({ intent: z.literal("khata.getHistory"), arguments: z.object({ customer: name }).strict() }).strict(),
  z.object({ intent: z.literal("customer.list"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("customer.search"), arguments: z.object({ query: name }).strict() }).strict(),
  z.object({
    intent: z.literal("khata.addEntry"),
    arguments: z.object({ customer: name, type: z.enum(["gave", "received"]), amountRupees: quantity.max(10000000), note: name.optional() }).strict(),
  }).strict(),
  // These ID-based operations are produced only from server-owned selection state.
  z.object({ intent: z.literal("customer.addEntryById"), arguments: z.object({
    customerId: z.uuid(), type: z.enum(["gave", "received"]), amountRupees: quantity.max(10000000), note: name.optional(),
  }).strict() }).strict(),
  z.object({ intent: z.literal("customer.getBalanceById"), arguments: z.object({ customerId: z.uuid() }).strict() }).strict(),
  z.object({ intent: z.literal("customer.getHistoryById"), arguments: z.object({ customerId: z.uuid() }).strict() }).strict(),
  z.object({ intent: z.literal("customer.create"), arguments: z.object({ customer: name }).strict() }).strict(),
  z.object({ intent: z.literal("khata.openAccount"), arguments: z.object({ customer: name, amountRupees: quantity.max(10000000) }).strict() }).strict(),
  z.object({ intent: z.literal("inventory.checkList"), arguments: z.object({ items: z.array(shoppingItemSchema).min(1).max(30) }).strict() }).strict(),
  z.object({ intent: z.literal("sales.prepareSpoken"), arguments: z.object({
    product: name, quantity: measuredQuantity.max(10000), unit: z.enum(["kg", "g", "litre", "ml", "packet", "piece"]),
    unitPrice: z.number().finite().positive().max(999999999).optional(), priceUnit: z.enum(["kg", "g", "litre", "ml", "packet", "piece"]).optional(),
  }).strict() }).strict(),
  z.object({ intent: z.literal("sales.recordSpoken"), arguments: z.object({
    items: saleItems,
    paymentMethod: z.enum(["cash", "upi", "card"]).nullable().optional(),
  }).strict() }).strict(),
  z.object({ intent: z.literal("sales.recordCreditSpoken"), arguments: z.object({
    customer: name,
    items: saleItems,
  }).strict() }).strict(),
  z.object({ intent: z.literal("sales.recordCreditById"), arguments: z.object({
    customerId: z.uuid(),
    items: saleItems,
  }).strict() }).strict(),
  z.object({ intent: z.literal("sales.recordConfirmedBasket"), arguments: z.object({
    items: z.array(z.object({ productId: z.uuid(), quantity: measuredQuantity.max(10000), expectedUnitPrice: z.number().finite().min(0).max(999999999).optional() }).strict()).min(1).max(30),
    paymentMethod: z.enum(["cash", "upi", "card"]),
  }).strict() }).strict(),
  z.object({
    intent: z.literal("sales.getDailySummary"),
    arguments: z.object({ date: z.iso.date() }).strict(),
  }).strict(),
  z.object({ intent: z.literal("sales.getMonthlySummary"), arguments: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  }).strict() }).strict(),
  z.object({ intent: z.literal("sales.getHistory"), arguments: z.object({
    date: z.iso.date().optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  }).strict() }).strict(),
  z.object({ intent: z.literal("reports.getSummary"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("inventory.getReorderSuggestions"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("supplier.list"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("supplier.search"), arguments: z.object({ query: name }).strict() }).strict(),
  z.object({ intent: z.literal("supplier.getDetails"), arguments: z.object({ supplier: name }).strict() }).strict(),
  z.object({ intent: z.literal("supplier.listActive"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("supplier.getOrders"), arguments: z.object({ supplier: name }).strict() }).strict(),
  z.object({ intent: z.literal("supplier.forProduct"), arguments: z.object({ product: name }).strict() }).strict(),
  z.object({ intent: z.literal("supplier.create"), arguments: z.object({ name }).strict() }).strict(),
  z.object({ intent: z.literal("orders.getOpen"), arguments: z.object({}).strict() }).strict(),
  z.object({ intent: z.literal("orders.getStatus"), arguments: z.object({ order: name }).strict() }).strict(),
  z.object({ intent: z.literal("orders.getStatusById"), arguments: z.object({ orderId: z.uuid() }).strict() }).strict(),
  z.object({ intent: z.literal("orders.transition"), arguments: z.object({ order: name, action: z.enum(["place", "receive", "cancel"]) }).strict() }).strict(),
  // This intent is only produced by the server-validated clarification state machine.
  // It is intentionally absent from the OpenRouter function list.
  z.object({ intent: z.literal("orders.transitionConfirmed"), arguments: z.object({ orderId: z.uuid(), expectedStatus: z.enum(["draft", "placed", "received", "cancelled"]), action: z.enum(["place", "receive", "cancel"]) }).strict() }).strict(),
  z.object({ intent: z.literal("orders.createDraft"), arguments: z.object({
    supplier: name,
    items: z.array(z.object({ product: name, quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(30),
  }).strict() }).strict(),
  // Attachment understanding is registered in the same trusted executor but
  // is never exposed as a text-model tool or permitted to mutate store data.
  z.object({ intent: z.literal("attachment.checkList"), arguments: z.object({ items: z.array(shoppingItemSchema).min(1).max(30) }).strict() }).strict(),
]);

export const pendingClarificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer-select"), query: name, candidates: z.array(customerOption).min(2).max(10),
    continuation: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("khata-entry"), type: z.enum(["gave", "received"]), amountRupees: quantity.max(10000000), note: name.optional() }).strict(),
      z.object({ kind: z.literal("khata-balance") }).strict(),
      z.object({ kind: z.literal("khata-history") }).strict(),
      z.object({ kind: z.literal("credit-sale"), items: saleItems }).strict(),
    ]) }).strict(),
  z.object({ kind: z.literal("repayment-amount"), customerId: z.uuid(), customer: name, customerCode: name,
    outstanding: z.number().finite().nonnegative(), requested: z.number().finite().positive() }).strict(),
  z.object({ kind: z.literal("open-account-amount"), customer: name }).strict(),
  z.object({ kind: z.literal("product-create-price"), product: name, unit: name, openingStock: measuredAmount }).strict(),
  z.object({ kind: z.literal("product-create-confirm"), product: name, unit: name, openingStock: measuredAmount, sellingPrice: z.number().finite().positive().max(999999999) }).strict(),
  z.object({ kind: z.literal("product-create-unit"), product: name, openingStock: measuredQuantity }).strict(),
  z.object({ kind: z.literal("product-action-choice"), product: name, unit: name, quantity: measuredQuantity }).strict(),
  z.object({ kind: z.literal("product-existing-confirm"), product: name,
    delta: z.number().finite().min(-100000).max(100000).refine((value) => value !== 0 && hasDecimalPlaces(value, 3)), unit: name.optional() }).strict(),
  z.object({ kind: z.literal("khata-create-confirm"), customer: name, amountRupees: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("khata-currency-confirm"), customer: name, amountRupees: z.number().int().positive(), type: z.enum(["gave", "received"]) }).strict(),
  z.object({ kind: z.literal("customer-name") }).strict(),
  z.object({ kind: z.literal("supplier-name") }).strict(),
  z.object({ kind: z.literal("order-supplier"), items: z.array(z.object({ product: name, quantity: z.number().int().positive() }).strict()).min(1).max(30) }).strict(),
  z.object({ kind: z.literal("order-transition-confirm"), orderId: z.uuid(), orderLabel: name, currentStatus: z.enum(["draft", "placed", "received", "cancelled"]), action: z.enum(["place", "receive", "cancel"]) }).strict(),
  z.object({ kind: z.literal("order-transition-select"), query: name, action: z.enum(["place", "receive", "cancel"]), candidates: z.array(orderOption).min(2).max(10) }).strict(),
  z.object({ kind: z.literal("order-status-select"), query: name, candidates: z.array(orderOption).min(2).max(10) }).strict(),
]);

export const reasoningResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool_call"), tool: toolCallSchema }).strict(),
  z.object({ kind: z.literal("clarify"), question: z.string().trim().min(1).max(400), pending: pendingClarificationSchema.optional(),
    intent: z.enum([
      "inventory.adjust", "inventory.adjustConfirmed", "inventory.getStock", "inventory.checkList", "inventory.getReorderSuggestions", "product.create",
      "sales.prepareSpoken", "sales.recordSpoken", "sales.recordCreditSpoken",
      "orders.getOpen", "orders.getStatus", "orders.getStatusById", "orders.createDraft", "orders.transition", "orders.transitionConfirmed",
      "customer.create", "customer.list", "customer.search", "customer.addEntryById", "customer.getBalanceById", "customer.getHistoryById",
      "khata.getBalance", "khata.getHistory", "khata.addEntry", "khata.openAccount",
      "supplier.list", "supplier.search", "supplier.getDetails", "supplier.listActive", "supplier.getOrders", "supplier.forProduct", "supplier.create",
      "sales.getDailySummary", "sales.getMonthlySummary", "sales.getHistory", "sales.recordConfirmedBasket",
      "reports.getSummary", "attachment.checkList",
    ]).optional(),
  }).strict(),
  z.object({ kind: z.literal("unsupported"), message: z.string().trim().min(1).max(500) }).strict(),
]);
export const recentTurnSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(500) }).strict();

export type ToolCall = z.infer<typeof toolCallSchema>;
export type ReasoningResult = z.infer<typeof reasoningResultSchema>;
export type PendingClarification = z.infer<typeof pendingClarificationSchema>;
