# Mapk

Cross-border shopping and delivery: buy from sellers in Nigeria, China and elsewhere, pay in your own currency, deliver anywhere in Nigeria.

- Product brief: [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md)
- Decisions log: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4 with shadcn/ui, Supabase (Postgres, Auth, RLS), Zod, Vitest, Playwright.

## Getting started

Requirements: Node 22+, Docker (for the local Supabase stack).

```bash
npm install
cp .env.example .env.local
npm run db:start          # starts local Supabase and applies migrations
npx supabase status       # copy API URL and publishable (anon) key into .env.local
npm run dev               # http://localhost:3000
```

Local auth emails (confirmation, magic links, password resets) are caught by Mailpit at http://127.0.0.1:54324.

### Create the first admin

1. Sign up in the app and confirm your email.
2. Put `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status`) in `.env.local`.
3. Run `npm run grant-admin -- you@example.com`.
4. Sign in again and open `/admin`.

### Hosted Supabase

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

In the Supabase dashboard, under Auth > URL Configuration, set the Site URL to your app URL and add `<app URL>/auth/callback` to Redirect URLs.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests (Vitest). DB tests are skipped unless `DATABASE_URL` is set |
| `npm run test:db` | Schema and RLS tests on a throwaway Postgres (needs Postgres 15+ binaries, no Docker) |
| `npm run test:e2e` | Playwright smoke tests (builds and starts the app) |
| `npm run db:reset` | Rebuild the local database from migrations |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` from the local database |
| `npm run grant-admin -- <email>` | Give an existing account the admin role |

To run the DB tests against the Supabase CLI stack instead:

```bash
npm run db:reset
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run tests/db
```

## Project layout

```
src/app/             routes (pages, route handlers)
src/components/ui/   shadcn/ui primitives
src/components/      feature components (thin; no business logic)
src/lib/             business logic, validation, data access
src/proxy.ts         session refresh + sign-in redirect for protected paths
supabase/migrations  SQL schema, RLS policies, reference data
tests/db             schema and RLS tests
tests/e2e            Playwright tests
scripts/             one-off admin and test scripts
```
