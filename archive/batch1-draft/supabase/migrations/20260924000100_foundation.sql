-- Batch 1: foundation schema.
-- Reference data (currencies, countries, corridors), user profiles, roles and a
-- role change audit log. Every table has RLS enabled with explicit policies.
--
-- Recipients are not users. They will be stored as contact details on orders
-- (a later batch) and reach tracking pages through a token, not an account.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('buyer', 'vendor', 'admin');

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
-- Currencies
-- minor_unit is the number of decimal places (NGN = 2, so 1 NGN = 100 kobo).
-- All money columns in later batches store integer minor units plus a
-- currency code that references this table.
-- is_active controls whether buyers can pick the currency for display.
-- ---------------------------------------------------------------------------

create table public.currencies (
  code        char(3)     primary key check (code ~ '^[A-Z]{3}$'),
  name        text        not null check (char_length(name) between 1 and 80),
  symbol      text        not null check (char_length(symbol) between 1 and 8),
  minor_unit  smallint    not null check (minor_unit between 0 and 4),
  is_active   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger currencies_set_updated_at
  before update on public.currencies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Countries
-- ---------------------------------------------------------------------------

create table public.countries (
  code           char(2)     primary key check (code ~ '^[A-Z]{2}$'),
  name           text        not null check (char_length(name) between 1 and 80),
  currency_code  char(3)     not null references public.currencies (code),
  phone_prefix   text        not null check (phone_prefix ~ '^\+[0-9]{1,4}$'),
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index countries_currency_code_idx on public.countries (currency_code);

create trigger countries_set_updated_at
  before update on public.countries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Corridors: origin country + destination country.
-- Fees, freight rates and duty estimates attach to corridors in batch 4.
-- ---------------------------------------------------------------------------

create table public.corridors (
  id                    uuid        primary key default gen_random_uuid(),
  code                  text        not null unique check (code ~ '^[A-Z]{2}-[A-Z]{2}$'),
  name                  text        not null check (char_length(name) between 1 and 120),
  origin_country        char(2)     not null references public.countries (code),
  destination_country   char(2)     not null references public.countries (code),
  is_cross_border       boolean     generated always as (origin_country <> destination_country) stored,
  est_delivery_days_min smallint    check (est_delivery_days_min >= 0),
  est_delivery_days_max smallint    check (est_delivery_days_max >= 0),
  is_active             boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint corridors_route_unique unique (origin_country, destination_country),
  constraint corridors_code_matches_route
    check (code = origin_country || '-' || destination_country),
  constraint corridors_delivery_days_order
    check (est_delivery_days_min is null
           or est_delivery_days_max is null
           or est_delivery_days_min <= est_delivery_days_max)
);

create index corridors_destination_country_idx on public.corridors (destination_country);

create trigger corridors_set_updated_at
  before update on public.corridors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user, created by trigger on sign-up.
-- email is a read-only copy of auth.users.email so admins can search users.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                  uuid        primary key references auth.users (id) on delete cascade,
  email               text,
  full_name           text        not null default '' check (char_length(full_name) <= 120),
  phone               text        check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  country_code        char(2)     references public.countries (code),
  preferred_currency  char(3)     not null default 'NGN' references public.currencies (code),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (lower(email));
create index profiles_country_code_idx on public.profiles (country_code);
create index profiles_preferred_currency_idx on public.profiles (preferred_currency);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Roles: one account can hold several roles (buyer + vendor, for example).
-- ---------------------------------------------------------------------------

create table public.user_roles (
  user_id     uuid            not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid            references public.profiles (id) on delete set null,
  created_at  timestamptz     not null default now(),
  primary key (user_id, role)
);

create index user_roles_granted_by_idx on public.user_roles (granted_by);

-- Append-only log of every role grant and revoke.
create table public.role_changes (
  id          bigint generated always as identity primary key,
  user_id     uuid            not null,
  role        public.app_role not null,
  action      text            not null check (action in ('granted', 'revoked')),
  actor_id    uuid,
  created_at  timestamptz     not null default now()
);

create index role_changes_user_id_idx on public.role_changes (user_id);

-- ---------------------------------------------------------------------------
-- Role check functions used by RLS policies.
-- security definer so policies on user_roles do not recurse into themselves.
-- ---------------------------------------------------------------------------

create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = _role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin');
$$;

-- ---------------------------------------------------------------------------
-- Role triggers: stamp granted_by from the session (never from the client),
-- block removal of the last admin, and write the audit log.
-- ---------------------------------------------------------------------------

create or replace function public.user_roles_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.granted_by = (select auth.uid());
  new.created_at = now();
  return new;
end;
$$;

create trigger user_roles_before_insert
  before insert on public.user_roles
  for each row execute function public.user_roles_before_insert();

create or replace function public.user_roles_guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' then
    -- Lock admin rows so two concurrent revokes cannot both pass the check.
    perform 1 from public.user_roles where role = 'admin' for update;
    if (select count(*) from public.user_roles where role = 'admin') <= 1 then
      raise exception 'Cannot remove the last admin'
        using errcode = 'P0001';
    end if;
  end if;
  return old;
end;
$$;

create trigger user_roles_guard_last_admin
  before delete on public.user_roles
  for each row execute function public.user_roles_guard_last_admin();

create or replace function public.user_roles_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.role_changes (user_id, role, action, actor_id)
    values (new.user_id, new.role, 'granted', (select auth.uid()));
    return new;
  end if;

  insert into public.role_changes (user_id, role, action, actor_id)
  values (old.user_id, old.role, 'revoked', (select auth.uid()));
  return old;
end;
$$;

create trigger user_roles_log_change
  after insert or delete on public.user_roles
  for each row execute function public.user_roles_log_change();

create or replace function public.role_changes_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'role_changes is append-only';
end;
$$;

create trigger role_changes_block_mutation
  before update or delete on public.role_changes
  for each row execute function public.role_changes_block_mutation();

-- ---------------------------------------------------------------------------
-- New user: create profile and give the buyer role.
-- Sign-up metadata is user-controlled, so it is trimmed and validated here.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_name     text := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);
  meta_country  text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'country_code', '')));
  country       char(2);
  currency      char(3);
