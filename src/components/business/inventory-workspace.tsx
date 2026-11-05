"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownRight, ArrowUpRight, Package, Plus, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { rupees } from "@/lib/business/calculations";
import type { InventoryMovement, Product } from "@/lib/business/schemas";
import { useBusinessMutation } from "./use-business-mutation";
import { useLocale } from "@/components/layout/locale-provider";

export function InventoryWorkspace({ products, movements, movementNames }: { products: Product[]; movements: InventoryMovement[]; movementNames: Record<string, string> }) {
  const { t } = useLocale();
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [panel, setPanel] = useState<"product" | "adjust" | null>(null);
  const [unitDraft, setUnitDraft] = useState("packet");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "available">("all");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { busy, error, notice, run } = useBusinessMutation();
  const visible = products.filter((product) => `${product.name} ${product.sku ?? ""}`.toLocaleLowerCase("en-IN").includes(search.toLocaleLowerCase("en-IN")))
    .filter((product) => filter === "low" ? product.current_stock <= product.low_stock_threshold : filter === "available" ? product.current_stock > 0 : true);
  const lowCount = products.filter((product) => product.current_stock <= product.low_stock_threshold).length;
  const outOfStockCount = products.filter((product) => product.current_stock === 0).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (panel && !dialog.open) dialog.showModal();
    if (!panel && dialog.open) dialog.close();
  }, [panel]);

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const base = {
      name: String(values.get("name") || "").trim(), sku: String(values.get("sku") || "").trim(),
      unit: String(values.get("unit") || "").trim(),
      sellingPrice: Number(values.get("sellingPrice")),
      costPrice: values.get("costPrice") ? Number(values.get("costPrice")) : null,
      threshold: Number(values.get("threshold")),
    };
    const action = editing
      ? { kind: "product.edit" as const, id: editing.id, ...base }
      : { kind: "product.create" as const, ...base, costPrice: base.costPrice ?? undefined, openingStock: Number(values.get("openingStock")) };
    if (await run(action, t(editing ? "Product updated." : "Product added with opening stock."))) { setEditing(null); setPanel(null); form.reset(); }
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjusting) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (await run({ kind: "product.adjust", id: adjusting.id, delta: Number(values.get("delta")), note: String(values.get("note") || "") }, t("Stock adjustment saved."))) {
      setAdjusting(null); setPanel(null); form.reset();
    }
  }

  async function archiveProduct(product: Product) {
    if (product.current_stock !== 0 || !window.confirm(t("Archive this product?") + ` ${product.name}. ${t("Its sale and movement history will remain.")}`)) return;
    await run({ kind: "product.archive", id: product.id }, t("Product archived. Its history is retained."));
  }

  const openProduct = (product: Product | null) => { setUnitDraft(product?.unit ?? "packet"); setEditing(product); setAdjusting(null); setPanel("product"); };
  const openAdjustment = (product: Product) => { setAdjusting(product); setEditing(null); setPanel("adjust"); };
  const actions = (product: Product) => <div className="row-actions"><button type="button" onClick={() => openProduct(product)}>{t("Edit")}</button><button type="button" onClick={() => openAdjustment(product)}>{t("Adjust")}</button><button type="button" disabled={busy || product.current_stock !== 0} title={t(product.current_stock === 0 ? "Archive while preserving history" : "Reduce stock to zero before archiving")} onClick={() => void archiveProduct(product)}>{t("Archive")}</button></div>;
  const displayUnit = (unit: string) => t(unit.toLocaleLowerCase("en-IN"));
  const stock = (product: Product) => <div className="stock-reading"><span className={product.current_stock <= product.low_stock_threshold ? "stock-low" : "stock-ok"}>{t(product.current_stock <= product.low_stock_threshold ? "Low stock" : "In stock")} · {product.current_stock} {displayUnit(product.unit)}</span><span className="stock-track"><span style={{ width: `${Math.min(100, product.current_stock / Math.max(product.low_stock_threshold * 2, 1) * 100)}%` }} /></span></div>;
  const movementNote = (movement: InventoryMovement) => movement.note?.startsWith("Sale ")
    ? t("Stock reduced by sale")
    : t(movement.note || movement.movement_type);

  return <div className="business-page inventory-page">
    <header className="workspace-page-heading business-title-row"><div><p className="workspace-eyebrow">{t("INVENTORY / CONNECTED")}</p><h1>{t("Inventory")} <em>{t("control.")}</em></h1><p>{t("Every adjustment has a movement. Sales reduce stock only when saved.")}</p></div><button className="button button-dark" type="button" onClick={() => openProduct(null)}><Plus size={17} aria-hidden="true" /> {t("Add product")}</button></header>
    <div className="business-summary-grid"><div className="business-summary"><Package size={18} aria-hidden="true" /><span>{t("ACTIVE PRODUCTS")}</span><strong>{products.length}</strong><small>{t("On your shelf")}</small></div><div className="business-summary attention"><SlidersHorizontal size={18} aria-hidden="true" /><span>{t("NEEDS ATTENTION")}</span><strong>{lowCount}</strong><small>{t("At or below threshold")}</small></div><div className="business-summary"><ArrowUpRight size={18} aria-hidden="true" /><span>{t("OUT OF STOCK")}</span><strong>{outOfStockCount}</strong><small>{t("Products with zero stock")}</small></div></div>
    <section className="business-section inventory-list"><div className="section-heading"><span>{t("PRODUCT DIRECTORY")} / {visible.length}</span><span>{t("LIVE STORE DATA")}</span></div><div className="business-filter-row"><label className="business-search"><Search size={18} aria-hidden="true" /><span className="sr-only">{t("Search inventory")}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search product or SKU")} /></label><label className="business-filter"><span className="sr-only">{t("Filter inventory")}</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">{t("All stock")}</option><option value="low">{t("Low stock")}</option><option value="available">{t("Available")}</option></select></label></div>
      {visible.length ? <><div className="table-scroll inventory-table"><table className="business-table"><thead><tr><th>{t("Product")}</th><th>{t("Unit price")}</th><th>{t("Stock level")}</th><th>{t("Actions")}</th></tr></thead><tbody>{visible.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku || displayUnit(product.unit)}</small></td><td className="money-cell">{rupees(product.selling_price)}<small>{t("per")} {displayUnit(product.unit)}</small></td><td>{stock(product)}</td><td>{actions(product)}</td></tr>)}</tbody></table></div><div className="inventory-mobile-list">{visible.map((product) => <article className="inventory-mobile-card" key={product.id}><div><strong>{product.name}</strong><span>{rupees(product.selling_price)} / {displayUnit(product.unit)}</span></div>{stock(product)}{actions(product)}</article>)}</div></> : <p className="business-muted">{t(products.length ? "No products match this search or filter." : "No products yet. Add your first product.")}</p>}
    </section>
    {notice && <p className="form-notice" role="status">{t(notice)}</p>}{error && !panel && <p className="form-error" role="alert">{t(error)}</p>}
    <section className="business-section inventory-movements"><div className="section-heading"><span>{t("RECENT STOCK MOVEMENTS")}</span><span>{t("TRANSACTION HISTORY")}</span></div>{movements.length ? <ul className="activity-list">{movements.map((movement) => <li key={movement.id}><span>{movement.quantity_delta > 0 ? <ArrowUpRight size={17} aria-hidden="true" /> : <ArrowDownRight size={17} aria-hidden="true" />}{movementNames[movement.product_id] ?? t("Product")}</span><span>{movementNote(movement)}</span><strong>{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}</strong></li>)}</ul> : <p className="business-muted">{t("No stock movements yet.")}</p>}</section>
    <dialog ref={dialogRef} className="business-drawer" onClose={() => setPanel(null)} onClick={(event) => { if (event.target === dialogRef.current) setPanel(null); }} aria-labelledby="inventory-drawer-title"><div className="business-drawer-content"><header><p className="workspace-eyebrow">{t("INVENTORY / TRUSTED ACTION")}</p><button type="button" onClick={() => setPanel(null)}>{t("Close")}</button></header>{panel === "product" ? <><h2 id="inventory-drawer-title">{t(editing ? "Edit product" : "Add product")}</h2><p>{t("Product details and opening stock are saved to your shop.")}</p><form key={editing?.id ?? "new"} className="business-form" onSubmit={(event) => void saveProduct(event)}><label>{t("Name")}<input name="name" required maxLength={120} defaultValue={editing?.name} placeholder={t("e.g. Maggi")} /></label><div className="form-grid"><label>{t("SKU (optional)")}<input name="sku" maxLength={60} defaultValue={editing?.sku ?? ""} /></label><label>{t("Unit")}<input name="unit" required defaultValue={editing?.unit ?? "packet"} onChange={(event) => setUnitDraft(event.target.value)} /></label></div><div className="form-grid"><label>{t("Selling price ₹")}<input name="sellingPrice" type="number" min="0" step="0.01" required defaultValue={editing?.selling_price} /></label><label>{t("Cost price ₹")}<input name="costPrice" type="number" min="0" step="0.01" defaultValue={editing?.cost_price ?? ""} /></label></div><div className="form-grid"><label>{t("Low stock threshold")}<input name="threshold" type="number" min="0" step="1" required defaultValue={editing?.low_stock_threshold ?? 5} /></label>{!editing && <label>{t("Opening stock")} ({unitDraft})<input name="openingStock" type="number" min="0" step={/^(?:kg|g|litre|ml)$/iu.test(unitDraft) ? "0.001" : "1"} required defaultValue={0} /></label>}</div><button className="button button-dark" type="submit" disabled={busy}><Plus size={16} aria-hidden="true" /> {t(editing ? "Save product" : "Add product")}</button></form></> : adjusting ? <><h2 id="inventory-drawer-title">{t("Adjust")} {adjusting.name}</h2><p>{t("Current stock:")} {adjusting.current_stock} {adjusting.unit}. {t("Positive adds stock; negative removes it.")}</p><form className="business-form" onSubmit={(event) => void saveAdjustment(event)}><label>{t("Change in")} {adjusting.unit}<input name="delta" type="number" step={/^(?:kg|g|litre|ml)$/iu.test(adjusting.unit) ? "0.001" : "1"} required placeholder="+20 or -3" /></label><label>{t("Movement note")}<input name="note" maxLength={300} placeholder={t("Reason for change")} /></label><button className="button button-copper" type="submit" disabled={busy}><RotateCcw size={16} aria-hidden="true" /> {t("Save movement")}</button></form></> : null}{error && <p className="form-error" role="alert">{t(error)}</p>}</div></dialog>
  </div>;
}
