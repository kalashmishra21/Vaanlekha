import "server-only";

import { z } from "zod";
import { indiaDayBounds, indiaMonthBounds } from "@/lib/business/calculations";
import { pendingClarificationSchema, type PendingClarification } from "@/lib/ai/types/tool-call";
import type { ShopContext } from "./context";
import type { BusinessRepository, CustomerRecord, LedgerRecord, ProductRecord, SupplierRecord, ReorderRecord, OpenOrderRecord, OrderStatus } from "../tools/business-executor";

type ReadyContext = Extract<ShopContext, { kind: "ready" }>;
const POSTGREST_PAGE_SIZE = 1000;

async function fetchAllPages<T extends { id: string }>(requestPage: (afterId: string | null) => PromiseLike<{
  data: T[] | null;
  error: { code: string; message: string } | null;
}>): Promise<{ data: T[] | null; error: { code: string; message: string } | null }> {
  const rows: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await requestPage(afterId);
    if (page.error) return { data: null, error: page.error };
    const pageRows = page.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < POSTGREST_PAGE_SIZE) return { data: rows, error: null };
    const nextId = pageRows.at(-1)?.id;
    if (!nextId || nextId === afterId) return { data: null, error: { code: "PGRST000", message: "Pagination cursor did not advance." } };
    afterId = nextId;
  }
}

export class SupabaseBusinessRepository implements BusinessRepository {
  constructor(private readonly context: ReadyContext) {}

