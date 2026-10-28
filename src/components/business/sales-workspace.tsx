"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { salePreviewTotal, rupees } from "@/lib/business/calculations";
import type { Product, Sale } from "@/lib/business/schemas";
import { useBusinessMutation } from "./use-business-mutation";

type Line = { productId: string; quantity: number };

export function SalesWorkspace({ products, sales }: { products: Product[]; sales: Sale[] }) {
  const available = products.filter((product) => product.current_stock > 0);
  const [items, setItems] = useState<Line[]>(available[0] ? [{ productId: available[0].id, quantity: 1 }] : []);
  const [payment, setPayment] = useState<"cash" | "upi" | "card">("cash");
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"all" | "cash" | "upi" | "card">("all");
  const [historyDate, setHistoryDate] = useState("");
  const { busy, error, notice, run } = useBusinessMutation();
  const visibleSales = sales.filter((sale) => (historyFilter === "all" || sale.payment_method === historyFilter) && (!historyDate || new Date(sale.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === historyDate));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todaySales = sales.filter((sale) => new Date(sale.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === today);
  const exceedsShownStock = items.some((item) => item.quantity > (products.find((product) => product.id === item.productId)?.current_stock ?? 0));
  let preview: number | null = null;
  try { preview = salePreviewTotal(items, products); } catch { preview = null; }

  async function saveSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmedTotal(null);
    if (!items.length || new Set(items.map((item) => item.productId)).size !== items.length) return;
    const result = await run({ kind: "sale.record", items, paymentMethod: payment }, "Sale recorded and stock reduced.");
    if (result && result.sale && typeof result.sale === "object" && "total_amount" in result.sale) {
      setConfirmedTotal(Number(result.sale.total_amount));
    }
  }

  return <div className="business-page sales-page">
    <div className="workspace-page-heading"><p className="workspace-eyebrow">SALES / CONNECTED</p><h1>Sales <em>desk.</em></h1><p>Build a basket. Database confirmation records the sale and reduces stock together.</p></div>
    <div className="business-summary-grid"><div className="business-summary"><span>TODAY&apos;S SALES</span><strong>{rupees(todaySales.reduce((sum, sale) => sum + sale.total_amount, 0))}</strong><small>{todaySales.length} transaction{todaySales.length === 1 ? "" : "s"} today</small></div><div className="business-summary"><span>RECORDED SALES</span><strong>{sales.length}</strong><small>In your shop history</small></div><div className="business-summary"><span>AVAILABLE PRODUCTS</span><strong>{available.length}</strong><small>Ready for a basket</small></div></div>
    <div className="business-columns">
      <section className="business-section"><div className="section-heading"><span>NEW SALE</span><span>INR</span></div>
        {available.length ? <form className="business-form" onSubmit={(event) => void saveSale(event)}>
          <div className="sale-lines">{items.map((item, index) => <div className="sale-line" key={index}><label>Product<select value={item.productId} onChange={(event) => setItems((current) => current.map((line, i) => i === index ? { ...line, productId: event.target.value } : line))}>{available.map((product) => <option key={product.id} value={product.id}>{product.name} · {rupees(product.selling_price)} · {product.current_stock} left</option>)}</select></label><label>Quantity ({products.find((product) => product.id === item.productId)?.unit ?? "unit"})<input type="number" min={/^(?:kg|g|litre|ml)$/iu.test(products.find((product) => product.id === item.productId)?.unit ?? "") ? "0.001" : "1"} step={/^(?:kg|g|litre|ml)$/iu.test(products.find((product) => product.id === item.productId)?.unit ?? "") ? "0.001" : "1"} value={item.quantity} onChange={(event) => setItems((current) => current.map((line, i) => i === index ? { ...line, quantity: Number(event.target.value) } : line))} required /></label><button className="line-remove" type="button" aria-label={`Remove line ${index + 1}`} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>Remove</button></div>)}</div>
          <button className="text-button" type="button" onClick={() => setItems((current) => [...current, { productId: available.find((p) => !current.some((line) => line.productId === p.id))?.id ?? available[0].id, quantity: 1 }])} disabled={items.length >= available.length}>+ Add another product</button>
          <div className="payment-choice" role="group" aria-label="Payment method">{(["cash", "upi", "card"] as const).map((method) => <button type="button" key={method} aria-pressed={payment === method} onClick={() => setPayment(method)}>{method.toUpperCase()}</button>)}</div>
          <div className="sale-total"><span>ESTIMATED TOTAL</span><strong>{preview === null ? "—" : rupees(preview)}</strong><small>Final price and stock are checked again by the database.</small></div>
          {preview === null && <p className="form-error" role="alert">Check quantities and prices. The total must be exact to the paisa.</p>}
          {exceedsShownStock && <p className="form-error" role="alert">Requested quantity exceeds the stock shown. The database will check again before saving.</p>}
          <button className="button button-copper" type="submit" disabled={busy || !items.length || preview === null || items.some((item) => item.quantity <= 0) || new Set(items.map((item) => item.productId)).size !== items.length}>{busy ? "Recording…" : "Record sale"}</button>
        </form> : <p className="business-muted">Add a product with available stock before recording a sale.</p>}
        {notice && <p className="form-notice" role="status">{notice}{confirmedTotal !== null ? ` Confirmed total: ${rupees(confirmedTotal)}.` : ""}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <section className="business-section"><div className="section-heading"><span>TRANSACTION HISTORY / {sales.length}</span></div><div className="business-filter-row"><label className="business-filter">Payment<select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value as typeof historyFilter)}><option value="all">All methods</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></label><label className="business-filter">Date<input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /></label></div>{visibleSales.length ? <ul className="sale-history">{visibleSales.map((sale) => <li key={sale.id}><span><strong>{new Date(sale.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</strong><small className="payment-chip">{sale.payment_method?.toUpperCase() || "PAYMENT NOT SET"}</small></span><span className="sale-history-total"><strong>{rupees(sale.total_amount)}</strong><Link href={`/receipts/${sale.id}`}>View receipt</Link></span></li>)}</ul> : <p className="business-muted">{sales.length ? "No sales match this filter." : "No sales recorded yet."}</p>}</section>
    </div>
  </div>;
}
