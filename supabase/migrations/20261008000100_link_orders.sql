-- Batch 3: link orders ("Buy it for me") and admin quoting.
--
-- Contents
--   A. Reference tables: regions (Nigerian states), store_domains
--   B. Order state machine: transitions table, guard trigger, transition_order()
--   C. Notifications: status 'pending', audience 'admins'
--   D. Orders: new columns, rate limit, creation only through create_link_order()
--   E. Quotes: versions, status, immutability, internal notes, send/accept/decline/expire
--   F. Order messages
--   G. Recipients: archive flag, Nigerian phones, valid states, address lock
--   H. Grants and RLS
--   I. pg_cron job (only when the extension is enabled)
--
-- Design rules
--   * Order status changes only through transition_order(). A trigger refuses
--     every other status change, for every role including the service role.
--   * Every multi-step action (send, accept, decline, expire) is one database
--     function, so it either completes or changes nothing.
--   * Browser sessions never write quotes, quote lines or notifications.

-- ---------------------------------------------------------------------------
-- A. Reference tables
-- ---------------------------------------------------------------------------

-- States (or regions) per country, for address dropdowns. Seeded in seed.sql.
create table public.regions (
  id            uuid        primary key default gen_random_uuid(),
  country_code  char(2)     not null references public.countries (code),
  name          text        not null check (char_length(name) between 1 and 80),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint regions_country_name_key unique (country_code, name)
);

create trigger regions_set_updated_at
  before update on public.regions
  for each row execute function public.set_updated_at();

-- Stores we know about. Rules live here, never in code: whether a store is
-- supported, which corridor it maps to, and whether we may fetch a preview.
-- A host matches a domain exactly or as a subdomain (m.aliexpress.com matches
-- aliexpress.com). Seeded in seed.sql. Admins edit it in the Supabase table
-- editor for now.
create table public.store_domains (
  id               uuid        primary key default gen_random_uuid(),
  domain           text        not null unique
                     check (domain = lower(domain)
                            and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  display_name     text        not null check (char_length(display_name) between 1 and 80),
  corridor_id      uuid        references public.corridors (id),
  preview_allowed  boolean     not null default false,
  supported        boolean     not null default true,
  notes            text        check (char_length(notes) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint store_domains_supported_needs_corridor check (not supported or corridor_id is not null)
);

create index store_domains_corridor_id_idx on public.store_domains (corridor_id);

create trigger store_domains_set_updated_at
  before update on public.store_domains
  for each row execute function public.set_updated_at();

-- The best (longest) matching store for a host, or no row. Internal: used by
-- create_link_order(). The app matches the same way in lib/orders/store-domains.ts
-- and a test compares the two.
create or replace function public.match_store_domain(_host text)
returns setof public.store_domains
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select lower(regexp_replace(btrim(coalesce(_host, '')), '\.$', '')) as v)
  select s.*
  from public.store_domains s, h
  where h.v = s.domain or right(h.v, char_length(s.domain) + 1) = '.' || s.domain
  order by char_length(s.domain) desc
  limit 1;
$$;

-- What buyers may see about stores: no admin notes.
create view public.store_directory
with (security_barrier = true)
as
  select s.id, s.domain, s.display_name, s.corridor_id, s.preview_allowed, s.supported
  from public.store_domains s;

-- ---------------------------------------------------------------------------
-- B. Order state machine
-- ---------------------------------------------------------------------------

create table public.order_status_transitions (
  id           uuid                primary key default gen_random_uuid(),
  from_status  public.order_status not null,
  to_status    public.order_status not null,
  created_at   timestamptz         not null default now(),
  updated_at   timestamptz         not null default now(),
  constraint order_status_transitions_pair_key unique (from_status, to_status),
  constraint order_status_transitions_moves check (from_status <> to_status)
);

create trigger order_status_transitions_set_updated_at
  before update on public.order_status_transitions
  for each row execute function public.set_updated_at();

-- The allowed moves. lib/orders/state-machine.ts holds the same map and a test
-- compares them. The steps after payment are provisional: later batches add to
-- them with a new migration.
insert into public.order_status_transitions (from_status, to_status) values
  ('draft', 'quote_requested'), ('draft', 'awaiting_payment'), ('draft', 'cancelled'),
  ('quote_requested', 'quoted'), ('quote_requested', 'cancelled'),
  ('quoted', 'awaiting_payment'), ('quoted', 'quote_expired'), ('quoted', 'cancelled'),
  ('quote_expired', 'quote_requested'), ('quote_expired', 'cancelled'),
  ('awaiting_payment', 'paid'), ('awaiting_payment', 'cancelled'),
  ('paid', 'purchased'), ('paid', 'refunded'),
  ('purchased', 'inspection_pending'), ('purchased', 'disputed'), ('purchased', 'refunded'),
  ('inspection_pending', 'inspection_approved'), ('inspection_pending', 'disputed'), ('inspection_pending', 'refunded'),
  ('inspection_approved', 'shipped'), ('inspection_approved', 'disputed'), ('inspection_approved', 'refunded'),
  ('shipped', 'in_transit'), ('shipped', 'disputed'),
  ('in_transit', 'arrived_destination'), ('in_transit', 'disputed'),
  ('arrived_destination', 'customs_cleared'), ('arrived_destination', 'disputed'),
  ('customs_cleared', 'out_for_delivery'), ('customs_cleared', 'disputed'),
  ('out_for_delivery', 'delivered'), ('out_for_delivery', 'disputed'),
  ('delivered', 'disputed'),
  ('disputed', 'refunded'), ('disputed', 'inspection_approved'), ('disputed', 'shipped'),
  ('disputed', 'in_transit'), ('disputed', 'arrived_destination'), ('disputed', 'customs_cleared'),
  ('disputed', 'out_for_delivery'), ('disputed', 'delivered');

-- No status change is accepted unless transition_order() set this transaction's
-- marker for this order, and the move is in the table. Applies to everyone.
create or replace function public.orders_guard_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if current_setting('mapk.transition_order', true) is distinct from new.id::text then
      raise exception 'Order status can only change through transition_order()' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.order_status_transitions t
      where t.from_status = old.status and t.to_status = new.status
    ) then
      raise exception 'An order cannot move from % to %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_guard_status
  before update on public.orders
  for each row execute function public.orders_guard_status();

