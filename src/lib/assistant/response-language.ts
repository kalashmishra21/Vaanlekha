import type { PendingClarification } from "../ai/types/tool-call";
import { rupees } from "../business/calculations";

export type MerchantLanguage = "hindi" | "hinglish" | "english";

export function detectMerchantLanguage(text: string): MerchantLanguage {
  if (/[\u0900-\u097f]/u.test(text)) return "hindi";
  if (/\b(?:karo|kro|kar do|hai|ki|ke|ka|rupaye|udhaar|khata|batao|kitna|aaj|nahi|haan|paav|aadha|sawa|dedh|dhai)\b/iu.test(text)) return "hinglish";
  return "english";
}

export function localizeClarification(text: string, pending: PendingClarification | undefined, fallback: string): string {
  const language = detectMerchantLanguage(text);
  if (language === "english" || !pending) return fallback;
  if (pending.kind === "product-create-price") return language === "hindi"
    ? `${pending.product} अभी इन्वेंटरी में नहीं है। ${pending.openingStock} ${pending.unit} जोड़ने के लिए प्रति ${pending.unit} बिक्री कीमत बताइए। अभी कुछ सेव नहीं हुआ।`
    : `${pending.product} inventory mein nahi hai. ${pending.openingStock} ${pending.unit} ke liye per ${pending.unit} selling price batao. Abhi kuch save nahi hua.`;
  if (pending.kind === "product-create-confirm") return language === "hindi"
    ? `${pending.product} के ${pending.openingStock} ${pending.unit} ₹${pending.sellingPrice} प्रति ${pending.unit} पर बनाऊँ? पुष्टि के लिए हाँ या रद्द करें लिखें। अभी कुछ सेव नहीं हुआ।`
    : `${pending.product} ke ${pending.openingStock} ${pending.unit} ₹${pending.sellingPrice} per ${pending.unit} par banau? Yes ya cancel likho. Abhi kuch save nahi hua.`;
  return fallback;
}

export function localizeTrustedReply(text: string, raw: unknown, fallback: string): string {
  const language = detectMerchantLanguage(text);
  if (language === "english" || !raw || typeof raw !== "object") return fallback;
  const data = raw as Record<string, unknown>;
  const product = typeof data.product === "string" ? data.product : null;
  const customer = typeof data.customer === "string" ? data.customer : null;
  const unit = typeof data.unit === "string" ? data.unit : "unit";
  if (data.intent === "sales.prepareSpoken" && data.draft && typeof data.draft === "object") {
    const draft = data.draft as { items?: { quantity?: number; productName?: string; unit?: string }[]; estimatedTotal?: number; canConfirm?: boolean };
    const item = draft.items?.[0];
    if (item && typeof item.quantity === "number" && typeof item.productName === "string" && typeof draft.estimatedTotal === "number") {
      if (!draft.canConfirm) return language === "hindi" ? `${item.productName} का स्टॉक ${item.quantity} ${item.unit ?? "unit"} बिक्री के लिए पर्याप्त नहीं है। बिक्री सेव नहीं हुई।`
        : `${item.productName} ka stock ${item.quantity} ${item.unit ?? "unit"} sale ke liye kam hai. Sale save nahi hui.`;
      return language === "hindi" ? `${item.quantity} ${item.unit ?? "unit"} ${item.productName} की बिक्री ${rupees(draft.estimatedTotal)} बनेगी। भुगतान तरीका चुनकर पुष्टि करें; अभी कोई बिक्री या स्टॉक बदलाव सेव नहीं हुआ।`
        : `${item.quantity} ${item.unit ?? "unit"} ${item.productName} ka total ${rupees(draft.estimatedTotal)} hai. Payment method chuno aur confirm karo; abhi sale ya stock save nahi hua.`;
    }
  }
  if (data.intent === "product.create" && product && typeof data.stock === "number" && typeof data.sellingPrice === "number") return language === "hindi"
    ? `${product} के ${data.stock} ${unit} ₹${data.sellingPrice} प्रति ${unit} पर इन्वेंटरी में सेव हो गए हैं।`
    : `${product} ke ${data.stock} ${unit} ₹${data.sellingPrice} per ${unit} par inventory mein save ho gaye.`;
  if (data.intent === "inventory.adjust" && product && typeof data.newStock === "number" && typeof data.delta === "number") return language === "hindi"
    ? `${product} का स्टॉक अब ${data.newStock} ${unit} है। ${data.delta > 0 ? "+" : ""}${data.delta} ${unit} का बदलाव सेव हुआ है।`
    : `${product} ka stock ab ${data.newStock} ${unit} hai. ${data.delta > 0 ? "+" : ""}${data.delta} ${unit} ka change save hua.`;
  if (data.intent === "inventory.getStock" && product && typeof data.stock === "number") return language === "hindi"
    ? `${product} का स्टॉक ${data.stock} ${unit} है।` : `${product} ka stock ${data.stock} ${unit} hai.`;
  if (data.intent === "khata.getBalance" && customer && typeof data.balance === "number") return language === "hindi"
    ? `${customer} के खाते में ${rupees(data.balance)} बकाया है।` : `${customer} ke khate mein ${rupees(data.balance)} baki hai.`;
  if (data.intent === "sales.getDailySummary" && typeof data.total === "number" && typeof data.count === "number") return language === "hindi"
    ? `आज की ${data.count} बिक्री का कुल ${rupees(data.total)} है।` : `Aaj ki ${data.count} sales ka total ${rupees(data.total)} hai.`;
  return fallback;
}

export function localizedSaleConfirmation(source: "shopping-list" | "spoken-sale", itemName: string, total: number, fallback: string): string {
  if (source !== "spoken-sale") return fallback;
  return detectMerchantLanguage(itemName) === "hindi"
    ? `${itemName} की ${rupees(total)} बिक्री सेव हो गई। उसी डेटाबेस ट्रांज़ैक्शन में स्टॉक घटाया गया।`
    : fallback;
}
