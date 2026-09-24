# CLAUDE.md

The full product brief lives in `docs/PROJECT_BRIEF.md`. Read it before any work.
Decisions already made are in `docs/DECISIONS.md`. Do not re-ask them.

@docs/PROJECT_BRIEF.md
@AGENTS.md

## Working rules (short version)

- Build only the current batch. List gaps at the end instead of building them.
- Money: integers in the smallest unit (kobo, cents) plus a currency code. No floats.
- Every Supabase table: RLS enabled with explicit policies and explicit grants. Add tests in `tests/db`.
- Business logic in `src/lib`. UI components stay thin.
- Zod on every input. TypeScript strict, no `any` without a comment explaining why.
- Rates, fees, duty estimates and FX overrides come from the database. Never hardcode them.
- Secrets in env vars only. Update `.env.example` when adding one.
- Vitest for pricing, fee, FX and ledger logic.
- Ask before guessing on money, security or data structure.

## Checks before committing

```bash
npm run lint && npm run typecheck && npm test && npm run test:db
```

Next.js 16 renamed middleware to `src/proxy.ts`. Request APIs (`cookies()`, `params`, `searchParams`) are async.
