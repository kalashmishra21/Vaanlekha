import { normalizeMerchantText, parseMerchantNumber } from "./merchant-language";
import { hasDecimalPlaces } from "../business/precision";

export type MerchantUnit = "kg" | "g" | "litre" | "ml" | "packet" | "piece";
export type SpokenQuantity = { quantity: number; unit: MerchantUnit | null; rest: string };
export type SpokenSale = { product: string; quantity: number; unit: MerchantUnit; unitPrice: number; priceUnit: MerchantUnit };

const amountWords: ReadonlyArray<[RegExp, number]> = [
  [/^(?:paune\s+do|paun[e]?\s+do|पौने\s*दो)/iu, 1.75],
  [/^(?:saadhe\s+teen|sadhe\s+teen|साढ़े\s*तीन|साढे\s*तीन)/iu, 3.5],
  [/^(?:sawa|sava|सवा)/iu, 1.25],
  [/^(?:dedh|derh|डेढ़|डेढ)/iu, 1.5],
  [/^(?:dhai|dhaai|ढाई)/iu, 2.5],
  [/^(?:aadha|adha|आधा)/iu, 0.5],
  [/^(?:paav|pav|pao|पाव|पौवा)/iu, 0.25],
];

const unitWords: ReadonlyArray<[RegExp, MerchantUnit]> = [
  [/^(?:kilograms?|kilos?|kgs?|किलो(?:ग्राम)?)/iu, "kg"],
  [/^(?:grams?|gm|g|ग्राम)/iu, "g"],
  [/^(?:litres?|liters?|ltr|l|लीटर|लिटर)/iu, "litre"],
  [/^(?:millilitres?|milliliters?|ml|मिलीलीटर|मिलीलिटर)/iu, "ml"],
  [/^(?:packets?|packs?|pkt|पैकेट(?:्स)?)/iu, "packet"],
  [/^(?:pieces?|pcs?|pc|पीस|टुकड़े?)/iu, "piece"],
];

function normalise(value: string): string {
  const compound = value.replace(/पौने\s*दो/gu, "paune do").replace(/साढ़े\s*तीन|साढे\s*तीन/gu, "saadhe teen");
  return normalizeMerchantText(compound).toLocaleLowerCase("en-IN")
    .replace(/\b(?:paune|poune)\s+(?:do|two)\b/gu, "paune do")
    .replace(/\b(?:saadhe|sadhe)\s+(?:teen|three)\b/gu, "saadhe teen")
    .trim();
}

export function parseSpokenQuantity(raw: string): SpokenQuantity | null {
  const text = normalise(raw);
  let value: number | null = null;
  let consumed = 0;
  for (const [pattern, amount] of amountWords) {
    const match = pattern.exec(text);
    if (match && (!text[match[0].length] || /\s/u.test(text[match[0].length]))) {
      value = amount;
      consumed = match[0].length;
      break;
    }
  }
  if (value === null) {
    const match = /^(?:\d+(?:\.\d{1,3})?|[a-z]+)(?=\s|$)/u.exec(text);
    if (!match) return null;
    value = /^\d/u.test(match[0]) ? Number(match[0]) : parseMerchantNumber(match[0]);
    consumed = match[0].length;
  }
  if (value === null || value <= 0 || value > 100000 || !hasDecimalPlaces(value, 3)) return null;
  const remainder = text.slice(consumed).trimStart();
  for (const [pattern, unit] of unitWords) {
    const match = pattern.exec(remainder);
    if (match && (!remainder[match[0].length] || /\s/u.test(remainder[match[0].length]))) {
      return { quantity: value, unit, rest: remainder.slice(match[0].length).trimStart() };
    }
  }
  return { quantity: value, unit: null, rest: remainder };
}

export function convertQuantity(quantity: number, from: MerchantUnit, to: MerchantUnit): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || !hasDecimalPlaces(quantity, 3)) return null;
  const normalized = from === to ? quantity :
    from === "kg" && to === "g" || from === "litre" && to === "ml" ? quantity * 1000 :
    from === "g" && to === "kg" || from === "ml" && to === "litre" ? quantity / 1000 : null;
  if (normalized === null || normalized > 100000 || !hasDecimalPlaces(normalized, 3)) return null;
  if ((to === "packet" || to === "piece") && !Number.isInteger(normalized)) return null;
  return Math.round(normalized * 1000) / 1000;
}

export function parseMerchantUnit(raw: string): MerchantUnit | null {
  const text = normalise(raw);
  return unitWords.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function quantityLineTotal(quantity: number, rupeesPerUnit: number): number | null {
  if (!hasDecimalPlaces(quantity, 3) || !hasDecimalPlaces(rupeesPerUnit, 2) || quantity <= 0 || rupeesPerUnit < 0) return null;
  const paise = Math.round(quantity * 1000) * Math.round(rupeesPerUnit * 100);
  if (paise % 1000 !== 0) return null;
  return paise / 100000;
}

export function parseSpokenSale(raw: string): SpokenSale | null {
  if (!/(?:बेच|bech|sell)/iu.test(raw)) return null;
  const amount = parseSpokenQuantity(raw);
  if (!amount?.unit) return null;
  const match = /^(.+?)\s+(\d+(?:\.\d{1,2})?|[a-z]+)\s*(?:rupaye|rupees?|rs\.?|inr|₹)\s+(.+)$/iu.exec(amount.rest);
  if (!match) return null;
  const unitPrice = /^\d/u.test(match[2]) ? Number(match[2]) : parseMerchantNumber(match[2]);
  const priceUnit = parseMerchantUnit(match[3]);
  if (unitPrice === null || unitPrice <= 0 || !hasDecimalPlaces(unitPrice, 2) || !priceUnit) return null;
  return { product: match[1].trim(), quantity: amount.quantity, unit: amount.unit, unitPrice, priceUnit };
}

export function convertUnitPrice(rupees: number, from: MerchantUnit, to: MerchantUnit): number | null {
  if (!Number.isFinite(rupees) || rupees < 0 || !hasDecimalPlaces(rupees, 2)) return null;
  const value = from === to ? rupees :
    from === "kg" && to === "g" || from === "litre" && to === "ml" ? rupees / 1000 :
    from === "g" && to === "kg" || from === "ml" && to === "litre" ? rupees * 1000 : null;
  return value !== null && hasDecimalPlaces(value, 2) ? Math.round(value * 100) / 100 : null;
}