  async products(): Promise<ProductRecord[]> {
    const { data, error } = await fetchAllPages((afterId) => {
      const query = this.context.client.from("products").select("id,name,unit,current_stock,selling_price")
        .eq("shop_id", this.context.shop.id).is("archived_at", null);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    if (error) throw new Error("Inventory is unavailable.");
    return z.array(z.object({ id: z.uuid(), name: z.string(), unit: z.string(), current_stock: z.coerce.number(), selling_price: z.coerce.number() }))
      .parse(data).map((row) => ({ id: row.id, name: row.name, unit: row.unit, currentStock: row.current_stock, sellingPrice: row.selling_price }));
  }

  async createProduct(input: { name: string; unit: string; sellingPrice: number; openingStock: number; threshold: number }, requestKey: string): Promise<ProductRecord> {
    const measured = !Number.isInteger(input.openingStock);
    const { data, error } = await this.context.client.rpc(measured ? "create_product_decimal_idempotent" : "create_product_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_name: input.name, p_sku: null, p_unit: input.unit,
      p_selling_price: input.sellingPrice, p_cost_price: null, p_threshold: input.threshold, p_opening_stock: input.openingStock,
    });
    if (error) throw new Error(error.code === "23505" ? "A product with that name already exists."
      : error.code === "PGRST202" && measured ? "Measured stock is unavailable until the database migration is applied. No product was created." : "Product could not be created.");
    const id = z.uuid().parse(data);
    const { data: row, error: readError } = await this.context.client.from("products")
      .select("id,name,unit,current_stock,selling_price").eq("shop_id", this.context.shop.id).eq("id", id).maybeSingle();
    if (readError || !row) throw new Error("Product may have been saved. Check inventory before retrying.");
    const saved = z.object({ id: z.uuid(), name: z.string(), unit: z.string(), current_stock: z.coerce.number(), selling_price: z.coerce.number() }).parse(row);
    return { id: saved.id, name: saved.name, unit: saved.unit, currentStock: saved.current_stock, sellingPrice: saved.selling_price };
  }

  async pendingClarification(): Promise<{ pending: PendingClarification; requestKey: string } | null> {
    const { data, error } = await this.context.client.rpc("get_assistant_pending_clarification", { p_shop_id: this.context.shop.id });
    if (error) throw new Error("Assistant follow-up context is unavailable.");
    if (data === null) return null;
    const saved = z.object({ pending: z.unknown(), requestKey: z.uuid() }).parse(data);
    return { pending: pendingClarificationSchema.parse(saved.pending), requestKey: saved.requestKey };
  }

  async savePendingClarification(pending: PendingClarification, requestKey: string): Promise<void> {
    const { error } = await this.context.client.rpc("save_assistant_pending_clarification", {
      p_shop_id: this.context.shop.id, p_pending: pending, p_request_key: requestKey,
    });
    if (error) throw new Error("The follow-up could not be safely saved. No store action was taken.");
  }

  async clearPendingClarification(): Promise<void> {
    const { error } = await this.context.client.rpc("clear_assistant_pending_clarification", { p_shop_id: this.context.shop.id });
    if (error) throw new Error("The pending follow-up could not be cleared.");
  }

  async adjustStock(productId: string, delta: number, requestKey: string): Promise<number> {
    const args = {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_product_id: productId, p_delta: delta, p_note: "Assistant request",
    };
    let { data, error } = await this.context.client.rpc("adjust_stock_decimal_idempotent", args);
    if (error?.code === "PGRST202" && Number.isInteger(delta)) {
      ({ data, error } = await this.context.client.rpc("adjust_stock_idempotent", args));
    }
    if (error?.code === "PGRST202") throw new Error("Measured stock is unavailable until the database migration is applied. No stock changed.");
    if (error) throw new Error(error.code === "P0001" ? "Product missing or insufficient stock." : "Stock adjustment failed.");
    return z.coerce.number().parse(data);
  }

  async customers(): Promise<CustomerRecord[]> {
    let data: unknown;
    let error: { code: string; message: string } | null;
    const primary = await fetchAllPages((afterId) => {
      const query = this.context.client.from("customers").select("id,name,customer_code,phone").eq("shop_id", this.context.shop.id);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    data = primary.data;
    error = primary.error;
    let hasStableReference = true;
    if (error && ["PGRST204", "42703"].includes(error.code) && /customer_code/iu.test(error.message)) {
      hasStableReference = false;
      const fallback = await fetchAllPages((afterId) => {
        const query = this.context.client.from("customers").select("id,name,phone").eq("shop_id", this.context.shop.id);
        return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
      });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw new Error("Khata is unavailable.");
    if (hasStableReference) return z.array(z.object({ id: z.uuid(), name: z.string(), customer_code: z.string(), phone: z.string().nullable() })).parse(data)
      .map((row) => ({ id: row.id, name: row.name, customerCode: row.customer_code, phone: row.phone }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.id.localeCompare(b.id));
    return z.array(z.object({ id: z.uuid(), name: z.string(), phone: z.string().nullable() })).parse(data)
      .map((row) => ({ id: row.id, name: row.name, customerCode: `ID-${row.id}`, phone: row.phone }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.id.localeCompare(b.id));
  }

  async createCustomer(name: string, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.rpc("create_customer_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_name: name, p_phone: null,
    });
    if (error) throw new Error("Customer could not be added.");
    return z.uuid().parse(data);
  }

  async openAccount(name: string, amount: number, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.rpc("open_khata_account_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_name: name, p_amount: amount,
    });
    if (error) throw new Error(error.code === "23505" ? "A customer with that name already exists." : "Opening khata could not be saved.");
    return z.uuid().parse(data);
  }

  async ledger(customerId: string): Promise<LedgerRecord[]> {
    const { data, error } = await fetchAllPages((afterId) => {
      const query = this.context.client.from("khata_entries").select("id,type,amount,note,created_at")
        .eq("shop_id", this.context.shop.id).eq("customer_id", customerId);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    if (error) throw new Error("Khata balance is unavailable.");
    return z.array(z.object({ id: z.uuid(), type: z.enum(["gave", "received"]), amount: z.coerce.number(), note: z.string().nullable(), created_at: z.string() }))
      .parse(data).map((row) => ({ id: row.id, type: row.type, amount: row.amount, note: row.note, createdAt: row.created_at }))
      .sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
  }

  async addEntry(customerId: string, type: "gave" | "received", amount: number, note: string | undefined, requestKey: string): Promise<void> {
    const { error } = await this.context.client.rpc("add_khata_entry_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_customer_id: customerId,
      p_type: type, p_amount: amount, p_note: note || null,
    });
    if (error) throw new Error(error.code === "23514" ? "The repayment is greater than the current outstanding balance. No entry was saved." : "Khata entry could not be saved.");
  }

  async dailySales(date: string): Promise<{ total: number; count: number }> {
    const { start, end } = indiaDayBounds(date);
    return this.salesSummary(start, end, "Sales summary is unavailable.");
  }

  async monthlySales(month: string): Promise<{ total: number; count: number }> {
    let bounds: { start: string; end: string };
    try { bounds = indiaMonthBounds(month); }
    catch { throw new Error("Choose a valid sales month."); }
    return this.salesSummary(bounds.start, bounds.end, "Monthly sales summary is unavailable.");
  }

  async salesHistory(filter: { date?: string; month?: string }): Promise<{ saleId: string; date: string; total: number; paymentMethod: string | null }[]> {
    const query = this.context.client.from("sales").select("id,created_at,total_amount,payment_method")
      .eq("shop_id", this.context.shop.id).order("created_at", { ascending: false }).limit(30);
    if (filter.date) {
      const { start, end } = indiaDayBounds(filter.date);
      query.gte("created_at", start).lt("created_at", end);
    } else if (filter.month) {
      let bounds: { start: string; end: string };
      try { bounds = indiaMonthBounds(filter.month); }
      catch { throw new Error("Choose a valid sales month."); }
      query.gte("created_at", bounds.start).lt("created_at", bounds.end);
    }
    const { data, error } = await query;
    if (error) throw new Error("Sales history is unavailable.");
    return z.array(z.object({ id: z.uuid(), created_at: z.string(), total_amount: z.coerce.number(), payment_method: z.string().nullable() })).parse(data)
      .map((row) => ({ saleId: row.id, date: row.created_at, total: row.total_amount, paymentMethod: row.payment_method }));
  }

  private async salesSummary(start: string, end: string, errorMessage: string): Promise<{ total: number; count: number }> {
    const { data, error } = await this.context.client.rpc("get_shop_sales_summary", {
      p_shop_id: this.context.shop.id, p_start: start, p_end: end,
    });
    if (!error) {
      const summary = z.object({ total: z.coerce.number().nonnegative(), count: z.coerce.number().int().nonnegative() }).parse(data);
      return { total: Math.round(summary.total * 100) / 100, count: summary.count };
    }
    if (error.code !== "PGRST202") throw new Error(errorMessage);

    // Keep reports working against production until the additive aggregate RPC
    // is applied. PostgREST caps a response at 1,000 rows, so page every saved
    // total in a deterministic order rather than silently returning a partial
    // sum. New sales are timestamped now and append after existing rows.
    let offset = 0;
    let count = 0;
    let totalPaise = 0;
    while (true) {
      const page = await this.context.client.from("sales").select("total_amount")
        .eq("shop_id", this.context.shop.id).gte("created_at", start).lt("created_at", end)
        .order("created_at", { ascending: true }).order("id", { ascending: true })
        .range(offset, offset + 999);
      if (page.error) throw new Error(errorMessage);
      const sales = z.array(z.object({ total_amount: z.coerce.number().nonnegative() })).parse(page.data);
      count += sales.length;
      totalPaise += sales.reduce((sum, sale) => sum + Math.round(sale.total_amount * 100), 0);
      if (sales.length < 1000) break;
      offset += 1000;
    }
    return { total: totalPaise / 100, count };
  }

  async recordSale(items: { productId: string; quantity: number; expectedUnitPrice?: number }[], paymentMethod: "cash" | "upi" | "card" | null, requestKey: string): Promise<{ saleId: string; total: number }> {
    const measured = items.some((item) => !Number.isInteger(item.quantity) || item.expectedUnitPrice !== undefined);
    const { data, error } = await this.context.client.rpc(measured ? "record_sale_decimal_idempotent" : "record_sale_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_items: items, p_payment_method: paymentMethod,
    });
    if (error?.code === "PGRST202" && measured) throw new Error("Measured sales are unavailable until the database migration is applied. No sale was recorded.");
    if (error) throw new Error(error.code === "P0001" ? "Insufficient stock. No sale was recorded."
      : error.code === "P0003" ? "The product price changed. Review the sale again; nothing was recorded." : "Sale could not be recorded.");
    return z.object({ saleId: z.uuid(), total: z.coerce.number().nonnegative() }).parse(data);
  }

  async recordCreditSale(input: { customerId: string | null; newCustomerName: string | null; items: { productId: string; quantity: number; expectedUnitPrice?: number }[] }, requestKey: string): Promise<{ saleId: string; total: number; customerId: string }> {
    const { data, error } = await this.context.client.rpc("record_credit_sale_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_customer_id: input.customerId,
      p_new_customer_name: input.newCustomerName, p_items: input.items,
    });
    if (error?.code === "PGRST202") throw new Error("Credit sales are unavailable until the business-accounting migration is applied. No sale or stock change was made.");
    if (error) throw new Error(error.code === "P0001" ? "Insufficient stock. No sale or khata entry was recorded."
      : error.code === "P0003" ? "The product price changed. Review the sale again; nothing was recorded."
        : error.code === "P0002" ? "Customer or product was not found in this shop. No sale was recorded." : "Credit sale could not be recorded safely.");
    return z.object({ saleId: z.uuid(), customerId: z.uuid(), total: z.coerce.number().nonnegative() }).parse(data);
  }

  async suppliers(): Promise<SupplierRecord[]> {
    let data: unknown;
    let error: { code: string; message: string } | null;
    const primary = await fetchAllPages((afterId) => {
      const query = this.context.client.from("suppliers").select("id,name,contact_name,phone,is_active").eq("shop_id", this.context.shop.id);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    data = primary.data;
    error = primary.error;
    let hasActive = true;
    if (error && ["PGRST204", "42703"].includes(error.code) && /is_active/iu.test(error.message)) {
      hasActive = false;
      const fallback = await fetchAllPages((afterId) => {
        const query = this.context.client.from("suppliers").select("id,name,contact_name,phone").eq("shop_id", this.context.shop.id);
        return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
      });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw new Error("Supplier directory is unavailable.");
    if (!hasActive) return z.array(z.object({ id: z.uuid(), name: z.string(), contact_name: z.string().nullable(), phone: z.string().nullable() })).parse(data)
      .map((row) => ({ id: row.id, name: row.name, contactName: row.contact_name, phone: row.phone, active: null }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.id.localeCompare(b.id));
    return z.array(z.object({ id: z.uuid(), name: z.string(), contact_name: z.string().nullable(), phone: z.string().nullable(), is_active: z.boolean() })).parse(data)
      .map((row) => ({ id: row.id, name: row.name, contactName: row.contact_name, phone: row.phone, active: row.is_active }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.id.localeCompare(b.id));
  }

  async createSupplier(name: string, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.rpc("create_supplier_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_name: name, p_contact_name: null, p_phone: null,
    });
    if (error) throw new Error(error.code === "23505" ? "A supplier with that name already exists." : "Supplier could not be saved.");
    return z.uuid().parse(data);
  }

  async reorderSuggestions(): Promise<ReorderRecord[]> {
    const { data, error } = await fetchAllPages((afterId) => {
      const query = this.context.client.from("products").select("id,name,current_stock,low_stock_threshold")
        .eq("shop_id", this.context.shop.id).is("archived_at", null);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    if (error) throw new Error("Reorder suggestions are unavailable.");
    return z.array(z.object({ id: z.uuid(), name: z.string(), current_stock: z.coerce.number(), low_stock_threshold: z.coerce.number() })).parse(data)
      .filter((product) => product.current_stock <= product.low_stock_threshold)
      .map((product) => ({ product: product.name, stock: product.current_stock, threshold: product.low_stock_threshold,
        quantity: Math.max(1, product.low_stock_threshold * 2 - product.current_stock) }));
  }

  async openOrders(): Promise<OpenOrderRecord[]> {
    return (await this.orders()).filter((order) => order.status === "draft" || order.status === "placed");
  }

  async orders(): Promise<OpenOrderRecord[]> {
    let orderData: unknown;
    let orderError: { code: string; message: string } | null;
    const primaryOrders = await fetchAllPages((afterId) => {
      const query = this.context.client.from("purchase_orders")
        .select("id,order_number,total_amount,supplier_id,status,created_at").eq("shop_id", this.context.shop.id);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    orderData = primaryOrders.data;
    orderError = primaryOrders.error;
    let hasOrderReferences = true;
    if (orderError && ["PGRST204", "42703"].includes(orderError.code) && /order_number|total_amount/iu.test(orderError.message)) {
      hasOrderReferences = false;
      const legacyOrders = await fetchAllPages((afterId) => {
        const query = this.context.client.from("purchase_orders").select("id,supplier_id,status,created_at").eq("shop_id", this.context.shop.id);
        return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
      });
      orderData = legacyOrders.data;
      orderError = legacyOrders.error;
    }
    if (orderError) throw new Error("Purchase orders are unavailable.");
    let suppliers: SupplierRecord[];
    try { suppliers = await this.suppliers(); }
    catch { throw new Error("Purchase orders are unavailable."); }
    const orderSchema = hasOrderReferences
      ? z.array(z.object({ id: z.uuid(), order_number: z.string(), total_amount: z.coerce.number(), supplier_id: z.uuid(), status: z.enum(["draft", "placed", "received", "cancelled"]), created_at: z.string() }))
      : z.array(z.object({ id: z.uuid(), supplier_id: z.uuid(), status: z.enum(["draft", "placed", "received", "cancelled"]), created_at: z.string() }));
    const orders = orderSchema.parse(orderData).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
    if (!orders.length) return [];
    const productResult = await fetchAllPages((afterId) => {
      const query = this.context.client.from("products").select("id,name").eq("shop_id", this.context.shop.id);
      return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
    });
    if (productResult.error) throw new Error("Purchase-order details are unavailable.");
    const items: { order_id: string; product_id: string; quantity: number; unit_cost: number | null }[] = [];
    for (let offset = 0; offset < orders.length; offset += 100) {
      const orderIds = orders.slice(offset, offset + 100).map((order) => order.id);
      const itemResult = await fetchAllPages((afterId) => {
        const query = this.context.client.from("purchase_order_items").select("id,order_id,product_id,quantity,unit_cost")
          .eq("shop_id", this.context.shop.id).in("order_id", orderIds);
        return (afterId ? query.gt("id", afterId) : query).order("id").range(0, POSTGREST_PAGE_SIZE - 1);
      });
      if (itemResult.error) throw new Error("Purchase-order details are unavailable.");
      const itemSchema = z.object({ id: z.uuid(), order_id: z.uuid(), product_id: z.uuid(), quantity: z.coerce.number().positive(), unit_cost: z.coerce.number().nullable() })
        .omit({ id: true });
      items.push(...z.array(itemSchema).parse(itemResult.data));
    }
    const products = z.array(z.object({ id: z.uuid(), name: z.string() })).parse(productResult.data);
    return orders.map((order) => ({
      id: order.id, orderNumber: hasOrderReferences ? z.object({ order_number: z.string() }).parse(order).order_number : `LEGACY-${order.id}`,
      orderDate: order.created_at,
      total: hasOrderReferences ? z.object({ total_amount: z.number() }).parse(order).total_amount
        : items.filter((item) => item.order_id === order.id).reduce((sum, item) => sum + item.quantity * (item.unit_cost ?? 0), 0),
      supplier: suppliers.find((supplier) => supplier.id === order.supplier_id)?.name ?? "Supplier", status: order.status,
      items: items.filter((item) => item.order_id === order.id).map((item) => `${products.find((product) => product.id === item.product_id)?.name ?? "Product"} × ${item.quantity}`),
    }));
  }

  async createOrderDraft(supplierId: string, items: { productId: string; quantity: number }[], requestKey: string): Promise<{ id: string; orderNumber: string; status: OrderStatus }> {
    const identityProbe = await this.context.client.from("purchase_orders").select("order_number,total_amount")
      .eq("shop_id", this.context.shop.id).limit(1);
    if (identityProbe.error) throw new Error("Purchase order creation is paused until the additive order-reference migration is applied. No order or stock was changed.");
    const { data, error } = await this.context.client.rpc("create_purchase_order_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_supplier_id: supplierId, p_items: items.map((item) => ({ ...item, unitCost: null })), p_note: "Assistant draft",
    });
    if (error) throw new Error(error.code === "P0002" ? "Supplier or product not found." : "Purchase order draft could not be saved.");
    const id = z.uuid().parse(data);
    const { data: order, error: readError } = await this.context.client.from("purchase_orders")
      .select("id,order_number,status").eq("id", id).eq("shop_id", this.context.shop.id).maybeSingle();
    if (readError || !order) throw new Error("The purchase order may have been saved. Check the order list before retrying.");
    return z.object({ id: z.uuid(), order_number: z.string(), status: z.enum(["draft", "placed", "received", "cancelled"]) })
      .transform((row) => ({ id: row.id, orderNumber: row.order_number, status: row.status })).parse(order);
  }

  async transitionOrder(orderId: string, expectedStatus: OrderStatus, action: "place" | "receive" | "cancel", requestKey: string): Promise<OrderStatus> {
    const { data, error } = await this.context.client.rpc("transition_purchase_order_confirmed_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_order_id: orderId,
      p_expected_status: expectedStatus, p_action: action,
    });
    if (error) throw new Error(error.code === "P0002" ? "Purchase order not found." : "Purchase order status could not be changed safely.");
    const returnedStatus = z.enum(["draft", "placed", "received", "cancelled"]).parse(data);
    const { data: saved, error: readError } = await this.context.client.from("purchase_orders")
      .select("status").eq("id", orderId).eq("shop_id", this.context.shop.id).maybeSingle();
    if (readError || !saved) throw new Error("The purchase-order transition may have been saved. Check the order status before retrying.");
    const status = z.enum(["draft", "placed", "received", "cancelled"]).parse(saved.status);
    if (status !== returnedStatus) throw new Error("The purchase-order status changed again; reload it before taking another action.");
    return status;
  }
}
