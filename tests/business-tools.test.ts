import { describe, expect, it } from "vitest";
import { businessActionSchema } from "../src/lib/business/schemas";
import { indiaDayBounds, khataBalance, salePreviewTotal, todayInIndia, totalKhataOutstanding } from "../src/lib/business/calculations";
import { BusinessToolExecutor, describeToolResult, type BusinessRepository } from "../src/server/tools/business-executor";
import { executeValidatedToolCall } from "../src/server/tools/contracts";
import { matchShoppingList } from "../src/lib/assistant/match-shopping-list";
import { toolCallSchema, type ToolCall } from "../src/lib/ai/types/tool-call";
import { reorderSuggestions } from "../src/lib/business/reorder";
import { MockAIProvider } from "../src/lib/ai/providers/mock";

function fakeRepository() {
  const maggiId = "11111111-1111-4111-8111-111111111112";
  let stock = 20;
  let entries: { type: "gave" | "received"; amount: number }[] = [
    { type: "gave", amount: 460 }, { type: "received", amount: 200 },
  ];
  const productRows = [{ id: maggiId, name: "Maggi", unit: "packet", currentStock: stock, sellingPrice: 15 }];
  const customers = [{ id: "rahul-id", name: "Rahul Sharma" }];
  const orders: { id: string; supplier: string; status: "draft" | "placed" | "received" | "cancelled"; items: string[] }[] = [];
  const repository: BusinessRepository = {
    async products() { return productRows; },
    async createProduct(input) { const row = { id: "11111111-1111-4111-8111-111111111119", name: input.name, unit: input.unit, currentStock: input.openingStock, sellingPrice: input.sellingPrice }; productRows.push(row); return row; },
    async adjustStock(_id, delta) {
      if (stock + delta < 0) throw new Error("Insufficient stock.");
      stock += delta;
      return stock;
    },
    async customers() { return customers; },
    async createCustomer(name) { const id = "11111111-1111-4111-8111-111111111113"; customers.push({ id, name }); return id; },
    async openAccount(name, amount) { const id = "11111111-1111-4111-8111-111111111114"; customers.push({ id, name }); entries = [...entries, { type: "gave", amount }]; return id; },
    async ledger() { return entries; },
    async addEntry(_id, type, amount) { entries = [...entries, { type, amount }]; },
    async dailySales() { return { total: 310, count: 2 }; },
    async recordSale(items) {
      const amount = items.reduce((sum, item) => sum + item.quantity * 15, 0);
      if (items.some((item) => item.quantity > stock)) throw new Error("Insufficient stock. No sale was recorded.");
      stock -= items.reduce((sum, item) => sum + item.quantity, 0);
      return { saleId: "11111111-1111-4111-8111-111111111115", total: amount };
    },
    async suppliers() { return [{ id: "11111111-1111-4111-8111-111111111116", name: "North Market Distributors" }]; },
    async createSupplier() { return "11111111-1111-4111-8111-111111111117"; },
    async reorderSuggestions() { return [{ product: "Maggi", stock, threshold: 10, quantity: Math.max(1, 20 - stock) }]; },
    async openOrders() { return orders.filter((order) => order.status === "draft" || order.status === "placed"); },
    async orders() { return orders; },
    async createOrderDraft(_supplierId, items) { const order = { id: "11111111-1111-4111-8111-111111111118", supplier: "North Market Distributors", status: "draft" as const, items: items.map((item) => `Maggi × ${item.quantity}`) }; orders.push(order); return { id: order.id, status: order.status }; },
    async transitionOrder(orderId, expectedStatus, action) { const order = orders.find((candidate) => candidate.id === orderId); if (!order) throw new Error("Purchase order not found."); if (order.status !== expectedStatus) throw new Error("The purchase order changed."); order.status = action === "place" ? "placed" : action === "receive" ? "received" : "cancelled"; return order.status; },
  };
  return { repository, getStock: () => stock, getCustomers: () => customers, getEntries: () => entries };
}

