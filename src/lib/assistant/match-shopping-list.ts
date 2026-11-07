import { shoppingDraftSchema, shoppingExtractionSchema, type ShoppingDraft } from "./shopping-list";
import { convertQuantity, parseMerchantUnit, quantityLineTotal } from "./vernacular-quantity";

export type CatalogProduct = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  sellingPrice: number;
};

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-IN").normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function matchShoppingList(rawItems: unknown, catalog: CatalogProduct[]): ShoppingDraft {
  const { items } = shoppingExtractionSchema.parse({ items: rawItems });
  const seen = new Set<string>();
  const draftItems = items.map((item) => {
    const key = normalize(item.product);
    if (seen.has(key)) throw new Error("The list repeats a product. Combine its quantities and try again.");
    seen.add(key);
    const matches = catalog.filter((product) => normalize(product.name) === key);
    const product = matches.length === 1 ? matches[0] : undefined;
    if (item.quantity === undefined || item.quantity === null) {
      const product = matches.length === 1 ? matches[0] : undefined;
      return { requestedName: item.product, ...(product ? { productId: product.id, productName: product.name, stock: product.currentStock } : {}),
        status: "unit-unclear" as const, ...(item.unit ? { unit: item.unit } : {}), note: "Quantity could not be read confidently." };
    }
    if (!product) return { requestedName: item.product, quantity: item.quantity, status: "missing" as const, ...(item.unit ? { unit: item.unit } : {}) };
    let quantity = item.quantity;
    let displayUnit = item.unit ?? product.unit;
    if (item.unit) {
      const source = parseMerchantUnit(item.unit);
      const target = parseMerchantUnit(product.unit);
      if (item.unit.trim().toLocaleLowerCase("en-IN") === product.unit.trim().toLocaleLowerCase("en-IN")) {
        quantity = item.quantity;
      } else {
        const converted = source && target ? convertQuantity(item.quantity, source, target) : null;
        if (converted === null) return { requestedName: item.product, quantity: item.quantity, status: "unit-unclear" as const,
          productId: product.id, productName: product.name, stock: product.currentStock, unit: item.unit,
          note: `The listed unit cannot be compared with the saved ${product.unit} unit.` };
        quantity = converted;
        displayUnit = product.unit;
      }
    }
    const lineTotal = quantityLineTotal(quantity, product.sellingPrice);
    if (lineTotal === null) return { requestedName: item.product, quantity, status: "unit-unclear" as const,
      productId: product.id, productName: product.name, stock: product.currentStock, unit: displayUnit,
      note: "The estimated amount cannot be represented exactly in paise." };
    return {
      requestedName: item.product,
      quantity,
      status: product.currentStock >= quantity ? "available" as const : "short" as const,
      productId: product.id,
      productName: product.name,
      stock: product.currentStock,
      unit: product.unit,
      unitPrice: product.sellingPrice,
      lineTotal,
    };
  });
  return shoppingDraftSchema.parse({
    items: draftItems,
    estimatedTotal: draftItems.reduce((sum, item) => sum + ("lineTotal" in item ? (item.lineTotal ?? 0) : 0), 0),
    canConfirm: draftItems.every((item) => item.status === "available" && item.quantity !== undefined && item.productId !== undefined),
  });
}
