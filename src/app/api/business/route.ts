import { businessActionSchema, saleSchema } from "@/lib/business/schemas";
import { getShopContext } from "@/server/data/context";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { missingIdempotencyKey, readIdempotencyKey } from "@/server/security/idempotency";
import { z } from "zod";

export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); } catch {
    return Response.json({ error: "Send a valid request." }, { status: 400 });
  }
  const parsed = businessActionSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Check the entered values and try again." }, { status: 422 });

  const context = await getShopContext();
  if (context.kind === "setup") return Response.json({ error: "Connect Supabase to use store data." }, { status: 503 });
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (context.kind === "unavailable") return Response.json({ error: "Store data is temporarily unavailable." }, { status: 503 });

  const action = parsed.data;
  const rateLimited = await enforceShopRateLimit(context, "business_action");
  if (rateLimited) return rateLimited;
  const idempotentActions = new Set([
    "product.create", "product.adjust", "customer.create", "khata.add", "sale.record",
    "supplier.create", "order.createDraft", "order.transition",
  ]);
  const idempotencyKey = readIdempotencyKey(request);
  if (idempotentActions.has(action.kind) && !idempotencyKey) return missingIdempotencyKey();
  const requestKey = idempotencyKey ?? crypto.randomUUID();
  if (action.kind === "shop.create") {
    if (context.kind !== "no-shop") return Response.json({ error: "A shop is already connected." }, { status: 409 });
    const { data, error } = await context.client.from("shops").insert({ owner_id: context.userId, name: action.name }).select("id").single();
    if (error) return databaseError(error);
    return Response.json({ ok: true, shopId: data.id });
  }
  if (context.kind !== "ready") return Response.json({ error: "Create your shop first." }, { status: 409 });
  const { client, shop } = context;

  switch (action.kind) {
    case "product.create": {
      const measured = !Number.isInteger(action.openingStock);
      const { data, error } = await client.rpc(measured ? "create_product_decimal_idempotent" : "create_product_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_name: action.name, p_sku: action.sku || null, p_unit: action.unit,
        p_selling_price: action.sellingPrice, p_cost_price: action.costPrice ?? null,
        p_threshold: action.threshold, p_opening_stock: action.openingStock,
      });
      if (error?.code === "PGRST202" && measured) return Response.json({ error: "Measured stock needs the database migration before it can be saved. No product was created." }, { status: 503 });
      if (error) return databaseError(error);
      return Response.json({ ok: true, id: data });
    }
    case "product.edit": {
      const { data, error } = await client.from("products").update({
        name: action.name, sku: action.sku || null, unit: action.unit,
        selling_price: action.sellingPrice, cost_price: action.costPrice,
        low_stock_threshold: action.threshold,
      }).eq("id", action.id).eq("shop_id", shop.id).is("archived_at", null).select("id").maybeSingle();
      if (error) return databaseError(error);
      if (!data) return Response.json({ error: "Product not found." }, { status: 404 });
      return Response.json({ ok: true, id: data.id });
    }
    case "product.adjust": {
      const args = {
        p_shop_id: shop.id, p_request_key: requestKey, p_product_id: action.id, p_delta: action.delta, p_note: action.note || null,
      };
      let { data, error } = await client.rpc("adjust_stock_decimal_idempotent", args);
      if (error?.code === "PGRST202" && Number.isInteger(action.delta)) {
        ({ data, error } = await client.rpc("adjust_stock_idempotent", args));
      }
      if (error?.code === "PGRST202") return Response.json({ error: "Measured stock needs the database migration before it can be saved. No stock changed." }, { status: 503 });
      if (error) return databaseError(error);
      return Response.json({ ok: true, currentStock: data });
    }
    case "product.archive": {
      const { data, error } = await client.from("products")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", action.id).eq("shop_id", shop.id).eq("current_stock", 0)
        .is("archived_at", null).select("id").maybeSingle();
      if (error) return databaseError(error);
      if (!data) return Response.json({ error: "Reduce stock to zero before archiving this product." }, { status: 409 });
      return Response.json({ ok: true, id: data.id });
    }
    case "customer.create": {
      const { data, error } = await client.rpc("create_customer_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_name: action.name, p_phone: action.phone || null,
      });
      if (error) return databaseError(error);
      return Response.json({ ok: true, id: data });
    }
    case "khata.add": {
      const { data: customer, error: customerError } = await client.from("customers")
        .select("id").eq("id", action.customerId).eq("shop_id", shop.id).maybeSingle();
      if (customerError) return databaseError(customerError);
      if (!customer) return Response.json({ error: "Customer not found." }, { status: 404 });
      const { data, error } = await client.rpc("add_khata_entry_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_customer_id: action.customerId,
        p_type: action.type, p_amount: action.amount, p_note: action.note || null,
      });
      if (error) return databaseError(error);
      return Response.json({ ok: true, id: data });
    }
    case "sale.record": {
      if (new Set(action.items.map((item) => item.productId)).size !== action.items.length) {
        return Response.json({ error: "Select each product only once." }, { status: 422 });
      }
      const measured = action.items.some((item) => !Number.isInteger(item.quantity));
      const { data: result, error } = await client.rpc(measured ? "record_sale_decimal_idempotent" : "record_sale_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_items: action.items, p_payment_method: action.paymentMethod,
      });
      if (error?.code === "PGRST202" && measured) return Response.json({ error: "Measured sales need the database migration before they can be saved. No sale was recorded." }, { status: 503 });
      if (error) return databaseError(error);
      const saleId = z.object({ saleId: z.uuid(), total: z.number().nonnegative() }).parse(result).saleId;
      const { data: sale, error: readError } = await client.from("sales")
        .select("id,total_amount,payment_method,created_at").eq("id", saleId).eq("shop_id", shop.id).single();
      if (readError) return Response.json({ error: "Sale saved, but confirmation could not be loaded. Check recent sales before retrying." }, { status: 500 });
      return Response.json({ ok: true, sale: saleSchema.parse(sale) });
    }
    case "supplier.create": {
      const { data, error } = await client.rpc("create_supplier_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_name: action.name,
        p_contact_name: action.contactName || null, p_phone: action.phone || null,
      });
      if (error) return databaseError(error);
      return Response.json({ ok: true, id: data });
    }
    case "supplier.edit": {
      const { data, error } = await client.from("suppliers").update({
        name: action.name, contact_name: action.contactName, phone: action.phone,
      }).eq("id", action.id).eq("shop_id", shop.id).select("id").maybeSingle();
      if (error) return databaseError(error);
      if (!data) return Response.json({ error: "Supplier not found." }, { status: 404 });
      return Response.json({ ok: true, id: data.id });
    }
    case "order.createDraft": {
      if (new Set(action.items.map((item) => item.productId)).size !== action.items.length) {
        return Response.json({ error: "Select each product only once." }, { status: 422 });
      }
      const { data, error } = await client.rpc("create_purchase_order_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_supplier_id: action.supplierId, p_items: action.items, p_note: action.note || null,
      });
      if (error) return databaseError(error);
      return Response.json({ ok: true, id: data });
    }
    case "order.transition": {
      const { data, error } = await client.rpc("transition_purchase_order_idempotent", {
        p_shop_id: shop.id, p_request_key: requestKey, p_order_id: action.id, p_action: action.action,
      });
      if (error) return databaseError(error);
      return Response.json({ ok: true, status: data });
    }
  }
}

function databaseError(error: { code?: string; message: string }) {
  if (error.code === "23505") return Response.json({ error: "This name or SKU already exists." }, { status: 409 });
  if (error.code === "22023" && /Idempotency key/i.test(error.message)) return Response.json({ error: "This retry key was already used for a different action. Submit the action again." }, { status: 409 });
  if (error.code === "23514" || error.code === "22023" || error.code === "22P02") {
    return Response.json({ error: "Check the entered values and try again." }, { status: 422 });
  }
  if (error.code === "P0001") return Response.json({ error: "Insufficient stock or product unavailable." }, { status: 409 });
  if (error.code === "P0003") return Response.json({ error: "The product price changed. Review the sale again; nothing was recorded." }, { status: 409 });
  if (error.code === "P0002") return Response.json({ error: "A referenced product, supplier or order was not found." }, { status: 404 });
  if (error.code === "42501") return Response.json({ error: "You do not have access to this shop." }, { status: 403 });
  return Response.json({ error: "The store action could not be completed. Please try again." }, { status: 503 });
}
