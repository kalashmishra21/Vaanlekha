"use client";

import { useId, useState } from "react";
import { AlertCircle, ArrowUpRight, Check, ShoppingBasket } from "lucide-react";
import { rupees } from "@/lib/business/calculations";
import type { ShoppingDraft } from "@/lib/assistant/shopping-list";
import { useLocale } from "@/components/layout/locale-provider";

export function ShoppingListResult({ draft, busy, inactive, onConfirm }: {
  draft: ShoppingDraft;
  busy: boolean;
  inactive: boolean;
  onConfirm: (draft: ShoppingDraft, payment: "cash" | "upi" | "card") => void;
}) {
  const { t } = useLocale();
  const [payment, setPayment] = useState<"cash" | "upi" | "card">("cash");
  const paymentId = useId();
  return <section className="shopping-draft" aria-label={t("Shopping list draft")}>
    <div className="shopping-draft-head"><div><ShoppingBasket size={19} aria-hidden="true" /><strong>{t("Shopping list draft")}</strong></div><span>{t("NO STOCK CHANGED")}</span></div>
    <div className="shopping-table-scroll"><table><thead><tr><th scope="col">{t("Item")}</th><th scope="col">{t("Qty")}</th><th scope="col">{t("Stock")}</th><th scope="col">{t("Unit price")}</th><th scope="col">{t("Estimate")}</th></tr></thead>
      <tbody>{draft.items.map((item, index) => <tr key={`${item.requestedName}-${index}`}>
        <th scope="row"><strong>{item.productName ?? item.requestedName}</strong>{item.productName && item.productName !== item.requestedName && <small>{t("from")} “{item.requestedName}”</small>}<span className={`shopping-status ${item.status}`}>{item.status === "available" ? <Check size={12} aria-hidden="true" /> : <AlertCircle size={12} aria-hidden="true" />}{t(item.status === "available" ? "Available" : item.status === "short" ? "Short stock" : item.status === "unit-unclear" ? "Quantity or unit unclear" : "Not found")}</span>{item.note && <small>{t(item.note)}</small>}</th>
        <td>{item.quantity ?? t("Unclear")} {item.unit ?? ""}</td><td>{item.stock ?? "—"}</td><td>{item.unitPrice === undefined ? "—" : rupees(item.unitPrice)}</td><td>{item.lineTotal === undefined ? "—" : rupees(item.lineTotal)}</td>
      </tr>)}</tbody></table></div>
    <div className="shopping-draft-foot"><div><span>{t("ESTIMATE FOR MATCHED ITEMS")}</span><strong>{rupees(draft.estimatedTotal)}</strong><small>{t("Final price and stock are checked again by the database.")}</small></div>
      {draft.canConfirm && !inactive && <div className="shopping-confirm"><label htmlFor={paymentId}>{t("Payment")}
        <select id={paymentId} value={payment} onChange={(event) => setPayment(event.target.value as typeof payment)}><option value="cash">{t("Cash")}</option><option value="upi">UPI</option><option value="card">{t("Card")}</option></select></label>
        <button type="button" disabled={busy} onClick={() => onConfirm(draft, payment)}>{t("Confirm & record sale")} <ArrowUpRight size={16} aria-hidden="true" /></button></div>}
      {!draft.canConfirm && <p className="shopping-draft-caution">{t("Resolve missing or short-stock items before recording a sale.")}</p>}
      {inactive && <p className="shopping-draft-caution">{t("This draft has been used or is out of date. Check the list again for a new sale.")}</p>}
    </div>
  </section>;
}
