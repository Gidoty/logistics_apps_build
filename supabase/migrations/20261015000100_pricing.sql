-- Batch 4: landed-cost pricing engine and currency handling.
--
-- A. delivery_zones
-- B. duty_rates
-- C. fee_rules restructured (versioned, never edited after creation)
-- D. rule guards (immutable rows, no overlaps) and admin functions
-- E. fx_rates: spread, override end date, admin functions
-- F. dimensions on products and orders, weight needed to publish
-- G. quote line types, override and snapshot tables, send_quote with a snapshot
-- H. request throttle (for the public estimator)
-- I. privileges and row level security
--
-- Rates, fees and duty values are data, edited from /admin/pricing. The values
-- seeded in seed.sql are PLACEHOLDERS.

-- ---------------------------------------------------------------------------
-- A. Delivery zones
-- ---------------------------------------------------------------------------

create table public.delivery_zones (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique check (char_length(name) between 1 and 80),
  states      text[]      not null check (cardinality(states) >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger delivery_zones_set_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

-- States must be real regions, listed once, and in one zone only.
create or replace function public.delivery_zones_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(distinct s) from unnest(new.states) s) <> cardinality(new.states) then
    raise exception 'A state is listed twice in this zone' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(new.states) s
    where not exists (select 1 from public.regions r where r.country_code = 'NG' and r.name = s)
  ) then
    raise exception 'Zones can only contain Nigerian states from the list' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.delivery_zones z where z.id <> new.id and z.states && new.states) then
    raise exception 'A state can belong to one zone only. Remove it from the other zone first.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger delivery_zones_validate
  before insert or update on public.delivery_zones
  for each row execute function public.delivery_zones_validate();

-- ---------------------------------------------------------------------------
-- B. Duty rates (PLACEHOLDER values are seeded in seed.sql)
-- ---------------------------------------------------------------------------

-- Verify with a licensed customs broker before production.
create table public.duty_rates (
  id                    uuid         primary key default gen_random_uuid(),
  category_slug         text         references public.categories (slug) on update cascade,
  corridor_id           uuid         not null references public.corridors (id),
  import_duty_percent   numeric(7,4) not null check (import_duty_percent between 0 and 100),
  vat_percent           numeric(7,4) not null check (vat_percent between 0 and 100),
  other_levies_percent  numeric(7,4) not null check (other_levies_percent between 0 and 100),
  notes                 text         check (char_length(notes) <= 500),
  effective_from        timestamptz  not null default now(),
  effective_to          timestamptz,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now(),
  constraint duty_rates_window check (effective_to is null or effective_to > effective_from)
);

create index duty_rates_category_slug_idx on public.duty_rates (category_slug);
create index duty_rates_corridor_id_idx on public.duty_rates (corridor_id, effective_from desc);

create trigger duty_rates_set_updated_at
  before update on public.duty_rates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- C. Fee rules
-- ---------------------------------------------------------------------------

create type public.fee_type as enum (
  'service_fee', 'international_freight', 'clearing', 'last_mile',
  'special_handling', 'insurance', 'fx_spread', 'payment_processing'
);
create type public.fee_calc_method as enum ('flat', 'percent', 'per_kg');

alter table public.fee_rules drop constraint fee_rules_value_matches_method;

alter table public.fee_rules
  add column value            numeric(18,4),
  add column max_amount_minor bigint,
  add column weight_from_g    int,
  add column weight_to_g      int,
  add column category_slug    text references public.categories (slug) on update cascade,
  add column zone_id          uuid references public.delivery_zones (id),
  add column effective_from   timestamptz,
  add column effective_to     timestamptz,
  add column notes            text;

-- The old customs estimate becomes a duty rate: its percent is the duty,
-- VAT starts at the placeholder 7.5 and other levies at 0.
insert into public.duty_rates (corridor_id, import_duty_percent, vat_percent, other_levies_percent, notes, effective_from)
select f.corridor_id, f.percent, 7.5, 0,
       'Moved from the Batch 1 customs estimate. PLACEHOLDER: verify with a licensed customs broker.',
       f.created_at
from public.fee_rules f
where f.fee_type = 'customs_duty_estimate' and f.active and f.percent is not null;

delete from public.fee_rules where fee_type = 'customs_duty_estimate';
update public.fee_rules set fee_type = 'last_mile' where fee_type = 'last_mile_delivery';

