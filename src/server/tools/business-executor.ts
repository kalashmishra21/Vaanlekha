import { createHash } from "node:crypto";
import { khataBalance, rupees, todayInIndia } from "../../lib/business/calculations";
import type { PendingClarification, ToolCall } from "../../lib/ai/types/tool-call";
import type { TrustedToolExecutor, ToolExecutionResult } from "./contracts";
import { matchShoppingList, type CatalogProduct } from "../../lib/assistant/match-shopping-list";
import { shoppingDraftSchema } from "../../lib/assistant/shopping-list";
import { convertQuantity, convertUnitPrice, parseMerchantUnit, quantityLineTotal } from "../../lib/assistant/vernacular-quantity";

export type ProductRecord = CatalogProduct;
export type CustomerRecord = { id: string; name: string; customerCode?: string; phone?: string | null };
export type LedgerRecord = { id?: string; type: "gave" | "received"; amount: number; note?: string | null; createdAt?: string };
export type SupplierRecord = { id: string; name: string; contactName?: string | null; phone?: string | null; active?: boolean | null };
export type ReorderRecord = { product: string; stock: number; threshold: number; quantity: number };
export type OrderStatus = "draft" | "placed" | "received" | "cancelled";
export type OpenOrderRecord = { id: string; orderNumber?: string; orderDate?: string; total?: number; supplier: string; status: OrderStatus; items: string[] };

function derivedRequestKey(requestKey: string, operation: string): string {
  const hex = createHash("sha256").update(`vaanlekha:${operation}:${requestKey}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function canonicalProductAlias(value: string): string {
  return value.trim().replace(/\bmaggie\b/giu, "Maggi").replace(/मैगी/gu, "Maggi");
}

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
  monthlySales?(month: string): Promise<{ total: number; count: number }>;
  salesHistory?(filter: { date?: string; month?: string }): Promise<{ saleId: string; date: string; total: number; paymentMethod: string | null }[]>;
  recordSale(items: { productId: string; quantity: number; expectedUnitPrice?: number }[], paymentMethod: "cash" | "upi" | "card" | null, requestKey: string): Promise<{ saleId: string; total: number }>;
  recordCreditSale?(input: { customerId: string | null; newCustomerName: string | null; items: { productId: string; quantity: number; expectedUnitPrice?: number }[] }, requestKey: string): Promise<{ saleId: string; total: number; customerId: string }>;
  suppliers(): Promise<SupplierRecord[]>;
  createSupplier(name: string, requestKey: string): Promise<string>;
  reorderSuggestions(): Promise<ReorderRecord[]>;
  openOrders(): Promise<OpenOrderRecord[]>;
  orders(): Promise<OpenOrderRecord[]>;
  createOrderDraft(supplierId: string, items: { productId: string; quantity: number }[], requestKey: string): Promise<{ id: string; orderNumber?: string; status: OrderStatus }>;
  transitionOrder(orderId: string, expectedStatus: OrderStatus, action: "place" | "receive" | "cancel", requestKey: string): Promise<OrderStatus>;
}

function normalizedName(value: string): string {
  return value.toLocaleLowerCase("en-IN").normalize("NFKC")
    .replace(/\bmaggie\b/gu, "maggi").replace(/मैगी/gu, "maggi")
    .replace(/आइस\s*क्रीम|आइस्क्रीम|आईस्क्रीम|ice\s*cream/gu, "icecream")
    .replace(/चीनी/gu, "sugar").replace(/दूध/gu, "milk").replace(/तेल/gu, "oil")
    .replace(/\b(?:chini|cheeni|chinee|shakkar)\b/gu, "sugar")
    .replace(/\bdoodh\b|दूध/gu, "milk").replace(/\btel\b|तेल/gu, "oil")
    .replace(/चीनी/gu, "sugar").replace(/चावल/gu, "rice").replace(/आटा/gu, "flour").replace(/नमक/gu, "salt").replace(/चाय/gu, "tea").replace(/रोटी/gu, "bread")
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
  const exactReferences = orders.filter((order) => order.id.toLocaleLowerCase() === query
    || order.orderNumber?.toLocaleLowerCase("en-IN") === query);
  if (exactReferences.length) return exactReferences;
  return orders.filter((order) => normalizedName(order.supplier) === normalized
    || normalizedName(order.supplier).includes(normalized)
    || order.items.some((item) => normalizedName(item).includes(normalized)));
}

function isGenericOrderReference(value: string): boolean {
  return /^(?:(?:this|that|the)\s+)?(?:(?:purchase\s+)?order)(?:\s+(?:ka\s+)?status)?$/iu.test(value.trim());
}

function maskedPhone(phone: string | null | undefined): string | undefined {
  if (!phone || !/^\d{10}$/.test(phone)) return undefined;
  return `••••••${phone.slice(-4)}`;
}

function matchingCustomers(customers: CustomerRecord[], rawName: string): CustomerRecord[] {
  const exact = matchByNameAllowMany(customers, rawName);
  if (exact.length) return exact;
  const requested = normalizedName(rawName);
  return customers.filter((customer) => {
    const words = normalizedName(customer.name).split(/\s+/u);
    return requested.split(/\s+/u).length === 1 ? words.includes(requested) : normalizedName(customer.name).includes(requested);
  });
}

function matchByNameAllowMany<T extends { name: string }>(records: T[], rawName: string): T[] {
  const literalName = rawName.trim().normalize("NFKC").toLocaleLowerCase("en-IN");
  const literal = records.filter((record) => record.name.trim().normalize("NFKC").toLocaleLowerCase("en-IN") === literalName);
  if (literal.length) return literal;
  const requested = normalizedName(rawName);
  return records.filter((record) => normalizedName(record.name) === requested);
}

function orderOption(order: OpenOrderRecord) {
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? `LEGACY-${order.id}`,
    supplier: order.supplier,
    orderDate: order.orderDate ?? new Date(0).toISOString(),
    items: order.items,
    status: order.status,
  };
}

function formatOrderLabel(order: OpenOrderRecord): string {
  return `${order.orderNumber ?? `LEGACY-${order.id}`} · ${order.supplier}`;
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

async function resolveSaleItems(repository: BusinessRepository, requested: { product: string; quantity: number; unit?: string; unitPrice?: number; priceUnit?: string }[]) {
  const products = await repository.products();
  const resolved: { productId: string; quantity: number; expectedUnitPrice: number }[] = [];
  for (const item of requested) {
    const product = matchByName(products, canonicalProductAlias(item.product));
    if (!product) throw new Error(`${item.product} is not in this shop's inventory. No sale was recorded.`);
    const savedUnit = parseMerchantUnit(product.unit);
    const spokenUnit = parseMerchantUnit(item.unit ?? product.unit);
    if (!savedUnit || !spokenUnit) throw new Error(`The unit for ${product.name} is unclear. Nothing was recorded.`);
    const quantity = convertQuantity(item.quantity, spokenUnit, savedUnit);
    if (quantity === null) throw new Error(`The quantity for ${product.name} cannot be converted to ${product.unit}. Nothing was recorded.`);
    if ((item.unitPrice === undefined) !== (item.priceUnit === undefined)) throw new Error(`The spoken price for ${product.name} is incomplete. Nothing was recorded.`);
    if (item.unitPrice !== undefined && item.priceUnit !== undefined) {
      const stated = convertUnitPrice(item.unitPrice, parseMerchantUnit(item.priceUnit) ?? spokenUnit, savedUnit);
      if (stated === null || stated !== product.sellingPrice) throw new Error(`The stated price does not match ${product.name}'s saved selling price. Nothing was recorded.`);
    }
    if (resolved.some((line) => line.productId === product.id)) throw new Error(`The sale repeats ${product.name}. Combine its quantities and retry; nothing was recorded.`);
    resolved.push({ productId: product.id, quantity, expectedUnitPrice: product.sellingPrice });
  }
  return resolved;
}

