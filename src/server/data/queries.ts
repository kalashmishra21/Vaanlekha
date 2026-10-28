import "server-only";

import { z } from "zod";
import { productSchema, customerSchema, khataEntrySchema, movementSchema, saleSchema, customerReviewSchema, supplierSchema, purchaseOrderSchema, purchaseOrderItemSchema } from "@/lib/business/schemas";
import { indiaDayBounds, khataBalance, todayInIndia, totalKhataOutstanding } from "@/lib/business/calculations";
import type { ShopContext } from "./context";

type ReadyContext = Extract<ShopContext, { kind: "ready" }>;

function rows<T extends z.ZodType>(schema: T, data: unknown, error: { message: string } | null): z.infer<T>[] {
  if (error) throw new Error(error.message);
  return z.array(schema).parse(data ?? []);
}

export async function getInventory(context: ReadyContext) {
  const [products, movements] = await Promise.all([
    context.client.from("products").select("id,name,sku,unit,selling_price,cost_price,current_stock,low_stock_threshold,created_at,updated_at,archived_at").eq("shop_id", context.shop.id).order("name"),
    context.client.from("inventory_movements").select("id,product_id,movement_type,quantity_delta,note,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(12),
  ]);
  const allProducts = rows(productSchema, products.data, products.error);
  return {
    products: allProducts.filter((product) => !product.archived_at),
    movementNames: Object.fromEntries(allProducts.map((product) => [product.id, product.name])),
    movements: rows(movementSchema, movements.data, movements.error),
  };
}

export async function getKhata(context: ReadyContext) {
  const [customers, entries] = await Promise.all([
    context.client.from("customers").select("id,name,phone,created_at").eq("shop_id", context.shop.id).order("name"),
    context.client.from("khata_entries").select("id,customer_id,type,amount,note,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }),
  ]);
  const customerRows = rows(customerSchema, customers.data, customers.error);
  const entryRows = rows(khataEntrySchema, entries.data, entries.error);
  return { customers: customerRows, entries: entryRows, balances: Object.fromEntries(customerRows.map((customer) =>
    [customer.id, khataBalance(entryRows.filter((entry) => entry.customer_id === customer.id))])) };
}

export async function getSales(context: ReadyContext) {
  const [products, sales, reviews] = await Promise.all([
    context.client.from("products").select("id,name,sku,unit,selling_price,cost_price,current_stock,low_stock_threshold,created_at,updated_at").eq("shop_id", context.shop.id).is("archived_at", null).order("name"),
    context.client.from("sales").select("id,total_amount,payment_method,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(100),
    context.client.from("customer_reviews").select("id,sale_id,rating,customer_name,comment,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(100),
  ]);
  return { products: rows(productSchema, products.data, products.error), sales: rows(saleSchema, sales.data, sales.error),
    reviews: rows(customerReviewSchema, reviews.data, reviews.error) };
}

export async function getOverview(context: ReadyContext) {
  const { start, end } = indiaDayBounds(todayInIndia());
  const [products, entries, sales, movements, recentSales, recentEntries, recentOrders, customers] = await Promise.all([
    context.client.from("products").select("id,name,sku,unit,selling_price,cost_price,current_stock,low_stock_threshold,created_at,updated_at").eq("shop_id", context.shop.id).is("archived_at", null),
    context.client.from("khata_entries").select("id,customer_id,type,amount,note,created_at").eq("shop_id", context.shop.id),
    context.client.from("sales").select("id,total_amount,payment_method,created_at").eq("shop_id", context.shop.id).gte("created_at", start).lt("created_at", end),
    context.client.from("inventory_movements").select("id,product_id,movement_type,quantity_delta,note,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(5),
    context.client.from("sales").select("id,total_amount,payment_method,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(5),
    context.client.from("khata_entries").select("id,customer_id,type,amount,note,created_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(5),
    context.client.from("purchase_orders").select("id,supplier_id,status,note,created_at,updated_at").eq("shop_id", context.shop.id).order("updated_at", { ascending: false }).limit(5),
    context.client.from("customers").select("id,name,phone,created_at").eq("shop_id", context.shop.id),
  ]);
  const productRows = rows(productSchema, products.data, products.error);
  const entryRows = rows(khataEntrySchema, entries.data, entries.error);
  const saleRows = rows(saleSchema, sales.data, sales.error);
  return {
    todaySales: saleRows.reduce((sum, sale) => sum + Math.round(sale.total_amount * 100), 0) / 100,
    saleCount: saleRows.length,
    lowStock: productRows.filter((p) => p.current_stock <= p.low_stock_threshold),
    outstanding: totalKhataOutstanding(entryRows),
    recentMovements: rows(movementSchema, movements.data, movements.error),
    products: productRows,
    recentSales: rows(saleSchema, recentSales.data, recentSales.error),
    recentEntries: rows(khataEntrySchema, recentEntries.data, recentEntries.error),
    recentOrders: rows(purchaseOrderSchema, recentOrders.data, recentOrders.error),
    customers: rows(customerSchema, customers.data, customers.error),
  };
}

export async function getSuppliers(context: ReadyContext) {
  const { data, error } = await context.client.from("suppliers")
    .select("id,name,contact_name,phone,created_at").eq("shop_id", context.shop.id).order("name");
  return rows(supplierSchema, data, error);
}

export async function getOrders(context: ReadyContext) {
  const [suppliers, products, orders] = await Promise.all([
    context.client.from("suppliers").select("id,name,contact_name,phone,created_at").eq("shop_id", context.shop.id).order("name"),
    context.client.from("products").select("id,name,sku,unit,selling_price,cost_price,current_stock,low_stock_threshold,created_at,updated_at,archived_at").eq("shop_id", context.shop.id).order("name"),
    context.client.from("purchase_orders").select("id,supplier_id,status,note,created_at,updated_at").eq("shop_id", context.shop.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const orderRows = rows(purchaseOrderSchema, orders.data, orders.error);
  // Each order has at most 30 lines. Query the selected history, not an arbitrary
  // global item limit that could silently understate an order's total.
  const items = orderRows.length ? await context.client.from("purchase_order_items")
    .select("id,order_id,product_id,quantity,unit_cost").eq("shop_id", context.shop.id)
    .in("order_id", orderRows.map((order) => order.id)).limit(900) : { data: [], error: null };
  return {
    suppliers: rows(supplierSchema, suppliers.data, suppliers.error),
    products: rows(productSchema, products.data, products.error),
    orders: orderRows,
    items: rows(purchaseOrderItemSchema, items.data, items.error),
  };
}
