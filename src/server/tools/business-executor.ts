import { khataBalance, rupees } from "../../lib/business/calculations";
import type { PendingClarification, ToolCall } from "../../lib/ai/types/tool-call";
import type { TrustedToolExecutor, ToolExecutionResult } from "./contracts";
import { matchShoppingList, type CatalogProduct } from "../../lib/assistant/match-shopping-list";
import { shoppingDraftSchema } from "../../lib/assistant/shopping-list";
import { convertQuantity, convertUnitPrice, parseMerchantUnit, quantityLineTotal } from "../../lib/assistant/vernacular-quantity";

export type ProductRecord = CatalogProduct;
export type CustomerRecord = { id: string; name: string };
export type LedgerRecord = { type: "gave" | "received"; amount: number };
export type SupplierRecord = { id: string; name: string };
export type ReorderRecord = { product: string; stock: number; threshold: number; quantity: number };
export type OrderStatus = "draft" | "placed" | "received" | "cancelled";
export type OpenOrderRecord = { id: string; supplier: string; status: OrderStatus; items: string[] };

export interface BusinessRepository {
  products(): Promise<ProductRecord[]>;
  createProduct(input: { name: string; unit: string; sellingPrice: number; openingStock: number; threshold: number }, requestKey: string): Promise<ProductRecord>;
  adjustStock(productId: string, delta: number, requestKey: string): Promise<number>;
  customers(): Promise<CustomerRecord[]>;
  createCustomer(name: string, requestKey: string): Promise<string>;
  openAccount(name: string, amount: number, requestKey: string): Promise<string>;
  ledger(customerId: string): Promise<LedgerRecord[]>;
  addEntry(customerId: string, type: "gave" | "received", amount: number, note: string | undefined, requestKey: string): Promise<void>;
  dailySales(date: string): Promise<{ total: number; count: number }>;
  recordSale(items: { productId: string; quantity: number; expectedUnitPrice?: number }[], paymentMethod: "cash" | "upi" | "card", requestKey: string): Promise<{ saleId: string; total: number }>;
  suppliers(): Promise<SupplierRecord[]>;
  createSupplier(name: string, requestKey: string): Promise<string>;
  reorderSuggestions(): Promise<ReorderRecord[]>;
  openOrders(): Promise<OpenOrderRecord[]>;
  orders(): Promise<OpenOrderRecord[]>;
  createOrderDraft(supplierId: string, items: { productId: string; quantity: number }[], requestKey: string): Promise<{ id: string; status: OrderStatus }>;
  transitionOrder(orderId: string, expectedStatus: OrderStatus, action: "place" | "receive" | "cancel", requestKey: string): Promise<OrderStatus>;
}

