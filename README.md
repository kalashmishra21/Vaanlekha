# Vaanlekha

**A voice-first shop workspace for Indian retailers.** Vaanlekha brings inventory, sales, customer khata, suppliers, and purchase orders together, with an assistant that understands Hindi, Hinglish, and English.

## Features

- Track stock, sales, customer balances, suppliers, and purchase orders in one private workspace.
- Ask Vaani questions or propose shop updates in everyday language. Sensitive changes require confirmation and are validated against saved records.
- Use voice input, text-to-speech, and shopping-list image or PDF extraction with optional server-side AI providers.
- Draft customer reminders and receipts for WhatsApp. Messages are not sent automatically.

## Architecture

The Next.js App Router serves the website and API routes. Supabase provides authentication, PostgreSQL, row-level security, private logo storage, and private conversation attachments. Gemini and OpenRouter provide optional reasoning and vision; Gnani provides optional speech services. Provider secrets remain server-side. See [architecture](docs/architecture.md) and [design](DESIGN.md).

Assistant attachments are readable only by their shop owner and remain stored until the conversation is deleted. Unsent uploads expire after 24 hours and are cleaned up on the owner's next conversation-history load. Deleting a conversation removes its private files before the conversation record is deleted.

## Run locally

1. Install Node.js 24.x and run `npm ci`.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and public key.
3. Apply [`supabase/migrations`](supabase/migrations) in order to a new project. Do not reapply migrations already recorded by an existing project. To allow email/password signup without SMTP, turn off **Confirm email** under Supabase Authentication → Sign In / Providers → Email. Supabase then treats every entered address as confirmed without checking ownership; use unique passwords of at least 12 characters. Password reset still requires email delivery.
4. Run `npm run dev` and open [http://localhost:3100](http://localhost:3100).

`.env.example` documents the full environment. `AI_PROVIDER=mock` and `AI_REASONER=mock` are safe defaults; configure the relevant provider and server-side key to enable live AI services. Never commit `.env.local` or expose provider keys with a `NEXT_PUBLIC_` prefix.

## Deployment

Vercel hosts the Next.js frontend, API routes, and a daily UTC Supabase activity check; Supabase remains the backend for Auth, data, and storage. Import this repository as a Next.js project, set the Vercel Node.js version to **24.x**, add the variables from `.env.example`, and set the production site URL plus `/auth/callback` in Supabase Auth’s URL settings. Set `CRON_SECRET` as a Vercel Production Secret with at least 16 random characters. Remove any unsupported `NPM_CONFIG_CACHE_DIR` variable from Vercel project or team settings; npm's supported environment key for a custom cache path is `NPM_CONFIG_CACHE`. The cron performs a read-only `HEAD` request against `public.shops` using the public anon key; existing RLS still applies, and no shop rows or business data are returned. This reduces inactivity risk but does not guarantee that a Supabase Free project will remain active. Email/password signup creates a session immediately when **Confirm email** is disabled; password reset requires email delivery.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. The tests include database migration, ownership, and business-transaction checks using local PostgreSQL emulation.

## Workspace screenshots

These Chrome screenshots use synthetic QA records. Ivory Atelier and Forest Studio are the two saved appearance themes.

| Screen | Ivory Atelier | Forest Studio |
| --- | --- | --- |
| Landing | ![Landing page in Ivory Atelier](docs/screenshots/landing-ivory.png) | ![Landing page in Forest Studio](docs/screenshots/landing-forest.png) |
| Authentication | ![Sign-in page in Ivory Atelier](docs/screenshots/authentication-ivory.png) | ![Sign-in page in Forest Studio](docs/screenshots/authentication-forest.png) |
| Dashboard | ![Shop dashboard in Ivory Atelier](docs/screenshots/dashboard-ivory.png) | ![Shop dashboard in Forest Studio](docs/screenshots/dashboard-forest.png) |
| Assistant | ![Assistant conversation in Ivory Atelier](docs/screenshots/assistant-ivory.png) | ![Assistant in Forest Studio](docs/screenshots/assistant-forest.png) |

The [assistant history](docs/screenshots/assistant-history-ivory.png), [inventory](docs/screenshots/inventory-ivory.png), [khata](docs/screenshots/khata-ivory.png), [sales](docs/screenshots/sales-ivory.png), [suppliers](docs/screenshots/suppliers-ivory.png), [orders](docs/screenshots/orders-ivory.png), [profile](docs/screenshots/profile-ivory.png), and [mobile dashboard](docs/screenshots/dashboard-mobile-ivory.png) show the remaining views.
