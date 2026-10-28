import { describe, expect, it } from "vitest";
import { detectMerchantLanguage, localizeClarification, localizeTrustedReply, localizedSaleConfirmation } from "../src/lib/assistant/response-language";

describe("merchant reply language", () => {
  it("detects Hindi, Hinglish and English without changing the trusted result", () => {
    expect(detectMerchantLanguage("ढाई किलो चीनी बेच दो")).toBe("hindi");
    expect(detectMerchantLanguage("dhai kg sugar bech do")).toBe("hinglish");
    expect(detectMerchantLanguage("Sell two kilograms of sugar")).toBe("english");
    const result = { intent: "inventory.adjust", product: "चीनी", unit: "kg", delta: 0.25, newStock: 7.75 };
    expect(localizeTrustedReply("250 g चीनी add karo", result, "fallback")).toContain("7.75 kg");
    expect(localizeTrustedReply("250 g chini add karo", result, "fallback")).toContain("7.75 kg");
    expect(localizeTrustedReply("Add 250 g sugar", result, "fallback")).toBe("fallback");
    expect(localizeTrustedReply("हमारे suppliers की सूची दिखाओ", { intent: "supplier.list", suppliers: [{ name: "Everyday Staples Supply" }] }, "fallback"))
      .toBe("आपके सप्लायर हैं: Everyday Staples Supply।");
  });

  it("states that no product was saved before price approval", () => {
    const reply = localizeClarification("25 की एक आइसक्रीम", {
      kind: "product-create-confirm", product: "आइसक्रीम", unit: "packet", openingStock: 10, sellingPrice: 25,
    }, "fallback");
    expect(reply).toContain("10 packet");
    expect(reply).toContain("₹25");
    expect(reply).toContain("अभी कुछ सेव नहीं हुआ");
  });

  it("uses the saved amount only after a spoken sale is confirmed", () => {
    expect(localizedSaleConfirmation("spoken-sale", "Stage23 चीनी", 100, "fallback")).toContain("₹100");
    expect(localizedSaleConfirmation("shopping-list", "Stage23 चीनी", 100, "fallback")).toBe("fallback");
  });
});
