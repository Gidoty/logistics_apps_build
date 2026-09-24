-- Batch 1: complete platform schema (tables, enums, constraints, indexes).
-- Security (RLS, grants, guard triggers, helper functions) is in the next migration.
--
-- Conventions
-- * Every table: id uuid primary key, created_at, updated_at (kept by trigger).
-- * Money: <name>_minor bigint (smallest unit, e.g. kobo) + a char(3) currency
--   that references currencies(code). Never numeric or float for money.
-- * Rates that are not money (FX rates, fee percentages) use numeric.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('buyer', 'vendor', 'admin');

create type public.vendor_status as enum ('pending', 'approved', 'suspended');

create type public.order_type as enum ('catalog', 'link');

create type public.order_status as enum (
  'draft',
  'quote_requested',
  'quoted',
  'quote_expired',
  'awaiting_payment',
  'paid',
  'purchased',
  'inspection_pending',
  'inspection_approved',
  'shipped',
  'in_transit',
  'arrived_destination',
  'customs_cleared',
  'out_for_delivery',
  'delivered',
  'disputed',
  'refunded',
  'cancelled'
);

create type public.ledger_entry_type as enum (
  'payment_received',
  'held',
  'released_to_vendor',
  'refunded_to_buyer',
  'platform_fee',
  'adjustment'
);

