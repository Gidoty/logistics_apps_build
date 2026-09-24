# CLAUDE.md

The full product brief lives in `docs/PROJECT_BRIEF.md`. Read it before any work.
Decisions already made are in `docs/DECISIONS.md`. Do not re-ask them.

@docs/PROJECT_BRIEF.md
@AGENTS.md

## Working rules (short version)

- Build only the current batch. List gaps at the end instead of building them.
- Money: integers in the smallest unit (kobo, cents) plus a currency code. No floats.
- Every Supabase table: RLS enabled with explicit policies and explicit grants. `tests/db/schema.test.ts` fails if a table lacks RLS, a policy, id/created_at/updated_at, or an index on a foreign key. Add access tests in `tests/db/access.test.ts`.
- Money-moving state changes (order status, ledger, payouts) go through server code, never direct client writes.
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

Next.js 16 renamed middleware to `proxy.ts` (root). Request APIs (`cookies()`, `params`, `searchParams`) are async.
