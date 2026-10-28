import type { ToolCall } from "../ai/types/tool-call";
import { normalizeMerchantText, parseMerchantNumber } from "./merchant-language";
import { parseSpokenQuantity } from "./vernacular-quantity";

export function mentionsMerchantEntity(text: string, name: string): boolean {
  const normalizedText = normalizeMerchantText(text).toLocaleLowerCase("en-IN");
  const normalizedName = normalizeMerchantText(name).toLocaleLowerCase("en-IN");
  if (!normalizedName) return false;
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[\\s'’])${escaped}(?=$|[\\s'’])`, "u").test(normalizedText);
}

/** Model proposals need evidence in the current utterance, not just valid JSON. */
export function isGroundedToolCall(rawText: string, call: ToolCall): boolean {
  const text = normalizeMerchantText(rawText).toLocaleLowerCase("en-IN");
  const mentions = (name: string) => mentionsMerchantEntity(text, name);
  const number = (value: number) => {
    const words = text.split(/\s+/u);
    for (let start = 0; start < words.length; start++) {
      for (let length = 1; length <= 3 && start + length <= words.length; length++) {
        const phrase = words.slice(start, start + length).join(" ");
        if (parseMerchantNumber(phrase) === Math.abs(value) || parseSpokenQuantity(phrase)?.quantity === Math.abs(value)) return true;
      }
    }
    return false;
  };
  const has = (pattern: RegExp) => pattern.test(text);
  switch (call.intent) {
    case "inventory.adjustConfirmed": return false;
    case "inventory.adjust": return mentions(call.arguments.product) && number(call.arguments.delta)
      && (call.arguments.delta > 0
        ? has(/\b(?:add|increase|restock|jodo|badhao|daal)\b/u) && !has(/\b(?:decrease|reduce|remove|subtract|ghatao)\b/u)
        : has(/\b(?:decrease|reduce|remove|subtract|ghatao)\b/u) && !has(/\b(?:add|increase|restock|jodo|badhao|daal)\b/u));
    case "inventory.getStock": return mentions(call.arguments.product) && has(/\b(?:stock|inventory|available|quantity|kitna|how much)\b/u);
    case "khata.getBalance": return mentions(call.arguments.customer) && has(/\b(?:khata|udhaar|balance|owe|owes)\b/u);
    case "khata.addEntry": return mentions(call.arguments.customer) && number(call.arguments.amountRupees)
      && (call.arguments.type === "received"
        ? has(/\b(?:paid|payment|received|repay|returned|return|wapas|jama)\b/u) && !has(/\b(?:gave|credit|udhaar)\b/u)
        : has(/\b(?:add|likh|gave|credit|udhaar|diya|diye)\b/u) && !has(/\b(?:paid|payment|received|repay|returned|return|wapas|jama)\b/u));
    case "khata.openAccount": return mentions(call.arguments.customer) && number(call.arguments.amountRupees)
      && has(/\b(?:open|new|create|naya|nayi|bana)\b/u) && has(/\b(?:khata|udhaar)\b/u);
    case "customer.create": return mentions(call.arguments.customer) && has(/\b(?:customer|grahak)\b/u)
      && has(/\b(?:add|create|new|naya|nayi)\b/u) && !has(/\b(?:udhaar|khata)\b/u);
    case "supplier.create": return mentions(call.arguments.name) && has(/\b(?:supplier|vendor)\b/u)
      && has(/\b(?:add|create|new|naya|nayi)\b/u);
    case "inventory.checkList": return has(/\b(?:list|check|shopping)\b/u)
      && call.arguments.items.every((item) => mentions(item.product) && number(item.quantity));
    case "sales.getDailySummary": return has(/\b(?:sales?|bikri)\b/u)
      && (has(/\b(?:today|aaj)\b/u) || text.includes(call.arguments.date));
    case "inventory.getReorderSuggestions": return has(/\b(?:reorder|low.stock)\b/u);
    case "supplier.list": return (has(/\b(?:suppliers?|vendors?)\b/u) || has(/(?:सप्लायर|आपूर्तिकर्ता|विक्रेता)/u))
      && (has(/\b(?:list|show|dikhao|batao|names?)\b/u) || has(/(?:सूची|दिखाओ|बताओ|नाम|कौन)/u));
    case "orders.getOpen": return has(/\borders?\b/u) && has(/\b(?:open|show|list|dikhao|batao)\b/u);
    case "orders.getStatus": return mentions(call.arguments.order) && has(/\borders?\b/u) && has(/\b(?:status|where|check|dikhao|batao)\b/u);
    case "orders.transition": return mentions(call.arguments.order) && has(/\borders?\b/u)
      && (call.arguments.action === "place" ? has(/\b(?:place|rakho)\b/u)
        : call.arguments.action === "receive" ? has(/\b(?:receive|received|mila)\b/u)
          : has(/\b(?:cancel|radd)\b/u));
    case "orders.createDraft": return mentions(call.arguments.supplier) && has(/\borders?\b/u)
      && has(/\b(?:draft|create|make|bana|de do)\b/u)
      && call.arguments.items.every((item) => mentions(item.product) && number(item.quantity));
    case "product.create":
    case "sales.prepareSpoken":
    case "sales.recordConfirmedBasket":
    case "orders.transitionConfirmed": return false; // Never available through model function calls.
  }
}
