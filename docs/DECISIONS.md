# Decisions log

Decisions that affect money, security or data structure. Newest last.
A later entry overrides an earlier one.

## 2026-09-24: Initial answers

| #   | Topic             | Decision                                                                                                                                                                                                                                             |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admins            | No self sign-up path to admin. The first admin is created by script (`npm run make-admin -- email`). The last admin can never be removed.                                                                                                            |
| 2   | Recipients        | Recipients do not get accounts. Their name, phone and address live in `recipients`; they reach tracking through a secret link.                                                                                                                       |
| 3   | Sign-in           | Email + password and email magic link. Google is optional behind `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED`. Phone OTP login is deferred (needs a paid SMS provider). Magic links only log in existing accounts, so sign-up always collects name and country. |
| 4   | Vendors           | A vendor is a business owned by one account (`vendors.owner_id` is unique). Staff logins come later.                                                                                                                                                 |
| 5   | Money             | Every amount is `<name>_minor bigint` plus `currency char(3)` referencing `currencies(code)`. No floats anywhere (a schema test enforces this).                                                                                                      |
| 6   | Database workflow | Schema changes are SQL files in `supabase/migrations`, applied with the Supabase CLI.                                                                                                                                                                |
| 7   | Name              | The app is called Mapk (`APP_NAME` in `lib/config/app.ts`).                                                                                                                                                                                          |

## 2026-09-25: Batch 1 spec

| #   | Topic               | Decision                                                                                                                                                                                                                                                                                                                |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | Roles               | **One role per user** in `profiles.role` (buyer, vendor, admin). Replaces the earlier multi-role table. Every signed-in account can use buyer features; the role only adds access. Nobody changes their own role (admins included); only admins change other people's roles. Enforced by a trigger.                     |
| 9   | Fee rules           | `fee_rules.value` is split: `amount_minor bigint` for `flat` and `per_kg`, `percent numeric(7,4)` for `percent` (5.5 = 5.5%). A check constraint requires exactly the right one.                                                                                                                                        |
| 10  | Buyer order writes  | Buyers create orders only as `draft` or `quote_requested` and edit only drafts. They never change status after that, nor `vendor_id`, `delivery_code_hash`, `link_preview_json` or `public_tracking_token`. Later status changes go through server code. Buyers cannot write order items; prices come from server code. |
| 11  | Vendor order writes | Vendors read their assigned orders only. Actions (accept, purchased, inspection upload) arrive in Batch 6 as server functions that check the current status. Vendors cannot change their own `status`, `owner_id` or `verification_notes`.                                                                              |
| 12  | Vendor approval     | `approve_vendor()` sets the vendor to approved and the owner's role to vendor in one transaction; `suspend_vendor()` reverses it. Both admin-only and logged.                                                                                                                                                           |
| 13  | Public vendor data  | The public reads `vendor_directory` (id, business name, country of approved vendors). The `vendors` table, which holds payout details, is owner and admin only.                                                                                                                                                         |
| 14  | Ledger              | Append-only for everyone, service role included. Amounts are always positive; `entry_type` gives the direction. Corrections are new `adjustment` rows.                                                                                                                                                                  |
| 15  | Server-only tables  | Clients cannot insert into `ledger_entries`, `audit_log`, `payments` or `notifications` (no grants). Only server code with the service role key writes them.                                                                                                                                                            |
| 16  | Reference data      | Currencies, countries, corridors and placeholder fee rules live in `supabase/seed.sql` (idempotent). Hosted projects need `db push --include-seed` once.                                                                                                                                                                |
| 17  | Countries           | Kept a `countries` table (not in the original list) for country code integrity and the sign-up picker.                                                                                                                                                                                                                  |

Other choices:

- Role and vendor status are read from the database on each request, not stored in the JWT. A change takes effect on the next page load.
- Blocked users are sent to `/unauthorized`; logged-out users to `/login?next=...`.
- Phone numbers are stored in E.164 format (`+2348031234567`).
- Email confirmation is on. Passwords need 8+ characters with a letter and a number.
