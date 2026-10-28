import type { KhataEntry, Product } from "./schemas";
import { hasDecimalPlaces } from "./precision";

export function khataBalance(entries: Pick<KhataEntry, "type" | "amount">[]): number {
  const paise = entries.reduce((total, entry) =>
    total + (entry.type === "gave" ? 1 : -1) * Math.round(entry.amount * 100), 0);
  return paise / 100;
}

export function totalKhataOutstanding(entries: Pick<KhataEntry, "customer_id" | "type" | "amount">[]): number {
  const byCustomer = new Map<string, number>();
  for (const entry of entries) {
    const change = (entry.type === "gave" ? 1 : -1) * Math.round(entry.amount * 100);
    byCustomer.set(entry.customer_id, (byCustomer.get(entry.customer_id) ?? 0) + change);
  }
  return [...byCustomer.values()].reduce((total, paise) => total + Math.max(0, paise), 0) / 100;
}

export function salePreviewTotal(items: { productId: string; quantity: number }[], products: Pick<Product, "id" | "selling_price">[]): number {
  const prices = new Map(products.map((product) => [product.id, Math.round(product.selling_price * 100)]));
  const paise = items.reduce((total, item) => {
    const price = prices.get(item.productId);
    if (price === undefined || !hasDecimalPlaces(item.quantity, 3) || item.quantity <= 0) {
      throw new Error("Choose a valid product and quantity.");
    }
    const line = price * Math.round(item.quantity * 1000);
    if (line % 1000 !== 0) throw new Error("The line total cannot be recorded exactly in paise.");
    return total + line / 1000;
  }, 0);
  return paise / 100;
}

export function indiaDayBounds(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00+05:30`);
  if (Number.isNaN(start.valueOf())) throw new Error("Invalid date");
  return { start: start.toISOString(), end: new Date(start.valueOf() + 86400000).toISOString() };
}

export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function rupees(value: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}
