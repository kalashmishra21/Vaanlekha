# Vaanlekha

A voice-first AI copilot for Indian kirana stores and small retailers, built for the Gnani AI internship competition. Vaanlekha combines a Next.js workspace, trusted Supabase store operations, and a mock-first assistant with optional Gemini or OpenRouter reasoning.

## Current scope

The landing page, Vaani Core, and assistant work with `AI_PROVIDER=mock` and `AI_REASONER=mock` without AI service calls. With Supabase configured, a signed-in shop owner can manage inventory, khata, sales, and a database-derived overview. The assistant can add customers, open a khata with an atomic opening entry, record payments, and check a shopping list against real stock and prices. A shopping-list result is a draft; only the separate **Confirm & record sale** action can create a sale. Optional `AI_PROVIDER=gnani` adds real Prisma STT and Timbre TTS. **Evon inference is not connected.** Model output and browser code cannot write store data directly; validated server tools can, and stock adjustments require approval.

## Local setup

The merchant workspace also includes a supplier directory, internal purchase order drafts, low-stock reorder suggestions, inventory/customer search, sales filters, and recent store activity. Orders move from draft to placed to received (or cancelled). Marking an order placed does not contact the supplier. Receiving goods adds stock and movements atomically; repeated receipt is rejected. The assistant can list suppliers/open orders, suggest reorders, add suppliers, and save explicitly requested order drafts. It cannot place or receive an order by model intent.

The [supplier/order migration](supabase/migrations/20261008190000_suppliers_purchase_orders.sql) adds two synthetic suppliers to named demo shops and seeds them again after reset. The separate [order item index migration](supabase/migrations/20261008190256_purchase_order_items_shop_index.sql) covers shop-scoped reads. Apply each once, in timestamp order, for a new project; the supplier/order migration is already live in the connected Supabase project. Order history shows the latest 30 orders; sales history shows the latest 100 sales.

Requires Node.js 20.9+ and npm. Run `npm install`, then `npm run dev`. The app uses [http://localhost:3100](http://localhost:3100). Without Supabase variables, landing and mock preview work while the workspace shows a clear setup state.

For real store data:

1. Create a Supabase project. Copy its project URL and **public anon/publishable key** into a local `.env.local` using the names in [`.env.example`](.env.example). Never use a service-role key in the browser or commit credentials.
2. Run [the initial SQL migration](supabase/migrations/20261007000100_initial_business.sql), [the hardening migration](supabase/migrations/20261008071313_hardening_indexes.sql), [the demo reset migration](supabase/migrations/20261008090000_demo_shop_reset.sql), and [the assistant khata migration](supabase/migrations/20261008160000_assistant_open_khata.sql), in that order in the Supabase SQL Editor. Already applied migrations must not be rerun. These provide RLS, atomic business functions, richer demo records, an owner-scoped reset, and atomic new khata opening.
3. In Supabase Authentication URL settings, set the site URL to `http://localhost:3100` and allow `http://localhost:3100/auth/callback` as a redirect URL. Enable email/password sign-in. A hosted project may require email confirmation before first sign-in.
4. Start or restart the app, create an account or sign in at `/signin`, then choose **Create demo shop** in the workspace. The overview offers **Reset demo shop** for the signed-in owner. Reset removes that demo shop's current records and creates fresh synthetic samples atomically.

The seed contains eight products, four fictional customers, khata history, four sales, and stock movements. No real phone numbers are included. Bootstrap is idempotent; reset is explicit. No service-role key is required.

## Optional Gnani voice mode

Keep `AI_PROVIDER=mock` during normal development. To enable paid voice requests, place `AI_PROVIDER=gnani` and a private `GNANI_API_KEY` in `.env.local`, then restart the server. This key is read only by server routes. The assistant records up to 12 seconds of microphone audio, sends a short WAV to the server for [Prisma REST transcription](https://docs.gnani.ai/api/STT/speech-to-text), validates the selected intent, runs an authenticated trusted tool, then requests a spoken reply from [Timbre REST](https://docs.gnani.ai/api/TTS/tts-inference). If speech fails after a tool succeeds, the text still shows the authoritative result. Evon v3.3 is [officially documented for self-hosting](https://huggingface.co/gnani/gnani-evon-v3.3-30B-A3B); no hosted Evon URL is assumed here.

## Optional Gemini and OpenRouter reasoning

Set `AI_REASONER=gemini`, a private `GEMINI_API_KEY`, and a private `OPENROUTER_API_KEY` in `.env.local`, then restart. The pinned free-tier model is `gemini-3.5-flash-lite`. Gemini is primary for requests outside the deterministic parser; OpenRouter is a fallback for provider failures. Set `AI_REASONER=openrouter` to use only OpenRouter, or `AI_REASONER=mock` for offline reasoning. `AI_PROVIDER` independently controls voice. Model proposals are schema-validated, grounded in the current utterance, and checked against the authenticated shop before any action. Free providers can be rate limited or return no safe tool call; those cases do not mutate data. The [reasoner benchmark](docs/reasoner-benchmark.md) records model selection and limits.
Exact supported merchant commands use a deterministic fast path before a model request, so common stock, khata, sales and text-list phrases stay responsive when free providers are busy.

Shopping-list photos use a configurable free vision model through the same private server-side OpenRouter key (`OPENROUTER_VISION_MODEL`). `OPENROUTER_VISION_FALLBACK_MODELS` can list up to two other `:free` models; transient capacity errors receive a bounded retry before fallback. JPG, PNG, WebP and PDFs are accepted up to 5 MB; PDFs are limited to three pages. Text PDF extraction and scanned-page rendering run in the browser with PDF.js; images are sent to the vision provider temporarily. Vaanlekha does not store uploaded files. If every provider fails, the assistant shows an error and creates no draft or sale. Check every extracted item before confirming.

The [Phase 6 vision check](docs/vision-benchmark.md) records the synthetic comparison and why the current free model is only a best available option.

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` are the code checks. The default tests are offline; an embedded PostgreSQL test runs the SQL migration and verifies RLS, stock operations, and sale rollback without a Supabase account. A live Supabase browser flow still requires your own project configuration.

Architecture and trust rules: [docs/architecture.md](docs/architecture.md). Visual rules: [DESIGN.md](DESIGN.md).