update public.fee_rules
set value = coalesce(amount_minor::numeric, percent),
    effective_from = created_at,
    effective_to = case when active then null else greatest(updated_at, created_at + interval '1 second') end;

alter table public.fee_rules
  drop constraint fee_rules_fee_type_check,
  drop constraint fee_rules_calc_method_check,
  drop column amount_minor,
  drop column percent,
  drop column active;

alter table public.fee_rules
  alter column fee_type type public.fee_type using fee_type::public.fee_type,
  alter column calc_method type public.fee_calc_method using calc_method::public.fee_calc_method,
  alter column value set not null,
  alter column effective_from set not null,
  alter column effective_from set default now();

alter table public.fee_rules
  add constraint fee_rules_value_valid check (
    value >= 0
    and (calc_method <> 'percent' or value <= 100)
    and (calc_method = 'percent' or value = trunc(value))
  ),
  add constraint fee_rules_bounds_valid check (
    (min_amount_minor is null or min_amount_minor >= 0)
    and (max_amount_minor is null or max_amount_minor >= 0)
    and (min_amount_minor is null or max_amount_minor is null or min_amount_minor <= max_amount_minor)
  ),
  add constraint fee_rules_weight_band_valid check (
    (weight_from_g is null or weight_from_g >= 0)
    and (weight_to_g is null or weight_to_g > coalesce(weight_from_g, 0))
  ),
  add constraint fee_rules_zone_only_last_mile check (zone_id is null or fee_type = 'last_mile'),
  add constraint fee_rules_notes_length check (char_length(notes) <= 500),
  add constraint fee_rules_window check (effective_to is null or effective_to > effective_from);

create index fee_rules_category_slug_idx on public.fee_rules (category_slug);
create index fee_rules_zone_id_idx on public.fee_rules (zone_id);
create index fee_rules_lookup_idx on public.fee_rules (corridor_id, fee_type, effective_from desc);

-- ---------------------------------------------------------------------------
-- D. Rule guards and admin functions
-- ---------------------------------------------------------------------------

-- Rules are history. The only change a rule ever gets is its end date, set
-- once. Changing a rate = close the old rule and create a new one.
create or replace function public.pricing_rule_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Pricing rules are never deleted. Close the rule instead.' using errcode = 'P0001';
  end if;
  if old.effective_to is not null
     or new.effective_to is null
     or (to_jsonb(new) - 'effective_to' - 'updated_at') is distinct from (to_jsonb(old) - 'effective_to' - 'updated_at')
  then
    raise exception 'Pricing rules cannot be edited. Close the rule and create a new one.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fee_rules_guard
  before update or delete on public.fee_rules
  for each row execute function public.pricing_rule_guard();
create trigger duty_rates_guard
  before update or delete on public.duty_rates
  for each row execute function public.pricing_rule_guard();

-- No two rules for the same thing may cover the same moment and weight. The
-- engine refuses to guess between them, so the database refuses to store them.
-- Payment processing may have one percent rule and one flat rule at once.
create or replace function public.fee_rules_no_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pricing-rules', 0));
  if exists (
    select 1 from public.fee_rules r
    where r.id <> new.id
      and r.corridor_id = new.corridor_id
      and r.fee_type = new.fee_type
      and r.category_slug is not distinct from new.category_slug
      and r.zone_id is not distinct from new.zone_id
      and (new.fee_type <> 'payment_processing' or r.calc_method = new.calc_method)
      and tstzrange(r.effective_from, r.effective_to, '[)') && tstzrange(new.effective_from, new.effective_to, '[)')
      and int4range(coalesce(r.weight_from_g, 0), coalesce(r.weight_to_g, 2147483647), '[)')
          && int4range(coalesce(new.weight_from_g, 0), coalesce(new.weight_to_g, 2147483647), '[)')
  ) then
    raise exception 'Another rule for this fee already covers that time and weight range. Close it first.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fee_rules_no_overlap
  before insert on public.fee_rules
  for each row execute function public.fee_rules_no_overlap();