function normalizedName(value: string): string {
  return value.toLocaleLowerCase("en-IN").normalize("NFKC")
    .replace(/आइस\s*क्रीम|आइस्क्रीम|आईस्क्रीम|ice\s*cream/gu, "icecream")
    .replace(/चीनी/gu, "sugar").replace(/दूध/gu, "milk").replace(/तेल/gu, "oil")
    .replace(/\b(?:chini|cheeni|chinee|shakkar)\b/gu, "sugar")
    .replace(/\bdoodh\b/gu, "milk").replace(/\btel\b/gu, "oil")
    .replace(/\bji\b/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function matchByName<T extends { name: string }>(records: T[], rawName: string): T | null {
  const literalName = rawName.trim().normalize("NFKC").toLocaleLowerCase("en-IN");
  const literal = records.filter((record) => record.name.trim().normalize("NFKC").toLocaleLowerCase("en-IN") === literalName);
  if (literal.length > 1) throw new Error("More than one record matches that name. Use the full name.");
  if (literal.length === 1) return literal[0];
  const requested = normalizedName(rawName);
  const exact = records.filter((record) => normalizedName(record.name) === requested);
  if (exact.length > 1) throw new Error("More than one record matches that name. Use the full name.");
  if (exact.length === 1) return exact[0];
  const matches = records.filter((record) => {
    const words = normalizedName(record.name).split(/\s+/u);
    return requested.split(/\s+/u).length === 1 ? words.includes(requested) : normalizedName(record.name).includes(requested);
  });
  if (matches.length > 1) throw new Error("More than one record matches that name. Use the full name.");
  return matches[0] ?? null;
}

function matchingOrders(orders: OpenOrderRecord[], rawQuery: string): OpenOrderRecord[] {
  const query = rawQuery.replace(/^(?:purchase\s+)?order\s*/i, "").replace(/^#/, "").trim().toLocaleLowerCase("en-IN");
  const normalized = normalizedName(query);
  return orders.filter((order) => order.id.toLocaleLowerCase().startsWith(query)
    || normalizedName(order.supplier) === normalized
    || normalizedName(order.supplier).includes(normalized)
    || order.items.some((item) => normalizedName(item).includes(normalized)));
}

function canTransition(status: OrderStatus, action: "place" | "receive" | "cancel"): boolean {
  return action === "place" ? status === "draft" : action === "receive" ? status === "placed" : status === "draft" || status === "placed";
}

function transitionPast(action: "place" | "receive" | "cancel"): string {
  return action === "place" ? "placed" : action === "receive" ? "received" : "cancelled";
}

function clarificationResult(question: string, pending: PendingClarification): ToolExecutionResult {
  return { ok: false, clarification: { question, pending } };
}

function stockDelta(delta: number, spokenUnit: string | undefined, savedUnit: string): number | null {
  if (!spokenUnit) return delta;
  if (normalizedName(spokenUnit) === normalizedName(savedUnit)) return delta;
  const from = parseMerchantUnit(spokenUnit);
  const to = parseMerchantUnit(savedUnit);
  const converted = from && to ? convertQuantity(Math.abs(delta), from, to) : null;
  return converted === null ? null : Math.sign(delta) * converted;
}

export class BusinessToolExecutor implements TrustedToolExecutor {
  constructor(private readonly repository: BusinessRepository, private readonly requestKey: string = crypto.randomUUID()) {}

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    try {
      switch (call.intent) {
        case "product.create": {
          const existing = matchByName(await this.repository.products(), call.arguments.name);
          if (existing) {
            const delta = stockDelta(call.arguments.openingStock, call.arguments.unit, existing.unit);
            if (delta === null) return { ok: false, error: `The requested unit cannot be safely converted to ${existing.unit}. No stock changed.` };
            return clarificationResult(`A product named ${existing.name} already exists. Should I add ${delta} ${existing.unit} to its stock instead? Nothing has changed.`, {
              kind: "product-existing-confirm", product: existing.name, delta, unit: existing.unit,
            });
          }
          const product = await this.repository.createProduct({
            name: call.arguments.name, unit: call.arguments.unit, sellingPrice: call.arguments.sellingPrice,
            openingStock: call.arguments.openingStock, threshold: call.arguments.threshold,
          }, this.requestKey);
          return { ok: true, data: { intent: call.intent, product: product.name, unit: product.unit, sellingPrice: product.sellingPrice, stock: product.currentStock } };
        }
        case "inventory.adjust":
        case "inventory.adjustConfirmed": {
          const product = matchByName(await this.repository.products(), call.arguments.product);
          if (!product && call.arguments.delta > 0 && call.arguments.unit) return clarificationResult(
            `${call.arguments.product} is not in inventory. What selling price should I use per ${call.arguments.unit} to create it with ${call.arguments.delta} opening units? Nothing has been changed.`,
            { kind: "product-create-price", product: call.arguments.product, unit: call.arguments.unit, openingStock: call.arguments.delta },
          );
          if (!product && call.arguments.delta > 0) return clarificationResult(
            `${call.arguments.product} is not in inventory. What unit should I use to create it with ${call.arguments.delta} opening units? No stock changed.`,
            { kind: "product-create-unit", product: call.arguments.product, openingStock: call.arguments.delta },
          );
          if (!product) return { ok: false, error: "Product not found. No stock changed." };
          const delta = stockDelta(call.arguments.delta, call.arguments.unit, product.unit);
          if (delta === null) return { ok: false, error: `The requested unit cannot be safely converted to ${product.unit}. No stock changed.` };
          if (call.intent === "inventory.adjust") return clarificationResult(
            `Should I ${delta > 0 ? "add" : "remove"} ${Math.abs(delta)} ${product.unit} ${delta > 0 ? "to" : "from"} ${product.name} stock? Reply yes or cancel. Nothing has changed.`,
            { kind: "product-existing-confirm", product: product.name, delta, unit: product.unit },
          );
          const newStock = await this.repository.adjustStock(product.id, delta, this.requestKey);
          return { ok: true, data: { intent: "inventory.adjust", product: product.name, unit: product.unit, delta, newStock } };
        }
        case "inventory.getStock": {
          const product = matchByName(await this.repository.products(), call.arguments.product);
          if (!product) return { ok: false, error: "Product not found." };
          return { ok: true, data: { intent: call.intent, product: product.name, unit: product.unit, stock: product.currentStock } };
        }
        case "inventory.checkList": {
          const draft = matchShoppingList(call.arguments.items, await this.repository.products());
          return { ok: true, data: { intent: call.intent, draft } };
        }
        case "sales.prepareSpoken": {
          const product = matchByName(await this.repository.products(), call.arguments.product);
          if (!product) return { ok: false, error: `${call.arguments.product} is not in inventory. Add it before recording a sale.` };
          const savedUnit = parseMerchantUnit(product.unit);
          if (!savedUnit) return { ok: false, error: `The saved unit for ${product.name} is not recognised. Review the product before recording a measured sale.` };
          const quantity = convertQuantity(call.arguments.quantity, call.arguments.unit, savedUnit);
          const expectedPrice = convertUnitPrice(call.arguments.unitPrice, call.arguments.priceUnit, savedUnit);
          if (quantity === null || expectedPrice === null) return { ok: false, error: `The stated quantity or price unit cannot be converted to ${product.unit}. Say the unit explicitly; nothing changed.` };
          if (expectedPrice !== product.sellingPrice) return { ok: false, error: `You said ₹${call.arguments.unitPrice} per ${call.arguments.priceUnit}, but ${product.name} is priced at ₹${product.sellingPrice} per ${product.unit}. Review the price before the sale.` };
          const lineTotal = quantityLineTotal(quantity, product.sellingPrice);
          if (lineTotal === null) return { ok: false, error: "The quantity and price cannot be recorded exactly in paise. Nothing changed." };
          const draft = shoppingDraftSchema.parse({ source: "spoken-sale", items: [{ requestedName: call.arguments.product, quantity,
            status: product.currentStock >= quantity ? "available" : "short", productId: product.id, productName: product.name,
            stock: product.currentStock, unit: product.unit, unitPrice: product.sellingPrice, lineTotal }],
          estimatedTotal: lineTotal, canConfirm: product.currentStock >= quantity });
          return { ok: true, data: { intent: call.intent, draft } };
        }
        case "customer.create": {
          const existing = matchByName(await this.repository.customers(), call.arguments.customer);
          if (existing) return { ok: false, error: "A customer with that name already exists." };
          const id = await this.repository.createCustomer(call.arguments.customer, this.requestKey);
          return { ok: true, data: { intent: call.intent, customer: call.arguments.customer, id } };
        }
        case "khata.openAccount": {
          const existing = matchByName(await this.repository.customers(), call.arguments.customer);
          if (existing) return { ok: false, error: "A customer with that name already exists." };
          const id = await this.repository.openAccount(call.arguments.customer, call.arguments.amountRupees, this.requestKey);
          return { ok: true, data: { intent: call.intent, customer: call.arguments.customer, id, balance: call.arguments.amountRupees } };
        }
        case "khata.getBalance": {
          const customer = matchByName(await this.repository.customers(), call.arguments.customer);
          if (!customer) return { ok: false, error: "Customer not found." };
          const balance = khataBalance(await this.repository.ledger(customer.id));
          return { ok: true, data: { intent: call.intent, customer: customer.name, balance } };
        }
        case "khata.addEntry": {
          const customer = matchByName(await this.repository.customers(), call.arguments.customer);
          if (!customer && call.arguments.type === "gave") return clarificationResult(
            `${call.arguments.customer} is not in the customer list. Should I open a new khata with ${rupees(call.arguments.amountRupees)}? Nothing has been saved.`,
            { kind: "khata-create-confirm", customer: call.arguments.customer, amountRupees: call.arguments.amountRupees },
          );
          if (!customer) return { ok: false, error: "Customer not found. Add the customer before recording a repayment." };
          await this.repository.addEntry(customer.id, call.arguments.type, call.arguments.amountRupees, call.arguments.note, this.requestKey);
          const balance = khataBalance(await this.repository.ledger(customer.id));
          return { ok: true, data: { intent: call.intent, customer: customer.name, type: call.arguments.type, amount: call.arguments.amountRupees, balance } };
        }
        case "sales.recordConfirmedBasket": {
          if (new Set(call.arguments.items.map((item) => item.productId)).size !== call.arguments.items.length) {
            return { ok: false, error: "The basket repeats a product." };
          }
          const sale = await this.repository.recordSale(call.arguments.items, call.arguments.paymentMethod, this.requestKey);
          return { ok: true, data: { intent: call.intent, ...sale } };
        }
        case "sales.getDailySummary": {
          const summary = await this.repository.dailySales(call.arguments.date);
          return { ok: true, data: { intent: call.intent, date: call.arguments.date, ...summary } };
        }
        case "inventory.getReorderSuggestions": {
          const suggestions = await this.repository.reorderSuggestions();
          return { ok: true, data: { intent: call.intent, suggestions } };
        }
        case "supplier.list": {
          const suppliers = await this.repository.suppliers();
          return { ok: true, data: { intent: call.intent, suppliers } };
        }
        case "supplier.create": {
          const existing = matchByName(await this.repository.suppliers(), call.arguments.name);
          if (existing) return { ok: false, error: "A supplier with that name already exists." };
          const id = await this.repository.createSupplier(call.arguments.name, this.requestKey);
          return { ok: true, data: { intent: call.intent, supplier: call.arguments.name, id } };
        }
        case "orders.getOpen": {
          const orders = await this.repository.openOrders();
          return { ok: true, data: { intent: call.intent, orders } };
        }
        case "orders.getStatus": {
          const matches = matchingOrders(await this.repository.orders(), call.arguments.order);
          if (!matches.length) return { ok: false, error: "No matching purchase order was found in this shop." };
          return { ok: true, data: { intent: call.intent, orders: matches } };
        }
        case "orders.transition": {
          const matches = matchingOrders(await this.repository.orders(), call.arguments.order);
          if (!matches.length) return { ok: false, error: "No matching purchase order was found in this shop." };
          if (matches.length > 1) {
            const candidates = matches.slice(0, 10).map((order) => ({ id: order.id, label: `${order.supplier} · #${order.id.slice(0, 8)}`, status: order.status }));
            return clarificationResult(`More than one order matches. Choose one of the listed IDs before I ask for confirmation.`, {
              kind: "order-transition-select", query: call.arguments.order, action: call.arguments.action, candidates,
            });
          }
          const order = matches[0];
          if (!canTransition(order.status, call.arguments.action)) return { ok: false, error: `This order is ${order.status} and cannot be ${transitionPast(call.arguments.action)}.` };
          const orderLabel = `${order.supplier} · #${order.id.slice(0, 8)}`;
          const pending: PendingClarification = { kind: "order-transition-confirm", orderId: order.id, orderLabel, currentStatus: order.status, action: call.arguments.action };
          return clarificationResult(`${call.arguments.action === "place" ? "Mark" : call.arguments.action === "receive" ? "Receive goods for" : "Cancel"} ${orderLabel}, currently ${order.status}? Reply yes or cancel. Receiving increases stock once; placing is internal and does not contact the supplier. No order was changed.`, pending);
        }
        case "orders.transitionConfirmed": {
          const order = (await this.repository.orders()).find((candidate) => candidate.id === call.arguments.orderId);
          if (!order) return { ok: false, error: "That purchase order is no longer available in this shop." };
          if (order.status !== call.arguments.expectedStatus) return { ok: false, error: `The order changed from ${call.arguments.expectedStatus} to ${order.status} while you were deciding. Check its current status before trying again.` };
          if (!canTransition(order.status, call.arguments.action)) return { ok: false, error: `The order is now ${order.status}; the requested action is no longer valid.` };
          const status = await this.repository.transitionOrder(order.id, call.arguments.expectedStatus, call.arguments.action, this.requestKey);
          return { ok: true, data: { intent: call.intent, supplier: order.supplier, orderId: order.id, action: call.arguments.action, status } };
        }
        case "orders.createDraft": {
          const [suppliers, products] = await Promise.all([this.repository.suppliers(), this.repository.products()]);
          const supplier = matchByName(suppliers, call.arguments.supplier);
          if (!supplier) return { ok: false, error: "Supplier not found. Add the supplier first." };
          const items = call.arguments.items.map((item) => {
            const product = matchByName(products, item.product);
            if (!product) throw new Error(`Product not found: ${item.product}.`);
            return { productId: product.id, quantity: item.quantity };
          });
          if (new Set(items.map((item) => item.productId)).size !== items.length) return { ok: false, error: "The order repeats a product." };
          const order = await this.repository.createOrderDraft(supplier.id, items, this.requestKey);
          return { ok: true, data: { intent: call.intent, supplier: supplier.name, itemCount: items.length, id: order.id, status: order.status } };
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The business action failed." };
    }
  }
}

export function describeToolResult(result: ToolExecutionResult): { title: string; detail: string; reply: string } {
  if ("clarification" in result) return { title: "One detail needed", detail: "No store action has been taken.", reply: result.clarification.question };
  if (!result.ok) {
    if (result.error.startsWith("Sale may have been saved.")) {
      return { title: "Sale needs verification", detail: result.error, reply: result.error };
    }
    return { title: "Action not completed", detail: result.error, reply: `I could not complete that request: ${result.error}` };
  }
  const data = result.data as Record<string, unknown>;
  switch (data.intent) {
    case "product.create":
      return { title: "Product added", detail: `${data.product} · ${data.stock} ${data.unit} · ${rupees(Number(data.sellingPrice))} each`, reply: `${data.product} was created with ${data.stock} ${data.unit} in opening stock. This result is from the store database.` };
    case "inventory.checkList": {
      const draft = data.draft as { items: { status: string }[]; estimatedTotal: number; canConfirm: boolean };
      const available = draft.items.filter((item) => item.status === "available").length;
      return { title: "Shopping list draft", detail: `${available} of ${draft.items.length} items available · ${rupees(draft.estimatedTotal)} estimated`, reply: draft.canConfirm
        ? `I checked the list against your store. All ${draft.items.length} items are available. Review the draft and confirm before any sale is recorded.`
        : `I checked the list against your store. ${available} of ${draft.items.length} items are available; missing or short-stock items must be resolved before a sale. Nothing was changed.` };
    }
    case "sales.prepareSpoken": {
      const draft = data.draft as { items: { quantity: number; productName: string; unit: string }[]; estimatedTotal: number; canConfirm: boolean };
      const item = draft.items[0];
      return { title: "Sale draft", detail: `${item.quantity} ${item.unit} ${item.productName} · ${rupees(draft.estimatedTotal)}`,
        reply: draft.canConfirm ? `Review ${item.quantity} ${item.unit} of ${item.productName} for ${rupees(draft.estimatedTotal)}. Choose a payment method and confirm before anything is saved.`
          : `${item.productName} has insufficient stock for ${item.quantity} ${item.unit}. No sale was saved.` };
    }
    case "customer.create":
      return { title: "Customer added", detail: String(data.customer), reply: `${data.customer} was added as a customer. No opening udhaar was recorded.` };
    case "khata.openAccount":
      return { title: "Khata opened", detail: `${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `${data.customer}'s new khata was opened with ${rupees(Number(data.balance))} outstanding.` };
    case "sales.recordConfirmedBasket":
      return { title: "Sale recorded", detail: `${rupees(Number(data.total))} · confirmed by store`, reply: `Sale recorded for ${rupees(Number(data.total))}. Stock was reduced in the same database transaction.` };
    case "inventory.adjust":
      return { title: "Stock updated", detail: `${data.product} · ${data.newStock} in stock`, reply: `Done. ${data.product} stock is now ${data.newStock} after a ${Number(data.delta) > 0 ? "+" : ""}${data.delta} adjustment.` };
    case "inventory.getStock":
      return { title: "Stock checked", detail: `${data.product} · ${data.stock} in stock`, reply: `${data.product} has ${data.stock} units in stock.` };
    case "khata.getBalance":
      return { title: "Balance checked", detail: `${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `${data.customer}'s outstanding balance is ${rupees(Number(data.balance))}.` };
    case "khata.addEntry":
      return { title: data.type === "received" ? "Payment recorded" : "Udhaar recorded", detail: `${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `${data.type === "received" ? "Payment of" : "New udhaar of"} ${rupees(Number(data.amount))} was recorded. ${data.customer}'s outstanding balance is now ${rupees(Number(data.balance))}.` };
    case "sales.getDailySummary":
      return { title: "Sales summary", detail: `${data.date} · ${rupees(Number(data.total))}`, reply: `Sales on ${data.date} total ${rupees(Number(data.total))} across ${data.count} sale(s).` };
    case "inventory.getReorderSuggestions": {
      const suggestions = data.suggestions as ReorderRecord[];
      return { title: "Reorder suggestions", detail: `${suggestions.length} low-stock product(s)`, reply: suggestions.length ? `Consider reordering ${suggestions.map((item) => `${item.quantity} ${item.product}`).join(", ")}. These are suggestions; no order was created.` : "No product is below its reorder threshold." };
    }
    case "supplier.list": {
      const suppliers = data.suppliers as SupplierRecord[];
      return { title: "Suppliers", detail: `${suppliers.length} in your directory`, reply: suppliers.length ? `Your suppliers are ${suppliers.map((item) => item.name).join(", ")}.` : "No suppliers are saved yet. Add one in Suppliers." };
    }
    case "supplier.create":
      return { title: "Supplier added", detail: String(data.supplier), reply: `${data.supplier} was added to your supplier directory.` };
    case "orders.getOpen": {
      const orders = data.orders as OpenOrderRecord[];
      return { title: "Open purchase orders", detail: `${orders.length} draft or placed`, reply: orders.length ? `You have ${orders.length} open purchase order(s): ${orders.map((item) => `${item.supplier} (${item.status})`).join(", ")}.` : "There are no open purchase orders." };
    }
    case "orders.getStatus": {
      const orders = data.orders as OpenOrderRecord[];
      return { title: orders.length === 1 ? "Purchase order status" : "Matching purchase orders", detail: `${orders.length} order(s)`, reply: orders.map((order) => `${order.supplier} · #${order.id.slice(0, 8)} · ${order.status}`).join(". ") };
    }
    case "orders.transitionConfirmed": {
      const action = String(data.action);
      const status = String(data.status);
      const actionText = action === "place" ? "marked placed" : action === "receive" ? "received" : "cancelled";
      const disclosure = action === "place" ? " This is an internal status; no supplier was contacted." : action === "receive" ? " The database recorded the receipt and stock movement atomically." : "";
      return { title: `Order ${status}`, detail: `${data.supplier} · #${String(data.orderId).slice(0, 8)} · ${status}`, reply: `${data.supplier}'s purchase order was ${actionText}; its saved status is ${status}.${disclosure}` };
    }
    case "orders.createDraft":
      return { title: `Purchase order ${data.status}`, detail: `${data.supplier} · ${data.itemCount} product(s) · ${data.status}`, reply: `An internal purchase order draft for ${data.supplier} was saved with status ${data.status}. No supplier was contacted and stock was not changed.` };
    default:
      throw new Error("Unknown authoritative tool result.");
  }
}
