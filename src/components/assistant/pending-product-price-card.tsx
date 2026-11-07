"use client";

import { useState, type FormEvent } from "react";
import { parseUnitSellingPrice } from "@/lib/assistant/pending-price";

export function PendingProductPriceCard({ product, unit, openingStock, busy, onSubmit, label, actionLabel }: {
  product: string;
  unit: string;
  openingStock: number;
  busy: boolean;
  onSubmit: (price: number) => void;
  label: string;
  actionLabel: string;
}) {
  const [price, setPrice] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseUnitSellingPrice(price);
    if (value !== null && !busy) onSubmit(value);
  }
  return <form className="pending-product-price" onSubmit={submit}>
    <label htmlFor="pending-product-price-input">{label} {unit} for {product}</label>
    <div className="pending-product-price-row">
      <span aria-hidden="true">₹</span>
      <input id="pending-product-price-input" aria-label={`Selling price per ${unit}`} type="number" inputMode="decimal" min="0.01" max="999999999" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required disabled={busy} />
      <button type="submit" disabled={busy || parseUnitSellingPrice(price) === null}>{actionLabel}</button>
    </div>
    <small>{openingStock} {unit} will be added after this price is checked. No stock has changed yet.</small>
  </form>;
}