create or replace function public.duty_rates_no_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pricing-rules', 0));
  if exists (
    select 1 from public.duty_rates r
    where r.id <> new.id
      and r.corridor_id = new.corridor_id
      and r.category_slug is not distinct from new.category_slug
      and tstzrange(r.effective_from, r.effective_to, '[)') && tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception 'Another duty rate for this category and route already covers that time. Close it first.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger duty_rates_no_overlap
  before insert on public.duty_rates
  for each row execute function public.duty_rates_no_overlap();

create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can change pricing' using errcode = '42501';
  end if;
end;
$$;

-- Creates a new fee rule that starts now.
create or replace function public.create_fee_rule(
  _corridor_id uuid,
  _fee_type public.fee_type,
  _calc_method public.fee_calc_method,
  _value numeric,
  _currency text,
  _min_amount_minor bigint default null,
  _max_amount_minor bigint default null,
  _weight_from_g int default null,
  _weight_to_g int default null,
  _category_slug text default null,
  _zone_id uuid default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  perform public._require_admin();
  insert into public.fee_rules (
    corridor_id, fee_type, calc_method, value, currency, min_amount_minor, max_amount_minor,
    weight_from_g, weight_to_g, category_slug, zone_id, notes, effective_from
  ) values (
    _corridor_id, _fee_type, _calc_method, _value, upper(_currency), _min_amount_minor, _max_amount_minor,
    _weight_from_g, _weight_to_g, _category_slug, _zone_id, nullif(btrim(_notes), ''), clock_timestamp()
  ) returning id into _id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'fee_rule.created', 'fee_rules', _id,
          jsonb_build_object('old', null, 'new', (select to_jsonb(r) from public.fee_rules r where r.id = _id)));
  return _id;
end;
$$;

-- Changing a rate: the old rule ends at the very instant the new one starts.
-- What the rule applies to (route, fee, category, zone) stays the same; to
-- change that, close the rule and create a new one.
create or replace function public.replace_fee_rule(
  _old_id uuid,
  _calc_method public.fee_calc_method,
  _value numeric,
  _currency text,
  _min_amount_minor bigint default null,
  _max_amount_minor bigint default null,
  _weight_from_g int default null,
  _weight_to_g int default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old  public.fee_rules;
  _new  uuid;
  _at   timestamptz := clock_timestamp();
begin
  perform public._require_admin();
  select * into _old from public.fee_rules where id = _old_id for update;
  if not found then
    raise exception 'Rule not found' using errcode = 'P0002';
  end if;
  if _old.effective_to is not null then
    raise exception 'This rule is already closed' using errcode = 'P0001';
  end if;

  update public.fee_rules set effective_to = _at where id = _old_id;
  insert into public.fee_rules (
    corridor_id, fee_type, calc_method, value, currency, min_amount_minor, max_amount_minor,
    weight_from_g, weight_to_g, category_slug, zone_id, notes, effective_from
  ) values (
    _old.corridor_id, _old.fee_type, _calc_method, _value, upper(_currency), _min_amount_minor, _max_amount_minor,
    _weight_from_g, _weight_to_g, _old.category_slug, _old.zone_id, nullif(btrim(_notes), ''), _at
  ) returning id into _new;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'fee_rule.replaced', 'fee_rules', _new,
          jsonb_build_object('old', to_jsonb(_old), 'new', (select to_jsonb(r) from public.fee_rules r where r.id = _new)));
  return _new;
end;
$$;

create or replace function public.close_fee_rule(_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old public.fee_rules;
begin
  perform public._require_admin();
  select * into _old from public.fee_rules where id = _id for update;
  if not found then
    raise exception 'Rule not found' using errcode = 'P0002';
  end if;
  if _old.effective_to is not null then
    raise exception 'This rule is already closed' using errcode = 'P0001';
  end if;
  update public.fee_rules set effective_to = clock_timestamp() where id = _id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'fee_rule.closed', 'fee_rules', _id,
          jsonb_build_object('old', to_jsonb(_old), 'new', (select to_jsonb(r) from public.fee_rules r where r.id = _id)));
end;
$$;

create or replace function public.create_duty_rate(
  _corridor_id uuid,
  _category_slug text,
  _import_duty_percent numeric,
  _vat_percent numeric,
  _other_levies_percent numeric,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  perform public._require_admin();
  insert into public.duty_rates (
    corridor_id, category_slug, import_duty_percent, vat_percent, other_levies_percent, notes, effective_from
  ) values (
    _corridor_id, _category_slug, _import_duty_percent, _vat_percent, _other_levies_percent,
    nullif(btrim(_notes), ''), clock_timestamp()
  ) returning id into _id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'duty_rate.created', 'duty_rates', _id,
          jsonb_build_object('old', null, 'new', (select to_jsonb(r) from public.duty_rates r where r.id = _id)));
  return _id;
end;
$$;

create or replace function public.replace_duty_rate(
  _old_id uuid,
  _import_duty_percent numeric,
  _vat_percent numeric,
  _other_levies_percent numeric,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old public.duty_rates;
  _new uuid;
  _at  timestamptz := clock_timestamp();
begin
  perform public._require_admin();
  select * into _old from public.duty_rates where id = _old_id for update;
  if not found then
    raise exception 'Duty rate not found' using errcode = 'P0002';
  end if;
  if _old.effective_to is not null then
    raise exception 'This duty rate is already closed' using errcode = 'P0001';
  end if;
  update public.duty_rates set effective_to = _at where id = _old_id;
  insert into public.duty_rates (
    corridor_id, category_slug, import_duty_percent, vat_percent, other_levies_percent, notes, effective_from
  ) values (
    _old.corridor_id, _old.category_slug, _import_duty_percent, _vat_percent, _other_levies_percent,
    nullif(btrim(_notes), ''), _at
  ) returning id into _new;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'duty_rate.replaced', 'duty_rates', _new,
          jsonb_build_object('old', to_jsonb(_old), 'new', (select to_jsonb(r) from public.duty_rates r where r.id = _new)));
  return _new;
end;
$$;

create or replace function public.close_duty_rate(_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old public.duty_rates;
begin
  perform public._require_admin();
  select * into _old from public.duty_rates where id = _id for update;
  if not found then
    raise exception 'Duty rate not found' using errcode = 'P0002';
  end if;
  if _old.effective_to is not null then
    raise exception 'This duty rate is already closed' using errcode = 'P0001';
  end if;
  update public.duty_rates set effective_to = clock_timestamp() where id = _id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'duty_rate.closed', 'duty_rates', _id,
          jsonb_build_object('old', to_jsonb(_old), 'new', (select to_jsonb(r) from public.duty_rates r where r.id = _id)));
end;
$$;

-- Zones are edited in place (quotes keep their own copy in the snapshot).
-- Pass a null id to create a zone.
create or replace function public.save_delivery_zone(_id uuid, _name text, _states text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old public.delivery_zones;
  _out uuid;
begin
  perform public._require_admin();
  if _id is null then
    insert into public.delivery_zones (name, states) values (btrim(_name), _states) returning id into _out;
  else
    select * into _old from public.delivery_zones where id = _id for update;
    if not found then
      raise exception 'Zone not found' using errcode = 'P0002';
    end if;
    update public.delivery_zones set name = btrim(_name), states = _states where id = _id;
    _out := _id;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), case when _id is null then 'delivery_zone.created' else 'delivery_zone.updated' end,
          'delivery_zones', _out,
          jsonb_build_object('old', case when _id is null then null else to_jsonb(_old) end,
                             'new', (select to_jsonb(z) from public.delivery_zones z where z.id = _out)));
  return _out;
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Exchange rates
-- ---------------------------------------------------------------------------

