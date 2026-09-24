# Mapk

Cross-border shopping and delivery: buy from sellers in Nigeria, China and elsewhere, pay in your own currency, deliver anywhere in Nigeria.

- Product brief: [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md)
- Decisions log: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stack

Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4 with shadcn/ui, Supabase (Postgres, Auth, RLS), Zod, Vitest, Playwright, ESLint, Prettier.

## Setup with a hosted Supabase project

1. Install: `npm install`
2. Copy env: `cp .env.example .env.local`, then fill in from Supabase Dashboard > Project Settings > API:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Apply migrations and seed data (once per project):
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push --include-seed
   ```
   The seed must run before the first sign-up (new profiles default to NGN).
   Alternative without the CLI: paste the two files in `supabase/migrations/` (in order), then `supabase/seed.sql`, into the SQL editor.
4. In the dashboard, Auth > URL Configuration: set Site URL to `http://localhost:3000` (or your deployed URL) and add `http://localhost:3000/auth/callback` to Redirect URLs.
5. Run: `npm run dev` and open http://localhost:3000.

## Setup with local Supabase (Docker)

```bash
npm install
cp .env.example .env.local
npm run db:start      # starts local Supabase, applies migrations and seed.sql
npx supabase status   # copy API URL, anon key and service_role key into .env.local
npm run dev
```

Local auth emails are caught by Mailpit at http://127.0.0.1:54324. `npm run db:reset` rebuilds the database from migrations and seed.

## Create the first admin

1. Sign up in the app and confirm your email.
2. `npm run make-admin -- you@example.com`
3. Log out and back in, then open `/admin`.

## Scripts

| Command                           | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev` / `npm run build`   | Dev server / production build                                                |
| `npm run lint` / `typecheck`      | ESLint / TypeScript                                                          |
| `npm run format` / `format:check` | Prettier write / check                                                       |
| `npm test`                        | Unit tests. DB tests are skipped unless `DATABASE_URL` is set                |
| `npm run test:db`                 | Schema and RLS tests on a throwaway Postgres (needs Postgres 15+, no Docker) |
| `npm run test:e2e`                | Playwright at 375px width (builds and starts the app)                        |
| `npm run db:start` / `db:reset`   | Start / rebuild local Supabase                                               |
| `npm run db:types`                | Regenerate `lib/supabase/database.types.ts` from local Supabase              |
| `npm run make-admin -- <email>`   | Promote an existing account to admin                                         |

DB tests against the Supabase CLI stack instead:

```bash
npm run db:reset
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run tests/db
```

Signed-in browser tests run when these are set (existing, confirmed accounts):
`E2E_BUYER_EMAIL`, `E2E_BUYER_PASSWORD`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.

## Project layout

```
app/                  routes and pages
components/ui/        shadcn/ui primitives
components/           feature components (UI only, no business logic)
lib/<domain>/         business logic: auth, profile, vendors, reference, ...
lib/supabase/         server, browser and middleware clients + database types
proxy.ts              Next.js 16 middleware: session refresh + route protection
supabase/migrations/  schema, RLS, triggers
supabase/seed.sql     currencies, countries, corridors, placeholder fee rules
scripts/              make-admin, throwaway test database
tests/unit            Vitest unit tests
tests/db              schema and RLS tests
tests/e2e             Playwright tests
```

## Access rules

| Route        | Who                                          |
| ------------ | -------------------------------------------- |
| `/account/*` | any logged-in user                           |
| `/vendor/*`  | role `vendor` with an approved vendor record |
| `/admin/*`   | role `admin`                                 |

The proxy checks first; each page checks again on the server. The database enforces the same rules with RLS, so a bug in the app cannot leak data.
