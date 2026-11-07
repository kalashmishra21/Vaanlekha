import type { ToolCall } from "../ai/types/tool-call";
import { todayInIndia } from "../business/calculations";
import { normalizeMerchantText, parseMerchantNumber } from "./merchant-language";
import { parseSpokenQuantity, parseSpokenSale } from "./vernacular-quantity";

export function mentionsMerchantEntity(text: string, name: string): boolean {
  const normalizedText = normalizeMerchantText(text).toLocaleLowerCase("en-IN");
  const normalizedName = normalizeMerchantText(name).toLocaleLowerCase("en-IN");
  if (!normalizedName) return false;
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[\\s'’])${escaped}(?=$|[\\s'’])`, "u").test(normalizedText);
}

function productEntityKey(value: string): string {
  return normalizeMerchantText(value).toLocaleLowerCase("en-IN")
    .replace(/\bmaggie\b/gu, "maggi")
    .replace(/मैगी/gu, "maggi");
}

function mentionsProduct(text: string, product: string): boolean {
  const normalizedText = productEntityKey(text);
  const normalizedProduct = productEntityKey(product);
  if (!normalizedProduct) return false;
  const escaped = normalizedProduct.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[\\s'’])${escaped}(?=$|[\\s'’])`, "u").test(normalizedText);
}