-- spread_percent: our conversion fee for buyers paying in quote_currency,
--   shown to them as its own line. ended_at: when an override was removed.
alter table public.fx_rates
  add column spread_percent numeric(7,4) not null default 0 check (spread_percent >= 0 and spread_percent <= 20),
  add column ended_at       timestamptz;

create unique index fx_rates_one_active_override
  on public.fx_rates (base_currency, quote_currency) where is_override and ended_at is null;

-- Rate rows are history. Only the spread and the end of an override change.
create or replace function public.fx_rates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Exchange rate history is never deleted' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'spread_percent' - 'ended_at' - 'updated_at')
     is distinct from (to_jsonb(old) - 'spread_percent' - 'ended_at' - 'updated_at')
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at) then
    raise exception 'An exchange rate cannot be edited. Set an override or fetch a new rate.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fx_rates_guard
  before update or delete on public.fx_rates
  for each row execute function public.fx_rates_guard();

-- The row that prices a pair right now: the open override, else the newest fetch.
create or replace function public._effective_fx_row(_base text, _quote text)
returns public.fx_rates
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.fx_rates r
  where r.base_currency = _base and r.quote_currency = _quote and (not r.is_override or r.ended_at is null)
  order by r.is_override desc, r.fetched_at desc
  limit 1;
$$;