export class BusinessToolExecutor implements TrustedToolExecutor {
  constructor(private readonly repository: BusinessRepository, private readonly requestKey: string = crypto.randomUUID()) {}

  private async customerCodeFor(id: string): Promise<string> {
    try { return (await this.repository.customers()).find((customer) => customer.id === id)?.customerCode ?? `ID-${id}`; }
    catch { return `ID-${id}`; }
  }

  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    try {
      switch (call.intent) {
        case "product.create": {
          const name = canonicalProductAlias(call.arguments.name);
          const existing = matchByName(await this.repository.products(), name);
          if (existing) {
            const delta = stockDelta(call.arguments.openingStock, call.arguments.unit, existing.unit);
            if (delta === null) return { ok: false, error: `The requested unit cannot be safely converted to ${existing.unit}. No stock changed.` };
            return clarificationResult(`A product named ${existing.name} already exists. Should I add ${delta} ${existing.unit} to its stock instead? Nothing has changed.`, {
              kind: "product-existing-confirm", product: existing.name, delta, unit: existing.unit,
            });
          }
          const product = await this.repository.createProduct({
            name, unit: call.arguments.unit, sellingPrice: call.arguments.sellingPrice,
            openingStock: call.arguments.openingStock, threshold: call.arguments.threshold,
          }, this.requestKey);
          return { ok: true, data: { intent: call.intent, product: product.name, unit: product.unit, sellingPrice: product.sellingPrice, stock: product.currentStock } };
        }
        case "inventory.adjust":
        case "inventory.adjustConfirmed": {
          const requestedProduct = canonicalProductAlias(call.arguments.product);
          const product = matchByName(await this.repository.products(), requestedProduct);
          if (!product && call.arguments.delta > 0 && call.arguments.unit) return clarificationResult(
            `${requestedProduct} is not in inventory. What selling price should I use per ${call.arguments.unit} to create it with ${call.arguments.delta} opening units? Nothing has been changed.`,
            { kind: "product-create-price", product: requestedProduct, unit: call.arguments.unit, openingStock: call.arguments.delta },
          );
          if (!product && call.arguments.delta > 0) return clarificationResult(
            `${requestedProduct} is not in inventory. What unit should I use to create it with ${call.arguments.delta} opening units? No stock changed.`,
            { kind: "product-create-unit", product: requestedProduct, openingStock: call.arguments.delta },
          );
          if (!product) return { ok: false, error: "Product not found. No stock changed." };
          const delta = stockDelta(call.arguments.delta, call.arguments.unit, product.unit);
          if (delta === null) return { ok: false, error: `The requested unit cannot be safely converted to ${product.unit}. No stock changed.` };
          if (call.intent === "inventory.adjust" && delta < 0) return clarificationResult(
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
        case "attachment.checkList": {
          const draft = matchShoppingList(call.arguments.items, await this.repository.products());
          return { ok: true, data: { intent: call.intent, draft } };
        }
        case "sales.prepareSpoken": {
          const product = matchByName(await this.repository.products(), call.arguments.product);
          if (!product) return { ok: false, error: `${call.arguments.product} is not in inventory. Add it before recording a sale.` };
          const savedUnit = parseMerchantUnit(product.unit);
          if (!savedUnit) return { ok: false, error: `The saved unit for ${product.name} is not recognised. Review the product before recording a measured sale.` };
          const quantity = convertQuantity(call.arguments.quantity, call.arguments.unit, savedUnit);
          const hasStatedPrice = call.arguments.unitPrice !== undefined || call.arguments.priceUnit !== undefined;
          const expectedPrice = call.arguments.unitPrice !== undefined && call.arguments.priceUnit !== undefined
            ? convertUnitPrice(call.arguments.unitPrice, call.arguments.priceUnit, savedUnit) : null;
          if (quantity === null || (hasStatedPrice && expectedPrice === null)) return { ok: false, error: `The stated quantity or price unit cannot be converted to ${product.unit}. Say the unit explicitly; nothing changed.` };
          if (hasStatedPrice && expectedPrice !== product.sellingPrice) return { ok: false, error: `You said ₹${call.arguments.unitPrice} per ${call.arguments.priceUnit}, but ${product.name} is priced at ₹${product.sellingPrice} per ${product.unit}. Review the price before the sale.` };
          const lineTotal = quantityLineTotal(quantity, product.sellingPrice);
          if (lineTotal === null) return { ok: false, error: "The quantity and price cannot be recorded exactly in paise. Nothing changed." };
          const draft = shoppingDraftSchema.parse({ source: "spoken-sale", items: [{ requestedName: call.arguments.product, quantity,
            status: product.currentStock >= quantity ? "available" : "short", productId: product.id, productName: product.name,
            stock: product.currentStock, unit: product.unit, unitPrice: product.sellingPrice, lineTotal }],
          estimatedTotal: lineTotal, canConfirm: product.currentStock >= quantity });
          return { ok: true, data: { intent: call.intent, draft } };
        }
        case "sales.recordSpoken": {
          const items = await resolveSaleItems(this.repository, call.arguments.items);
          const sale = await this.repository.recordSale(items, call.arguments.paymentMethod ?? null, this.requestKey);
          let savedProducts: ProductRecord[];
          try { savedProducts = await this.repository.products(); }
          catch {
            return { ok: false, error: `Sale may have been saved (reference ${sale.saleId}, total ${rupees(sale.total)}). Updated stock could not be read; check Sales before retrying.` };
          }
          const stocks = items.map((item) => {
            const product = savedProducts.find((candidate) => candidate.id === item.productId);
            return product ? { product: product.name, unit: product.unit, stock: product.currentStock } : null;
          }).filter((item) => item !== null);
          if (stocks.length !== items.length) return { ok: false, error: `Sale may have been saved (reference ${sale.saleId}, total ${rupees(sale.total)}). Updated stock could not be verified; check Sales before retrying.` };
          return { ok: true, data: { intent: call.intent, ...sale, stocks } };
        }
        case "sales.recordCreditSpoken":
        case "sales.recordCreditById": {
          if (!this.repository.recordCreditSale) return { ok: false, error: "Atomic credit sale recording is unavailable until the business-accounting migration is applied. Nothing was recorded." };
          let customerId: string | null;
          let newCustomerName: string | null = null;
          let customerName: string;
          if (call.intent === "sales.recordCreditById") {
            const customer = (await this.repository.customers()).find((item) => item.id === call.arguments.customerId);
            if (!customer) return { ok: false, error: "That customer is no longer available in this shop. Nothing was recorded." };
            customerId = customer.id;
            customerName = customer.name;
          } else {
            const matches = matchingCustomers(await this.repository.customers(), call.arguments.customer);
            if (matches.length > 1) return clarificationResult(`More than one ${call.arguments.customer} matches. Select the customer code before recording this credit sale.`, {
              kind: "customer-select", query: call.arguments.customer,
              candidates: matches.slice(0, 10).map((customer) => ({ id: customer.id, customerCode: customer.customerCode ?? `ID-${customer.id}`, maskedPhone: maskedPhone(customer.phone) })),
              continuation: { kind: "credit-sale", items: call.arguments.items },
            });
            if (matches.length === 1) {
              customerId = matches[0].id;
              customerName = matches[0].name;
            } else {
              customerId = null;
              newCustomerName = call.arguments.customer;
              customerName = call.arguments.customer;
            }
          }
          const items = await resolveSaleItems(this.repository, call.arguments.items);
          const sale = await this.repository.recordCreditSale({ customerId, newCustomerName, items }, this.requestKey);
          let entries: LedgerRecord[];
          try { entries = await this.repository.ledger(sale.customerId); }
          catch {
            return { ok: false, error: `Credit sale may have been saved (reference ${sale.saleId}, total ${rupees(sale.total)}). Check Sales and khata before retrying.` };
          }
          return { ok: true, data: { intent: "sales.recordCreditSpoken", ...sale, customer: customerName, balance: khataBalance(entries) } };
        }
        case "customer.create": {
          const id = await this.repository.createCustomer(call.arguments.customer, this.requestKey);
          return { ok: true, data: { intent: call.intent, customer: call.arguments.customer, id, customerCode: await this.customerCodeFor(id) } };
        }
        case "khata.openAccount": {
          const id = await this.repository.openAccount(call.arguments.customer, call.arguments.amountRupees, this.requestKey);
          return { ok: true, data: { intent: call.intent, customer: call.arguments.customer, id, customerCode: await this.customerCodeFor(id), balance: call.arguments.amountRupees } };
        }
        case "customer.list":
        case "customer.search": {
          const customers = await this.repository.customers();
          const matched = call.intent === "customer.search" ? matchingCustomers(customers, call.arguments.query) : customers;
          return { ok: true, data: { intent: call.intent, customers: matched.map((customer) => ({
            id: customer.id, name: customer.name, customerCode: customer.customerCode ?? `ID-${customer.id}`, maskedPhone: maskedPhone(customer.phone),
          })) } };
        }
        case "khata.getBalance": {
          const matches = matchingCustomers(await this.repository.customers(), call.arguments.customer);
          if (!matches.length) return { ok: false, error: "No matching customer was found in this shop." };
          if (matches.length > 1) return clarificationResult(`More than one customer matches ${call.arguments.customer}. Select the correct customer code; no ledger was read or changed.`, {
            kind: "customer-select", query: call.arguments.customer,
            candidates: matches.slice(0, 10).map((customer) => ({ id: customer.id, customerCode: customer.customerCode ?? `ID-${customer.id}`, maskedPhone: maskedPhone(customer.phone) })),
            continuation: { kind: "khata-balance" },
          });
          const customer = matches[0];
          const balance = khataBalance(await this.repository.ledger(customer.id));
          return { ok: true, data: { intent: call.intent, customer: customer.name, customerCode: customer.customerCode ?? `ID-${customer.id}`, balance } };
        }
        case "khata.getHistory": {
          const matches = matchingCustomers(await this.repository.customers(), call.arguments.customer);
          if (!matches.length) return { ok: false, error: "No matching customer was found in this shop." };
          if (matches.length > 1) return clarificationResult(`More than one customer matches ${call.arguments.customer}. Select the correct customer code; no ledger was changed.`, {
            kind: "customer-select", query: call.arguments.customer,
            candidates: matches.slice(0, 10).map((customer) => ({ id: customer.id, customerCode: customer.customerCode ?? `ID-${customer.id}`, maskedPhone: maskedPhone(customer.phone) })),
            continuation: { kind: "khata-history" },
          });
          const customer = matches[0];
          const entries = await this.repository.ledger(customer.id);
          return { ok: true, data: { intent: call.intent, customer: customer.name, entries, balance: khataBalance(entries) } };
        }
        case "khata.addEntry": {
          const matches = matchingCustomers(await this.repository.customers(), call.arguments.customer);
          if (matches.length > 1) return clarificationResult(`More than one customer named ${call.arguments.customer} exists. Select the customer code and masked phone before recording this ledger entry.`, {
            kind: "customer-select", query: call.arguments.customer,
            candidates: matches.slice(0, 10).map((customer) => ({ id: customer.id, customerCode: customer.customerCode ?? `ID-${customer.id}`, maskedPhone: maskedPhone(customer.phone) })),
            continuation: { kind: "khata-entry", type: call.arguments.type, amountRupees: call.arguments.amountRupees, ...(call.arguments.note ? { note: call.arguments.note } : {}) },
          });
          const customer = matches[0];
          if (!customer && call.arguments.type === "gave") {
            const id = await this.repository.openAccount(call.arguments.customer, call.arguments.amountRupees, this.requestKey);
            return { ok: true, data: { intent: "khata.openAccount", customer: call.arguments.customer, id,
              customerCode: await this.customerCodeFor(id), balance: call.arguments.amountRupees, automatic: true } };
          }
          if (!customer) return { ok: false, error: "No matching customer was found for this repayment. No entry was saved." };
          const entries = await this.repository.ledger(customer.id);
          const balance = khataBalance(entries);
          if (call.arguments.type === "received" && call.arguments.amountRupees > balance) return clarificationResult(
            `The current outstanding amount for ${customer.name} (${customer.customerCode ?? `ID-${customer.id}`}) is ${rupees(balance)}, less than the ${rupees(call.arguments.amountRupees)} repayment. Enter a repayment amount up to ${rupees(balance)} or cancel. Nothing was saved.`,
            { kind: "repayment-amount", customerId: customer.id, customer: customer.name, customerCode: customer.customerCode ?? `ID-${customer.id}`, outstanding: Math.max(balance, 0), requested: call.arguments.amountRupees },
          );
          await this.repository.addEntry(customer.id, call.arguments.type, call.arguments.amountRupees, call.arguments.note, this.requestKey);
          let updated: LedgerRecord[];
          try { updated = await this.repository.ledger(customer.id); }
          catch {
            return { ok: false, error: `The khata entry may have been saved for ${customer.name}. Check the ledger before retrying.` };
          }
          return { ok: true, data: { intent: "khata.addEntry", customer: customer.name, customerCode: customer.customerCode ?? `ID-${customer.id}`, type: call.arguments.type, amount: call.arguments.amountRupees, balance: khataBalance(updated) } };
        }
        case "customer.addEntryById": {
          const customer = (await this.repository.customers()).find((item) => item.id === call.arguments.customerId);
          if (!customer) return { ok: false, error: "That customer is no longer available in this shop." };
          const entries = await this.repository.ledger(customer.id);
          const balance = khataBalance(entries);
          if (call.arguments.type === "received" && call.arguments.amountRupees > balance) return clarificationResult(
            `${customer.name}'s current balance is ${rupees(balance)}. Enter an amount up to that balance; nothing was saved.`,
            { kind: "repayment-amount", customerId: customer.id, customer: customer.name, customerCode: customer.customerCode ?? `ID-${customer.id}`, outstanding: Math.max(balance, 0), requested: call.arguments.amountRupees },
          );
          await this.repository.addEntry(customer.id, call.arguments.type, call.arguments.amountRupees, call.arguments.note, this.requestKey);
          let updated: LedgerRecord[];
          try { updated = await this.repository.ledger(customer.id); }
          catch {
            return { ok: false, error: `The khata entry may have been saved for ${customer.name}. Check the ledger before retrying.` };
          }
          return { ok: true, data: { intent: "khata.addEntry", customer: customer.name, type: call.arguments.type, amount: call.arguments.amountRupees, balance: khataBalance(updated) } };
        }
        case "customer.getBalanceById": {
          const customer = (await this.repository.customers()).find((item) => item.id === call.arguments.customerId);
          if (!customer) return { ok: false, error: "That customer is no longer available in this shop." };
          const entries = await this.repository.ledger(customer.id);
          return { ok: true, data: { intent: "khata.getBalance", customer: customer.name, customerCode: customer.customerCode ?? `ID-${customer.id}`, balance: khataBalance(entries) } };
        }
        case "customer.getHistoryById": {
          const customer = (await this.repository.customers()).find((item) => item.id === call.arguments.customerId);
          if (!customer) return { ok: false, error: "That customer is no longer available in this shop." };
          const entries = await this.repository.ledger(customer.id);
          return { ok: true, data: { intent: "khata.getHistory", customer: customer.name, entries, balance: khataBalance(entries) } };
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
        case "sales.getMonthlySummary": {
          if (!this.repository.monthlySales) return { ok: false, error: "Monthly sales reporting is unavailable." };
          const summary = await this.repository.monthlySales(call.arguments.month);
          return { ok: true, data: { intent: call.intent, month: call.arguments.month, ...summary } };
        }
        case "sales.getHistory": {
          if (!this.repository.salesHistory) return { ok: false, error: "Sales history is unavailable." };
          const history = await this.repository.salesHistory(call.arguments);
          return { ok: true, data: { intent: call.intent, sales: history } };
        }
        case "reports.getSummary": {
          const date = todayInIndia(new Date());
          const [products, sales, customers, reorder] = await Promise.all([
            this.repository.products(), this.repository.dailySales(date),
            this.repository.customers(), this.repository.reorderSuggestions(),
          ]);
          const balances = await Promise.all(customers.map(async (customer) => khataBalance(await this.repository.ledger(customer.id))));
          return { ok: true, data: { intent: call.intent, date,
            productCount: products.length, lowStockCount: reorder.length,
            salesTotal: sales.total, saleCount: sales.count, outstandingTotal: balances.reduce((sum, balance) => sum + Math.max(0, balance), 0) } };
        }
        case "inventory.getReorderSuggestions": {
          const suggestions = await this.repository.reorderSuggestions();
          return { ok: true, data: { intent: call.intent, suggestions } };
        }
        case "supplier.list": {
          const suppliers = await this.repository.suppliers();
          return { ok: true, data: { intent: call.intent, suppliers } };
        }
        case "supplier.listActive": {
          const saved = await this.repository.suppliers();
          if (saved.some((supplier) => supplier.active === undefined || supplier.active === null)) return { ok: false, error: "Saved active/inactive status is unavailable until the supplier-status migration is applied." };
          const suppliers = saved.filter((supplier) => supplier.active === true);
          return { ok: true, data: { intent: call.intent, suppliers } };
        }
        case "supplier.search": {
          const query = normalizedName(call.arguments.query);
          const suppliers = (await this.repository.suppliers()).filter((supplier) => normalizedName(supplier.name).includes(query));
          return { ok: true, data: { intent: call.intent, suppliers } };
        }
        case "supplier.getDetails": {
          const matches = matchByNameAllowMany(await this.repository.suppliers(), call.arguments.supplier);
          if (!matches.length) return { ok: false, error: "No matching supplier was found in this shop." };
          return { ok: true, data: { intent: call.intent, suppliers: matches } };
        }
        case "supplier.getOrders": {
          const matches = matchByNameAllowMany(await this.repository.suppliers(), call.arguments.supplier);
          if (!matches.length) return { ok: false, error: "No matching supplier was found in this shop." };
          const orders = await this.repository.orders();
          return { ok: true, data: { intent: call.intent, supplier: matches[0].name,
            orders: orders.filter((order) => normalizedName(order.supplier) === normalizedName(matches[0].name)) } };
        }
        case "supplier.forProduct": {
          const product = matchByName(await this.repository.products(), call.arguments.product);
          if (!product) return { ok: false, error: "No matching product was found in this shop." };
          const orders = (await this.repository.orders()).filter((order) => order.items.some((item) => normalizedName(item).includes(normalizedName(product.name))));
          const suppliers = [...new Map(orders.map((order) => [order.supplier, order.supplier])).values()];
          return { ok: true, data: { intent: call.intent, product: product.name, suppliers, orders } };
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
          const savedOrders = await this.repository.orders();
          const matches = isGenericOrderReference(call.arguments.order) ? savedOrders : matchingOrders(savedOrders, call.arguments.order);
          if (!matches.length) return { ok: false, error: "No matching purchase order was found in this shop." };
          if (matches.length > 1) return clarificationResult(`Several orders match ${call.arguments.order}. Select an exact order number to check its status.`, {
            kind: "order-status-select", query: call.arguments.order, candidates: matches.slice(0, 10).map(orderOption),
          });
          return { ok: true, data: { intent: call.intent, orders: matches } };
        }
        case "orders.getStatusById": {
          const order = (await this.repository.orders()).find((item) => item.id === call.arguments.orderId);
          if (!order) return { ok: false, error: "No purchase order with that reference was found in this shop." };
          return { ok: true, data: { intent: "orders.getStatus", orders: [order] } };
        }
        case "orders.transition": {
          const matches = matchingOrders(await this.repository.orders(), call.arguments.order);
          if (!matches.length) return { ok: false, error: "No matching purchase order was found in this shop." };
          if (matches.length > 1) {
            const candidates = matches.slice(0, 10).map(orderOption);
            return clarificationResult(`More than one order matches. Choose an exact order number before I ask for confirmation.`, {
              kind: "order-transition-select", query: call.arguments.order, action: call.arguments.action, candidates,
            });
          }
          const order = matches[0];
          if (!canTransition(order.status, call.arguments.action)) return { ok: false, error: `This order is ${order.status} and cannot be ${transitionPast(call.arguments.action)}.` };
          const orderLabel = formatOrderLabel(order);
          const pending: PendingClarification = { kind: "order-transition-confirm", orderId: order.id, orderLabel, currentStatus: order.status, action: call.arguments.action };
          return clarificationResult(`${call.arguments.action === "place" ? "Mark" : call.arguments.action === "receive" ? "Receive goods for" : "Cancel"} ${orderLabel}, currently ${order.status}? Reply yes or cancel. Receiving increases stock once; placing is internal and does not contact the supplier. No order was changed.`, pending);
        }
        case "orders.transitionConfirmed": {
          const order = (await this.repository.orders()).find((candidate) => candidate.id === call.arguments.orderId);
          if (!order) return { ok: false, error: "That purchase order is no longer available in this shop." };
          if (order.status !== call.arguments.expectedStatus) return { ok: false, error: `The order changed from ${call.arguments.expectedStatus} to ${order.status} while you were deciding. Check its current status before trying again.` };
          if (!canTransition(order.status, call.arguments.action)) return { ok: false, error: `The order is now ${order.status}; the requested action is no longer valid.` };
          const status = await this.repository.transitionOrder(order.id, call.arguments.expectedStatus, call.arguments.action, this.requestKey);
          return { ok: true, data: { intent: call.intent, supplier: order.supplier, orderId: order.id, orderNumber: order.orderNumber ?? `LEGACY-${order.id}`, action: call.arguments.action, status } };
        }
        case "orders.createDraft":
        case "orders.createDraftConfirmed": {
          const [suppliers, products] = await Promise.all([this.repository.suppliers(), this.repository.products()]);
          const items = call.arguments.items.map((item) => {
            const product = matchByName(products, item.product);
            if (!product) throw new Error(`Product not found: ${item.product}.`);
            return { productId: product.id, quantity: item.quantity };
          });
          if (new Set(items.map((item) => item.productId)).size !== items.length) return { ok: false, error: "The order repeats a product." };
          let supplier = matchByName(suppliers, call.arguments.supplier);
          if (!supplier && call.intent === "orders.createDraft") return clarificationResult(
            `I could not find ${call.arguments.supplier} in this shop's supplier list. Add this supplier and create an internal purchase-order draft for the requested items? No records have been created.`,
            { kind: "supplier-create-confirm", supplier: call.arguments.supplier, items: call.arguments.items });
          if (!supplier) {
            try {
              const id = await this.repository.createSupplier(call.arguments.supplier, this.requestKey);
              supplier = { id, name: call.arguments.supplier };
            } catch (error) {
              // A concurrent explicit addition may have won the unique-name race.
              const refreshed = matchByName(await this.repository.suppliers(), call.arguments.supplier);
              if (!refreshed) throw error;
              supplier = refreshed;
            }
          }
          const orderKey = call.intent === "orders.createDraftConfirmed"
            ? derivedRequestKey(this.requestKey, "confirmed-order-draft") : this.requestKey;
          const order = await this.repository.createOrderDraft(supplier.id, items, orderKey);
          return { ok: true, data: { intent: call.intent, supplier: supplier.name, itemCount: items.length, id: order.id, orderNumber: order.orderNumber, status: order.status } };
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
    if (result.error.startsWith("Sale may have been saved")) {
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
    case "customer.list":
    case "customer.search": {
      const customers = data.customers as { name: string; customerCode: string; maskedPhone?: string }[];
      return { title: "Customers", detail: `${customers.length} matching record(s)`, reply: customers.length
        ? customers.map((customer) => `${customer.name} · ${customer.customerCode}${customer.maskedPhone ? ` · ${customer.maskedPhone}` : ""}`).join(". ")
        : "No matching customers are saved in this shop." };
    }
    case "khata.openAccount":
      return { title: "Khata opened", detail: `${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `${data.customer}'s new khata was opened with ${rupees(Number(data.balance))} outstanding.` };
    case "sales.recordConfirmedBasket":
    case "sales.recordSpoken":
      return { title: "Sale recorded", detail: `${rupees(Number(data.total))} · confirmed by store`, reply: `Sale recorded for ${rupees(Number(data.total))}. Stock was reduced in the same database transaction.` };
    case "sales.recordCreditSpoken":
      return { title: "Credit sale recorded", detail: `${rupees(Number(data.total))} · ${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `The ${rupees(Number(data.total))} credit sale for ${data.customer} was saved. Sale, inventory deduction and khata receivable were recorded in one database transaction. The outstanding balance is ${rupees(Number(data.balance))}.` };
    case "inventory.adjust":
      return { title: "Stock updated", detail: `${data.product} · ${data.newStock} in stock`, reply: `Done. ${data.product} stock is now ${data.newStock} after a ${Number(data.delta) > 0 ? "+" : ""}${data.delta} adjustment.` };
    case "inventory.getStock":
      return { title: "Stock checked", detail: `${data.product} · ${data.stock} in stock`, reply: `${data.product} has ${data.stock} units in stock.` };
    case "khata.getBalance":
      return { title: "Balance checked", detail: `${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `${data.customer}'s outstanding balance is ${rupees(Number(data.balance))}.` };
    case "khata.getHistory": {
      const entries = data.entries as LedgerRecord[];
      return { title: "Khata history", detail: `${data.customer} · ${entries.length} ledger entry(ies) · ${rupees(Number(data.balance))} outstanding`, reply: entries.length
        ? `${data.customer}'s ledger: ${entries.map((entry) => `${entry.type === "gave" ? "credit" : "payment"} ${rupees(entry.amount)}${entry.createdAt ? ` on ${entry.createdAt.slice(0, 10)}` : ""}${entry.note ? ` (${entry.note})` : ""}`).join("; ")}. Current balance ${rupees(Number(data.balance))}.`
        : `${data.customer} has no ledger entries.` };
    }
    case "khata.addEntry":
      return { title: data.type === "received" ? "Payment recorded" : "Udhaar recorded", detail: `${data.customer} · ${rupees(Number(data.balance))} outstanding`, reply: `${data.type === "received" ? "Payment of" : "New udhaar of"} ${rupees(Number(data.amount))} was recorded. ${data.customer}'s outstanding balance is now ${rupees(Number(data.balance))}.` };
    case "sales.getDailySummary":
      return { title: "Sales summary", detail: `${data.date} · ${rupees(Number(data.total))}`, reply: `Sales on ${data.date} total ${rupees(Number(data.total))} across ${data.count} sale(s).` };
    case "sales.getMonthlySummary":
      return { title: "Monthly sales", detail: `${data.month} · ${rupees(Number(data.total))}`, reply: `Sales for ${data.month} total ${rupees(Number(data.total))} across ${data.count} sale(s), based on saved records.` };
    case "sales.getHistory": {
      const sales = data.sales as { saleId: string; date: string; total: number; paymentMethod: string | null }[];
      return { title: "Sales history", detail: `${sales.length} saved sale(s)`, reply: sales.length
        ? sales.map((sale) => `${todayInIndia(new Date(sale.date))} · ${rupees(sale.total)}${sale.paymentMethod ? ` · ${sale.paymentMethod}` : ""}`).join(". ")
        : "No matching sales are saved in this period." };
    }
    case "reports.getSummary":
      return { title: "Business summary", detail: `${data.productCount} products · ${data.lowStockCount} low stock · ${rupees(Number(data.salesTotal))} sold today`, reply: `For ${data.date}: ${data.productCount} saved products, ${data.lowStockCount} at or below their reorder threshold, ${data.saleCount} sale(s) totalling ${rupees(Number(data.salesTotal))}, and ${rupees(Number(data.outstandingTotal))} total outstanding khata.` };
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
    case "supplier.search":
    case "supplier.getDetails":
    case "supplier.listActive": {
      const suppliers = data.suppliers as SupplierRecord[];
      return { title: "Supplier records", detail: `${suppliers.length} supplier(s)`, reply: suppliers.length
        ? suppliers.map((supplier) => `${supplier.name}${supplier.active === false ? " · inactive" : ""}${supplier.contactName ? ` · ${supplier.contactName}` : ""}${supplier.phone ? ` · ${supplier.phone}` : ""}`).join(". ")
        : "No matching suppliers are saved in this shop." };
    }
    case "supplier.getOrders": {
      const orders = data.orders as OpenOrderRecord[];
      return { title: "Supplier purchase history", detail: `${orders.length} saved order(s) for ${data.supplier}`, reply: orders.length
        ? orders.map((order) => `${order.orderNumber ?? `LEGACY-${order.id}`} · ${order.orderDate ? todayInIndia(new Date(order.orderDate)) : "date unavailable"} · ${order.status} · ${order.items.join(", ")}`).join(". ")
        : `No purchase orders are saved for ${data.supplier}.` };
    }
    case "supplier.forProduct": {
      const suppliers = data.suppliers as string[];
      const orders = data.orders as OpenOrderRecord[];
      return { title: "Supplier purchase history", detail: `${suppliers.length} supplier(s) with saved orders for ${data.product}`, reply: suppliers.length
        ? `${data.product} appears in saved orders from ${suppliers.join(", ")}. ${orders.map((order) => `${order.orderNumber ?? `LEGACY-${order.id}`} (${order.status})`).join(", ")}.`
        : `No saved purchase orders link ${data.product} to a supplier.` };
    }
    case "orders.getOpen": {
      const orders = data.orders as OpenOrderRecord[];
      return { title: "Open purchase orders", detail: `${orders.length} draft or placed`, reply: orders.length ? `You have ${orders.length} open purchase order(s): ${orders.map((item) => `${item.supplier} (${item.status})`).join(", ")}.` : "There are no open purchase orders." };
    }
    case "orders.getStatus": {
      const orders = data.orders as OpenOrderRecord[];
      return { title: orders.length === 1 ? "Purchase order status" : "Matching purchase orders", detail: `${orders.length} order(s)`, reply: orders.map((order) => `${order.orderNumber ?? `LEGACY-${order.id}`} · ${order.supplier} · ${order.status} · ${order.items.join(", ")}`).join(". ") };
    }
    case "orders.transitionConfirmed": {
      const action = String(data.action);
      const status = String(data.status);
      const actionText = action === "place" ? "marked placed" : action === "receive" ? "received" : "cancelled";
      const disclosure = action === "place" ? " This is an internal status; no supplier was contacted." : action === "receive" ? " The database recorded the receipt and stock movement atomically." : "";
      return { title: `Order ${status}`, detail: `${data.orderNumber ?? `LEGACY-${String(data.orderId)}`} · ${data.supplier} · ${status}`, reply: `${data.supplier}'s order ${data.orderNumber ?? `LEGACY-${String(data.orderId)}`} was ${actionText}; its saved status is ${status}.${disclosure}` };
    }
    case "orders.createDraft":
    case "orders.createDraftConfirmed":
      return { title: `Purchase order ${data.status}`, detail: `${data.orderNumber ?? "Reference unavailable"} · ${data.supplier} · ${data.itemCount} product(s)`, reply: `Internal purchase order ${data.orderNumber ?? "without a reference"} for ${data.supplier} was saved with status ${data.status}. No supplier was contacted and stock was not changed.` };
    default:
      throw new Error("Unknown authoritative tool result.");
  }
}
