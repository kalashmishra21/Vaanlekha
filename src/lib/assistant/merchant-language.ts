import { pendingClarificationSchema, reasoningResultSchema, type PendingClarification, type ReasoningResult } from "../ai/types/tool-call";
import { parseTextShoppingList } from "./parse-text-list";
import { parseSpokenQuantity, parseSpokenSale } from "./vernacular-quantity";

const hindiWords: ReadonlyArray<[RegExp, string]> = [
  [/रुपये|रुपए|रुपया|रुपयें/gu, "rupaye"], [/\brupee?s?\b|\brupae\b|\brupye\b|\bruppee?s?\b/giu, "rupaye"], [/₹/gu, "inr "],
  [/पैकेट|पैकेट्स/gu, "packet"], [/पीस/gu, "piece"], [/यूनिट/gu, "unit"],
  [/उधार/gu, "udhaar"], [/\budhhar\b|\budhar\b/giu, "udhaar"], [/खाते/gu, "khate"], [/खाता/gu, "khata"], [/में/gu, "mein"],
  [/नाम/gu, "naam"], [/नया/gu, "naya"], [/नई/gu, "nayi"], [/इन्वेंटरी/gu, "inventory"],
  [/शर्मा/gu, "Sharma"], [/जी/gu, "ji"], [/माल/gu, "maal"],
  [/जोड़\s*दो/gu, "add kar do"], [/जोड़(?:ो)?/gu, "add"], [/ऐड|एड/gu, "add"], [/कर\s*दो/gu, "kar do"], [/करो/gu, "karo"],
  [/दाल(?:ो)?/gu, "daal"], [/ने/gu, "ne"], [/वापस/gu, "wapas"], [/दिए|दिया/gu, "diye"],
  [/आज/gu, "aaj"], [/बिक्री/gu, "sales"], [/सेल/gu, "sale"], [/कुल/gu, "total"],
  [/बताओ/gu, "batao"], [/कितना/gu, "kitna"], [/की/gu, "ki"], [/का/gu, "ka"], [/के/gu, "ke"], [/को/gu, "ko"],
  [/स्टॉक/gu, "stock"], [/ब्रेड/gu, "bread"],
  [/दिखाओ/gu, "dikhao"], [/ऑर्डर/gu, "order"], [/रद्द/gu, "cancel"], [/मिला|आया/gu, "received"], [/है/gu, "hai"],
  [/पचास/gu, "pachaas"], [/पैंतालीस/gu, "paintalis"], [/पच्चीस/gu, "pachis"], [/बीस/gu, "bees"],
  [/दस/gu, "das"], [/एक/gu, "ek"], [/दो/gu, "do"], [/तीन/gu, "teen"], [/चार/gu, "chaar"],
  [/पाँच|पांच/gu, "paanch"], [/छह|छः/gu, "chhe"], [/सात/gu, "saat"], [/आठ/gu, "aath"], [/नौ/gu, "nau"],
  [/सौ/gu, "sau"], [/हज़ार|हजार/gu, "hazaar"], [/हाँ|हां/gu, "haan"], [/नहीं/gu, "nahi"],
];

const numberWords: Record<string, number> = {
  zero: 0, shunya: 0, ek: 1, eka: 1, ik: 1, one: 1, a: 1,
  do: 2, dho: 2, two: 2, teen: 3, tin: 3, three: 3, chaar: 4, char: 4, four: 4,
  paanch: 5, panch: 5, panchh: 5, five: 5, chhe: 6, che: 6, chhah: 6, six: 6,
  saat: 7, sat: 7, seven: 7, aath: 8, ath: 8, eight: 8, nau: 9, nao: 9, nine: 9,
  das: 10, dus: 10, ten: 10, gyarah: 11, gyara: 11, eleven: 11, barah: 12, bara: 12, twelve: 12,
  terah: 13, tera: 13, thirteen: 13, chaudah: 14, fourteen: 14, pandrah: 15, pandra: 15, fifteen: 15,
  solah: 16, sola: 16, sixteen: 16, satrah: 17, satara: 17, seventeen: 17, atharah: 18, athara: 18, eighteen: 18,
  unnis: 19, unnees: 19, nineteen: 19, bees: 20, bis: 20, twenty: 20, ikkis: 21, bais: 22, baais: 22,
  teis: 23, teIs: 23, chaubis: 24, chobis: 24, pachis: 25, pachees: 25, chhabbis: 26, chabbis: 26,
  sattais: 27, athais: 28, untis: 29, untees: 29, tees: 30, tis: 30, thirty: 30,
  ikattis: 31, battis: 32, taintis: 33, chauntis: 34, paintis: 35, chhattis: 36, saintis: 37,
  adtis: 38, untalis: 39, chalis: 40, chaalis: 40, forty: 40, iktalis: 41, bayalis: 42, taintalis: 43,
  chawalis: 44, paintalis: 45, chiyalis: 46, saintalis: 47, adtalis: 48, unchaas: 49,
  pachaas: 50, pachas: 50, pachhas: 50, fifty: 50, ikyavan: 51, bavan: 52, tirpan: 53, chauvan: 54,
  pachpan: 55, chhappan: 56, sattavan: 57, athavan: 58, unsath: 59, saath: 60, sixty: 60,
  iksath: 61, basath: 62, tirsath: 63, chaunsath: 64, painsath: 65, chhiyasath: 66, sarsath: 67,
  adsath: 68, unhattar: 69, sattar: 70, seventy: 70, ikhattar: 71, bahattar: 72, tihattar: 73,
  chauhattar: 74, pachhattar: 75, chhihattar: 76, satattar: 77, athattar: 78, unaasi: 79,
  assi: 80, eighty: 80, ikyasi: 81, bayasi: 82, tirasi: 83, chaurasi: 84, pachasi: 85,
  chhiyasi: 86, satasi: 87, athasi: 88, navasi: 89, nabbe: 90, ninety: 90,
  ikyanve: 91, baanve: 92, tiranve: 93, chauranve: 94, pachanve: 95, chhiyanve: 96, satyanve: 97,
  athanve: 98, ninyanve: 99, hundred: 100,
};
numberWords.sau = 100;
numberWords.so = 100;
numberWords.soo = 100;
numberWords.ekso = 100;