create or replace function public.set_fx_override(_base text, _quote text, _rate numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _current public.fx_rates;
  _id uuid;
begin
  perform public._require_admin();
  _base := upper(_base);
  _quote := upper(_quote);
  if _base = _quote then
    raise exception 'Choose two different currencies' using errcode = 'P0001';
  end if;
  if _rate is null or _rate <= 0 or _rate >= 10000000000 then
    raise exception 'Enter a rate above zero' using errcode = 'P0001';
  end if;
  if (select count(*) from public.currencies c where c.code in (_base, _quote) and c.active) <> 2 then
    raise exception 'Both currencies must be active' using errcode = 'P0001';
  end if;

  _current := public._effective_fx_row(_base, _quote);
  update public.fx_rates set ended_at = clock_timestamp()
  where base_currency = _base and quote_currency = _quote and is_override and ended_at is null;

  insert into public.fx_rates (base_currency, quote_currency, rate, source, is_override, spread_percent, fetched_at)
  values (_base, _quote, round(_rate, 8), 'admin override', true, coalesce(_current.spread_percent, 0), clock_timestamp())
  returning id into _id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'fx.override_set', 'fx_rates', _id,
          jsonb_build_object('old', to_jsonb(_current), 'new', (select to_jsonb(r) from public.fx_rates r where r.id = _id)));
  return _id;
end;
$$;

create or replace function public.remove_fx_override(_base text, _quote text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old public.fx_rates;
begin
  perform public._require_admin();
  select * into _old from public.fx_rates
  where base_currency = upper(_base) and quote_currency = upper(_quote) and is_override and ended_at is null
  for update;
  if not found then
    raise exception 'There is no override to remove for this pair' using errcode = 'P0001';
  end if;
  update public.fx_rates set ended_at = clock_timestamp() where id = _old.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'fx.override_removed', 'fx_rates', _old.id,
          jsonb_build_object('old', to_jsonb(_old), 'new', (select to_jsonb(r) from public.fx_rates r where r.id = _old.id)));
end;
$$;

-- Sets the spread on the row that prices the pair now. The rate and its
-- fetched_at do not change, so a spread edit can never make an old rate look fresh.
create or replace function public.set_fx_spread(_base text, _quote text, _spread_percent numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.fx_rates;
begin
  perform public._require_admin();
  if _spread_percent is null or _spread_percent < 0 or _spread_percent > 20 then
    raise exception 'The conversion fee must be between 0 and 20 percent' using errcode = 'P0001';
  end if;
  _row := public._effective_fx_row(upper(_base), upper(_quote));
  if _row.id is null then
    raise exception 'There is no exchange rate for this pair yet' using errcode = 'P0001';
  end if;
  update public.fx_rates set spread_percent = _spread_percent where id = _row.id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'fx.spread_set', 'fx_rates', _row.id,
          jsonb_build_object('old', jsonb_build_object('spread_percent', _row.spread_percent),
                             'new', jsonb_build_object('spread_percent', _spread_percent)));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Dimensions, and a weight before publishing
-- ---------------------------------------------------------------------------

alter table public.products
  add column length_cm numeric(7,2) check (length_cm > 0 and length_cm <= 1000),
  add column width_cm  numeric(7,2) check (width_cm > 0 and width_cm <= 1000),
  add column height_cm numeric(7,2) check (height_cm > 0 and height_cm <= 1000),
  add constraint products_dimensions_together check (
    (length_cm is null) = (width_cm is null) and (width_cm is null) = (height_cm is null)
  );

alter table public.orders
  add column length_cm numeric(7,2) check (length_cm > 0 and length_cm <= 1000),
  add column width_cm  numeric(7,2) check (width_cm > 0 and width_cm <= 1000),
  add column height_cm numeric(7,2) check (height_cm > 0 and height_cm <= 1000),
  add constraint orders_dimensions_together check (
    (length_cm is null) = (width_cm is null) and (width_cm is null) = (height_cm is null)
  );

-- Without a weight there is no delivered price to show. Listings that are
-- already published without one stay up until they are edited.
create or replace function public.products_require_weight()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active and new.weight_grams is null and not public.is_privileged_session()
     and (tg_op = 'INSERT' or not old.active or new.weight_grams is distinct from old.weight_grams) then
    raise exception 'Add the weight before publishing, so buyers can see the delivered price'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger products_require_weight
  before insert or update on public.products
  for each row execute function public.products_require_weight();

grant execute on function public.products_require_weight() to authenticated, service_role;

grant insert (length_cm, width_cm, height_cm) on public.products to authenticated;
grant update (length_cm, width_cm, height_cm) on public.products to authenticated;

-- ---------------------------------------------------------------------------
-- G. Quotes: line types, admin-only override and snapshot tables, send_quote
-- ---------------------------------------------------------------------------

