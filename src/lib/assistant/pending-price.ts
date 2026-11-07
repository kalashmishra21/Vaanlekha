export function parseUnitSellingPrice(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/u.test(value)) return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price <= 999999999 ? price : null;
}
