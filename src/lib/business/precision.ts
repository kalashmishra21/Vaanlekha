export function hasDecimalPlaces(value: number, places: 2 | 3): boolean {
  if (!Number.isFinite(value)) return false;
  const scale = 10 ** places;
  return Math.abs(value * scale - Math.round(value * scale)) < 1e-6;
}

export function decimalUnits(value: number, places: 2 | 3): number {
  if (!hasDecimalPlaces(value, places)) throw new Error(`Use at most ${places} decimal places.`);
  return Math.round(value * 10 ** places);
}
