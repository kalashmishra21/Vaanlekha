import { z } from "zod";
import { todayInIndia } from "../../business/calculations";
import { MockAIProvider } from "../providers/mock";
import { reasoningResultSchema, type ReasoningResult, type ToolCall } from "../types/tool-call";
import type { ReasoningInput } from "../types/provider";
import { ProviderRequestError, retryProviderRequest } from "../provider-http";
import { isAmbiguousMerchantText, isConversationOnlyMessage } from "../../assistant/merchant-language";
import { isGroundedToolCall, mentionsMerchantEntity } from "../../assistant/utterance-safety";

const endpoint = "https://openrouter.ai/api/v1/chat/completions";
export type ReasonerTransport = { endpoint: string; provider: "OpenRouter" | "Gemini" };
const field = { type: "string" } as const;
const integer = { type: "integer" } as const;
const parameters = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: "object", properties, required, additionalProperties: false });
const listItems = { type: "array", minItems: 1, maxItems: 30, items: parameters({ product: field, quantity: integer }, ["product", "quantity"]) };

const tools = [
  ["inventory_adjust", "Propose a stock change. Positive delta adds stock; negative delta removes it. Include unit only when explicitly stated; the trusted tool asks for unit and price if this product is missing.", parameters({ product: field, delta: integer, unit: field }, ["product", "delta"])],
  ["inventory_getStock", "Read the current stock of a product.", parameters({ product: field }, ["product"])],
  ["khata_getBalance", "Read how much a customer owes the shop.", parameters({ customer: field }, ["customer"])],
  ["khata_addEntry", "Record a customer's ledger event. Use type received when the customer pays or returns money; gave when the shop gives new credit.", parameters({ customer: field, type: { type: "string", enum: ["gave", "received"] }, amountRupees: integer }, ["customer", "type", "amountRupees"])],
  ["customer_create", "Add a customer with no opening credit, only when the request does not mention udhaar or opening balance.", parameters({ customer: field }, ["customer"])],
  ["khata_openAccount", "Create a NEW customer and opening udhaar together. Use only when the opening amount is explicit.", parameters({ customer: field, amountRupees: integer }, ["customer", "amountRupees"])],
  ["clarify_openAccount", "Ask for the opening amount when a new udhaar customer or khata is requested without any amount. No customer is created yet.", parameters({ customer: field }, ["customer"])],
  ["inventory_checkList", "Read inventory and prices for a shopping list. This is a draft, never a sale.", parameters({ items: listItems }, ["items"])],
  ["sales_getDailySummary", "Read total sales for a YYYY-MM-DD date.", parameters({ date: field }, ["date"])],
  ["inventory_getReorderSuggestions", "Read low-stock reorder quantities. This creates no order.", parameters({}, [])],
  ["supplier_list", "Read the shop's supplier directory.", parameters({}, [])],
  ["supplier_create", "Add a supplier when the merchant explicitly requests it.", parameters({ name: field }, ["name"])],
  ["orders_getOpen", "Read the shop's draft and placed purchase orders.", parameters({}, [])],
  ["orders_getStatus", "Read the actual status of one matching owner-scoped purchase order.", parameters({ order: field }, ["order"])],
  ["orders_transition", "Request a place, receive or cancel action. The trusted app will always ask the merchant to confirm before any state change.", parameters({ order: field, action: { type: "string", enum: ["place", "receive", "cancel"] } }, ["order", "action"])],
  ["orders_createDraft", "Create an INTERNAL purchase order draft for an explicitly named supplier and product quantities. Never claim supplier was contacted.", parameters({ supplier: field, items: { type: "array", minItems: 1, maxItems: 30, items: parameters({ product: field, quantity: integer }, ["product", "quantity"]) } }, ["supplier", "items"])],
] as const;

const intentByFunction: Record<string, ToolCall["intent"]> = {
  inventory_adjust: "inventory.adjust",
  inventory_getStock: "inventory.getStock",
  khata_getBalance: "khata.getBalance",
  khata_addEntry: "khata.addEntry",
  customer_create: "customer.create",
  khata_openAccount: "khata.openAccount",
  inventory_checkList: "inventory.checkList",
  sales_getDailySummary: "sales.getDailySummary",
  inventory_getReorderSuggestions: "inventory.getReorderSuggestions",
  supplier_list: "supplier.list",
  supplier_create: "supplier.create",
  orders_getOpen: "orders.getOpen",
  orders_getStatus: "orders.getStatus",
  orders_transition: "orders.transition",
  orders_createDraft: "orders.createDraft",
};

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({
    tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
  }) })).min(1),
});

