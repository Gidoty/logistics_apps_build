# CLAUDE.md

The full product brief lives in `docs/PROJECT_BRIEF.md`. Read it before any work.
Decisions already made are in `docs/DECISIONS.md`. Do not re-ask them.

@docs/PROJECT_BRIEF.md
@AGENTS.md

## Working rules (short version)

- Build only the current batch. List gaps at the end instead of building them.
- Money: integers in the smallest unit (kobo, cents) plus a currency code. No floats.
- Every Supabase table: RLS enabled with explicit policies and explicit grants. `tests/db/schema.test.ts` fails if a table lacks RLS, a policy, id/created_at/updated_at, or an index on a foreign key. Add access tests in `tests/db/access.test.ts`.
- Schema changes after Batch 1 are new files in `supabase/migrations/`. Never edit a migration that may already be applied.
- Vendor payout details change only through `request_payout_change` and admin approval. Payments read `payout_details_json`, never the pending column.
- Rules that protect buyers (prohibited items, category, route, publishing) live in database triggers. App code mirrors them only to give instant feedback. Keep the two in step and test both.
- Public pages (shop, vendor pages) read through `createPublicClient()` so they show exactly what a visitor sees, even to a signed-in admin.
- Money typed by people goes through `lib/money` (strings in, integer minor units out). Never `parseFloat` a price.
- Money-moving state changes (order status, ledger, payouts) go through server code, never direct client writes.
- Order status changes only through `transition_order()` (SQL) or `transitionOrder()` (`lib/orders/state-machine.ts`). Never update `orders.status` directly. Orders are created only by SQL functions, never by direct inserts.
- Anything that fetches a URL on a visitor's behalf goes through `lib/security/safe-fetch.ts`.
- Pricing rules and duty rates are never edited: change a rate with `replace_fee_rule` / `replace_duty_rate` (admin pricing page). The engine in `lib/pricing` stays pure (no database, no clock); a loader feeds it. A quote needs its pricing snapshot, and never quote on a stale exchange rate.
- Business logic in `lib/<domain>`. Components in `components/` are UI only.
- Zod on every input. TypeScript strict, no `any` without a comment explaining why.
- Rates, fees, duty estimates and FX overrides come from the database. Never hardcode them.
- Secrets in env vars only. Update `.env.example` when adding one.
- Vitest for pricing, fee, FX and ledger logic.
- Ask before guessing on money, security or data structure.

## Checks before committing

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:db
```

Browser tests (`npm run test:e2e`) build the app and run it against a fake Supabase (`tests/e2e/mock-supabase.mjs`). They check layout at 375px, page weight on Slow 4G and the queries sent, not database results. Tests with real accounts run only when `E2E_BASE_URL` is set.

Next.js 16 renamed middleware to `proxy.ts` (root). Request APIs (`cookies()`, `params`, `searchParams`) are async.