-- Audit rows get the real clock time, not the transaction's start time, so
-- several entries written by one function (for example a quote sent and the
-- order status change it causes) stay in the order they happened.
alter table public.audit_log alter column created_at set default clock_timestamp();

-- The one way to change an order's status. Checks the map, updates the order
-- and writes audit_log. Not callable from browsers: server code with the
-- service role uses it (lib/orders/state-machine.ts), and the functions below
-- call it. `_actor` is used when no one is signed in (service role, cron).
create or replace function public.transition_order(
  _order_id uuid,
  _to public.order_status,
  _note text default null,
  _actor uuid default null
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  _from public.order_status;
begin
  select o.status into _from from public.orders o where o.id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.order_status_transitions t where t.from_status = _from and t.to_status = _to
  ) then
    raise exception 'An order cannot move from % to %', _from, _to using errcode = 'P0001';
  end if;

  perform set_config('mapk.transition_order', _order_id::text, true);
  update public.orders set status = _to where id = _order_id;
  perform set_config('mapk.transition_order', '', true);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    coalesce(_actor, (select auth.uid())),
    'order.status_changed', 'orders', _order_id,
    jsonb_build_object('from', _from, 'to', _to, 'note', left(nullif(btrim(_note), ''), 500))
  );

  return _to;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Notifications
-- ---------------------------------------------------------------------------

-- 'queued' becomes 'pending'. Rows can also target all admins (audience), so
-- one row serves every admin: the Batch 7 sender looks up admin emails then.
alter table public.notifications drop constraint notifications_status_check;
update public.notifications set status = 'pending' where status = 'queued';
alter table public.notifications
  add constraint notifications_status_check check (status in ('pending', 'sent', 'failed', 'cancelled')),
  alter column status set default 'pending';

alter table public.notifications add column audience text check (audience in ('admins'));
alter table public.notifications drop constraint notifications_has_target;
alter table public.notifications
  add constraint notifications_has_target check (user_id is not null or recipient_id is not null or audience is not null);

drop index public.notifications_status_idx;
create index notifications_status_idx on public.notifications (status) where status = 'pending';

-- Internal: writes one pending email notification. Not granted to anyone.
create or replace function public.queue_notification(
  _user_id uuid,
  _audience text,
  _template text,
  _payload jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, audience, channel, template, payload, status)
  values (_user_id, _audience, 'email', _template, coalesce(_payload, '{}'::jsonb), 'pending');
$$;

-- ---------------------------------------------------------------------------
-- D. Orders
-- ---------------------------------------------------------------------------

alter table public.orders
  add column quantity         int    not null default 1 check (quantity between 1 and 100),
  add column variant_notes    text   check (char_length(variant_notes) <= 500),
  add column buyer_notes      text   check (char_length(buyer_notes) <= 1000),
  add column max_budget_minor bigint check (max_budget_minor > 0 and max_budget_minor <= 1000000000000),
  add column decline_reason   text   check (decline_reason in
                                ('prohibited_item', 'out_of_stock', 'unsupported_store', 'cannot_verify_seller', 'other')),
  add column decline_note     text   check (char_length(decline_note) <= 500),
  add column store_domain_id  uuid   references public.store_domains (id),
  add column source_host      text   check (char_length(source_host) <= 253);

create index orders_store_domain_id_idx on public.orders (store_domain_id);

