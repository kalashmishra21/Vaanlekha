# Vaanlekha agent instructions

## Project identity

Vaanlekha is a voice-first AI copilot for Indian kirana stores and small retailers. It is a challenge project for the Gnani AI internship competition. The connected demo shop retains its original database name for migration compatibility.

## Git workflow

- Stay on `main`. Do not create feature branches unless the user explicitly changes this rule.
- Complete one coherent unit of work, test it, commit it, then push directly to `origin main`.
- Never rewrite published history. Do not use destructive Git commands to discard work.
- Never commit secrets, local environment files, credentials, or generated build output.

## Code quality

- Keep the folder structure clean. Do not duplicate components or files, and remove dead code.
- Prefer small reusable modules and the strict TypeScript configuration.
- Validate external and model-produced data with schemas before it reaches trusted tools.
- Keep secrets on the server. Do not put secrets in source or client-exposed environment variables.
- Do not make fake claims in the README or UI. Avoid unnecessary dependencies.

## Gnani credits

- Use the mock provider by default. Do not invoke real Prisma, Evon, Timbre, or other Gnani APIs during normal development.
- Enable real Gnani integration only when the user explicitly requests it. Never expose Gnani API keys client-side.
- A model may propose an action; only validated trusted server tools and authoritative data can confirm it succeeded.

## Design

- Read [DESIGN.md](DESIGN.md) before changing UI. It is the visual source of truth.
- Avoid generic AI SaaS visual clichés. Accessibility and responsive behavior are required.
- Future 3D must enhance product meaning and never undermine speed or readability.
- UI/UX Pro Max may be used for audits, Taste for creative guidance, and Vercel skills for React/Next.js quality when available. None overrides DESIGN.md.

## Validation before a completed push

Run `npm run lint`, `npm run typecheck`, relevant tests, and `npm run build`. Fix failures before pushing completed work.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