begin
  -- Unknown or inactive country: leave it empty. Currency follows the
  -- country when that currency is enabled for display, else NGN.
  select c.code, case when cur.is_active then cur.code end
    into country, currency
  from public.countries c
  join public.currencies cur on cur.code = c.currency_code
  where c.code = meta_country and c.is_active;

  insert into public.profiles (id, email, full_name, country_code, preferred_currency)
  values (new.id, new.email, meta_name, country, coalesce(currency, 'NGN'));

  insert into public.user_roles (user_id, role)
  values (new.id, 'buyer');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Privileges. Grants are explicit so they do not depend on platform defaults.
-- RLS policies below decide which rows each role can reach.
-- ---------------------------------------------------------------------------

revoke all on public.currencies, public.countries, public.corridors,
              public.profiles, public.user_roles, public.role_changes
  from anon, authenticated;

grant select on public.currencies, public.countries, public.corridors to anon, authenticated;
grant insert, update, delete on public.currencies, public.countries, public.corridors to authenticated;

grant select on public.profiles to authenticated;
-- Users may only change these columns. id, email and timestamps stay locked.
grant update (full_name, phone, country_code, preferred_currency) on public.profiles to authenticated;

grant select, insert, delete on public.user_roles to authenticated;
grant select on public.role_changes to authenticated;

grant all on public.currencies, public.countries, public.corridors,
             public.profiles, public.user_roles, public.role_changes
  to service_role;

revoke all on function public.has_role(public.app_role) from public;
revoke all on function public.is_admin() from public;
grant execute on function public.has_role(public.app_role) to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;
revoke all on function public.user_roles_guard_last_admin() from public, anon, authenticated;
revoke all on function public.user_roles_log_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.currencies   enable row level security;
alter table public.countries    enable row level security;
alter table public.corridors    enable row level security;
alter table public.profiles     enable row level security;
alter table public.user_roles   enable row level security;
alter table public.role_changes enable row level security;

-- Reference data: anyone can read active rows, admins read and write all.
create policy currencies_select on public.currencies
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy currencies_admin_insert on public.currencies
  for insert to authenticated
  with check ((select public.is_admin()));
create policy currencies_admin_update on public.currencies
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy currencies_admin_delete on public.currencies
  for delete to authenticated
  using ((select public.is_admin()));

create policy countries_select on public.countries
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy countries_admin_insert on public.countries
  for insert to authenticated
  with check ((select public.is_admin()));
create policy countries_admin_update on public.countries
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy countries_admin_delete on public.countries
  for delete to authenticated
  using ((select public.is_admin()));

create policy corridors_select on public.corridors
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy corridors_admin_insert on public.corridors
  for insert to authenticated
  with check ((select public.is_admin()));
create policy corridors_admin_update on public.corridors
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy corridors_admin_delete on public.corridors
  for delete to authenticated
  using ((select public.is_admin()));

-- Profiles: users read and edit their own row. Admins read and edit all.
-- Inserts come only from the sign-up trigger. Deletes cascade from auth.users.
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Roles: users see their own roles. Only admins grant or revoke.
create policy user_roles_select_own_or_admin on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated
  with check ((select public.is_admin()));
create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated
  using ((select public.is_admin()));

-- Audit log: admins read. Nobody writes except the trigger.
create policy role_changes_admin_select on public.role_changes
  for select to authenticated
  using ((select public.is_admin()));