describe("business boundary", () => {
  it("asks for a missing product's selling price before creating stock", async () => {
    const fake = fakeRepository();
    const result = await new BusinessToolExecutor(fake.repository).execute({ intent: "inventory.adjust",
      arguments: { product: "Ice Cream", delta: 10, unit: "unit" } });
    expect(result).toMatchObject({ ok: false, clarification: { pending: { kind: "product-create-price", product: "Ice Cream", openingStock: 10 } } });
    expect(fake.getStock()).toBe(20);
  });
  it("derives reorder quantities and rejects invalid purchase orders", () => {
    const suggestions = reorderSuggestions([{ id: "a", name: "Milk", current_stock: 3, low_stock_threshold: 5, cost_price: 20, selling_price: 25 },
      { id: "b", name: "Tea", current_stock: 20, low_stock_threshold: 5, cost_price: null, selling_price: 10 }]);
    expect(suggestions).toMatchObject([{ name: "Milk", quantity: 7 }]);
    expect(businessActionSchema.safeParse({ kind: "order.createDraft", supplierId: "bad", items: [] }).success).toBe(false);
    expect(toolCallSchema.safeParse({ intent: "orders.createDraft", arguments: { supplier: "North Market", items: [{ product: "Milk", quantity: -1 }] } }).success).toBe(false);
  });

  it("creates an internal order draft only after the trusted repository returns", async () => {
    const fake = fakeRepository();
    const result = await executeValidatedToolCall({ intent: "orders.createDraft", arguments: {
      supplier: "North Market Distributors", items: [{ product: "Maggi", quantity: 10 }],
    } }, new BusinessToolExecutor(fake.repository));
    expect(result).toMatchObject({ ok: true, data: { itemCount: 1 } });
    expect(describeToolResult(result).reply).toContain("No supplier was contacted");
    expect(fake.getStock()).toBe(20);
  });

  it("never confirms an order draft after a repository failure", async () => {
    const fake = fakeRepository();
    fake.repository.createOrderDraft = async () => { throw new Error("Purchase order draft could not be saved."); };
    const result = await executeValidatedToolCall({ intent: "orders.createDraft", arguments: {
      supplier: "North Market Distributors", items: [{ product: "Maggi", quantity: 10 }],
    } }, new BusinessToolExecutor(fake.repository));
    expect(result.ok).toBe(false);
    expect(describeToolResult(result).title).toBe("Action not completed");
    expect(fake.getStock()).toBe(20);
  });

  it("rejects unknown suppliers and products without saving an order", async () => {
    const executor = new BusinessToolExecutor(fakeRepository().repository);
    expect(await executor.execute({ intent: "orders.createDraft", arguments: { supplier: "Missing", items: [{ product: "Maggi", quantity: 1 }] } })).toMatchObject({ ok: false });
    expect(await executor.execute({ intent: "orders.createDraft", arguments: { supplier: "North Market Distributors", items: [{ product: "Missing", quantity: 1 }] } })).toMatchObject({ ok: false });
  });
  it("rejects invalid product and sale input before a database call", () => {
    expect(businessActionSchema.safeParse({ kind: "product.adjust", id: "bad-id", delta: 0 }).success).toBe(false);
    expect(businessActionSchema.safeParse({ kind: "sale.record", items: [{ productId: "bad-id", quantity: -1 }], paymentMethod: "cash" }).success).toBe(false);
    const product = { kind: "product.create", name: "Test", unit: "piece", sellingPrice: 0.29, threshold: 0, openingStock: 0 };
    expect(businessActionSchema.safeParse(product).success).toBe(true);
    expect(businessActionSchema.safeParse({ ...product, sellingPrice: 0.291 }).success).toBe(false);
  });

  it("calculates khata outstanding with the documented sign convention", () => {
    expect(khataBalance([{ type: "gave", amount: 460 }, { type: "received", amount: 200 }])).toBe(260);
    expect(totalKhataOutstanding([
      { customer_id: "a", type: "gave", amount: 460 },
      { customer_id: "a", type: "received", amount: 200 },
      { customer_id: "b", type: "received", amount: 50 },
    ])).toBe(260);
  });

  it("calculates a sale preview in paise and rejects unknown products", () => {
    const products = [{ id: "a", selling_price: 15.5 }, { id: "b", selling_price: 10 }];
    expect(salePreviewTotal([{ productId: "a", quantity: 2 }, { productId: "b", quantity: 3 }], products)).toBe(61);
    expect(() => salePreviewTotal([{ productId: "missing", quantity: 1 }], products)).toThrow();
  });

  it("uses India business-day bounds for sales queries", () => {
    expect(indiaDayBounds("2026-10-07")).toEqual({ start: "2026-10-06T18:30:00.000Z", end: "2026-10-07T18:30:00.000Z" });
    expect(todayInIndia(new Date("2026-10-06T19:00:00Z"))).toBe("2026-10-07");
  });

  it("confirms a stock adjustment only after the repository succeeds", async () => {
    const fake = fakeRepository();
    const executor = new BusinessToolExecutor(fake.repository);
    const proposal = await executeValidatedToolCall({ intent: "inventory.adjust", arguments: { product: "Maggi", delta: 20 } }, executor);
    expect(proposal).toMatchObject({ ok: false, clarification: { pending: { kind: "product-existing-confirm", delta: 20 } } });
    expect(fake.getStock()).toBe(20);
    if (!("clarification" in proposal)) throw new Error("Expected stock confirmation");
    const confirmed = await new MockAIProvider().reason({ text: "haan", pending: proposal.clarification.pending });
    if (confirmed.kind !== "tool_call") throw new Error("Expected confirmed stock call");
    const result = await executeValidatedToolCall(confirmed.tool, executor);
    expect(result).toMatchObject({ ok: true, data: { newStock: 40 } });
    expect(fake.getStock()).toBe(40);
    expect(describeToolResult(result).reply).toContain("Done.");
  });

  it("does not claim success when stock is insufficient", async () => {
    const fake = fakeRepository();
    const executor = new BusinessToolExecutor(fake.repository);
    const proposal = await executor.execute({ intent: "inventory.adjust", arguments: { product: "Maggi", delta: -21 } });
    expect(proposal).toMatchObject({ clarification: { pending: { delta: -21 } } });
    expect(fake.getStock()).toBe(20);
    if (!("clarification" in proposal)) throw new Error("Expected stock confirmation");
    const confirmed = await new MockAIProvider().reason({ text: "yes", pending: proposal.clarification.pending });
    if (confirmed.kind !== "tool_call") throw new Error("Expected confirmed stock call");
    const result = await executor.execute(confirmed.tool);
    expect(result.ok).toBe(false);
    expect(fake.getStock()).toBe(20);
    expect(describeToolResult(result).title).toBe("Action not completed");
  });

  it.each([
    ["आइसक्रीम", "Ice Cream", "packet", 10],
    ["Ice Cream", "आइसक्रीम", "pack", 10],
  ])("matches %s to the saved %s alias and waits for approval", async (savedName, requestName, unit, delta) => {
    let stock = 10;
    const repository = { products: async () => [{ id: "11111111-1111-4111-8111-111111111119", name: savedName, unit: "packet", currentStock: stock, sellingPrice: 25 }],
      adjustStock: async (_id: string, change: number) => { stock += change; return stock; } } as unknown as BusinessRepository;
    const executor = new BusinessToolExecutor(repository);
    const proposal = await executor.execute({ intent: "inventory.adjust", arguments: { product: requestName, unit, delta } });
    expect(proposal).toMatchObject({ clarification: { pending: { kind: "product-existing-confirm", delta: 10, unit: "packet" } } });
    expect(stock).toBe(10);
    if (!("clarification" in proposal)) throw new Error("Expected confirmation");
    const yes = await new MockAIProvider().reason({ text: "हाँ", pending: JSON.parse(JSON.stringify(proposal.clarification.pending)) });
    if (yes.kind !== "tool_call") throw new Error("Expected stock call after approval");
    expect(await executor.execute(yes.tool)).toMatchObject({ ok: true, data: { newStock: 20 } });
  });

  it("reads Rahul Sharma from the Sharma ji alias and derives his balance", async () => {
    const executor = new BusinessToolExecutor(fakeRepository().repository);
    const result = await executor.execute({ intent: "khata.getBalance", arguments: { customer: "Sharma ji" } });
    expect(result).toMatchObject({ ok: true, data: { customer: "Rahul Sharma", balance: 260 } });
  });

  it("does not substitute an ASR-misheard customer name with someone else's ledger", async () => {
    const executor = new BusinessToolExecutor(fakeRepository().repository);
    const result = await executor.execute({ intent: "khata.getBalance", arguments: { customer: "Shyama ji" } });
    expect(result.ok).toBe(false);
    expect(describeToolResult(result).title).toBe("Action not completed");
  });

  it("saves a khata entry before calculating the new balance", async () => {
    const executor = new BusinessToolExecutor(fakeRepository().repository);
    const result = await executor.execute({ intent: "khata.addEntry", arguments: { customer: "Sharma ji", type: "gave", amountRupees: 100 } });
    expect(result).toMatchObject({ ok: true, data: { balance: 360 } });
  });

  it("creates a customer and opening udhaar through the trusted repository", async () => {
    const fake = fakeRepository();
    const result = await executeValidatedToolCall({ intent: "khata.openAccount", arguments: { customer: "Nandini", amountRupees: 100 } }, new BusinessToolExecutor(fake.repository));
    expect(result).toMatchObject({ ok: true, data: { customer: "Nandini", balance: 100 } });
    expect(fake.getCustomers()).toContainEqual({ id: "11111111-1111-4111-8111-111111111114", name: "Nandini" });
    expect(fake.getEntries()).toContainEqual({ type: "gave", amount: 100 });
  });

  it("creates a new product only after the missing selling price is supplied", async () => {
    const provider = new MockAIProvider();
    const first = await provider.reason({ text: "50 packet of Bread add kro new inventory h ye" });
    expect(first).toMatchObject({ kind: "clarify", pending: { kind: "product-create-price", openingStock: 50 } });
    if (first.kind !== "clarify" || !first.pending) throw new Error("Expected a product-price clarification");
    const confirmation = await provider.reason({ text: "₹18 per packet", pending: first.pending });
    expect(confirmation).toMatchObject({ kind: "clarify", pending: { kind: "product-create-confirm", sellingPrice: 18 } });
    if (confirmation.kind !== "clarify" || !confirmation.pending) throw new Error("Expected creation confirmation");
    const completed = await provider.reason({ text: "yes", pending: confirmation.pending });
    expect(completed).toMatchObject({ kind: "tool_call", tool: { intent: "product.create" } });
    if (completed.kind !== "tool_call") throw new Error("Expected validated product creation intent");
    const fake = fakeRepository();
    const result = await executeValidatedToolCall(completed.tool, new BusinessToolExecutor(fake.repository));
    expect(result).toMatchObject({ ok: true, data: { product: "Bread", stock: 50, sellingPrice: 18 } });
    expect(fake.repository.createProduct).toBeDefined();
  });

  it("routes an existing matching customer to an entry and a missing one through explicit permission", async () => {
    const fake = fakeRepository();
    fake.getCustomers().push({ id: "mahi-id", name: "Mahi Patel" });
    const executor = new BusinessToolExecutor(fake.repository);
    const existingCall: ToolCall = { intent: "khata.addEntry", arguments: { customer: "Mahi", type: "gave", amountRupees: 100 } };
    const existing = await executor.execute(existingCall);
    expect(existing).toMatchObject({ ok: true, data: { customer: "Mahi Patel", balance: 360 } });

    const missingCall: ToolCall = { intent: "khata.addEntry", arguments: { customer: "Nandini", type: "gave", amountRupees: 100 } };
    const needsPermission = await executor.execute(missingCall);
    expect(needsPermission).toMatchObject({ ok: false, clarification: { pending: { kind: "khata-create-confirm", customer: "Nandini", amountRupees: 100 } } });
    expect(fake.getCustomers().some((customer) => customer.name === "Nandini")).toBe(false);
    if (!("clarification" in needsPermission)) throw new Error("Expected account confirmation");
    const confirmed = await new MockAIProvider().reason({ text: "haan", pending: needsPermission.clarification.pending });
    expect(confirmed).toMatchObject({ kind: "tool_call", tool: { intent: "khata.openAccount", arguments: { customer: "Nandini", amountRupees: 100 } } });
    if (confirmed.kind !== "tool_call") throw new Error("Expected opening-account call");
    expect(await executor.execute(confirmed.tool)).toMatchObject({ ok: true, data: { customer: "Nandini", balance: 100 } });
    expect(fake.getCustomers().some((customer) => customer.name === "Nandini")).toBe(true);
  });

  it("does not guess among ambiguous customer names", async () => {
    const fake = fakeRepository();
    fake.getCustomers().push({ id: "mahi-a", name: "Mahi Sharma" }, { id: "mahi-b", name: "Mahi Verma" });
    const result = await new BusinessToolExecutor(fake.repository).execute({
      intent: "khata.getBalance", arguments: { customer: "Mahi" },
    });
    expect(result).toMatchObject({ ok: false, error: "More than one record matches that name. Use the full name." });
  });

  it("requires confirmation for owner-scoped order transitions and rejects a stale confirmation", async () => {
    const fake = fakeRepository();
    const executor = new BusinessToolExecutor(fake.repository);
    const created = await executor.execute({ intent: "orders.createDraft", arguments: {
      supplier: "North Market Distributors", items: [{ product: "Maggi", quantity: 2 }],
    } });
    expect(created).toMatchObject({ ok: true, data: { status: "draft" } });
    const requested = await executor.execute({ intent: "orders.transition", arguments: { order: "North Market Distributors", action: "place" } });
    expect(requested).toMatchObject({ ok: false, clarification: { pending: { kind: "order-transition-confirm", currentStatus: "draft", action: "place" } } });
    if (!("clarification" in requested)) throw new Error("Expected explicit order confirmation");
    const stalePending = requested.clarification.pending;
    const [order] = await fake.repository.orders();
    order.status = "placed";
    const staleIntent = await new MockAIProvider().reason({ text: "yes", pending: stalePending });
    if (staleIntent.kind !== "tool_call") throw new Error("Expected confirmation tool");
    const stale = await executor.execute(staleIntent.tool);
    expect(stale).toMatchObject({ ok: false, error: expect.stringContaining("changed from draft to placed") });
    expect(order.status).toBe("placed");
  });

  it("records a repayment as received and reduces outstanding", async () => {
    const result = await new BusinessToolExecutor(fakeRepository().repository).execute({ intent: "khata.addEntry", arguments: { customer: "Sharma ji", type: "received", amountRupees: 50 } });
    expect(result).toMatchObject({ ok: true, data: { balance: 210, type: "received" } });
    expect(describeToolResult(result).title).toBe("Payment recorded");
  });

  it("validates a shopping-list draft without changing stock", async () => {
    const fake = fakeRepository();
    const result = await new BusinessToolExecutor(fake.repository).execute({ intent: "inventory.checkList", arguments: { items: [
      { product: "Maggi", quantity: 2 }, { product: "Tata Salt", quantity: 1 },
    ] } });
    expect(result).toMatchObject({ ok: true, data: { draft: { canConfirm: false, estimatedTotal: 30,
      items: [{ status: "available", unitPrice: 15 }, { status: "missing" }] } } });
    expect(fake.getStock()).toBe(20);
    expect(() => matchShoppingList([{ product: "Maggi", quantity: 1 }, { product: "maggi", quantity: 2 }], [{ id: "11111111-1111-4111-8111-111111111112", name: "Maggi", unit: "packet", currentStock: 20, sellingPrice: 15 }])).toThrow("repeats");
  });

  it("records a confirmed basket only after trusted sale success", async () => {
    const fake = fakeRepository();
    const executor = new BusinessToolExecutor(fake.repository);
    const productId = "11111111-1111-4111-8111-111111111112";
    const rejected = await executor.execute({ intent: "sales.recordConfirmedBasket", arguments: { items: [{ productId, quantity: 21 }], paymentMethod: "cash" } });
    expect(rejected.ok).toBe(false);
    expect(fake.getStock()).toBe(20);
    expect(describeToolResult(rejected).title).toBe("Action not completed");
    const saved = await executor.execute({ intent: "sales.recordConfirmedBasket", arguments: { items: [{ productId, quantity: 2 }], paymentMethod: "upi" } });
    expect(saved).toMatchObject({ ok: true, data: { total: 30 } });
    expect(fake.getStock()).toBe(18);
    expect(toolCallSchema.safeParse({ intent: "sales.recordConfirmedBasket", arguments: { items: [{ productId, quantity: 0 }], paymentMethod: "cash" } }).success).toBe(false);
  });

  it("returns an authoritative daily sales summary", async () => {
    const result = await new BusinessToolExecutor(fakeRepository().repository).execute({ intent: "sales.getDailySummary", arguments: { date: "2026-10-07" } });
    expect(result).toMatchObject({ ok: true, data: { total: 310, count: 2 } });
  });
});
