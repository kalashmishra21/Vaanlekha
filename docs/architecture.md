# Architecture

Vaanlekha is one Next.js App Router application backed by Supabase Auth and Postgres when configured. It is sized for a small challenge demo. The landing page and deterministic mock AI preview work without credentials; the connected workspace requires a signed-in shop owner.

## Trusted flow

```text
User text or short voice clip → optional Prisma transcription
          → mock, Gemini or OpenRouter intent → Zod validation
          → authenticated server tool → owner-scoped Supabase operation
          → authoritative database result → assistant confirmation
          → optional Timbre speech
```

The mock provider makes no network calls. `AI_PROVIDER=gnani` uses official Prisma REST for short WAV transcription and Timbre REST for speech. Separately, a deterministic fast path handles exact supported merchant phrases. `AI_REASONER=gemini` proposes other intents through the pinned free-tier Gemini model, with OpenRouter as a fallback for provider failures; a provider rate limit remains visible instead of silently falling back. `AI_REASONER=openrouter` selects OpenRouter alone, and `AI_REASONER=mock` preserves the offline mode. Evon has no configured hosted endpoint. The browser never receives Gemini, Gnani or OpenRouter keys. A missing, malformed, multiple, or schema-invalid tool proposal cannot reach the business executor. No provider error mutates data. Only a successful trusted operation may produce a completion claim.

`/api/assistant/turn` validates user text, recent conversation context, server-saved clarification state, and the provider result before calling `BusinessToolExecutor`. A pending stock addition retains the product, quantity and unit across refreshes; an existing compatible product is matched against shop inventory, while a missing product requires a price. Both require explicit confirmation before writing. The trusted contracts also include `customer.create`, `khata.openAccount`, `inventory.checkList`, and `sales.recordConfirmedBasket`. Browser forms post validated actions to `/api/business`; neither route accepts a caller-supplied shop ID. `/api/voice/transcribe` accepts only a short mono WAV from an authenticated owner with a connected shop; it calls Prisma only in Gnani mode. TTS is requested after the trusted tool result is known.

`/api/assistant/attachment` accepts temporary image bytes or browser-extracted PDF text. PDF.js reads text pages locally or renders scanned pages to images; images go through up to three configured free OpenRouter vision models in order, with bounded retries for capacity failures. The model's item list is Zod-validated, then the trusted inventory tool matches exact product names and reads current stock/prices. The result is a draft with available, short and missing rows. Nothing is reserved or sold. If all vision models fail, the route returns an error and does not run the inventory tool; text and voice turns remain independent. A separate `/api/assistant/confirm-sale` request requires explicit user confirmation and runs the existing atomic `record_sale` RPC. Stock and prices are checked again in the database. Uploads are not stored by the app.

## Data and transactions

[The initial migration](../supabase/migrations/20261007000100_initial_business.sql) defines profiles, owner shops, products, stock movements, customers, ledger entries, sales, sale items, and reserved AI action records. [The hardening migration](../supabase/migrations/20261008071313_hardening_indexes.sql) restricts profile-trigger execution and adds supporting foreign-key indexes. Apply both in order on a new project. Every table has RLS. Each shop table checks ownership through `auth.uid()`. Cross-shop foreign keys bind child rows to their parent shop. The app uses a public anon/publishable key with cookie-based SSR auth. No service-role key is used.

Stock adjustments, new products with opening stock, new khata opening, and sales run in Postgres functions. `open_khata_account` inserts a customer and opening `gave` entry in one owner-checked transaction. A sale locks product rows, checks stock, calculates line totals from stored prices, writes items and movements, and reduces stock in one transaction. An error rolls the whole sale back. Direct Data API writes to sales and movements are revoked, and a trigger blocks direct stock edits. Each security-definer function pins `search_path` and checks owner identity before changing data.

Measured stock and sale quantities use three decimal places in the fractional-quantity migration. The parser preserves a decimal point between digits; quantity and price unit conversions accept only compatible units and exact paise totals. Trusted inventory lookup recognizes common Devanagari and Roman product aliases. A name that matches multiple saved products fails with a request for the full name instead of selecting one silently.

### Retry safety and request limits

The `20261010090000_mutation_idempotency_and_rate_limits.sql` migration adds owner-checked RPC wrappers for stock adjustments, product/customer/supplier creation, khata entries/opening, sales, purchase-order drafts and transitions. Each request supplies a UUID `Idempotency-Key`. The key and canonical action payload are stored under `(shop_id, key)` in the same Postgres transaction as the mutation. A replay with the same operation and payload returns the stored result; reusing a key for a different operation or payload fails with a conflict. Failed writes roll back the key claim too. The ledger tables and quota counters have RLS enabled with direct access revoked; callers can use only the narrow authenticated functions.

