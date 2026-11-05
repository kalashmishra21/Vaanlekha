"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { salePreviewTotal, rupees } from "@/lib/business/calculations";
import type { CustomerReview, Product, Sale } from "@/lib/business/schemas";
import { useBusinessMutation } from "./use-business-mutation";
import { useLocale } from "@/components/layout/locale-provider";

type Line = { productId: string; quantity: number };

export function SalesWorkspace({ products, sales, reviews }: { products: Product[]; sales: Sale[]; reviews: CustomerReview[] }) {
  const { locale, t } = useLocale();
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
    const result = await run({ kind: "sale.record", items, paymentMethod: payment }, t("Sale recorded and stock reduced."));
    if (result && result.sale && typeof result.sale === "object" && "total_amount" in result.sale) {
      setConfirmedTotal(Number(result.sale.total_amount));
    }
  }

  return <div className="business-page sales-page">
    <div className="workspace-page-heading"><p className="workspace-eyebrow">{t("SALES / CONNECTED")}</p><h1>{t("Sales")} <em>{t("desk.")}</em></h1><p>{t("Build a basket. Database confirmation records the sale and reduces stock together.")}</p></div>
    <div className="business-summary-grid"><div className="business-summary"><span>{t("TODAY’S SALES")}</span><strong>{rupees(todaySales.reduce((sum, sale) => sum + sale.total_amount, 0))}</strong><small>{todaySales.length} {t("transactions today")}</small></div><div className="business-summary"><span>{t("RECORDED SALES")}</span><strong>{sales.length}</strong><small>{t("In your shop history")}</small></div><div className="business-summary"><span>{t("AVAILABLE PRODUCTS")}</span><strong>{available.length}</strong><small>{t("Ready for a basket")}</small></div></div>
    <div className="business-columns">
      <section className="business-section"><div className="section-heading"><span>{t("NEW SALE")}</span><span>INR</span></div>
        {available.length ? <form className="business-form" onSubmit={(event) => void saveSale(event)}>
          <div className="sale-lines">{items.map((item, index) => <div className="sale-line" key={index}><label>{t("Product")}<select value={item.productId} onChange={(event) => setItems((current) => current.map((line, i) => i === index ? { ...line, productId: event.target.value } : line))}>{available.map((product) => <option key={product.id} value={product.id}>{product.name} · {rupees(product.selling_price)} · {product.current_stock} {t("left")} {t(product.unit.toLocaleLowerCase("en-IN"))}</option>)}</select></label><label>{t("Quantity")} ({t((products.find((product) => product.id === item.productId)?.unit ?? t("unit")).toLocaleLowerCase("en-IN"))})<input type="number" min={/^(?:kg|g|litre|ml)$/iu.test(products.find((product) => product.id === item.productId)?.unit ?? "") ? "0.001" : "1"} step={/^(?:kg|g|litre|ml)$/iu.test(products.find((product) => product.id === item.productId)?.unit ?? "") ? "0.001" : "1"} value={item.quantity} onChange={(event) => setItems((current) => current.map((line, i) => i === index ? { ...line, quantity: Number(event.target.value) } : line))} required /></label><button className="line-remove" type="button" aria-label={`${t("Remove line")} ${index + 1}`} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>{t("Remove")}</button></div>)}</div>
          <button className="text-button" type="button" onClick={() => setItems((current) => [...current, { productId: available.find((p) => !current.some((line) => line.productId === p.id))?.id ?? available[0].id, quantity: 1 }])} disabled={items.length >= available.length}>+ {t("Add another product")}</button>
          <div className="payment-choice" role="group" aria-label={t("Payment method")}>{(["cash", "upi", "card"] as const).map((method) => <button type="button" key={method} aria-pressed={payment === method} onClick={() => setPayment(method)}>{t(method === "cash" ? "Cash" : method.toUpperCase())}</button>)}</div>
          <div className="sale-total"><span>{t("ESTIMATED TOTAL")}</span><strong>{preview === null ? "—" : rupees(preview)}</strong><small>{t("Final price and stock are checked again by the database.")}</small></div>
          {preview === null && <p className="form-error" role="alert">{t("Check quantities and prices. The total must be exact to the paisa.")}</p>}
          {exceedsShownStock && <p className="form-error" role="alert">{t("Requested quantity exceeds the stock shown. The database will check again before saving.")}</p>}
          <button className="button button-copper" type="submit" disabled={busy || !items.length || preview === null || items.some((item) => item.quantity <= 0) || new Set(items.map((item) => item.productId)).size !== items.length}>{t(busy ? "Recording…" : "Record sale")}</button>
        </form> : <p className="business-muted">{t("Add a product with available stock before recording a sale.")}</p>}
        {notice && <p className="form-notice" role="status">{notice}{confirmedTotal !== null ? ` ${t("Confirmed total:")} ${rupees(confirmedTotal)}.` : ""}</p>}{error && <p className="form-error" role="alert">{t(error)}</p>}
      </section>
      <section className="business-section"><div className="section-heading"><span>{t("TRANSACTION HISTORY")} / {sales.length}</span></div><div className="business-filter-row"><label className="business-filter">{t("Payment")}<select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value as typeof historyFilter)}><option value="all">{t("All methods")}</option><option value="cash">{t("Cash")}</option><option value="upi">UPI</option><option value="card">{t("Card")}</option></select></label><label className="business-filter">{t("Date")}<input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /></label></div>{visibleSales.length ? <ul className="sale-history">{visibleSales.map((sale) => <li key={sale.id}><span><strong>{new Date(sale.created_at).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" })}</strong><small className="payment-chip">{t(sale.payment_method?.toUpperCase() || "PAYMENT NOT SET")}</small></span><span className="sale-history-total"><strong>{rupees(sale.total_amount)}</strong><Link href={`/receipts/${sale.id}`}>{t("View receipt")}</Link></span></li>)}</ul> : <p className="business-muted">{t(sales.length ? "No sales match this filter." : "No sales recorded yet.")}</p>}</section>
    </div>
    <section className="business-section customer-review-section"><div className="section-heading"><span>{t("CUSTOMER FEEDBACK")} / {reviews.length}</span></div>
      <p className="business-muted">{t("Responses come from private links on saved sale receipts. The link proves a sale exists; it does not verify the respondent's identity.")}</p>
      {reviews.length ? <ul className="customer-review-list">{reviews.map((review) => <li key={review.id}><div><strong>{review.customer_name || "Anonymous customer"}</strong><span>{review.rating}/5 · {new Date(review.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</span></div><p>{review.comment}</p><Link href={`/receipts/${review.sale_id}`}>View linked sale</Link></li>)}</ul>
        : <p className="business-muted">{t("No customer feedback has been submitted. Open a saved receipt to invite a response.")}</p>}
    </section>
  </div>;
}