/** Model proposals need evidence in the current utterance, not just valid JSON. */
export function isGroundedToolCall(rawText: string, call: ToolCall, indiaToday = todayInIndia()): boolean {
  const text = normalizeMerchantText(rawText).toLocaleLowerCase("en-IN");
  const mentions = (name: string) => mentionsMerchantEntity(text, name);
  const number = (value: number | null | undefined) => {
    if (value === null || value === undefined) return false;
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
  const statesCompletedSale = () => has(/\b(?:sell|sells|selling|sold|bech(?:\s+(?:do|diya|diye))?|bik(?:\s+(?:gaya|gaye|gayi|chuka|chuke))?)\b/u)
    || has(/(?:बेच(?:\s+(?:दो|दिया|दिए|दी|दीजिए))?|बिक(?:\s+(?:गया|गये|गए|गयी|गई|चुका|चुकी|चुके))?)/u)
    || has(/\b(?:sale|sales|bikri)\s+(?:hui|hue|ho\s+gaya|ho\s+gayi|ho\s+gaye)\b/u);
  switch (call.intent) {
    case "inventory.adjust": return mentionsProduct(rawText, call.arguments.product) && number(call.arguments.delta)
      && (call.arguments.delta > 0
        ? has(/\b(?:add|increase|restock|jodo|badhao|daal)\b/u) && !has(/\b(?:decrease|reduce|remove|subtract|ghatao)\b/u)
        : has(/\b(?:decrease|reduce|remove|subtract|ghatao)\b/u) && !has(/\b(?:add|increase|restock|jodo|badhao|daal)\b/u));
    case "inventory.adjustConfirmed": return false;
    case "inventory.getStock": return mentionsProduct(rawText, call.arguments.product) && has(/\b(?:stock|inventory|available|quantity|kitna|how much)\b/u);
    case "khata.getBalance": return mentions(call.arguments.customer) && has(/\b(?:khata|udhaar|balance|owe|owes)\b/u);
    case "khata.getHistory": return mentions(call.arguments.customer) && has(/\b(?:khata|udhaar|ledger|history|transaction)\b/u);
    case "customer.list": return has(/\b(?:customers?|grahak)\b/u) && has(/\b(?:list|show|dikhao|batao|names?)\b/u);
    case "customer.search": return mentions(call.arguments.query) && has(/\b(?:customer|grahak)\b/u) && has(/\b(?:search|find|dhoondo|dhundo|look up)\b/u);
    case "khata.addEntry": return mentions(call.arguments.customer) && number(call.arguments.amountRupees)
      && (call.arguments.type === "received"
        ? has(/\b(?:paid|payment|received|repay|returned|return|wapas|jama)\b/u) && !has(/\b(?:gave|credit|udhaar)\b/u)
        : has(/\b(?:add|likh|gave|credit|udhaar|diya|diye|liya)\b/u) && !has(/\b(?:paid|payment|received|repay|returned|return|wapas|jama)\b/u));
    case "customer.addEntryById": return false;
    case "customer.getBalanceById":
    case "customer.getHistoryById": return false;
    case "khata.openAccount": return mentions(call.arguments.customer) && number(call.arguments.amountRupees)
      && has(/\b(?:open|new|create|naya|nayi|bana)\b/u) && has(/\b(?:khata|udhaar)\b/u);
    case "customer.create": return mentions(call.arguments.customer) && has(/\b(?:customer|grahak)\b/u)
      && has(/\b(?:add|create|new|naya|nayi)\b/u) && !has(/\b(?:udhaar|khata)\b/u);
    case "supplier.create": return mentions(call.arguments.name) && has(/\b(?:supplier|vendor)\b/u)
      && has(/\b(?:add|create|new|naya|nayi)\b/u);
    case "inventory.checkList": return has(/\b(?:list|check|shopping)\b/u)
      && call.arguments.items.every((item) => mentionsProduct(rawText, item.product) && number(item.quantity));
    case "sales.prepareSpoken": {
      const explicitSale = parseSpokenSale(rawText);
      return Boolean(explicitSale
        && productEntityKey(explicitSale.product) === productEntityKey(call.arguments.product)
        && explicitSale.quantity === call.arguments.quantity
        && explicitSale.unit === call.arguments.unit
        && explicitSale.unitPrice === call.arguments.unitPrice
        && explicitSale.priceUnit === call.arguments.priceUnit);
    }
    case "sales.recordSpoken": return !has(/\b(?:udhaar|credit|on credit|pay later)\b/u)
      && statesCompletedSale()
      && call.arguments.items.every((item) => mentionsProduct(rawText, item.product) && number(item.quantity));
    case "sales.recordCreditSpoken": return mentions(call.arguments.customer)
      && has(/\b(?:udhaar|credit|on credit|pay later|baad mein payment)\b/u)
      && statesCompletedSale()
      && call.arguments.items.every((item) => mentionsProduct(rawText, item.product) && number(item.quantity));
    case "sales.recordCreditById": return false;
    case "sales.getDailySummary": {
      const asksForSales = has(/\b(?:sales?|bikri)\b/u);
      const asksForToday = has(/\b(?:today|aaj|aj)\b/u);
      return asksForSales && (asksForToday ? call.arguments.date === indiaToday : text.includes(call.arguments.date));
    }
    case "sales.getMonthlySummary": return has(/\b(?:sales?|bikri)\b/u)
      && has(/\b(?:monthly|month|mahine|mahina|maheene)\b/u)
      && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(call.arguments.month);
    case "sales.getHistory": return has(/\b(?:sales?|bikri)\b/u)
      && has(/\b(?:history|recent|transactions?|records?|purani|pichli)\b/u)
      && (!call.arguments.date || text.includes(call.arguments.date))
      && (!call.arguments.month || text.includes(call.arguments.month) || has(/\b(?:this month|is mahine|iss mahine)\b/u));
    case "reports.getSummary": return has(/\b(?:business|store|shop|dukaan|vyapar)\b/u)
      && has(/\b(?:summary|overview|report|haal)\b/u);
    case "inventory.getReorderSuggestions": return has(/\b(?:reorder|low.stock)\b/u);
    case "supplier.list": return has(/(?:\b(?:suppliers?|vendors?)\b|सप्लायर|आपूर्तिकर्ता)/u)
      && has(/(?:\b(?:list|show|dikhao|batao|names?)\b|सूची|नाम|दिखाओ|बताओ|कौन)/u);
    case "supplier.listActive": return has(/\b(?:suppliers?|vendors?)\b/u) && has(/\b(?:active|chalu)\b/u);
    case "supplier.search": return mentions(call.arguments.query) && has(/\b(?:supplier|vendor)\b/u)
      && has(/\b(?:search|find|dhoondo|dhundo)\b/u);
    case "supplier.getDetails": return mentions(call.arguments.supplier) && has(/\b(?:supplier|vendor)\b/u)
      && has(/\b(?:phone|number|contact|details?|address|email|batao)\b/u);
    case "supplier.getOrders": return mentions(call.arguments.supplier) && has(/\b(?:supplier|vendor)\b/u)
      && has(/\b(?:orders?|purchase|pending)\b/u);
    case "supplier.forProduct": return mentionsProduct(rawText, call.arguments.product) && has(/\b(?:supplier|vendor|आपूर्तिकर्ता)\b/u)
      && has(/\b(?:who|which|kaun|koun)\b/u);
    case "orders.getOpen": return has(/\borders?\b/u) && has(/\b(?:open|show|list|dikhao|batao)\b/u);
    case "orders.getStatus": return (mentions(call.arguments.order) || /\b(?:(?:this|that|the|is|ye|woh|vo)\s+order)\b/u.test(text))
      && has(/\borders?\b/u) && has(/\b(?:status|where|check|dikhao|batao)\b/u);
    case "orders.transition": return mentions(call.arguments.order) && has(/\borders?\b/u)
      && (call.arguments.action === "place" ? has(/\b(?:place|rakho)\b/u)
        : call.arguments.action === "receive" ? has(/\b(?:receive|received|mila)\b/u) : has(/\b(?:cancel|radd)\b/u));
    case "orders.createDraft": return mentions(call.arguments.supplier) && has(/\borders?\b/u)
      && has(/\b(?:draft|create|make|bana|de do)\b/u)
      && call.arguments.items.every((item) => mentionsProduct(rawText, item.product) && number(item.quantity));
    case "product.create":
    case "sales.recordConfirmedBasket":
    case "orders.transitionConfirmed":
    case "orders.getStatusById":
    case "attachment.checkList": return false;
    default: return false;
  }
}