The same migration adds an atomic Postgres-backed 60-second limiter shared by app instances. It scopes requests to the authenticated shop (or user during shop setup) and uses fixed server-side quotas for assistant turns, speech, attachments, Prisma transcription, model reasoning/vision and business actions. Missing limiter RPCs fail closed with 503; exhausted quotas return 429 and `Retry-After`. Gemini has one attempt within a 20-second request budget before OpenRouter fallback; OpenRouter may retry a transient failure within its own 20-second budget. Vision gets one bounded retry per model. Short Retry-After values are honored within the retry budget; longer waits are returned to the client. Prisma/Timbre calls have a 20-second timeout and are not automatically retried, avoiding duplicate credit use. Vision falls back across configured free models and returns a non-success response if none can read the document; text and voice requests remain available.

Migration deployment must be checked against the live `supabase_migrations.schema_migrations` history before applying. The repository's current local/live history has drift, so do not run a blanket `supabase db push` until the history is reconciled and the migration is confirmed missing.

Khata outstanding is derived from entries, never independently edited: `gave` adds to what a customer owes the shop, `received` subtracts. UI calculations use paise to avoid decimal drift; the database stores INR `numeric(12,2)`. The overview reads today's sales using Asia/Kolkata day bounds, low stock from product thresholds, and khata outstanding from ledger entries.

## Demo data and offline tests

`bootstrap_demo_shop()` creates one synthetic private shop after sign-in. It inserts eight products, four fictional customers, ledger history, and four sales through the same trusted stock/sale functions. Calling it again for the same owner returns the existing shop. `reset_demo_shop()` is an explicit, owner-scoped transaction that deletes only that owner's named demo shop and recreates its sample records; a failed reseed rolls back the deletion. It does not silently alter existing shops when the migration is applied. No real phone numbers or personal data are included.

The default test suite has no network dependency. It tests Zod boundaries, tool confirmation behavior, money calculations, official Gnani request shapes with a fake transport, and runs the SQL migrations in embedded PostgreSQL to verify seeding, reset, ownership, direct-write restrictions, stock changes, and failed-sale rollback. Hosted Supabase and a private Gnani key are needed for live reset and voice QA.

## Suppliers and purchase orders

`suppliers`, `purchase_orders`, and `purchase_order_items` use the same owner RLS and composite shop foreign keys as the original business tables. Direct order/item writes are revoked. `create_purchase_order` validates a supplier, products, bounded quantities and costs in one transaction. `transition_purchase_order` locks the order row; only a placed order can be received. Receipt calls trusted stock adjustment for every line and changes status in the same transaction, preventing partial or repeated receipt. A placed status is an internal record, not a message to a supplier.

Assistant contracts add `supplier.list`, `supplier.create`, `orders.getOpen`, `orders.createDraft`, and `inventory.getReorderSuggestions`. Model arguments still cross Zod and the authenticated repository. Reorder quantities target twice the low-stock threshold with at least one unit, remain suggestions, and never create an order automatically. Only the explicit Orders UI can place, cancel or receive a saved order.

Inventory and customer filters derive from the fetched shop data without requests on every keystroke. Independent overview queries run concurrently; React request caching keeps the shared shop/session lookup deduplicated. Order lines are queried only for the latest 30 orders (at most 900 lines), avoiding a partial global list that could understate totals. Archived product names remain available in order history.

## Customer feedback

The sale-linked review migration adds owner-readable `customer_reviews` and private `review_invites` tables. A receipt can issue a random 256-bit token whose hash is stored in Postgres. The link expires after 30 days and can submit once. Narrow security-definer functions check that the signed-in owner owns the sale before issuing a link, expose only shop name and sale date to a holder of a valid token, and atomically insert a response while consuming that token. Direct anonymous table reads and writes are revoked. The response is private to the shop; possession of a link is not proof of customer identity. The WhatsApp action opens a draft and does not attest to message delivery.

## Layout

- `src/lib/supabase`: public configuration and separate browser/server clients.
- `src/proxy.ts`: refreshes cookie sessions for protected routes.
- `src/server/data`: authenticated shop context, reads, and Supabase tool adapter.
- `src/server/tools`: validated trusted business operations.
- `src/lib/business`: action/row schemas, money and ledger calculations.
- `src/app/app` and `src/components/business`: responsive merchant workspace.
- `supabase/migrations`: versioned schema and database functions.

Mock-first development protects Gnani programme credits while isolating UI and business rules from model and API failures. Live Gnani voice use is explicitly opt-in and keeps its key server-side.