const devanagariDigits = "०१२३४५६७८९";

export function normalizeMerchantText(value: string): string {
  let result = value.normalize("NFKC").replace(/[०-९]/gu, (digit) => String(devanagariDigits.indexOf(digit)));
  for (const [pattern, replacement] of hindiWords) result = result.replace(pattern, replacement);
  return result.replace(/[।!?.,;:]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function parseMerchantNumber(value: string): number | null {
  const normalized = normalizeMerchantText(value).toLocaleLowerCase("en-IN")
    .replace(/\b(?:and|aur)\b/gu, " ").trim();
  if (/^\d{1,9}$/u.test(normalized)) return Number(normalized);
  if (!normalized) return null;
  let total = 0;
  let current = 0;
  for (const token of normalized.split(/\s+/u)) {
    if (token === "sau" || token === "hundred") {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    if (token === "hazaar" || token === "hazar" || token === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    const number = numberWords[token];
    if (number === undefined || number === 0 && token !== "zero" && token !== "shunya") return null;
    current += number;
    if (current > 999) return null;
  }
  const result = total + current;
  return Number.isSafeInteger(result) && result > 0 && result <= 100_000_000 ? result : null;
}

function titleName(value: string): string {
  const trimmed = value.trim().replace(/^(?:the|customer|product|item)\s+/i, "").replace(/\s+/gu, " ");
  return trimmed.replace(/(^|[\s-])([\p{L}])/gu, (_match, boundary: string, letter: string) => `${boundary}${letter.toLocaleUpperCase("en-IN")}`).replace(/\bJi\b/gu, "ji");
}

function canonicalProductName(value: string): string {
  return value.trim() === "मैगी" ? "Maggi" : titleName(value.replace(/\bcreame\b/giu, "cream"));
}

function tool(intent: string, args: unknown): ReasoningResult {
  return reasoningResultSchema.parse({ kind: "tool_call", tool: { intent, arguments: args } });
}

function clarification(question: string, pending?: PendingClarification, intent?: string): ReasoningResult {
  return reasoningResultSchema.parse({ kind: "clarify", question, pending, intent });
}

export function isClarificationCancel(text: string): boolean { return /^(?:cancel|stop|nahi|no|nope|rehne do|mat karo|chhodo)$/iu.test(normalizeMerchantText(text)); }
export function isConversationOnlyMessage(rawText: string): boolean {
  const text = normalizeMerchantText(rawText).toLocaleLowerCase("en-IN");
  return /^(?:(?:hi+|hello+|hey+|namaste|namaskar)(?: saathi)?|good (?:morning|afternoon|evening)|thanks|thank you|okay?|hmm+|umm+|uh+)$/iu.test(text);
}
export function isAmbiguousMerchantText(rawText: string): boolean {
  return /\b(?:maybe|perhaps|shayad|probably|not sure|unclear|inaudible)\b/iu.test(normalizeMerchantText(rawText));
}
function isYes(text: string): boolean { return /^(?:haan|ha|yes|y|confirm|confirmed|kar do|karo|theek hai|sahi|inr|rupees?|rupaye|₹)$/iu.test(normalizeMerchantText(text)); }

function parseMoney(value: string): { amount: number; currency: "inr" | "other" | "unspecified" } | null {
  const normalized = normalizeMerchantText(value).toLocaleLowerCase("en-IN");
  const currency = /\$|\busd\b|\bdollars?\b|\bआ?\s*dollar\b/u.test(normalized) ? "other"
    : /₹|\binr\b|\brs\.?\b|\brupees?\b|\brupaye\b|\brupay\b/u.test(normalized) ? "inr" : "unspecified";
  const numberText = normalized.replace(/₹|\$|\b(?:inr|usd|rs\.?|rupees?|rupaye|rupay|dollars?)\b/gu, " ").replace(/\bper\b.*$/iu, " ").trim();
  const amount = parseMerchantNumber(numberText);
  return amount === null ? null : { amount, currency };
}

function parsePendingProductPrice(text: string, pending: Extract<PendingClarification, { kind: "product-create-price" }>): number | null {
  const normalized = normalizeMerchantText(text).toLocaleLowerCase("en-IN");
  if (/\$|\busd\b|\bdollars?\b/u.test(normalized)) return null;
  const canonical = (value: string) => value.replace(/आइसक्रीम|ice\s*cream/gu, "icecream");
  const product = canonical(normalizeMerchantText(pending.product).toLocaleLowerCase("en-IN"));
  const unit = normalizeMerchantText(pending.unit).toLocaleLowerCase("en-IN");
  let amountText = canonical(normalized).replaceAll(product, " ");
  amountText = amountText.replace(/₹|प्रति|\b(?:inr|rs\.?|rupees?|rupaye|rupay|per|each|ki|ka|ke|ek|one|a|an|for|hai)\b/gu, " ");
  amountText = amountText.replaceAll(unit, " ").replace(/\b(?:packets?|pieces?|units?|bottles?|boxes?|litres?|liters?)\b/gu, " ").replace(/\s+/gu, " ").trim();
  const amount = parseMerchantNumber(amountText);
  return amount !== null && amount > 0 && amount <= 999999999 ? amount : null;
}

function confirmPending(pending: PendingClarification, text: string): ReasoningResult | null {
  const normalized = normalizeMerchantText(text);
  if (pending.kind === "open-account-amount") {
    const money = parseMoney(text);
    if (!money || money.currency === "other") return clarification(`Enter an amount in rupees for ${pending.customer}'s opening khata. Nothing was saved.`, pending, "khata.openAccount");
    return tool("khata.openAccount", { customer: pending.customer, amountRupees: money.amount });
  }
  if (pending.kind === "product-create-price") {
    const sellingPrice = parsePendingProductPrice(text, pending);
    if (sellingPrice === null) return clarification(`Enter a selling price in rupees per ${pending.unit}. Nothing was created.`, pending, "product.create");
    return clarification(`Create ${pending.product} with ${pending.openingStock} ${pending.unit}(s) at ₹${sellingPrice} each? Reply yes or cancel. Nothing has been saved.`,
      { kind: "product-create-confirm", product: pending.product, unit: pending.unit, openingStock: pending.openingStock, sellingPrice }, "product.create");
  }
  if (pending.kind === "product-create-confirm") {
    if (!isYes(text)) return clarification(`Create ${pending.product} with ${pending.openingStock} ${pending.unit}(s) at ₹${pending.sellingPrice} each? Reply yes or cancel. Nothing has been saved.`, pending, "product.create");
    return tool("product.create", { name: pending.product, unit: pending.unit, sellingPrice: pending.sellingPrice, openingStock: pending.openingStock, threshold: 5 });
  }
  if (pending.kind === "product-create-unit") {
    const unit = /^(?:packets?|pieces?|units?|bottles?|boxes?|kg|litres?|liters?)$/iu.test(normalized) ? normalized.replace(/s$/iu, "") : null;
    if (!unit) return clarification(`What unit should I use for ${pending.product} (packet, piece, unit, bottle, box or kg)? Nothing has changed.`, pending, "product.create");
    return clarification(`What is the selling price per ${unit} for ${pending.product}? Nothing has been created.`,
      { kind: "product-create-price", product: pending.product, unit, openingStock: pending.openingStock }, "product.create");
  }
  if (pending.kind === "product-action-choice") {
    if (/^(?:new|naya|nayi|new product|create|naya product)$/iu.test(normalized)) return clarification(
      `What is the selling price per ${pending.unit} for ${pending.product}? Nothing has been created.`,
      { kind: "product-create-price", product: pending.product, unit: pending.unit, openingStock: pending.quantity }, "product.create");
    if (/^(?:existing|old|already exists|stock|existing stock)$/iu.test(normalized)) return tool("inventory.adjust", { product: pending.product, delta: pending.quantity });
    return clarification(`Is ${pending.product} a new product or existing stock? Reply new or existing. Nothing changed.`, pending, "inventory.adjust");
  }
  if (pending.kind === "product-existing-confirm") {
    if (!isYes(text)) return clarification(`Should I add ${pending.delta} to existing ${pending.product} stock? Reply yes or cancel. No stock has changed.`, pending, "inventory.adjust");
    return tool("inventory.adjust", { product: pending.product, delta: pending.delta });
  }
  if (pending.kind === "khata-create-confirm") {
    if (!isYes(text)) return clarification(`Should I open ${pending.customer}'s new khata with ₹${pending.amountRupees}? Reply yes or cancel. Nothing is saved yet.`, pending, "khata.openAccount");
    return tool("khata.openAccount", { customer: pending.customer, amountRupees: pending.amountRupees });
  }
  if (pending.kind === "khata-currency-confirm") {
    if (/\$|\busd\b|\bdollars?\b/iu.test(normalized)) return { kind: "unsupported", message: "Khata amounts are recorded in INR. No entry was made." };
    if (!isYes(text) && !/\binr\b|\brs\.?\b|\brupees?\b|\brupaye\b|₹/iu.test(normalized)) {
      return clarification(`Please confirm whether this is ₹${pending.amountRupees} for ${pending.customer}. Khata uses INR; nothing has been added.`, pending, "khata.addEntry");
    }
    return tool("khata.addEntry", { customer: pending.customer, type: pending.type, amountRupees: pending.amountRupees });
  }
  if (pending.kind === "customer-name") {
    const customer = titleName(text.replace(/^(?:customer|naam)\s+/i, ""));
    return tool("customer.create", { customer });
  }
  if (pending.kind === "supplier-name") return tool("supplier.create", { name: titleName(text.replace(/^supplier\s+/i, "")) });
  if (pending.kind === "order-supplier") {
    if (/^(?:yes|haan|ha|no|nahi|cancel)$/iu.test(normalized)) return clarification("Name the saved supplier to use for this purchase-order draft. Nothing has been created.", pending, "orders.createDraft");
    const supplier = titleName(text.replace(/\s+(?:supplier|distributor)$/i, ""));
    return tool("orders.createDraft", { supplier, items: pending.items });
  }
  if (pending.kind === "order-transition-confirm") {
    const label = pending.orderLabel;
    if (!isYes(text)) return clarification(`Confirm ${pending.action} for ${label} (currently ${pending.currentStatus})? Reply yes or cancel. No order was changed.`, pending, "orders.transition");
    return tool("orders.transitionConfirmed", { orderId: pending.orderId, expectedStatus: pending.currentStatus, action: pending.action });
  }
  if (pending.kind === "order-transition-select") {
    const query = normalized.replace(/^(?:order|po|#)\s*/iu, "").trim();
    const matches = pending.candidates.filter((candidate) => candidate.id.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())
      || candidate.label.toLocaleLowerCase("en-IN") === query.toLocaleLowerCase("en-IN"));
    if (matches.length !== 1) return clarification("Use one of the purchase-order IDs or supplier names shown in the previous message. Nothing was changed.", pending, "orders.transition");
    const selected = matches[0];
    if (!canTransition(selected.status, pending.action)) return { kind: "unsupported", message: `That order is already ${selected.status}; it cannot be ${transitionPast(pending.action)}.` };
    return clarification(`Confirm ${pending.action} for ${selected.label}, currently ${selected.status}? Reply yes or cancel. Nothing was changed.`, {
      kind: "order-transition-confirm", orderId: selected.id, orderLabel: selected.label, currentStatus: selected.status, action: pending.action,
    }, "orders.transition");
  }
  return null;
}

function canTransition(status: "draft" | "placed" | "received" | "cancelled", action: "place" | "receive" | "cancel"): boolean {
  return action === "place" ? status === "draft" : action === "receive" ? status === "placed" : status === "draft" || status === "placed";
}

function transitionPast(action: "place" | "receive" | "cancel"): string {
  return action === "place" ? "placed" : action === "receive" ? "received" : "cancelled";
}

function parseQuantityUnit(value: string): { quantity: number; unit: string } | null {
  const match = /^(.+?)\s+(packets?|packet|pieces?|piece|units?|unit|bottles?|bottle|boxes?|box|kg|litres?|liters?)$/iu.exec(value.trim());
  if (!match) return null;
  const quantity = parseMerchantNumber(match[1]);
  if (quantity === null || quantity < 1 || quantity > 100000) return null;
  const rawUnit = match[2].toLocaleLowerCase("en-IN");
  const unit = /packet/u.test(rawUnit) ? "packet" : /piece/u.test(rawUnit) ? "piece" : /unit/u.test(rawUnit) ? "unit" : /bottle/u.test(rawUnit) ? "bottle" : /box/u.test(rawUnit) ? "box" : rawUnit;
  return { quantity, unit };
}

function parseKhataAdd(text: string): ReasoningResult | null {
  const normalized = normalizeMerchantText(text);
  const debtAt = normalized.search(/\b(?:udhaar|khata|khate)\b/iu);
  if (debtAt < 0 || !/\b(?:add|karo|kro|kar do|likh|jodo|daal)\b/iu.test(normalized)) return null;
  const prefix = normalized.slice(0, debtAt).trim();
  const separator = prefix.toLocaleLowerCase("en-IN").lastIndexOf(" ke ");
  if (separator < 1) return null;
  const customer = titleName(prefix.slice(0, separator));
  const moneyPhrase = prefix.slice(separator + 4).trim();
  const money = parseMoney(moneyPhrase);
  if (!money || money.amount < 1 || money.amount > 10_000_000) return null;
  if (money.currency !== "inr") {
    return clarification(`Is this ₹${money.amount} for ${customer}? Khata is stored in INR, so I need confirmation before adding anything.`, {
      kind: "khata-currency-confirm", customer, amountRupees: money.amount, type: "gave",
    }, "khata.addEntry");
  }
  return tool("khata.addEntry", { customer, type: "gave", amountRupees: money.amount });
}

function parseNewProduct(text: string): ReasoningResult | null {
  const normalized = normalizeMerchantText(text);
  const isNew = /\b(?:new|naya|nayi)\s+(?:inventory|product|item|stock|maal)\b|\bnew inventory\b/iu.test(normalized);
  if (!isNew) return null;
  const beforeMarker = normalized.split(/\b(?:new|naya|nayi)\s+(?:inventory|product|item|stock|maal)\b/iu)[0].trim();
  const prefix = beforeMarker.replace(/\s+(?:(?:add|jodo|daal)(?:\s+(?:kro|karo|kar\s+do))?|(?:kro|karo|kar\s+do))\s*$/iu, "").trim();
  const quantityUnit = parseQuantityUnit(prefix);
  if (quantityUnit) return clarification(`What selling price should I use per ${quantityUnit.unit} for ${titleName(prefix.replace(new RegExp(`\\s+${quantityUnit.quantity}\\s+${quantityUnit.unit}s?$`, "i"), ""))}? No product has been created.`, undefined, "product.create");

  const amountFirst = /^(.+?)\s+(packets?|packet|pieces?|piece|units?|unit)\s+(?:of\s+)?(.+)$/iu.exec(prefix);
  let product: string | undefined;
  let unit: string | undefined;
  let openingStock: number | null = null;
  if (amountFirst) {
    openingStock = parseMerchantNumber(amountFirst[1]);
    unit = amountFirst[2].toLocaleLowerCase("en-IN").replace(/s$/u, "");
    product = amountFirst[3];
  } else {
    const nameFirst = /^(.+?)\s+(.+?)\s+(packets?|packet|pieces?|piece|units?|unit)$/iu.exec(prefix);
    if (nameFirst) {
      product = nameFirst[1]; unit = nameFirst[3].toLocaleLowerCase("en-IN").replace(/s$/u, "");
      openingStock = parseMerchantNumber(nameFirst[2]);
    }
  }
  if (!product || !unit || openingStock === null || openingStock < 0 || openingStock > 100000) {
    return clarification("Tell me the product name, opening quantity and unit, for example ‘50 packets of Bread as a new item’. Nothing was created.", undefined, "product.create");
  }
  product = titleName(product.replace(/^(?:of|ka|ke)\s+/i, ""));
  return clarification(`What is the selling price per ${unit} for ${product}? Please give the price in rupees. Nothing has been created yet.`, {
    kind: "product-create-price", product, unit, openingStock,
  }, "product.create");
}

function parseOrderStatus(text: string): ReasoningResult | null {
  const normalized = normalizeMerchantText(text);
  const match = /^(?:purchase\s+)?order\s+(?:status\s+(?:of\s+)?)?(.+?)\s+(?:ka\s+)?status(?:\s+batao)?$/iu.exec(normalized)
    ?? /^(.+?)\s+ka\s+(?:purchase\s+)?order\s+(?:status|kya hai|kahan hai)(?:\s+batao)?$/iu.exec(normalized);
  if (!match) return null;
  return tool("orders.getStatus", { order: titleName(match[1].replace(/^(?:status of|of)\s+/i, "")) });
}

function parseOrderTransition(text: string): ReasoningResult | null {
  const normalized = normalizeMerchantText(text);
  let match = /^order\s+(.+?)\s+(?:ko\s+)?(place|placed|receive|received|cancel|cancelled|radd)(?:\s+(?:karo|kro|kar do|kar dijiye|mark|as))?$/iu.exec(normalized);
  if (!match) match = /^(.+?)\s+ka\s+(?:purchase\s+)?order\s+(?:ko\s+)?(place|placed|receive|received|cancel|cancelled|radd)(?:\s+(?:karo|kro|kar do|kar dijiye|batao))?$/iu.exec(normalized);
  if (!match) return null;
  const action = /place/iu.test(match[2]) ? "place" : /receive/iu.test(match[2]) ? "receive" : "cancel";
  return tool("orders.transition", { order: titleName(match[1]), action });
}

export function pendingQuestion(pending: PendingClarification): string {
  switch (pending.kind) {
    case "open-account-amount": return `How much opening udhaar should I enter for ${pending.customer}?`;
    case "product-create-price": return `What is the selling price per ${pending.unit} for ${pending.product}?`;
    case "product-create-confirm": return `Create ${pending.product} with ${pending.openingStock} ${pending.unit}(s) at ₹${pending.sellingPrice} each? Reply yes or cancel.`;
    case "product-create-unit": return `What unit should I use for ${pending.product}?`;
    case "product-action-choice": return `Is ${pending.product} new or existing stock?`;
    case "product-existing-confirm": return `Should I add ${pending.delta} to existing ${pending.product} stock?`;
    case "khata-create-confirm": return `Should I open ${pending.customer}'s khata with ₹${pending.amountRupees}? Reply yes or cancel.`;
    case "khata-currency-confirm": return `Please confirm whether this is ₹${pending.amountRupees} for ${pending.customer}. Khata uses INR.`;
    case "customer-name": return "What is the customer's name? Nothing has been added yet.";
    case "supplier-name": return "What is the supplier's name? Nothing has been added yet.";
    case "order-supplier": return "Which saved supplier should I use for this purchase-order draft? Nothing has been created yet.";
    case "order-transition-confirm": return `Confirm ${pending.action} for ${pending.orderLabel}, currently ${pending.currentStatus}? Reply yes or cancel.`;
    case "order-transition-select": return `Which order do you mean by “${pending.query}”? Use one of: ${pending.candidates.map((item) => `${item.label} (#${item.id.slice(0, 8)}, ${item.status})`).join(", ")}.`;
  }
}

export function completePendingClarification(rawPending: unknown, text: string): ReasoningResult | null {
  const parsed = pendingClarificationSchema.safeParse(rawPending);
  return parsed.success ? confirmPending(parsed.data, text) : null;
}

export function reasonMerchantCommand(rawText: string, today: string): ReasoningResult {
  const text = normalizeMerchantText(rawText);
  if (isConversationOnlyMessage(rawText)) return { kind: "unsupported", message: "Hello! Tell me what you would like to check or change in your store." };
  if (isAmbiguousMerchantText(rawText)) return clarification("I am not sure I heard the request clearly. Please repeat the item, action and amount. Nothing was changed.");
  const spokenSale = parseSpokenSale(rawText);
  if (spokenSale) return tool("sales.prepareSpoken", spokenSale);
  const spokenQuantity = parseSpokenQuantity(rawText);
  if (spokenQuantity && !spokenQuantity.unit && /(?:तेल|oil)/iu.test(spokenQuantity.rest) && /(?:देना|दो|do|give|sell|बेच)/iu.test(spokenQuantity.rest)) {
    return clarification("पाव तेल किस माप में चाहिए—250 ml, 250 g, या कोई और मात्रा? कृपया मात्रा, यूनिट और काम (बिक्री या स्टॉक) साफ़ बताइए। कुछ भी सेव नहीं हुआ।");
  }
  if (spokenQuantity?.unit && /\b(?:add|jodo|daal|restock)\b/iu.test(text)) {
    const product = spokenQuantity.rest.replace(/\s+(?:(?:add|jodo|daal|restock)(?:\s+(?:karo|kro|kar do))?|(?:karo|kro|kar do))\s*$/iu, "").trim();
    if (product && product !== spokenQuantity.rest) return tool("inventory.adjust", { product: titleName(product), delta: spokenQuantity.quantity, unit: spokenQuantity.unit });
  }
  const pending = /^(?:customer add(?: karo)?|add customer)$/iu.test(text)
    ? clarification("What is the customer's name? Nothing has been added yet.", { kind: "customer-name" }, "customer.create") : null;
  if (pending) return pending;

  const productCreation = parseNewProduct(rawText);
  if (productCreation) return productCreation;

  const khataAdd = parseKhataAdd(rawText);
  if (khataAdd) return khataAdd;

  const writeKhata = /^(.+?)\s+ko\s+(.+?)\s+rupaye\s+udhaar\s+likh\s+do$/iu.exec(text);
  if (writeKhata) {
    const amount = parseMerchantNumber(writeKhata[2]);
    if (amount !== null) return tool("khata.addEntry", { customer: titleName(writeKhata[1]), type: "gave", amountRupees: amount });
  }

  const openAccount = /^(.+?)\s+ke\s+(.+?)\s+(?:ka\s+)?naya\s+udhaar\s+khata\s+bana\s+(?:do|karo)$/iu.exec(text);
  if (openAccount) {
    const money = parseMoney(openAccount[2]);
    if (money?.currency === "inr") return tool("khata.openAccount", { customer: titleName(openAccount[1]), amountRupees: money.amount });
  }
  const namedOpenAccount = /^(.+?)\s+ke\s+naam\s+se\s+(.+?)\s+rupaye\s+ka\s+naya\s+udhaar\s+khata\s+bana\s+(?:do|karo)$/iu.exec(text);
  if (namedOpenAccount) {
    const amount = parseMerchantNumber(namedOpenAccount[2]);
    if (amount !== null) return tool("khata.openAccount", { customer: titleName(namedOpenAccount[1]), amountRupees: amount });
  }
  const clarifyAccount = /^(.+?)\s+naam\s+se\s+customer\s+add\s+(?:karo|kro)\s+udhaar\s+wala$/iu.exec(text);
  if (clarifyAccount) return clarification(`${titleName(clarifyAccount[1])} ke khate mein shuru mein kitna udhaar likhun?`, {
    kind: "open-account-amount", customer: titleName(clarifyAccount[1]),
  }, "khata.openAccount");

  const repayment = /^(.+?)\s+ne\s+(.+?)\s+(?:(?:inr|rs\.?|rupees?|rupaye|rupay)\s+)?(?:wapas|return|pay|jama)\s+(?:kiye|kiya|diye|diya|karo|kar diye)?$/iu.exec(text);
  if (repayment && /\b(?:wapas|return|pay|jama)\b/iu.test(text)) {
    const money = parseMoney(repayment[2]);
    if (money && money.currency !== "other") return tool("khata.addEntry", { customer: titleName(repayment[1]), type: "received", amountRupees: money.amount });
  }
  const balance = /^(.+?)\s+ka\s+kitna\s+udhaar\s+hai$/iu.exec(text);
  if (balance) return tool("khata.getBalance", { customer: titleName(balance[1]) });
  const englishBalance = /^how much does\s+(.+?)\s+owe(?:\s+(?:us|the shop))?$/iu.exec(text);
  if (englishBalance) return tool("khata.getBalance", { customer: titleName(englishBalance[1]) });

  const shoppingList = /^(?:shopping list|list check karo):\s*(.+)$/iu.exec(rawText.trim());
  if (shoppingList) {
    try {
      const items = parseTextShoppingList(shoppingList[1].replace(/\s*,\s*/gu, "\n"));
      return tool("inventory.checkList", { items });
    } catch {
      return { kind: "unsupported", message: "Write each list item as a product and quantity, for example Maggi 2, Parle-G 3." };
    }
  }

  const orderTransition = parseOrderTransition(rawText);
  if (orderTransition) return orderTransition;
  const orderStatus = parseOrderStatus(rawText);
  if (orderStatus) return orderStatus;

  const explicitOrder = /^(.+?)\s+se\s+(.+?)\s+ke\s+(.+?)\s+(?:ka\s+)?(?:purchase\s+)?order\s+(?:draft\s+)?(?:banao|bana\s+do|create|make|place\s+draft)$/iu.exec(text);
  if (explicitOrder) {
    const amountUnit = parseQuantityUnit(explicitOrder[3]);
    if (amountUnit) return tool("orders.createDraft", { supplier: titleName(explicitOrder[1]), items: [{ product: titleName(explicitOrder[2]), quantity: amountUnit.quantity }] });
  }
  const missingSupplier = /^(.+?)\s+ka\s+order\s+(.+?)\s+(?:de\s+do|bana\s+do|banao|kar\s+do)$/iu.exec(text)
    ?? /^(.+?)\s+ka\s+(.+?)\s+ka\s+order\s+(?:de\s+do|bana\s+do|banao|kar\s+do)$/iu.exec(text);
  if (missingSupplier) {
    const amountUnit = parseQuantityUnit(missingSupplier[2]);
    if (amountUnit) return clarification(`Which saved supplier should I use for ${amountUnit.quantity} ${amountUnit.unit}(s) of ${titleName(missingSupplier[1])}? I will create a draft only; no supplier will be contacted.`, {
      kind: "order-supplier", items: [{ product: titleName(missingSupplier[1]), quantity: amountUnit.quantity }],
    }, "orders.createDraft");
  }
  const ordersByProduct = /^(.+?)\s+ke\s+(.+?)\s+order\s+(?:de\s+do|bana\s+do|kar\s+do)$/iu.exec(text);
  if (ordersByProduct) {
    const amountUnit = parseQuantityUnit(ordersByProduct[2]);
    if (amountUnit) return clarification(`Which saved supplier should I use for ${amountUnit.quantity} ${amountUnit.unit}(s) of ${titleName(ordersByProduct[1])}? I will create a draft only; no supplier will be contacted.`, {
      kind: "order-supplier", items: [{ product: titleName(ordersByProduct[1]), quantity: amountUnit.quantity }],
    }, "orders.createDraft");
  }

  if (/^(?:low[- ]stock items? ki reorder list bana do|reorder suggestions? batao|reorder list|low stock batao)$/iu.test(text))
    return tool("inventory.getReorderSuggestions", {});
  if (/^(?:suppliers? (?:dikhao|batao)|supplier list|show suppliers)$/iu.test(text)) return tool("supplier.list", {});
  if (/^(?:supplier add(?: karo| kro)?|add supplier)$/iu.test(text)) return clarification("What is the supplier's name? Nothing has been added yet.", { kind: "supplier-name" }, "supplier.create");
  const newSupplier = /^(?:new supplier\s+)?(.+?)\s+(?:supplier\s+)?add\s+(?:karo|kro)$/iu.exec(text);
  if (newSupplier && /supplier/iu.test(text)) return tool("supplier.create", { name: titleName(newSupplier[1].replace(/\bsupplier\b/iu, "")) });
  if (/^(?:supplier add|add supplier)$/iu.test(text)) return clarification("What is the supplier's name? Nothing has been added yet.", { kind: "supplier-name" }, "supplier.create");
  if (/^(?:open orders? dikhao|purchase orders? dikhao|orders? dikhao|show (?:open )?orders?)$/iu.test(text)) return tool("orders.getOpen", {});

  if (/^(?:what(?:'s| is| are) today's sales|tell me today's (?:total )?sales|today's sales summary|aaj ki (?:total )?sale batao|aaj ki sales batao|aaj ki bikri batao)$/iu.test(text))
    return tool("sales.getDailySummary", { date: today });

  const bareProduct = /^(.+)\s+(\d+|[a-z]+(?:\s+sau)?)\s+(packets?|pieces?|units?|bottles?|boxes?)$/iu.exec(text);
  if (bareProduct && !/^(?:increase|decrease|reduce)\b/iu.test(text)) {
    const quantity = parseMerchantNumber(bareProduct[2]);
    if (quantity !== null) return clarification(`Is ${canonicalProductName(bareProduct[1])} a new product or should I add ${quantity} to existing stock? No stock has changed.`,
      { kind: "product-action-choice", product: canonicalProductName(bareProduct[1]), quantity, unit: bareProduct[3].replace(/s$/iu, "") }, "inventory.adjust");
  }

  const englishAdd = /^add\s+(.+?)\s+(?:packets?|packet|units?|unit)\s+of\s+(.+?)\s+to\s+(?:inventory|stock)$/iu.exec(text);
  if (englishAdd) {
    const quantity = parseMerchantNumber(englishAdd[1]);
    if (quantity) return tool("inventory.adjust", { product: canonicalProductName(englishAdd[2]), delta: quantity });
  }
  const addInventory = /^(.+?)\s+(?:ke|ka)\s+(.+?)\s+(packets?|packet|pieces?|piece|units?|unit)\s+(?:add|jodo|daal)\s*(?:karo|kro|kar\s+do|kr\s+do)?(?:\s+inventory\s+me)?$/iu.exec(text)
    ?? /^(.+?)\s+(?:(?:ke|ka)\s+)?(.+?)\s+(packets?|packet|pieces?|piece|units?|unit)\s+(?:add|jodo|daal)\s*(?:karo|kro|kar\s+do|kr\s+do)?(?:\s+inventory\s+me)?$/iu.exec(text);
  if (addInventory) {
    const quantity = parseMerchantNumber(addInventory[2]);
    if (quantity) return tool("inventory.adjust", { product: canonicalProductName(addInventory[1]), delta: quantity, unit: addInventory[3].replace(/s$/iu, "") });
  }
  const stock = /^(?:what(?:'s| is) the stock of|show (?:me )?the stock of)\s+(.+?)$/iu.exec(text)
    ?? /^how many\s+(?:packets?|pieces?|units?|bottles?|boxes?)\s+of\s+(.+?)\s+are\s+(?:there\s+)?in\s+stock$/iu.exec(text)
    ?? /^(.+?)\s+ka stock batao$/iu.exec(text);
  if (stock) return tool("inventory.getStock", { product: canonicalProductName(stock[1]) });

  if (/^(?:customer add|add customer|supplier add|add supplier)$/iu.test(text)) {
    const isSupplier = /supplier/iu.test(text);
    return clarification(isSupplier ? "What is the supplier's name?" : "What is the customer's name?", isSupplier ? { kind: "supplier-name" } : { kind: "customer-name" }, isSupplier ? "supplier.create" : "customer.create");
  }
  if (/(?:stock|maal|inventory)/iu.test(text) && /(?:adjust|badhao|ghatao|add|kam)/iu.test(text)
    && !parseMerchantNumber(text)) return clarification("Which product and how many units should I add or remove? Nothing was changed.", undefined, "inventory.adjust");
  return reasoningResultSchema.parse({ kind: "unsupported", message: "I could not safely identify that store request. Add the product/customer/supplier and amount, or try a supported example." });
}

export function completePending(rawPending: unknown, text: string): ReasoningResult | null {
  const parsed = pendingClarificationSchema.safeParse(rawPending);
  if (!parsed.success) return null;
  return confirmPending(parsed.data, text);
}

function looksLikeNameAnswer(text: string): boolean {
  const words = text.trim().split(/\s+/u);
  return words.length <= 5
    && /\p{L}/u.test(text)
    && /^[\p{L}\p{N}][\p{L}\p{M}\p{N}'’&.\-/]*(?:\s+[\p{L}\p{N}][\p{L}\p{M}\p{N}'’&.\-/]*){0,4}$/u.test(text)
    && !/^(?:what|how|where|when|why|who|tell|show|please|can|could|would|is|are|do|does|aaj|today|order|stock|inventory|khata|udhaar|add|create|cancel)\b/iu.test(text)
    && !/\b(?:me|you|joke|time|please|batao|dikhao|karo|kar|do|de|diya|hai|rupaye|rupees?|rs)\b/iu.test(text)
    && !/(?:आज|बिक्री|स्टॉक|उधार|बताओ|दिखाओ|ऑर्डर)/u.test(text);
}

// A pending answer only owns the next turn when it looks like an answer to that
// particular question. A fresh merchant command must be allowed to interrupt it.
export function shouldContinuePending(rawPending: unknown, rawText: string): boolean {
  const parsed = pendingClarificationSchema.safeParse(rawPending);
  if (!parsed.success) return false;
  if (isConversationOnlyMessage(rawText)) return false;
  if (isAmbiguousMerchantText(rawText)) return false;
  const text = normalizeMerchantText(rawText).toLocaleLowerCase("en-IN");
  if (isClarificationCancel(rawText)) return true;
  if (parsed.data.kind === "product-create-price") return parsePendingProductPrice(rawText, parsed.data) !== null;
  if (parsed.data.kind === "product-create-confirm") return isYes(rawText);
  if (parsed.data.kind === "khata-currency-confirm" && /^(?:haan|ha|yes|confirm)?\s*,?\s*(?:inr|rs|rupees?|rupaye)$/iu.test(text)) return true;
  if (parsed.data.kind === "open-account-amount" && !/\b(?:aaj|today|sales?|stock|inventory|udhaar|khata|order|supplier|customer|add|create|show|batao)\b/u.test(text)) return true;
  if (/(?:\baaj\b|\btoday\b|\bsales?\b|\bstock\b|\binventory\b|\budhaar\b|\bkhata\b|\border\b|\bsupplier\b|\bcustomer\b|\badd\b|\bcreate\b|\bshow\b|\bbatao\b)/u.test(text)) {
    return parsed.data.kind === "order-transition-confirm" && isYes(rawText);
  }
  if (["open-account-amount", "khata-currency-confirm"].includes(parsed.data.kind)) {
    return parseMoney(rawText) !== null || isYes(rawText);
  }
  if (["product-existing-confirm", "khata-create-confirm", "order-transition-confirm"].includes(parsed.data.kind)) return isYes(rawText);
  if (parsed.data.kind === "product-action-choice") return /^(?:new|naya|nayi|new product|create|naya product|existing|old|already exists|stock|existing stock)$/iu.test(text);
  if (parsed.data.kind === "product-create-unit") return /^(?:packets?|pieces?|units?|bottles?|boxes?|kg|litres?|liters?)$/iu.test(text);
  if (parsed.data.kind === "order-transition-select") {
    const query = text.replace(/^(?:order|po|#)\s*/iu, "").trim();
    if (!query) return false;
    return parsed.data.candidates.some((candidate) => candidate.id.toLocaleLowerCase().startsWith(query)
      || candidate.label.toLocaleLowerCase("en-IN") === query);
  }
  if (["customer-name", "supplier-name", "order-supplier"].includes(parsed.data.kind)) return looksLikeNameAnswer(text);
  return false;
}
