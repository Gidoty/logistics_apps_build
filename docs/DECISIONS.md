# Decisions log

Decisions that affect money, security or data structure. Newest last.

## 2026-09-24: Batch 1 foundations

| # | Topic | Decision |
|---|-------|----------|
| 1 | Roles | One account can hold several roles. Stored in `user_roles` (user_id, role). Roles: `buyer`, `vendor`, `admin`. |
| 2 | Admins | No self sign-up path to admin. The first admin is created with `npm run grant-admin -- email`. After that only admins grant roles, from `/admin`. The last admin can never be removed. Every grant and revoke is written to the append-only `role_changes` table. |
| 3 | Recipients | Recipients do not get accounts. A later batch stores their name, phone and address on the order, and they open tracking through a secret link. |
| 4 | Sign-in | Email + password, email magic link, and Google (switched on with `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` once the provider is set up in Supabase). Phone OTP login is deferred because it needs a paid SMS provider. Magic links only sign in existing accounts, so sign-up always collects name and country. |
| 5 | Vendors | A vendor is a business owned by one account. Staff logins come later, via a `vendor_members` table. Built in batch 2. |
| 6 | Money | Every amount uses two columns: `<name>_minor bigint` (smallest unit) and `<name>_currency char(3)` referencing `currencies.code`. `currencies.minor_unit` stores decimal places per currency. No floats anywhere. |
| 7 | Database workflow | Schema changes are SQL files in `supabase/migrations`, applied with the Supabase CLI to local and hosted projects. Reference data (currencies, countries, launch corridors) lives in a migration so production gets it too. |
| 8 | Name | The app is called Mapk (`APP_NAME` in `src/lib/config/app.ts`). |

Other choices made in batch 1:

- Roles are read from the database on each request, not stored in the JWT. A revoked role takes effect on the next page load.
- Pages that need a role return 404 to users without it, so admin URLs are not confirmed to outsiders.
- Phone numbers are stored in E.164 format (`+2348031234567`). Local formats like `0803...` are rejected, because SMS delivery codes depend on the number being right.
- Email confirmation is on and passwords need 8+ characters with a letter and a number.