export class OpenRouterReasoner {
  constructor(
    private readonly key: string,
    private readonly model: string,
    private readonly request: typeof fetch = fetch,
    private readonly today: () => string = todayInIndia,
    private readonly beforeNetworkRequest?: () => Promise<void>,
    private readonly transport: ReasonerTransport = { endpoint, provider: "OpenRouter" },
  ) {}

  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    const text = z.string().trim().min(1).max(500).parse(input.text);
    if (isConversationOnlyMessage(text)) return { kind: "unsupported", message: "Hello! Tell me what you would like to check or change in your store." };
    if (isAmbiguousMerchantText(text)) return { kind: "clarify", question: "I am not sure I heard the request clearly. Please repeat the item, action and amount. Nothing was changed." };
    // Exact supported merchant phrases use deterministic reasoning before the model.
    // The result still crosses the same Zod and trusted-tool boundary.
    const recognized = await new MockAIProvider(this.today).reason({ ...input, text });
    if (recognized.kind !== "unsupported") return reasoningResultSchema.parse(recognized);
    await this.beforeNetworkRequest?.();
    const deadline = Date.now() + 40_000;
    const started = performance.now();
    let response: Response;
    try {
      response = await retryProviderRequest(() => this.request(this.transport.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: `Classify one Indian retailer request into exactly one function call. Only propose a function; never claim it ran. Interpret Hindi, Hinglish and English. Today in India is ${this.today()}. Preserve product, customer, and supplier names. Convert Hindi number words only when unambiguous. For today's sales use today's date. A new udhaar khata with a stated amount needs khata_openAccount; if amount is missing choose clarify_openAccount, never customer_create. A repayment needs khata_addEntry with type received. Khata is INR only; if the user names dollars or another currency, do not convert or assume INR. Do not infer a missing product price, supplier, order ID or amount. A shopping list needs inventory_checkList; do not record a sale. A reorder suggestion is a read-only inventory_getReorderSuggestions call. An order draft uses orders_createDraft only with an explicitly named supplier and product quantities; it does not contact the supplier. An order state change must use orders_transition; the app will request explicit confirmation before it runs. If uncertain, do not call any function.` },
          ...(input.recent ?? []).slice(-6).map((turn) => ({ role: turn.role, content: turn.text })),
          { role: "user", content: text },
        ],
        tools: tools.map(([name, description, schema]) => ({ type: "function", function: { name, description, parameters: schema } })),
        tool_choice: "auto",
        parallel_tool_calls: false,
        temperature: 0,
        max_tokens: 400,
        stream: false,
        }),
        signal: AbortSignal.timeout(Math.min(35_000, Math.max(1, deadline - Date.now()))),
        cache: "no-store",
      }));
    } catch {
      if (process.env.AI_REASONER_TRACE === "1") console.info("Reasoner request", { provider: this.transport.provider, status: "network-error", durationMs: Math.round(performance.now() - started) });
      throw new ProviderRequestError(this.transport.provider, 503, "1");
    }
    if (process.env.AI_REASONER_TRACE === "1") console.info("Reasoner request", { provider: this.transport.provider, status: response.status, durationMs: Math.round(performance.now() - started) });
    if (!response.ok) throw new ProviderRequestError(this.transport.provider, response.status, response.headers.get("retry-after"));
    const raw: unknown = await response.json();
    if (z.object({ error: z.unknown() }).safeParse(raw).success) {
      throw new Error(`${this.transport.provider} reasoning provider is temporarily unavailable.`);
    }
    const parsed = completionSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${this.transport.provider} returned an invalid completion.`);
    const calls = parsed.data.choices[0].message.tool_calls;
    if (!calls?.length) return { kind: "unsupported", message: "No safe intent was identified." };
    if (calls.length !== 1) throw new Error(`${this.transport.provider} proposed multiple actions.`);
    if (calls[0].function.name === "clarify_openAccount") {
      let args: unknown;
      try { args = JSON.parse(calls[0].function.arguments); } catch { throw new Error(`${this.transport.provider} returned invalid clarification arguments.`); }
      const customer = z.object({ customer: z.string().trim().min(1).max(120) }).strict().parse(args).customer;
      if (!mentionsMerchantEntity(text, customer)) {
        return { kind: "clarify", question: "Which customer should I open a khata for? No account was created." };
      }
      return reasoningResultSchema.parse({ kind: "clarify", question: `${customer} ke khate mein shuru mein kitna udhaar likhun?`, pending: { kind: "open-account-amount", customer } });
    }
    const intent = intentByFunction[calls[0].function.name];
    if (!intent) throw new Error(`${this.transport.provider} proposed an unknown action.`);
    let args: unknown;
    try { args = JSON.parse(calls[0].function.arguments); } catch { throw new Error(`${this.transport.provider} returned invalid tool arguments.`); }
    const proposal = reasoningResultSchema.parse({ kind: "tool_call", tool: { intent, arguments: args } });
    if (proposal.kind !== "tool_call" || !isGroundedToolCall(text, proposal.tool)) {
      return { kind: "clarify", question: "I could not confirm the item and action from that request. Please say exactly what to check or change, including any quantity or amount. Nothing was changed." };
    }
    return proposal;
  }
}
