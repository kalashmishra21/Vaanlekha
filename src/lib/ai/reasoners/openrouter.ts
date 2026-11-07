import { z } from "zod";
import { todayInIndia } from "../../business/calculations";
import { reasoningResultSchema, type ReasoningResult, type ToolCall } from "../types/tool-call";
import type { ReasoningInput } from "../types/provider";
import { ProviderRequestError, retryProviderRequest } from "../provider-http";
import { completePending, isAmbiguousMerchantText, isConversationOnlyMessage, shouldContinuePending } from "../../assistant/merchant-language";
import { isGroundedToolCall, mentionsMerchantEntity } from "../../assistant/utterance-safety";

const endpoint = "https://openrouter.ai/api/v1/chat/completions";
export type ReasonerTransport = { endpoint: string; provider: "OpenRouter" | "Gemini"; timeoutMs?: number; retryAttempts?: number };
const field = { type: "string" } as const;
const integer = { type: "integer" } as const;
const decimal = { type: "number" } as const;
const parameters = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: "object", properties, required, additionalProperties: false });
const listItems = { type: "array", minItems: 1, maxItems: 30, items: parameters({ product: field, quantity: integer }, ["product", "quantity"]) };

const tools = [
  ["inventory_adjust", "Propose a stock change. Positive delta adds stock; negative delta removes it. Preserve fractional quantities. Include unit only when explicitly stated; the trusted tool asks for unit and price if this product is missing.", parameters({ product: field, delta: decimal, unit: field }, ["product", "delta"])],
  ["inventory_getStock", "Read the current stock of a product.", parameters({ product: field }, ["product"])],
  ["khata_getBalance", "Read how much a customer owes the shop.", parameters({ customer: field }, ["customer"])],
  ["khata_getHistory", "Read the saved ledger history for one named customer. If the name could match multiple people, the trusted executor will ask which customer.", parameters({ customer: field }, ["customer"])],
  ["customer_list", "List saved shop customers using internal references and masked phone numbers only.", parameters({}, [])],
  ["customer_search", "Search actual shop customers by name; do not assume duplicate names identify the same person.", parameters({ query: field }, ["query"])],
  ["khata_addEntry", "Record a customer's ledger event. Use type received when the customer pays or returns money; gave when the shop gives new credit.", parameters({ customer: field, type: { type: "string", enum: ["gave", "received"] }, amountRupees: integer }, ["customer", "type", "amountRupees"])],
  ["customer_create", "Add a customer with no opening credit, only when the request does not mention udhaar or opening balance.", parameters({ customer: field }, ["customer"])],
  ["khata_openAccount", "Create a NEW customer and opening udhaar together. Use only when the opening amount is explicit.", parameters({ customer: field, amountRupees: integer }, ["customer", "amountRupees"])],
  ["clarify_openAccount", "Ask for the opening amount when a new udhaar customer or khata is requested without any amount. No customer is created yet.", parameters({ customer: field }, ["customer"])],
  ["continue_pending", "Continue the server-saved clarification only when the current message clearly answers its one missing detail or confirms a previously described action. The trusted app validates the reply and constructs any action. Do not use for a new request.", parameters({}, [])],
  ["inventory_checkList", "Read inventory and prices for a shopping list. This is a draft, never a sale.", parameters({ items: listItems }, ["items"])],
  ["sales_prepareSpoken", "Prepare a spoken sale as a reviewable draft only. Never record the sale. Include an explicitly spoken product, quantity and unit; include price only when spoken.", parameters({ product: field, quantity: decimal, unit: { type: "string", enum: ["kg", "g", "litre", "ml", "packet", "piece"] }, unitPrice: decimal, priceUnit: { type: "string", enum: ["kg", "g", "litre", "ml", "packet", "piece"] } }, ["product", "quantity", "unit"])],
  ["sales_recordSpoken", "Record a clear explicit non-credit sale. The trusted executor reads saved prices and atomically records the sale and stock deduction. Never use for a shopping list or uncertain event.", parameters({ items: { type: "array", minItems: 1, maxItems: 30, items: parameters({ product: field, quantity: decimal, unit: field, unitPrice: decimal, priceUnit: field }, ["product", "quantity"]) }, paymentMethod: { type: ["string", "null"], enum: ["cash", "upi", "card", null] } }, ["items"])],
  ["sales_recordCreditSpoken", "Record a sale on credit only when the merchant explicitly says udhaar, credit, or pay later. The trusted executor atomically records sale, stock deduction, and the exact customer's receivable. Include customer and every item.", parameters({ customer: field, items: { type: "array", minItems: 1, maxItems: 30, items: parameters({ product: field, quantity: decimal, unit: field, unitPrice: decimal, priceUnit: field }, ["product", "quantity"]) } }, ["customer", "items"])],
  ["sales_getDailySummary", "Read total sales for a YYYY-MM-DD date.", parameters({ date: field }, ["date"])],
  ["sales_getMonthlySummary", "Read sales totals for a YYYY-MM month in India business time.", parameters({ month: field }, ["month"])],
  ["sales_getHistory", "Read recent saved sales for an optional date or month. Never infer sale data.", parameters({ date: field, month: field }, [])],
  ["reports_getSummary", "Read a brief summary of current shop inventory, today's sales, and outstanding khata from saved records.", parameters({}, [])],
  ["inventory_getReorderSuggestions", "Read low-stock reorder quantities. This creates no order.", parameters({}, [])],
  ["supplier_list", "Read the shop's supplier directory.", parameters({}, [])],
  ["supplier_search", "Search the actual supplier directory by supplier name.", parameters({ query: field }, ["query"])],
  ["supplier_getDetails", "Read saved details for one named supplier, including its stored contact information.", parameters({ supplier: field }, ["supplier"])],
  ["supplier_listActive", "Read currently active suppliers.", parameters({}, [])],
  ["supplier_getOrders", "Read purchase orders linked to one named supplier.", parameters({ supplier: field }, ["supplier"])],
  ["supplier_forProduct", "Find suppliers that appear in actual purchase orders for one named shop product. Return no answer if there is no saved relationship.", parameters({ product: field }, ["product"])],
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
  sales_prepareSpoken: "sales.prepareSpoken",
  sales_recordSpoken: "sales.recordSpoken",
  sales_recordCreditSpoken: "sales.recordCreditSpoken",
  sales_getDailySummary: "sales.getDailySummary",
  sales_getMonthlySummary: "sales.getMonthlySummary",
  sales_getHistory: "sales.getHistory",
  reports_getSummary: "reports.getSummary",
  khata_getHistory: "khata.getHistory",
  customer_list: "customer.list",
  customer_search: "customer.search",
  inventory_getReorderSuggestions: "inventory.getReorderSuggestions",
  supplier_list: "supplier.list",
  supplier_search: "supplier.search",
  supplier_getDetails: "supplier.getDetails",
  supplier_listActive: "supplier.listActive",
  supplier_getOrders: "supplier.getOrders",
  supplier_forProduct: "supplier.forProduct",
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
    await this.beforeNetworkRequest?.();
    const deadlineSignal = AbortSignal.timeout(this.transport.timeoutMs ?? 15_000);
    const started = performance.now();
    let response: Response;
    try {
      response = await retryProviderRequest(() => {
        if (deadlineSignal.aborted) throw new Error("Reasoner deadline exceeded");
        return this.request(this.transport.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: `Classify one Indian retailer request into exactly one function call. Only propose a function; never claim it ran. Interpret Hindi, Roman Hindi, Hinglish and Indian English. Today in India is ${this.today()}. Preserve product, customer, and supplier names. Convert Hindi number words only when unambiguous. For today's sales use today's date; for monthly sales use the current India month unless the user states another month. A new udhaar event must create the customer and ledger entry atomically when no matching customer exists. If multiple customers have that name, let the trusted executor ask for selection. A repayment needs khata_addEntry with type received. Khata is INR only; if the user names another currency, do not convert or assume INR. For a clear explicit non-credit sale use sales_recordSpoken; the trusted executor uses actual saved prices and the database transaction deducts stock. Use sales_recordCreditSpoken only for explicitly stated udhaar/credit. A shopping-list review must use inventory_checkList and never record a sale. Never infer a missing product, unit or quantity. Supplier and order answers must come from shop records. When a supplier has several orders, the executor will ask for the order number; never guess. A reorder suggestion is read-only. An order draft is internal and does not contact the supplier; create it only with an explicit supplier and items. An order transition always requires confirmation. If a server-saved pending clarification is supplied, choose continue_pending only when the current message answers that question; a fresh unrelated command must use its normal function. If uncertain, do not call any function.` },
          ...(input.pending ? [{ role: "system", content: `Server-saved pending clarification (trusted context): ${JSON.stringify(input.pending)}. The current merchant message may answer only its missing detail. Use continue_pending for a clear answer; do not change any saved names, quantities, units, prices, IDs, or actions.` }] : []),
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
        signal: deadlineSignal,
        cache: "no-store",
      }); }, { attempts: this.transport.retryAttempts ?? 2 });
    } catch {
      if (process.env.AI_REASONER_TRACE === "1") console.info("Reasoner request", { provider: this.transport.provider, status: "network-error", durationMs: Math.round(performance.now() - started) });
      throw new ProviderRequestError(this.transport.provider, 503, "1");
    }
    const networkMs = Math.round(performance.now() - started);
    if (process.env.AI_REASONER_TRACE === "1") console.info("Reasoner network", { provider: this.transport.provider, status: response.status, durationMs: networkMs });
    if (!response.ok) throw new ProviderRequestError(this.transport.provider, response.status, response.headers.get("retry-after"));
    const parseStarted = performance.now();
    const raw: unknown = await response.json();
    if (z.object({ error: z.unknown() }).safeParse(raw).success) {
      throw new ProviderRequestError(this.transport.provider, 503, response.headers.get("retry-after"));
    }
    const parsed = completionSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${this.transport.provider} returned an invalid completion.`);
    if (process.env.AI_REASONER_TRACE === "1") console.info("Reasoner parse", { provider: this.transport.provider, durationMs: Math.round(performance.now() - parseStarted) });
    const calls = parsed.data.choices[0].message.tool_calls;
    if (!calls?.length) return { kind: "unsupported", message: "No safe intent was identified." };
    if (calls.length !== 1) throw new Error(`${this.transport.provider} proposed multiple actions.`);
    if (calls[0].function.name === "continue_pending") {
      let args: unknown;
      try { args = JSON.parse(calls[0].function.arguments); } catch { throw new Error(`${this.transport.provider} returned invalid pending arguments.`); }
      z.object({}).strict().parse(args);
      if (!input.pending || !shouldContinuePending(input.pending, text)) {
        return { kind: "clarify", question: "That reply does not safely answer the pending question. Please provide the requested detail or start a new request. Nothing was changed." };
      }
      const completed = completePending(input.pending, text);
      return completed ? reasoningResultSchema.parse(completed) : {
        kind: "clarify", question: "I could not validate that answer. Please provide the requested detail again. Nothing was changed.",
      };
    }
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
    if (proposal.kind !== "tool_call" || !isGroundedToolCall(text, proposal.tool, this.today())) {
      return { kind: "clarify", question: "I could not confirm the item and action from that request. Please say exactly what to check or change, including any quantity or amount. Nothing was changed." };
    }
    return proposal;
  }
}
