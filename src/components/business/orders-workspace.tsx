"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, PackageCheck, Plus } from "lucide-react";
import { rupees } from "@/lib/business/calculations";
import { whatsAppDraft } from "@/lib/business/sharing";
import { reorderSuggestions } from "@/lib/business/reorder";
import type { Product, PurchaseOrder, PurchaseOrderItem, Supplier } from "@/lib/business/schemas";
import { useBusinessMutation } from "./use-business-mutation";
import { useLocale } from "@/components/layout/locale-provider";

type Line = { productId: string; quantity: number; unitCost: number | null };

export function OrdersWorkspace({ suppliers, products, orders, items }: {
  suppliers: Supplier[]; products: Product[]; orders: PurchaseOrder[]; items: PurchaseOrderItem[];
}) {
  const { locale, t } = useLocale();
  const availableProducts = products.filter((product) => !product.archived_at);
  const suggestions = reorderSuggestions(availableProducts);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const { busy, error, notice, run } = useBusinessMutation();
  const visibleOrders = statusFilter === "all" ? orders : orders.filter((order) => order.status === statusFilter);
  const duplicate = new Set(lines.map((line) => line.productId)).size !== lines.length;
  const estimated = lines.reduce((sum, line) => sum + line.quantity * (line.unitCost ?? products.find((product) => product.id === line.productId)?.cost_price ?? products.find((product) => product.id === line.productId)?.selling_price ?? 0), 0);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const note = String(new FormData(form).get("note") ?? "").trim();
    if (!supplierId || !lines.length || duplicate) return;
    if (await run({ kind: "order.createDraft", supplierId, items: lines, note }, t("Purchase order draft saved. No supplier has been contacted."))) { setLines([]); form.reset(); }
  }

  async function transition(order: PurchaseOrder, action: "place" | "receive" | "cancel") {
    if (action === "receive" && !window.confirm(t("Confirm goods were received? This will add each ordered quantity to inventory."))) return;
    await run({ kind: "order.transition", id: order.id, action }, t(action === "receive" ? "Goods received and stock movements saved." : action === "place" ? "Order marked placed. Contact the supplier separately." : "Order cancelled. No stock changed."));
  }

  return <div className="business-page orders-page">
    <div className="workspace-page-heading"><p className="workspace-eyebrow">{t("ORDERS / CONNECTED")}</p><h1>{t("Purchase")} <em>{t("orders.")}</em></h1><p>{t("Plan replenishment, track each status, and add stock only when goods arrive.")}</p></div>
    <div className="order-status-strip">{(["draft", "placed", "received", "cancelled"] as const).map((status) => <div key={status} data-status={status}><span>{t(status).toUpperCase()}</span><strong>{orders.filter((order) => order.status === status).length}</strong></div>)}</div>
    <section className="business-section reorder-section"><div className="section-heading"><span>{t("REORDER SUGGESTIONS")} / {suggestions.length}</span><span>{t("AT OR BELOW THRESHOLD")}</span></div>
      {suggestions.length ? <div className="reorder-list">{suggestions.map((item) => <div key={item.productId}><div><strong>{item.name}</strong><span>{item.stock} {t("on shelf")} · {t("threshold")} {item.threshold}</span></div><strong>+{item.quantity}</strong><button type="button" onClick={() => setLines((current) => current.some((line) => line.productId === item.productId) ? current : [...current, { productId: item.productId, quantity: item.quantity, unitCost: item.unitCost }])}>{t("Add to draft")}</button></div>)}</div>
        : <p className="business-muted">{t("No products are at or below their reorder threshold.")}</p>}
    </section>
    <div className="business-columns">
      <section className="business-section business-form-panel"><div className="section-heading"><span>{t("NEW PURCHASE ORDER")}</span><span>{t("INTERNAL DRAFT")}</span></div>
        {suppliers.length && availableProducts.length ? <form className="business-form" onSubmit={(event) => void createDraft(event)}><label>{t("Supplier")}<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          {lines.map((line, index) => <div className="order-line" key={index}><label>{t("Product")}<select value={line.productId} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, productId: event.target.value, unitCost: null } : item))}>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>{t("Quantity")}<input type="number" min="1" max="10000" required value={line.quantity} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, quantity: Number(event.target.value) } : item))} /></label><label>{t("Unit cost")} ₹<input type="number" min="0" step="0.01" value={line.unitCost ?? ""} placeholder={t("Product cost")} onChange={(event) => setLines((current) => current.map((item, position) => position === index ? { ...item, unitCost: event.target.value === "" ? null : Number(event.target.value) } : item))} /></label><button className="line-remove" type="button" onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>{t("Remove")}</button></div>)}
          <button className="text-button" type="button" disabled={lines.length >= availableProducts.length} onClick={() => setLines((current) => [...current, { productId: availableProducts.find((product) => !current.some((line) => line.productId === product.id))?.id ?? availableProducts[0].id, quantity: 1, unitCost: null }])}><Plus size={14} aria-hidden="true" /> {t("Add product")}</button>
          {duplicate && <p className="form-error" role="alert">{t("Each product can appear only once.")}</p>}
          <label>{t("Order note (optional)")}<input name="note" maxLength={300} placeholder={t("Delivery or supplier reference")} /></label><div className="sale-total"><span>{t("ESTIMATED COST")}</span><strong>{rupees(estimated)}</strong><small>{t("Based on saved unit costs; not a payment or supplier invoice.")}</small></div><button className="button button-copper" type="submit" disabled={busy || !lines.length || duplicate}>{t("Save draft")}</button>
        </form> : <p className="business-muted">{t("Add a supplier and a product before drafting an order.")} <Link href="/app/suppliers">{t("Open suppliers")} <ArrowUpRight size={14} aria-hidden="true" /></Link></p>}
      </section>
      <section className="business-section"><div className="section-heading"><span>{t("PURCHASE ORDER HISTORY")} / {orders.length}</span></div><label className="business-filter">{t("Show")}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{t("All orders")}</option><option value="draft">{t("Draft")}</option><option value="placed">{t("Placed")}</option><option value="received">{t("Received")}</option><option value="cancelled">{t("Cancelled")}</option></select></label>
        {visibleOrders.length ? <ul className="order-history">{visibleOrders.map((order) => { const orderItems = items.filter((item) => item.order_id === order.id); const supplier = suppliers.find((item) => item.id === order.supplier_id); const lines = orderItems.map((item) => { const product = products.find((entry) => entry.id === item.product_id); return `${product?.name ?? t("Product")}: ${item.quantity} ${product?.unit ?? t("units")}`; }); const shareText = `${t("Purchase order")} ${order.id.slice(0, 8)} ${t("for")} ${supplier?.name ?? t("supplier")}:\n${lines.join("\n")}\n${t("Please confirm availability and price.")}`; const shareLink = whatsAppDraft(shareText, supplier?.phone ?? undefined) ?? whatsAppDraft(shareText); return <li key={order.id}><div className="order-history-head"><strong>{supplier?.name ?? t("Supplier")}</strong><span data-status={order.status}>{t(order.status)}</span></div><div className="order-progress" data-status={order.status} aria-label={`${t("Order status:")} ${t(order.status)}`}><span>{t("Draft")}</span><span>{t("Placed")}</span><span>{t("Received")}</span></div><p>{lines.join(" · ") || t("No items")}</p><div className="order-history-foot"><span>{new Date(order.created_at).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN")} · {rupees(orderItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0))}</span><div>{["draft", "placed"].includes(order.status) && shareLink && <a className="business-share-link" href={shareLink} target="_blank" rel="noopener noreferrer">{t("Open WhatsApp draft")} <ExternalLink size={14} aria-hidden="true" /></a>}{order.status === "draft" && <button type="button" disabled={busy} onClick={() => void transition(order, "place")}>{t("Mark placed")}</button>}{order.status === "placed" && <button type="button" disabled={busy} onClick={() => void transition(order, "receive")}><PackageCheck size={15} aria-hidden="true" /> {t("Receive goods")}</button>}{["draft", "placed"].includes(order.status) && <button type="button" disabled={busy} onClick={() => void transition(order, "cancel")}>{t("Cancel")}</button>}</div></div></li>; })}</ul>
          : <p className="business-muted">{statusFilter === "all" ? t("No purchase orders yet. Use a reorder suggestion to start a draft.") : `${t("No orders with status:")} ${t(statusFilter)}.`}</p>}
      </section>
    </div>
    {notice && <p className="form-notice" role="status">{t(notice)}</p>}{error && <p className="form-error" role="alert">{t(error)}</p>}
  </div>;
}