-- At most 10 link requests per buyer in any 24 hours (cancelled ones count).
-- A trigger, so the limit holds however an order is created.
create or replace function public.orders_link_rate_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_type = 'link' then
    -- One request at a time per buyer, so two at once cannot both slip under the limit.
    perform pg_advisory_xact_lock(hashtextextended('link-orders:' || new.buyer_id::text, 0));
    if (
      select count(*) from public.orders o
      where o.buyer_id = new.buyer_id and o.order_type = 'link' and o.created_at > now() - interval '24 hours'
    ) >= 10 then
      raise exception 'You can send up to 10 link requests in 24 hours. Please try again later.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_link_rate_limit
  before insert on public.orders
  for each row execute function public.orders_link_rate_limit();

-- Orders are created by functions only (this one for link orders), never by
-- direct inserts, and the status only moves through transition_order().
revoke insert, update on public.orders from authenticated;
drop policy orders_buyer_create on public.orders;
drop policy orders_buyer_edit_draft on public.orders;

-- Vendors have no access to link orders. Catalog orders only.
drop policy orders_vendor_read on public.orders;
create policy orders_vendor_read on public.orders
  for select to authenticated
  using (order_type = 'catalog' and vendor_id = (select public.current_vendor_id()));

-- Creates a link order, its item and the admin notification in one step.
-- Enforces the store rules and the rate limit again, whatever the app did.
create or replace function public.create_link_order(
  _source_url text,
  _quantity int,
  _variant_notes text,
  _buyer_notes text,
  _max_budget_minor bigint,
  _recipient_id uuid,
  _buyer_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _buyer     uuid := (select auth.uid());
  _host      text;
  _store     public.store_domains;
  _order_id  uuid;
begin
  if _buyer is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = _buyer) then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if _source_url is null or char_length(_source_url) > 2048 then
    raise exception 'Enter the full link to the product' using errcode = 'P0001';
  end if;
  _host := lower(substring(_source_url from '^https://([^/?#@:\s]+)(?::443)?(?:[/?#]|$)'));
  if _host is null then
    raise exception 'Enter a full https link to the product' using errcode = 'P0001';
  end if;
  _host := regexp_replace(_host, '\.$', '');
  -- A real host name, never an IP address.
  if position('.' in _host) = 0 or _host ~ '^[0-9.]+$' then
    raise exception 'Use the link from the store''s website' using errcode = 'P0001';
  end if;

  select * into _store from public.match_store_domain(_host);
  if found and not _store.supported then
    raise exception 'We cannot buy from % yet. Please send a link from a store we support.', _store.display_name
      using errcode = 'P0001', hint = 'unsupported_store';
  end if;

  if not exists (
    select 1 from public.recipients r where r.id = _recipient_id and r.created_by = _buyer and not r.archived
  ) then
    raise exception 'Choose one of your recipients' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.currencies c where c.code = upper(_buyer_currency) and c.active) then
    raise exception 'Choose an available currency' using errcode = 'P0001';
  end if;

  insert into public.orders (
    buyer_id, recipient_id, corridor_id, order_type, status, source_url, buyer_currency,
    quantity, variant_notes, buyer_notes, max_budget_minor, store_domain_id, source_host
  ) values (
    _buyer, _recipient_id, _store.corridor_id, 'link', 'quote_requested', _source_url, upper(_buyer_currency),
    _quantity, nullif(btrim(_variant_notes), ''), nullif(btrim(_buyer_notes), ''), _max_budget_minor,
    _store.id, _host
  ) returning id into _order_id;

  insert into public.order_items (order_id, description, quantity, unit_price_minor, currency)
  values (_order_id, left('Item from ' || coalesce(_store.display_name, _host), 500), _quantity, 0, upper(_buyer_currency));

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_buyer, 'order.created', 'orders', _order_id,
          jsonb_build_object('type', 'link', 'host', _host, 'known_store', _store.id is not null));

  perform public.queue_notification(null, 'admins', 'quote_requested',
    jsonb_build_object('order_id', _order_id, 'unknown_store', _store.id is null));

  return _order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Quotes
-- ---------------------------------------------------------------------------

create type public.quote_status as enum ('sent', 'accepted', 'declined_by_buyer', 'expired', 'superseded');

alter table public.quotes
  add column version                int                 not null default 1 check (version >= 1),
  add column status                 public.quote_status not null default 'sent',
  add column weight_estimate_grams  int                 check (weight_estimate_grams > 0 and weight_estimate_grams <= 500000);
alter table public.quotes alter column version drop default;

alter table public.quotes add constraint quotes_order_version_key unique (order_id, version);
-- Only one quote per order can be waiting for the buyer.
create unique index quotes_one_sent_per_order on public.quotes (order_id) where status = 'sent';

