import { describe, expect, it } from "vitest";
import { convertQuantity, parseSpokenQuantity, parseSpokenSale, quantityLineTotal } from "../src/lib/assistant/vernacular-quantity";

describe("Indian spoken quantities", () => {
  const examples: Array<[string, number, string | null]> = [
    ["पाव किलो चीनी", 0.25, "kg"], ["aadha litre doodh", 0.5, "litre"],
    ["सवा किलो आटा", 1.25, "kg"], ["dedh kg rice", 1.5, "kg"],
    ["पौने दो लीटर तेल", 1.75, "litre"], ["ढाई किलो चीनी", 2.5, "kg"],
    ["साढ़े तीन kg आटा", 3.5, "kg"], ["do packets Maggi", 2, "packet"],
    ["char pieces soap", 4, "piece"], ["250 ml oil", 250, "ml"],
    ["पाव तेल देना", 0.25, null],
  ];
  for (const [utterance, quantity, unit] of examples) {
    it(`parses ${utterance}`, () => {
      expect(parseSpokenQuantity(utterance)).toMatchObject({ quantity, unit });
    });
  }

  it("converts only compatible explicit units without rounding", () => {
    expect(convertQuantity(250, "g", "kg")).toBe(0.25);
    expect(convertQuantity(290, "g", "kg")).toBe(0.29);
    expect(convertQuantity(2.5, "kg", "g")).toBe(2500);
    expect(convertQuantity(750, "ml", "litre")).toBe(0.75);
    expect(convertQuantity(0.5, "litre", "ml")).toBe(500);
    expect(convertQuantity(0.25, "kg", "litre")).toBeNull();
    expect(convertQuantity(0.5, "packet", "packet")).toBeNull();
  });

  it("calculates exact paise and rejects values that would silently round", () => {
    expect(quantityLineTotal(2.5, 40)).toBe(100);
    expect(quantityLineTotal(0.25, 40)).toBe(10);
    expect(quantityLineTotal(0.29, 40)).toBe(11.6);
    expect(quantityLineTotal(0.25, 40.03)).toBeNull();
  });

  it("preserves the explicit per-kg price in a Hindi sale command", () => {
    expect(parseSpokenSale("ढाई किलो चीनी 40 रुपये किलो के हिसाब से बेच दो")).toEqual({
      product: "चीनी", quantity: 2.5, unit: "kg", unitPrice: 40, priceUnit: "kg",
    });
    expect(parseSpokenSale("पाव तेल देना")).toBeNull();
  });
});
