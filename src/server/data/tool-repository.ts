import "server-only";

import { z } from "zod";
import { indiaDayBounds } from "@/lib/business/calculations";
import { pendingClarificationSchema, type PendingClarification } from "@/lib/ai/types/tool-call";
import type { ShopContext } from "./context";
import type { BusinessRepository, CustomerRecord, LedgerRecord, ProductRecord, SupplierRecord, ReorderRecord, OpenOrderRecord, OrderStatus } from "../tools/business-executor";

type ReadyContext = Extract<ShopContext, { kind: "ready" }>;

export class SupabaseBusinessRepository implements BusinessRepository {
  constructor(private readonly context: ReadyContext) {}

  async products(): Promise<ProductRecord[]> {
    const { data, error } = await this.context.client.from("products")
      .select("id,name,unit,current_stock,selling_price").eq("shop_id", this.context.shop.id).is("archived_at", null);
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
    if (readError || !row) throw new Error("Product was submitted but its saved result could not be verified.");
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
    const { data, error } = await this.context.client.from("customers")
      .select("id,name").eq("shop_id", this.context.shop.id);
    if (error) throw new Error("Khata is unavailable.");
    return z.array(z.object({ id: z.uuid(), name: z.string() })).parse(data);
  }

  async createCustomer(name: string, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.rpc("create_customer_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_name: name, p_phone: null,
    });
    if (error) throw new Error(error.code === "23505" ? "A customer with that name already exists." : "Customer could not be added.");
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
    const { data, error } = await this.context.client.from("khata_entries")
      .select("type,amount").eq("shop_id", this.context.shop.id).eq("customer_id", customerId);
    if (error) throw new Error("Khata balance is unavailable.");
    return z.array(z.object({ type: z.enum(["gave", "received"]), amount: z.coerce.number() })).parse(data);
  }

  async addEntry(customerId: string, type: "gave" | "received", amount: number, note: string | undefined, requestKey: string): Promise<void> {
    const { error } = await this.context.client.rpc("add_khata_entry_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_customer_id: customerId,
      p_type: type, p_amount: amount, p_note: note || null,
    });
    if (error) throw new Error("Khata entry could not be saved.");
  }

  async dailySales(date: string): Promise<{ total: number; count: number }> {
    const { start, end } = indiaDayBounds(date);
    const { data, error } = await this.context.client.from("sales")
      .select("total_amount").eq("shop_id", this.context.shop.id).gte("created_at", start).lt("created_at", end);
    if (error) throw new Error("Sales summary is unavailable.");
    const sales = z.array(z.object({ total_amount: z.coerce.number() })).parse(data);
    return { total: sales.reduce((total, sale) => total + Math.round(sale.total_amount * 100), 0) / 100, count: sales.length };
  }

  async recordSale(items: { productId: string; quantity: number; expectedUnitPrice?: number }[], paymentMethod: "cash" | "upi" | "card", requestKey: string): Promise<{ saleId: string; total: number }> {
    const measured = items.some((item) => !Number.isInteger(item.quantity) || item.expectedUnitPrice !== undefined);
    const { data, error } = await this.context.client.rpc(measured ? "record_sale_decimal_idempotent" : "record_sale_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_items: items, p_payment_method: paymentMethod,
    });
    if (error?.code === "PGRST202" && measured) throw new Error("Measured sales are unavailable until the database migration is applied. No sale was recorded.");
    if (error) throw new Error(error.code === "P0001" ? "Insufficient stock. No sale was recorded."
      : error.code === "P0003" ? "The product price changed. Review the sale again; nothing was recorded." : "Sale could not be recorded.");
    return z.object({ saleId: z.uuid(), total: z.coerce.number().nonnegative() }).parse(data);
  }

  async suppliers(): Promise<SupplierRecord[]> {
    const { data, error } = await this.context.client.from("suppliers").select("id,name").eq("shop_id", this.context.shop.id).order("name");
    if (error) throw new Error("Supplier directory is unavailable.");
    return z.array(z.object({ id: z.uuid(), name: z.string() })).parse(data);
  }

  async createSupplier(name: string, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.rpc("create_supplier_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_name: name, p_contact_name: null, p_phone: null,
    });
    if (error) throw new Error(error.code === "23505" ? "A supplier with that name already exists." : "Supplier could not be saved.");
    return z.uuid().parse(data);
  }

  async reorderSuggestions(): Promise<ReorderRecord[]> {
    const { data, error } = await this.context.client.from("products")
      .select("name,current_stock,low_stock_threshold").eq("shop_id", this.context.shop.id).is("archived_at", null);
    if (error) throw new Error("Reorder suggestions are unavailable.");
    return z.array(z.object({ name: z.string(), current_stock: z.coerce.number(), low_stock_threshold: z.coerce.number() })).parse(data)
      .filter((product) => product.current_stock <= product.low_stock_threshold)
      .map((product) => ({ product: product.name, stock: product.current_stock, threshold: product.low_stock_threshold,
        quantity: Math.max(1, product.low_stock_threshold * 2 - product.current_stock) }));
  }

  async openOrders(): Promise<OpenOrderRecord[]> {
    return (await this.orders()).filter((order) => order.status === "draft" || order.status === "placed");
  }

  async orders(): Promise<OpenOrderRecord[]> {
    const [ordersResult, suppliersResult] = await Promise.all([
      this.context.client.from("purchase_orders").select("id,supplier_id,status").eq("shop_id", this.context.shop.id).order("created_at", { ascending: false }).limit(30),
      this.context.client.from("suppliers").select("id,name").eq("shop_id", this.context.shop.id),
    ]);
    if (ordersResult.error || suppliersResult.error) throw new Error("Purchase orders are unavailable.");
    const orders = z.array(z.object({ id: z.uuid(), supplier_id: z.uuid(), status: z.enum(["draft", "placed", "received", "cancelled"]) })).parse(ordersResult.data);
    if (!orders.length) return [];
    const [itemResult, productResult] = await Promise.all([
      this.context.client.from("purchase_order_items").select("order_id,product_id,quantity").eq("shop_id", this.context.shop.id).in("order_id", orders.map((order) => order.id)),
      this.context.client.from("products").select("id,name").eq("shop_id", this.context.shop.id),
    ]);
    if (itemResult.error || productResult.error) throw new Error("Purchase-order details are unavailable.");
    const items = z.array(z.object({ order_id: z.uuid(), product_id: z.uuid(), quantity: z.number().int().positive() })).parse(itemResult.data);
    const products = z.array(z.object({ id: z.uuid(), name: z.string() })).parse(productResult.data);
    const suppliers = z.array(z.object({ id: z.uuid(), name: z.string() })).parse(suppliersResult.data);
    return orders.map((order) => ({
      id: order.id, supplier: suppliers.find((supplier) => supplier.id === order.supplier_id)?.name ?? "Supplier", status: order.status,
      items: items.filter((item) => item.order_id === order.id).map((item) => `${products.find((product) => product.id === item.product_id)?.name ?? "Product"} × ${item.quantity}`),
    }));
  }

  async createOrderDraft(supplierId: string, items: { productId: string; quantity: number }[], requestKey: string): Promise<{ id: string; status: OrderStatus }> {
    const { data, error } = await this.context.client.rpc("create_purchase_order_idempotent", {
      p_shop_id: this.context.shop.id, p_request_key: requestKey, p_supplier_id: supplierId, p_items: items.map((item) => ({ ...item, unitCost: null })), p_note: "Assistant draft",
    });
    if (error) throw new Error(error.code === "P0002" ? "Supplier or product not found." : "Purchase order draft could not be saved.");
    const id = z.uuid().parse(data);
    const { data: order, error: readError } = await this.context.client.from("purchase_orders")
      .select("id,status").eq("id", id).eq("shop_id", this.context.shop.id).maybeSingle();
    if (readError || !order) throw new Error("The draft was submitted but its saved status could not be verified.");
    return z.object({ id: z.uuid(), status: z.enum(["draft", "placed", "received", "cancelled"]) }).parse(order);
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
    if (readError || !saved) throw new Error("The transition ran but its saved status could not be verified.");
    const status = z.enum(["draft", "placed", "received", "cancelled"]).parse(saved.status);
    if (status !== returnedStatus) throw new Error("The purchase-order status changed again; reload it before taking another action.");
    return status;
  }
}