create type public.dispute_status as enum (
  'open',
  'under_review',
  'resolved_buyer',
  'resolved_vendor',
  'closed'
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.currencies (
  id                 uuid        primary key default gen_random_uuid(),
  code               char(3)     not null unique check (code ~ '^[A-Z]{3}$'),
  name               text        not null check (char_length(name) between 1 and 80),
  symbol             text        not null check (char_length(symbol) between 1 and 8),
  minor_unit_digits  int         not null check (minor_unit_digits between 0 and 4),
  active             boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Not in the original table list: gives country codes a real list to check
-- against and feeds the sign-up country picker.
create table public.countries (
  id             uuid        primary key default gen_random_uuid(),
  code           char(2)     not null unique check (code ~ '^[A-Z]{2}$'),
  name           text        not null check (char_length(name) between 1 and 80),
  currency_code  char(3)     not null references public.currencies (code),
  phone_prefix   text        not null check (phone_prefix ~ '^\+[0-9]{1,4}$'),
  active         boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index countries_currency_code_idx on public.countries (currency_code);

-- One row per fetched or overridden rate: 1 base_currency = rate quote_currency.
create table public.fx_rates (
  id              uuid          primary key default gen_random_uuid(),
  base_currency   char(3)       not null references public.currencies (code),
  quote_currency  char(3)       not null references public.currencies (code),
  rate            numeric(18,8) not null check (rate > 0),
  source          text          not null check (char_length(source) between 1 and 80),
  is_override     boolean       not null default false,
  fetched_at      timestamptz   not null default now(),
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  constraint fx_rates_distinct_pair check (base_currency <> quote_currency)
);

create index fx_rates_base_currency_idx on public.fx_rates (base_currency);
create index fx_rates_quote_currency_idx on public.fx_rates (quote_currency);
create index fx_rates_latest_idx on public.fx_rates (base_currency, quote_currency, fetched_at desc);

create table public.corridors (
  id                        uuid        primary key default gen_random_uuid(),
  origin_country            char(2)     not null references public.countries (code),
  destination_country       char(2)     not null references public.countries (code),
  name                      text        not null check (char_length(name) between 1 and 120),
  active                    boolean     not null default false,
  default_transit_days_min  int         check (default_transit_days_min >= 0),
  default_transit_days_max  int         check (default_transit_days_max >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint corridors_route_unique unique (origin_country, destination_country),
  constraint corridors_transit_days_order check (
    default_transit_days_min is null
    or default_transit_days_max is null
    or default_transit_days_min <= default_transit_days_max
  )
);

create index corridors_origin_country_idx on public.corridors (origin_country);
create index corridors_destination_country_idx on public.corridors (destination_country);

-- Admin-configurable fees. Rates are never hardcoded in application code.
-- flat:    amount_minor is the fee, in currency.
-- per_kg:  amount_minor is the fee per kilogram, in currency.
-- percent: percent is the rate (5.5 = 5.5%). amount_minor must be null.
-- min_amount_minor (optional) is a floor for the computed fee, in currency.
create table public.fee_rules (
  id                uuid         primary key default gen_random_uuid(),
  corridor_id       uuid         not null references public.corridors (id) on delete cascade,
  fee_type          text         not null check (fee_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  calc_method       text         not null check (calc_method in ('flat', 'percent', 'per_kg')),
  amount_minor      bigint       check (amount_minor >= 0),
  percent           numeric(7,4) check (percent >= 0 and percent <= 100),
  currency          char(3)      not null references public.currencies (code),
  min_amount_minor  bigint       check (min_amount_minor >= 0),
  active            boolean      not null default true,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  constraint fee_rules_value_matches_method check (
    (calc_method in ('flat', 'per_kg') and amount_minor is not null and percent is null)
    or (calc_method = 'percent' and percent is not null and amount_minor is null)
  )
);

create index fee_rules_corridor_id_idx on public.fee_rules (corridor_id);
create index fee_rules_currency_idx on public.fee_rules (currency);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- id is the auth user id. email is a read-only copy of auth.users.email.
create table public.profiles (
  id                  uuid             primary key references auth.users (id) on delete cascade,
  full_name           text             not null default '' check (char_length(full_name) <= 120),
  email               text,
  phone               text             check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  country_code        char(2)          references public.countries (code),
  role                public.user_role not null default 'buyer',
  preferred_currency  char(3)          not null default 'NGN' references public.currencies (code),
  created_at          timestamptz      not null default now(),
  updated_at          timestamptz      not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (role);
create index profiles_country_code_idx on public.profiles (country_code);
create index profiles_preferred_currency_idx on public.profiles (preferred_currency);

-- One vendor business per owner account.
create table public.vendors (
  id                    uuid                 primary key default gen_random_uuid(),
  owner_id              uuid                 not null unique references public.profiles (id),
  business_name         text                 not null check (char_length(business_name) between 2 and 120),
  country_code          char(2)              not null references public.countries (code),
  city                  text                 not null check (char_length(city) between 1 and 80),
  status                public.vendor_status not null default 'pending',
  verification_notes    text                 check (char_length(verification_notes) <= 2000),
  payout_details_json   jsonb                not null default '{}'::jsonb,
  created_at            timestamptz          not null default now(),
  updated_at            timestamptz          not null default now()
);

create index vendors_country_code_idx on public.vendors (country_code);
create index vendors_status_idx on public.vendors (status);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.products (
  id            uuid        primary key default gen_random_uuid(),
  vendor_id     uuid        not null references public.vendors (id),
  title         text        not null check (char_length(title) between 2 and 200),
  description   text        not null default '' check (char_length(description) <= 10000),
  category      text        not null check (char_length(category) between 1 and 80),
  brand         text        check (char_length(brand) <= 80),
  condition     text        not null default 'new' check (condition in ('new', 'used', 'refurbished')),
  price_minor   bigint      not null check (price_minor >= 0),
  currency      char(3)     not null references public.currencies (code),
  stock         int         not null default 0 check (stock >= 0),
  weight_grams  int         check (weight_grams > 0),
  active        boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index products_vendor_id_idx on public.products (vendor_id);
create index products_currency_idx on public.products (currency);
create index products_active_category_idx on public.products (active, category);

create table public.product_images (
  id            uuid        primary key default gen_random_uuid(),
  product_id    uuid        not null references public.products (id) on delete cascade,
  storage_path  text        not null check (char_length(storage_path) between 1 and 500),
  sort_order    int         not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images (product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- The person receiving goods. Not a user account.
create table public.recipients (
  id             uuid        primary key default gen_random_uuid(),
  created_by     uuid        not null default auth.uid() references public.profiles (id),
  full_name      text        not null check (char_length(full_name) between 2 and 120),
  phone          text        not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email          text        check (char_length(email) <= 254),
  address_line   text        not null check (char_length(address_line) between 3 and 300),
  city           text        not null check (char_length(city) between 1 and 80),
  state          text        not null check (char_length(state) between 1 and 80),
  country_code   char(2)     not null default 'NG' references public.countries (code),
  landmark       text        check (char_length(landmark) <= 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index recipients_created_by_idx on public.recipients (created_by);
create index recipients_country_code_idx on public.recipients (country_code);

-- recipient_id, corridor_id and vendor_id may be empty while the order is a
-- draft or waiting for a quote. Later batches require them before payment.
create table public.orders (
  id                     uuid                primary key default gen_random_uuid(),
  buyer_id               uuid                not null default auth.uid() references public.profiles (id),
  recipient_id           uuid                references public.recipients (id),
  corridor_id            uuid                references public.corridors (id),
  vendor_id              uuid                references public.vendors (id),
  order_type             public.order_type   not null,
  status                 public.order_status not null default 'draft',
  source_url             text                check (source_url ~ '^https?://' and char_length(source_url) <= 2048),
  link_preview_json      jsonb,
  buyer_currency         char(3)             not null references public.currencies (code),
  delivery_code_hash     text,
  -- 32 hex characters (122 random bits). Used in public tracking links.
  public_tracking_token  text                not null unique
                           default replace(gen_random_uuid()::text, '-', ''),
  created_at             timestamptz         not null default now(),
  updated_at             timestamptz         not null default now(),
  constraint orders_link_needs_url check (order_type <> 'link' or source_url is not null)
);

create index orders_buyer_id_idx on public.orders (buyer_id);
create index orders_recipient_id_idx on public.orders (recipient_id);
create index orders_corridor_id_idx on public.orders (corridor_id);
create index orders_vendor_id_idx on public.orders (vendor_id);
create index orders_buyer_currency_idx on public.orders (buyer_currency);
create index orders_status_idx on public.orders (status);
-- public_tracking_token already has a unique index; this one is named for clarity.
create index orders_public_tracking_token_idx on public.orders (public_tracking_token);

create table public.order_items (
  id                uuid        primary key default gen_random_uuid(),
  order_id          uuid        not null references public.orders (id) on delete cascade,
  product_id        uuid        references public.products (id),
  description       text        not null check (char_length(description) between 1 and 500),
  quantity          int         not null check (quantity > 0),
  unit_price_minor  bigint      not null check (unit_price_minor >= 0),
  currency          char(3)     not null references public.currencies (code),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);
create index order_items_currency_idx on public.order_items (currency);

create table public.quotes (
  id            uuid          primary key default gen_random_uuid(),
  order_id      uuid          not null references public.orders (id),
  prepared_by   uuid          not null references public.profiles (id),
  total_minor   bigint        not null check (total_minor >= 0),
  currency      char(3)       not null references public.currencies (code),
  fx_rate_used  numeric(18,8) check (fx_rate_used > 0),
  expires_at    timestamptz   not null,
  accepted_at   timestamptz,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create index quotes_order_id_idx on public.quotes (order_id);
create index quotes_prepared_by_idx on public.quotes (prepared_by);
create index quotes_currency_idx on public.quotes (currency);

create table public.quote_lines (
  id            uuid        primary key default gen_random_uuid(),
  quote_id      uuid        not null references public.quotes (id) on delete cascade,
  line_type     text        not null check (line_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  label         text        not null check (char_length(label) between 1 and 200),
  amount_minor  bigint      not null check (amount_minor >= 0),
  currency      char(3)     not null references public.currencies (code),
  sort_order    int         not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index quote_lines_quote_id_idx on public.quote_lines (quote_id, sort_order);
create index quote_lines_currency_idx on public.quote_lines (currency);

-- ---------------------------------------------------------------------------
-- Logistics
-- ---------------------------------------------------------------------------

create table public.shipments (
  id                   uuid        primary key default gen_random_uuid(),
  logistics_partner    text        not null check (char_length(logistics_partner) between 1 and 80),
  adapter              text        not null default 'manual' check (adapter ~ '^[a-z][a-z0-9_]{1,39}$'),
  tracking_number      text        check (char_length(tracking_number) <= 120),
  status               text        not null default 'pending' check (char_length(status) between 1 and 40),
  origin_country       char(2)     not null references public.countries (code),
  destination_country  char(2)     not null references public.countries (code),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index shipments_origin_country_idx on public.shipments (origin_country);
create index shipments_destination_country_idx on public.shipments (destination_country);

-- Many orders can share one shipment (consolidation).
create table public.shipment_orders (
  id           uuid        primary key default gen_random_uuid(),
  shipment_id  uuid        not null references public.shipments (id) on delete cascade,
  order_id     uuid        not null references public.orders (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shipment_orders_unique unique (shipment_id, order_id)
);

create index shipment_orders_shipment_id_idx on public.shipment_orders (shipment_id);
create index shipment_orders_order_id_idx on public.shipment_orders (order_id);

create table public.shipment_events (
  id           uuid        primary key default gen_random_uuid(),
  shipment_id  uuid        not null references public.shipments (id) on delete cascade,
  status       text        not null check (char_length(status) between 1 and 40),
  note         text        check (char_length(note) <= 2000),
  location     text        check (char_length(location) <= 200),
  occurred_at  timestamptz not null default now(),
  created_by   uuid        references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index shipment_events_shipment_id_idx on public.shipment_events (shipment_id, occurred_at);
create index shipment_events_created_by_idx on public.shipment_events (created_by);

-- ---------------------------------------------------------------------------
-- Inspection
-- ---------------------------------------------------------------------------

create table public.inspections (
  id              uuid        primary key default gen_random_uuid(),
  order_id        uuid        not null references public.orders (id),
  submitted_by    uuid        not null references public.profiles (id),
  notes           text        check (char_length(notes) <= 5000),
  serial_or_imei  text        check (char_length(serial_or_imei) <= 100),
  buyer_decision  text        check (buyer_decision in ('approved', 'disputed')),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inspections_decision_time check ((buyer_decision is null) = (decided_at is null))
);

create index inspections_order_id_idx on public.inspections (order_id);
create index inspections_submitted_by_idx on public.inspections (submitted_by);

create table public.inspection_media (
  id             uuid        primary key default gen_random_uuid(),
  inspection_id  uuid        not null references public.inspections (id) on delete cascade,
  storage_path   text        not null check (char_length(storage_path) between 1 and 500),
  media_type     text        not null check (media_type in ('image', 'video')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index inspection_media_inspection_id_idx on public.inspection_media (inspection_id);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

create table public.payments (
  id                  uuid        primary key default gen_random_uuid(),
  order_id            uuid        not null references public.orders (id),
  provider            text        not null check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  provider_reference  text        not null unique check (char_length(provider_reference) between 1 and 200),
  amount_minor        bigint      not null check (amount_minor > 0),
  currency            char(3)     not null references public.currencies (code),
  status              text        not null check (char_length(status) between 1 and 40),
  raw_payload         jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index payments_order_id_idx on public.payments (order_id);
create index payments_currency_idx on public.payments (currency);
-- provider_reference already has a unique index; this one is named for clarity.
create index payments_provider_reference_idx on public.payments (provider_reference);

-- Append-only. Amounts are always positive; entry_type gives the direction.
create table public.ledger_entries (
  id            uuid                     primary key default gen_random_uuid(),
  order_id      uuid                     not null references public.orders (id),
  entry_type    public.ledger_entry_type not null,
  amount_minor  bigint                   not null check (amount_minor > 0),
  currency      char(3)                  not null references public.currencies (code),
  payment_id    uuid                     references public.payments (id),
  note          text                     check (char_length(note) <= 2000),
  created_by    uuid                     references public.profiles (id),
  created_at    timestamptz              not null default now(),
  updated_at    timestamptz              not null default now()
);

create index ledger_entries_order_id_idx on public.ledger_entries (order_id, created_at);
create index ledger_entries_currency_idx on public.ledger_entries (currency);
create index ledger_entries_payment_id_idx on public.ledger_entries (payment_id);
create index ledger_entries_created_by_idx on public.ledger_entries (created_by);

create table public.disputes (
  id               uuid                  primary key default gen_random_uuid(),
  order_id         uuid                  not null references public.orders (id),
  raised_by        uuid                  not null default auth.uid() references public.profiles (id),
  reason           text                  not null check (char_length(reason) between 10 and 5000),
  status           public.dispute_status not null default 'open',
  resolution_note  text                  check (char_length(resolution_note) <= 5000),
  created_at       timestamptz           not null default now(),
  updated_at       timestamptz           not null default now()
);

create index disputes_order_id_idx on public.disputes (order_id);
create index disputes_raised_by_idx on public.disputes (raised_by);
create index disputes_status_idx on public.disputes (status);

-- ---------------------------------------------------------------------------
-- Messaging and audit
-- ---------------------------------------------------------------------------

create table public.notifications (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        references public.profiles (id) on delete cascade,
  recipient_id  uuid        references public.recipients (id) on delete cascade,
  channel       text        not null check (channel in ('email', 'sms', 'in_app')),
  template      text        not null check (template ~ '^[a-z][a-z0-9_.]{1,79}$'),
  payload       jsonb       not null default '{}'::jsonb,
  sent_at       timestamptz,
  status        text        not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint notifications_has_target check (user_id is not null or recipient_id is not null)
);

create index notifications_user_id_idx on public.notifications (user_id);
create index notifications_recipient_id_idx on public.notifications (recipient_id);
create index notifications_status_idx on public.notifications (status) where status = 'queued';

-- Append-only. actor_id has no foreign key so entries survive user deletion.
create table public.audit_log (
  id           uuid        primary key default gen_random_uuid(),
  actor_id     uuid,
  action       text        not null check (action ~ '^[a-z][a-z0-9_.]{1,79}$'),
  entity_type  text        not null check (entity_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  entity_id    uuid,
  details      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers on every table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'currencies', 'countries', 'fx_rates', 'corridors', 'fee_rules', 'profiles',
    'vendors', 'products', 'product_images', 'recipients', 'orders', 'order_items',
    'quotes', 'quote_lines', 'shipments', 'shipment_orders', 'shipment_events',
    'inspections', 'inspection_media', 'payments', 'ledger_entries', 'disputes',
    'notifications', 'audit_log'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;