alter table public.quote_lines
  add constraint quote_lines_type_allowed check (
    line_type in ('item_price', 'service_fee', 'international_freight', 'customs_estimate', 'last_mile_delivery', 'other')
  );

-- Admin-only notes. A table of its own, so buyers can read quotes freely
-- while these stay hidden by row security.
create table public.quote_internal_notes (
  id          uuid        primary key default gen_random_uuid(),
  quote_id    uuid        not null unique references public.quotes (id) on delete cascade,
  notes       text        not null check (char_length(notes) between 1 and 2000),
  created_by  uuid        references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index quote_internal_notes_created_by_idx on public.quote_internal_notes (created_by);

create trigger quote_internal_notes_set_updated_at
  before update on public.quote_internal_notes
  for each row execute function public.set_updated_at();

-- A sent quote cannot change: not its total, currency, expiry or weight, and
-- never its lines. Only its status moves: sent -> accepted, declined_by_buyer,
-- expired or superseded. Applies to every role.
create or replace function public.quotes_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_id <> old.order_id
     or new.version <> old.version
     or new.prepared_by <> old.prepared_by
     or new.total_minor <> old.total_minor
     or new.currency <> old.currency
     or new.fx_rate_used is distinct from old.fx_rate_used
     or new.expires_at <> old.expires_at
     or new.weight_estimate_grams is distinct from old.weight_estimate_grams
     or new.created_at <> old.created_at then
    raise exception 'A sent quote cannot be changed. Send a new version instead.' using errcode = 'P0001';
  end if;

  if new.status <> old.status
     and not (old.status = 'sent' and new.status in ('accepted', 'declined_by_buyer', 'expired', 'superseded')) then
    raise exception 'A quote cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;

  if new.accepted_at is distinct from old.accepted_at
     and not (old.accepted_at is null and new.status = 'accepted') then
    raise exception 'A sent quote cannot be changed. Send a new version instead.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger quotes_guard_update
  before update on public.quotes
  for each row execute function public.quotes_guard_update();

create or replace function public.block_quote_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% cannot be changed or deleted. Send a new quote version instead.', tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger quotes_no_delete
  before delete on public.quotes
  for each row execute function public.block_quote_history_change();
create trigger quote_lines_immutable
  before update or delete on public.quote_lines
  for each row execute function public.block_quote_history_change();

-- Expires the order's waiting quote when its time has passed, and moves the
-- order to quote_expired. Returns true when it did. Locks the order first,
-- always, so it cannot race with accept or revise. Internal.
create or replace function public._expire_order_quote(_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order  public.orders;
  _quote  public.quotes;
begin
  select * into _order from public.orders where id = _order_id for update;
  if not found then return false; end if;

  select * into _quote from public.quotes
   where order_id = _order_id and status = 'sent' for update;
  if not found or _quote.expires_at > now() then return false; end if;

  update public.quotes set status = 'expired' where id = _quote.id;
  if _order.status = 'quoted' then
    perform public.transition_order(_order_id, 'quote_expired', 'The quote expired', null);
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (null, 'quote.expired', 'quotes', _quote.id,
          jsonb_build_object('order_id', _order_id, 'version', _quote.version));
  perform public.queue_notification(_order.buyer_id, null, 'quote_expired',
    jsonb_build_object('order_id', _order_id, 'quote_id', _quote.id));
  return true;
end;
$$;

-- Called when someone opens an order: applies expiry if it is due.
create or replace function public.expire_quote_if_due(_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orders o
    where o.id = _order_id and (o.buyer_id = (select auth.uid()) or (select public.is_admin()))
  ) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  return public._expire_order_quote(_order_id);
end;
$$;

-- For pg_cron: expires every quote that is due. Returns how many.
create or replace function public.expire_due_quotes()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row  record;
  _n    int := 0;
begin
  for _row in
    select distinct q.order_id from public.quotes q
    where q.status = 'sent' and q.expires_at <= now()
    limit 500
  loop
    if public._expire_order_quote(_row.order_id) then _n := _n + 1; end if;
  end loop;
  return _n;
end;
$$;

-- Admin: send a quote for a link order, or revise one (a new version that
-- supersedes the old). The total is always the sum of the lines, worked out
-- here: there is no way to pass one in.
-- _lines: [{"type": "item_price", "label": "...", "amount_minor": 12345}, ...]
-- Amounts are in the order's currency.
-- TODO Batch 4: the pricing engine replaces manual line entry.
create or replace function public.send_quote(
  _order_id uuid,
  _lines jsonb,
  _expires_in_hours int,
  _weight_grams int default null,
  _internal_notes text default null,
  _corridor_id uuid default null,
  _confirm_over_budget boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin      uuid := (select auth.uid());
  _order      public.orders;
  _line       jsonb;
  _type       text;
  _label      text;
  _amount     numeric;
  _total      numeric := 0;
  _has_item   boolean := false;
  _count      int;
  _previous   public.quotes;
  _version    int;
  _quote_id   uuid;
  _was_revision boolean;
  _i          int;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can send quotes' using errcode = '42501';
  end if;

  select * into _order from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.order_type <> 'link' or _order.status not in ('quote_requested', 'quoted') then
    raise exception 'This order is not waiting for a quote' using errcode = 'P0001';
  end if;

  if _expires_in_hours is null or _expires_in_hours not in (24, 48, 72) then
    raise exception 'A quote can expire after 24, 48 or 72 hours' using errcode = '22023';
  end if;
  if _weight_grams is not null and (_weight_grams < 1 or _weight_grams > 500000) then
    raise exception 'The weight estimate must be between 1 and 500000 grams' using errcode = '22023';
  end if;

  -- Unknown store: admin chooses the corridor before the first quote.
  if _order.corridor_id is null then
    if _corridor_id is null or not exists (select 1 from public.corridors c where c.id = _corridor_id and c.active) then
      raise exception 'Choose the shipping route for this store before sending a quote' using errcode = 'P0001';
    end if;
    update public.orders set corridor_id = _corridor_id where id = _order_id;
  end if;

  if _lines is null or jsonb_typeof(_lines) <> 'array' then
    raise exception 'A quote needs line items' using errcode = '22023';
  end if;
  _count := jsonb_array_length(_lines);
  if _count < 1 or _count > 20 then
    raise exception 'A quote needs between 1 and 20 line items' using errcode = '22023';
  end if;

  for _i in 0 .. _count - 1 loop
    _line := _lines -> _i;
    if jsonb_typeof(_line) <> 'object' or jsonb_typeof(_line -> 'amount_minor') is distinct from 'number' then
      raise exception 'Line % is not valid', _i + 1 using errcode = '22023';
    end if;
    _type := _line ->> 'type';
    _label := btrim(coalesce(_line ->> 'label', ''));
    _amount := (_line ->> 'amount_minor')::numeric;
    if _type is null or _type not in ('item_price', 'service_fee', 'international_freight',
                                      'customs_estimate', 'last_mile_delivery', 'other') then
      raise exception 'Line % has an unknown type', _i + 1 using errcode = '22023';
    end if;
    if char_length(_label) < 1 or char_length(_label) > 200 then
      raise exception 'Line % needs a label of up to 200 characters', _i + 1 using errcode = '22023';
    end if;
    if _amount <> trunc(_amount) or _amount < 0 or _amount > 1000000000000 then
      raise exception 'Line % has an invalid amount', _i + 1 using errcode = '22023';
    end if;
    _total := _total + _amount;
    if _type = 'item_price' and _amount > 0 then _has_item := true; end if;
  end loop;

  if not _has_item then
    raise exception 'A quote needs an item price line above zero' using errcode = '22023';
  end if;
  if _total > 1000000000000 then
    raise exception 'The total is too large' using errcode = '22023';
  end if;

  if _order.max_budget_minor is not null and _total > _order.max_budget_minor and not coalesce(_confirm_over_budget, false) then
    raise exception 'The total is over the buyer''s budget. Confirm to send it anyway.'
      using errcode = 'P0001', hint = 'over_budget';
  end if;

  -- Supersede the waiting version first (only one quote may be 'sent').
  select * into _previous from public.quotes where order_id = _order_id and status = 'sent' for update;
  _was_revision := found;
  if _was_revision then
    update public.quotes set status = 'superseded' where id = _previous.id;
  end if;
  select coalesce(max(q.version), 0) + 1 into _version from public.quotes q where q.order_id = _order_id;

  insert into public.quotes (order_id, prepared_by, total_minor, currency, expires_at, version, status, weight_estimate_grams)
  values (_order_id, _admin, _total::bigint, _order.buyer_currency,
          now() + make_interval(hours => _expires_in_hours), _version, 'sent', _weight_grams)
  returning id into _quote_id;

  for _i in 0 .. _count - 1 loop
    _line := _lines -> _i;
    insert into public.quote_lines (quote_id, line_type, label, amount_minor, currency, sort_order)
    values (_quote_id, _line ->> 'type', btrim(_line ->> 'label'), (_line ->> 'amount_minor')::bigint,
            _order.buyer_currency, _i);
  end loop;

  if nullif(btrim(_internal_notes), '') is not null then
    insert into public.quote_internal_notes (quote_id, notes, created_by)
    values (_quote_id, left(btrim(_internal_notes), 2000), _admin);
  end if;

  if _order.status = 'quote_requested' then
    perform public.transition_order(_order_id, 'quoted', 'Quote sent', _admin);
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_admin, case when _was_revision then 'quote.revised' else 'quote.sent' end, 'quotes', _quote_id,
          jsonb_build_object('order_id', _order_id, 'version', _version, 'total_minor', _total::bigint,
                             'currency', _order.buyer_currency, 'lines', _count,
                             'over_budget_confirmed',
                             _order.max_budget_minor is not null and _total > _order.max_budget_minor));

  perform public.queue_notification(_order.buyer_id, null,
    case when _was_revision then 'quote_revised' else 'quote_ready' end,
    jsonb_build_object('order_id', _order_id, 'quote_id', _quote_id, 'version', _version,
                       'expires_at', now() + make_interval(hours => _expires_in_hours)));

  return _quote_id;
end;
$$;

-- Buyer: accept the waiting quote. Returns 'accepted', or 'expired' when the
-- quote ran out of time: in that case the statuses are updated and committed,
-- which is why this returns a result instead of raising an error.
create or replace function public.accept_quote(_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _buyer  uuid := (select auth.uid());
  _order  public.orders;
  _quote  public.quotes;
begin
  select * into _order from public.orders where id = _order_id and buyer_id = _buyer for update;
  if _buyer is null or not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status = 'quote_expired' then return 'expired'; end if;
  if _order.status <> 'quoted' then
    raise exception 'This quote can no longer be accepted' using errcode = 'P0001';
  end if;

  if public._expire_order_quote(_order_id) then return 'expired'; end if;

  select * into _quote from public.quotes where order_id = _order_id and status = 'sent' for update;
  if not found then
    raise exception 'There is no quote to accept' using errcode = 'P0001';
  end if;

  update public.quotes set status = 'accepted', accepted_at = now() where id = _quote.id;
  perform public.transition_order(_order_id, 'awaiting_payment', 'Quote accepted', _buyer);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_buyer, 'quote.accepted', 'quotes', _quote.id,
          jsonb_build_object('order_id', _order_id, 'version', _quote.version, 'total_minor', _quote.total_minor));
  perform public.queue_notification(null, 'admins', 'quote_accepted',
    jsonb_build_object('order_id', _order_id, 'quote_id', _quote.id));
  return 'accepted';
end;
$$;

-- Buyer: decline the waiting quote. The order is cancelled.
create or replace function public.decline_quote(_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _buyer  uuid := (select auth.uid());
  _order  public.orders;
  _quote  public.quotes;
begin
  select * into _order from public.orders where id = _order_id and buyer_id = _buyer for update;
  if _buyer is null or not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status = 'quote_expired' then return 'expired'; end if;
  if _order.status <> 'quoted' then
    raise exception 'This quote can no longer be declined' using errcode = 'P0001';
  end if;
  if public._expire_order_quote(_order_id) then return 'expired'; end if;

  select * into _quote from public.quotes where order_id = _order_id and status = 'sent' for update;
  if not found then
    raise exception 'There is no quote to decline' using errcode = 'P0001';
  end if;

  update public.quotes set status = 'declined_by_buyer' where id = _quote.id;
  perform public.transition_order(_order_id, 'cancelled', 'The buyer declined the quote', _buyer);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_buyer, 'quote.declined', 'quotes', _quote.id,
          jsonb_build_object('order_id', _order_id, 'version', _quote.version));
  perform public.queue_notification(null, 'admins', 'quote_declined_by_buyer',
    jsonb_build_object('order_id', _order_id, 'quote_id', _quote.id));
  return 'declined';
end;
$$;

-- Admin: decline a request before any quote is out. The order is cancelled and
-- the buyer sees the reason.
create or replace function public.decline_order(_order_id uuid, _reason text, _note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin  uuid := (select auth.uid());
  _order  public.orders;
  _clean  text := nullif(btrim(coalesce(_note, '')), '');
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can decline requests' using errcode = '42501';
  end if;
  if _reason is null or _reason not in ('prohibited_item', 'out_of_stock', 'unsupported_store', 'cannot_verify_seller', 'other') then
    raise exception 'Choose a reason' using errcode = '22023';
  end if;
  if _reason = 'other' and (_clean is null or char_length(_clean) < 5) then
    raise exception 'Explain the reason in at least 5 characters' using errcode = '22023';
  end if;
  if _clean is not null and char_length(_clean) > 500 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;

  select * into _order from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.order_type <> 'link' or _order.status <> 'quote_requested' then
    raise exception 'Only requests that are waiting for a quote can be declined' using errcode = 'P0001';
  end if;

  update public.orders set decline_reason = _reason, decline_note = _clean where id = _order_id;
  perform public.transition_order(_order_id, 'cancelled', 'Declined: ' || _reason, _admin);

  perform public.queue_notification(_order.buyer_id, null, 'quote_declined',
    jsonb_build_object('order_id', _order_id, 'reason', _reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Order messages
-- ---------------------------------------------------------------------------

create table public.order_messages (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references public.orders (id),
  sender_id   uuid        not null default auth.uid() references public.profiles (id),
  body        text        not null check (char_length(btrim(body)) between 1 and 1000),
  is_admin    boolean     not null default false,
  -- When the other side read it: admins read buyer messages, buyers read admin messages.
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index order_messages_order_id_idx on public.order_messages (order_id, created_at);
create index order_messages_sender_id_idx on public.order_messages (sender_id);

create trigger order_messages_set_updated_at
  before update on public.order_messages
  for each row execute function public.set_updated_at();

-- The sender and the admin flag come from the session, never from the client.
-- Buyers may send up to 20 messages per hour per order.
create or replace function public.order_messages_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_privileged_session() then
    if (select auth.uid()) is null then
      raise exception 'Sign in required' using errcode = '28000';
    end if;
    new.sender_id := (select auth.uid());
    new.is_admin := (select public.is_admin());
    new.read_at := null;
  end if;
  new.body := btrim(new.body);

  if not new.is_admin and (
    select count(*) from public.order_messages m
    where m.order_id = new.order_id and m.sender_id = new.sender_id and m.created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a little.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_messages_guard_insert
  before insert on public.order_messages
  for each row execute function public.order_messages_guard_insert();

-- Messages are never edited or deleted. Only read_at is set, by
-- mark_order_messages_read().
create or replace function public.order_messages_guard_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or new.order_id <> old.order_id or new.sender_id <> old.sender_id or new.body <> old.body
     or new.is_admin <> old.is_admin or new.created_at <> old.created_at
     or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'Messages cannot be edited or deleted' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_messages_guard_change
  before update or delete on public.order_messages
  for each row execute function public.order_messages_guard_change();

-- Each message queues a notification for the other side.
create or replace function public.order_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _buyer uuid;
begin
  select o.buyer_id into _buyer from public.orders o where o.id = new.order_id;
  if new.is_admin then
    perform public.queue_notification(_buyer, null, 'order_message_from_admin',
      jsonb_build_object('order_id', new.order_id, 'message_id', new.id));
  else
    perform public.queue_notification(null, 'admins', 'order_message_from_buyer',
      jsonb_build_object('order_id', new.order_id, 'message_id', new.id));
  end if;
  return new;
end;
$$;

create trigger order_messages_notify
  after insert on public.order_messages
  for each row execute function public.order_messages_notify();

-- Marks the other side's messages as read: buyers mark admin messages, admins
-- mark buyer messages.
create or replace function public.mark_order_messages_read(_order_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  _is_admin  boolean := (select public.is_admin());
  _n         int;
begin
  if not exists (
    select 1 from public.orders o where o.id = _order_id and (o.buyer_id = (select auth.uid()) or _is_admin)
  ) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  update public.order_messages
     set read_at = now()
   where order_id = _order_id and read_at is null and is_admin <> _is_admin;
  get diagnostics _n = row_count;
  return _n;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Recipients
-- ---------------------------------------------------------------------------

alter table public.recipients add column archived boolean not null default false;

-- Nigerian recipients: a mobile number in +234 form (070x, 080x, 081x, 090x, 091x).
-- It receives the delivery code by SMS, so landlines are refused.
alter table public.recipients
  add constraint recipients_ng_phone check (country_code <> 'NG' or phone ~ '^\+234[789][01][0-9]{8}$');

-- State must be one of the country's regions when we know them.
create or replace function public.recipients_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.state is distinct from old.state or new.country_code is distinct from old.country_code)
     and exists (select 1 from public.regions r where r.country_code = new.country_code)
     and not exists (select 1 from public.regions r where r.country_code = new.country_code and r.name = new.state) then
    raise exception 'Choose a state from the list' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger recipients_validate
  before insert or update on public.recipients
  for each row execute function public.recipients_validate();

create or replace function public.recipient_in_use(_recipient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders o where o.recipient_id = _recipient_id);
$$;

-- Once an order uses a recipient, where it delivers cannot change (a quote was
-- worked out for that place). Name, phone, landmark and the archive flag can.
create or replace function public.recipients_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_privileged_session() and not (select public.is_admin())
     and (new.state is distinct from old.state
          or new.city is distinct from old.city
          or new.address_line is distinct from old.address_line
          or new.country_code is distinct from old.country_code)
     and public.recipient_in_use(old.id) then
    raise exception 'This recipient is used in an order, so its address cannot change. Add a new recipient instead.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger recipients_guard_update
  before update on public.recipients
  for each row execute function public.recipients_guard_update();

-- ---------------------------------------------------------------------------
-- H. Grants and RLS
-- ---------------------------------------------------------------------------

revoke all on public.regions, public.store_domains, public.order_status_transitions,
              public.quote_internal_notes, public.order_messages, public.store_directory
  from anon, authenticated;

-- Quotes and their lines are written by functions only.
revoke insert, update, delete on public.quotes, public.quote_lines from authenticated;

grant select on public.regions to anon, authenticated;
grant insert, update, delete on public.regions to authenticated;
grant select, insert, update, delete on public.store_domains to authenticated;
grant select on public.store_directory to authenticated;
grant select on public.order_status_transitions to authenticated;
grant select on public.quote_internal_notes to authenticated;
grant select on public.order_messages to authenticated;
grant insert (order_id, body) on public.order_messages to authenticated;
grant all on public.regions, public.store_domains, public.order_status_transitions,
             public.quote_internal_notes, public.order_messages to service_role;
grant select on public.store_directory to service_role;

-- Functions. Internal ones have no grants at all.
revoke all on function
  public.match_store_domain(text),
  public.transition_order(uuid, public.order_status, text, uuid),
  public.queue_notification(uuid, text, text, jsonb),
  public._expire_order_quote(uuid),
  public.expire_quote_if_due(uuid),
  public.expire_due_quotes(),
  public.create_link_order(text, int, text, text, bigint, uuid, text),
  public.send_quote(uuid, jsonb, int, int, text, uuid, boolean),
  public.accept_quote(uuid),
  public.decline_quote(uuid),
  public.decline_order(uuid, text, text),
  public.mark_order_messages_read(uuid),
  public.recipient_in_use(uuid),
  public.orders_guard_status(),
  public.orders_link_rate_limit(),
  public.quotes_guard_update(),
  public.block_quote_history_change(),
  public.order_messages_guard_insert(),
  public.order_messages_guard_change(),
  public.order_messages_notify(),
  public.recipients_validate(),
  public.recipients_guard_update()
  from public, anon, authenticated;

grant execute on function
  public.expire_quote_if_due(uuid),
  public.create_link_order(text, int, text, text, bigint, uuid, text),
  public.send_quote(uuid, jsonb, int, int, text, uuid, boolean),
  public.accept_quote(uuid),
  public.decline_quote(uuid),
  public.decline_order(uuid, text, text),
  public.mark_order_messages_read(uuid)
  to authenticated, service_role;
-- Trigger functions run as the caller and need execute on themselves.
grant execute on function
  public.recipient_in_use(uuid),
  public.orders_guard_status(),
  public.orders_link_rate_limit(),
  public.quotes_guard_update(),
  public.block_quote_history_change(),
  public.order_messages_guard_insert(),
  public.order_messages_guard_change(),
  public.recipients_validate(),
  public.recipients_guard_update()
  to authenticated, service_role;
grant execute on function
  public.transition_order(uuid, public.order_status, text, uuid),
  public.expire_due_quotes()
  to service_role;

alter table public.regions                 enable row level security;
alter table public.store_domains           enable row level security;
alter table public.order_status_transitions enable row level security;
alter table public.quote_internal_notes    enable row level security;
alter table public.order_messages          enable row level security;

create policy regions_public_read on public.regions
  for select to anon, authenticated using (true);
create policy regions_admin_all on public.regions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Buyers never read this table (it has admin notes). They use store_directory.
create policy store_domains_admin_all on public.store_domains
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy order_status_transitions_read on public.order_status_transitions
  for select to authenticated using (true);

create policy quote_internal_notes_admin_read on public.quote_internal_notes
  for select to authenticated using ((select public.is_admin()));

-- Quotes: buyers see quotes on their own orders, except superseded versions, so
-- they only ever see the latest. Admins see everything. No one writes directly.
drop policy quotes_buyer_read on public.quotes;
drop policy quotes_admin_all on public.quotes;
create policy quotes_buyer_read on public.quotes
  for select to authenticated
  using (
    status <> 'superseded'
    and exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid()))
  );
create policy quotes_admin_read on public.quotes
  for select to authenticated using ((select public.is_admin()));

drop policy quote_lines_admin_all on public.quote_lines;
create policy quote_lines_admin_read on public.quote_lines
  for select to authenticated using ((select public.is_admin()));

create policy order_messages_buyer_read on public.order_messages
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())));
create policy order_messages_admin_read on public.order_messages
  for select to authenticated using ((select public.is_admin()));
create policy order_messages_buyer_insert on public.order_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and not is_admin
    and exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid()))
  );
create policy order_messages_admin_insert on public.order_messages
  for insert to authenticated with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- I. pg_cron: expire due quotes every 15 minutes
-- ---------------------------------------------------------------------------

-- Scheduled only when pg_cron is already enabled. If it is not, nothing breaks:
-- an overdue quote is also expired when someone opens or accepts it. To turn the
-- job on later, enable pg_cron and run supabase/cron.sql.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-quotes', '*/15 * * * *', 'select public.expire_due_quotes()');
  else
    raise notice 'pg_cron is not enabled: the expire-quotes job was not scheduled. See supabase/cron.sql.';
  end if;
end;
$$;
