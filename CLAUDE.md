# CLAUDE.md

The full product brief lives in `docs/PROJECT_BRIEF.md`. Read it before any work.

@docs/PROJECT_BRIEF.md

## Working rules (short version)

- Build only the current batch. List gaps at the end instead of building them.
- Money: integers in the smallest unit (kobo, cents) plus a currency code. No floats.
- Every Supabase table: RLS enabled with explicit policies.
- Business logic in `/lib`. UI components stay thin.
- Zod on every input. TypeScript strict, no `any` without a comment explaining why.
- Rates, fees, duty estimates and FX overrides come from the database. Never hardcode them.
- Secrets in env vars only. Update `.env.example` when adding one.
- Vitest for pricing, fee, FX and ledger logic.
- Ask before guessing on money, security or data structure.