alter table public.quote_lines drop constraint quote_lines_type_allowed;
alter table public.quote_lines
  add constraint quote_lines_type_allowed check (
    line_type in (
      'item_price', 'service_fee', 'international_freight', 'insurance', 'import_duty', 'other_levies',
      'vat', 'customs_estimate', 'clearing', 'special_handling', 'last_mile_delivery',
      'payment_processing', 'fx_spread', 'other'
    )
  );

-- Admin-only, like quote_internal_notes: buyers can read quote_lines, so
-- anything about margins lives in tables they cannot read.
-- A row exists for a line the admin overrode (original amount set) or added by hand (original null).
create table public.quote_line_overrides (
  id                     uuid        primary key default gen_random_uuid(),
  quote_line_id          uuid        not null unique references public.quote_lines (id) on delete cascade,
  reason                 text        not null check (char_length(btrim(reason)) between 5 and 500),
  original_amount_minor  bigint      check (original_amount_minor >= 0 and original_amount_minor <= 1000000000000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.quote_pricing_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  quote_id        uuid        not null unique references public.quotes (id) on delete cascade,
  engine_version  text        not null check (char_length(engine_version) between 1 and 40),
  snapshot        jsonb       not null check (jsonb_typeof(snapshot) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger quote_line_overrides_set_updated_at
  before update on public.quote_line_overrides
  for each row execute function public.set_updated_at();
create trigger quote_pricing_snapshots_set_updated_at
  before update on public.quote_pricing_snapshots
  for each row execute function public.set_updated_at();

create trigger quote_line_overrides_immutable
  before update or delete on public.quote_line_overrides
  for each row execute function public.block_quote_history_change();
create trigger quote_pricing_snapshots_immutable
  before update or delete on public.quote_pricing_snapshots
  for each row execute function public.block_quote_history_change();

-- Sends a quote, or a revision that supersedes the waiting one. The total is
-- the sum of the lines, worked out here. The pricing snapshot (what the engine
-- used) is required and stored where only admins can read it.
--
-- _lines: [{"type": "...", "label": "...", "amount_minor": 123,
--           "override": {"reason": "...", "original_amount_minor": 100}}]
--   "override" is present for a line the admin changed after calculating
--   (original amount set) or added by hand (original amount null).
-- _dimensions: {"length_cm": 30, "width_cm": 20, "height_cm": 10} or null.
drop function public.send_quote(uuid, jsonb, int, int, text, uuid, boolean);

create or replace function public.send_quote(
  _order_id uuid,
  _lines jsonb,
  _expires_in_hours int,
  _snapshot jsonb,
  _weight_grams int default null,
  _internal_notes text default null,
  _corridor_id uuid default null,
  _confirm_over_budget boolean default false,
  _dimensions jsonb default null
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
  _override   jsonb;
  _original   numeric;
  _total      numeric := 0;
  _has_item   boolean := false;
  _count      int;
  _previous   public.quotes;
  _version    int;
  _quote_id   uuid;
  _line_id    uuid;
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
  if _snapshot is null or jsonb_typeof(_snapshot) <> 'object'
     or nullif(btrim(coalesce(_snapshot ->> 'engine_version', '')), '') is null then
    raise exception 'A quote needs the pricing snapshot from the calculation' using errcode = '22023';
  end if;
  if _dimensions is not null and (
       jsonb_typeof(_dimensions) <> 'object'
       or jsonb_typeof(_dimensions -> 'length_cm') is distinct from 'number'
       or jsonb_typeof(_dimensions -> 'width_cm') is distinct from 'number'
       or jsonb_typeof(_dimensions -> 'height_cm') is distinct from 'number') then
    raise exception 'Dimensions need a length, width and height' using errcode = '22023';
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
  if _count < 1 or _count > 30 then
    raise exception 'A quote needs between 1 and 30 line items' using errcode = '22023';
  end if;

  for _i in 0 .. _count - 1 loop
    _line := _lines -> _i;
    if jsonb_typeof(_line) <> 'object' or jsonb_typeof(_line -> 'amount_minor') is distinct from 'number' then
      raise exception 'Line % is not valid', _i + 1 using errcode = '22023';
    end if;
    _type := _line ->> 'type';
    _label := btrim(coalesce(_line ->> 'label', ''));
    _amount := (_line ->> 'amount_minor')::numeric;
    if _type is null or _type not in ('item_price', 'service_fee', 'international_freight', 'insurance',
                                      'import_duty', 'other_levies', 'vat', 'customs_estimate', 'clearing',
                                      'special_handling', 'last_mile_delivery', 'payment_processing',
                                      'fx_spread', 'other') then
      raise exception 'Line % has an unknown type', _i + 1 using errcode = '22023';
    end if;
    if char_length(_label) < 1 or char_length(_label) > 200 then
      raise exception 'Line % needs a label of up to 200 characters', _i + 1 using errcode = '22023';
    end if;
    if _amount <> trunc(_amount) or _amount < 0 or _amount > 1000000000000 then
      raise exception 'Line % has an invalid amount', _i + 1 using errcode = '22023';
    end if;
    _override := _line -> 'override';
    if _override is not null and _override <> 'null'::jsonb then
      if jsonb_typeof(_override) <> 'object'
         or char_length(btrim(coalesce(_override ->> 'reason', ''))) < 5
         or char_length(btrim(_override ->> 'reason')) > 500 then
        raise exception 'Line % was changed by hand: give a reason of at least 5 characters', _i + 1
          using errcode = '22023';
      end if;
      if _override ? 'original_amount_minor' and jsonb_typeof(_override -> 'original_amount_minor') = 'number' then
        _original := (_override ->> 'original_amount_minor')::numeric;
        if _original <> trunc(_original) or _original < 0 or _original > 1000000000000 then
          raise exception 'Line % has an invalid original amount', _i + 1 using errcode = '22023';
        end if;
      end if;
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
            _order.buyer_currency, _i)
    returning id into _line_id;

    _override := _line -> 'override';
    if _override is not null and _override <> 'null'::jsonb then
      insert into public.quote_line_overrides (quote_line_id, reason, original_amount_minor)
      values (_line_id, btrim(_override ->> 'reason'),
              case when jsonb_typeof(_override -> 'original_amount_minor') = 'number'
                   then (_override ->> 'original_amount_minor')::bigint end);
    end if;
  end loop;

  insert into public.quote_pricing_snapshots (quote_id, engine_version, snapshot)
  values (_quote_id, left(btrim(_snapshot ->> 'engine_version'), 40), _snapshot);

  if _dimensions is not null then
    update public.orders
    set length_cm = (_dimensions ->> 'length_cm')::numeric,
        width_cm = (_dimensions ->> 'width_cm')::numeric,
        height_cm = (_dimensions ->> 'height_cm')::numeric
    where id = _order_id;
  end if;

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
                             'overridden_lines', (select count(*) from jsonb_array_elements(_lines) l
                                                  where l -> 'override' is not null and l -> 'override' <> 'null'::jsonb),
                             'over_budget_confirmed',
                             _order.max_budget_minor is not null and _total > _order.max_budget_minor));

  perform public.queue_notification(_order.buyer_id, null,
    case when _was_revision then 'quote_revised' else 'quote_ready' end,
    jsonb_build_object('order_id', _order_id, 'quote_id', _quote_id, 'version', _version,
                       'expires_at', now() + make_interval(hours => _expires_in_hours)));

  return _quote_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. Request throttle (public estimator)
-- ---------------------------------------------------------------------------

create table public.request_throttle (
  id            uuid        primary key default gen_random_uuid(),
  bucket        text        not null check (char_length(bucket) between 1 and 200),
  window_start  timestamptz not null,
  hits          int         not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint request_throttle_window_key unique (bucket, window_start)
);

create index request_throttle_window_idx on public.request_throttle (window_start);

create trigger request_throttle_set_updated_at
  before update on public.request_throttle
  for each row execute function public.set_updated_at();

-- Counts one request in the current fixed window. Returns false once the
-- bucket is over its limit. Server code only.
create or replace function public.throttle_hit(_bucket text, _limit int, _window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _start timestamptz;
  _hits  int;
begin
  if _limit < 1 or _window_seconds < 1 then
    raise exception 'Invalid throttle settings' using errcode = '22023';
  end if;
  _start := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  insert into public.request_throttle (bucket, window_start, hits)
  values (_bucket, _start, 1)
  on conflict (bucket, window_start) do update set hits = public.request_throttle.hits + 1
  returning hits into _hits;
  if random() < 0.01 then
    delete from public.request_throttle where window_start < now() - interval '2 days';
  end if;
  return _hits <= _limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- I. Privileges and row level security
-- ---------------------------------------------------------------------------

alter table public.delivery_zones          enable row level security;
alter table public.duty_rates              enable row level security;
alter table public.quote_line_overrides    enable row level security;
alter table public.quote_pricing_snapshots enable row level security;
alter table public.request_throttle        enable row level security;

-- Pricing tables are read by admins (and by server code with the service role,
-- which builds public estimates). Visitors and buyers get nothing.
drop policy fee_rules_admin_all on public.fee_rules;
drop policy fx_rates_admin_all on public.fx_rates;
create policy fee_rules_admin_read on public.fee_rules
  for select to authenticated using ((select public.is_admin()));
create policy fx_rates_admin_read on public.fx_rates
  for select to authenticated using ((select public.is_admin()));
create policy duty_rates_admin_read on public.duty_rates
  for select to authenticated using ((select public.is_admin()));
create policy delivery_zones_admin_read on public.delivery_zones
  for select to authenticated using ((select public.is_admin()));
create policy quote_line_overrides_admin_read on public.quote_line_overrides
  for select to authenticated using ((select public.is_admin()));
create policy quote_pricing_snapshots_admin_read on public.quote_pricing_snapshots
  for select to authenticated using ((select public.is_admin()));
create policy request_throttle_admin_read on public.request_throttle
  for select to authenticated using ((select public.is_admin()));

revoke all on public.delivery_zones, public.duty_rates, public.quote_line_overrides,
  public.quote_pricing_snapshots, public.request_throttle from anon, authenticated;
revoke insert, update, delete on public.fee_rules, public.fx_rates from authenticated;
grant select on public.delivery_zones, public.duty_rates, public.quote_line_overrides,
  public.quote_pricing_snapshots, public.request_throttle to authenticated;
grant all on public.delivery_zones, public.duty_rates, public.quote_line_overrides,
  public.quote_pricing_snapshots, public.request_throttle to service_role;

revoke all on function
  public.pricing_rule_guard(),
  public.fee_rules_no_overlap(),
  public.duty_rates_no_overlap(),
  public.delivery_zones_validate(),
  public.fx_rates_guard(),
  public._require_admin(),
  public._effective_fx_row(text, text),
  public.create_fee_rule(uuid, public.fee_type, public.fee_calc_method, numeric, text, bigint, bigint, int, int, text, uuid, text),
  public.replace_fee_rule(uuid, public.fee_calc_method, numeric, text, bigint, bigint, int, int, text),
  public.close_fee_rule(uuid),
  public.create_duty_rate(uuid, text, numeric, numeric, numeric, text),
  public.replace_duty_rate(uuid, numeric, numeric, numeric, text),
  public.close_duty_rate(uuid),
  public.save_delivery_zone(uuid, text, text[]),
  public.set_fx_override(text, text, numeric),
  public.remove_fx_override(text, text),
  public.set_fx_spread(text, text, numeric),
  public.send_quote(uuid, jsonb, int, jsonb, int, text, uuid, boolean, jsonb),
  public.throttle_hit(text, int, int)
  from public, anon, authenticated;

-- Trigger functions run as the caller and need execute on themselves.
grant execute on function
  public.pricing_rule_guard(),
  public.fee_rules_no_overlap(),
  public.duty_rates_no_overlap(),
  public.delivery_zones_validate(),
  public.fx_rates_guard()
  to authenticated, service_role;

-- Admin functions: they check is_admin() themselves. The two internal helpers
-- (_require_admin, _effective_fx_row) are only called from these definer
-- functions and have no grants.
grant execute on function
  public.create_fee_rule(uuid, public.fee_type, public.fee_calc_method, numeric, text, bigint, bigint, int, int, text, uuid, text),
  public.replace_fee_rule(uuid, public.fee_calc_method, numeric, text, bigint, bigint, int, int, text),
  public.close_fee_rule(uuid),
  public.create_duty_rate(uuid, text, numeric, numeric, numeric, text),
  public.replace_duty_rate(uuid, numeric, numeric, numeric, text),
  public.close_duty_rate(uuid),
  public.save_delivery_zone(uuid, text, text[]),
  public.set_fx_override(text, text, numeric),
  public.remove_fx_override(text, text),
  public.set_fx_spread(text, text, numeric),
  public.send_quote(uuid, jsonb, int, jsonb, int, text, uuid, boolean, jsonb)
  to authenticated, service_role;

grant execute on function public.throttle_hit(text, int, int) to service_role;
