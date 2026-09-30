-- Batch 2, part 2: vendor applications and the product catalog.
--
-- Contents
--   A. categories and prohibited_terms tables
--   B. products: new columns, condition enum, rules enforced by trigger
--   C. vendors: application columns, status rules, review functions
--   D. public views (vendor_directory, shop_brands)
--   E. grants and RLS for everything above
--
-- Why rules live in triggers and not only in app code: an approved vendor
-- holds a login that can call Supabase directly, skipping our server actions.
-- Anything that protects buyers (prohibited items, corridor, category) must
-- hold however the row is written.

-- ---------------------------------------------------------------------------
-- A. categories and prohibited terms
-- ---------------------------------------------------------------------------

create table public.categories (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique check (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  name         text        not null check (char_length(name) between 1 and 80),
  parent_slug  text        references public.categories (slug) on update cascade,
  active       boolean     not null default true,
  prohibited   boolean     not null default false,
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index categories_parent_slug_idx on public.categories (parent_slug);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- Words that send a listing to admin review. Matching is case-insensitive and
-- on whole words or phrases. Kept in sync with lib/catalog/prohibited.ts (a
-- database test compares the two lists). Lives in a migration, not seed.sql,
-- because the protection must exist in every environment.
create table public.prohibited_terms (
  id          uuid        primary key default gen_random_uuid(),
  term        text        not null unique
                check (term ~ '^[a-z0-9][a-z0-9 :''-]*[a-z0-9]$' and char_length(term) <= 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger prohibited_terms_set_updated_at
  before update on public.prohibited_terms
  for each row execute function public.set_updated_at();

insert into public.prohibited_terms (term) values
  -- weapons
  ('firearm'), ('firearms'), ('rifle'), ('pistol'), ('handgun'), ('revolver'), ('shotgun'),
  ('ammunition'), ('taser'), ('stun gun'), ('pepper spray'), ('switchblade'), ('grenade'), ('detonator'),
  -- hazardous
  ('explosive'), ('explosives'), ('gunpowder'), ('fireworks'), ('asbestos'), ('radioactive'),
  ('uranium'), ('cyanide'), ('pesticide'),
  -- drugs
  ('cocaine'), ('heroin'), ('cannabis'), ('marijuana'), ('methamphetamine'), ('meth'), ('mdma'),
  ('lsd'), ('tramadol'), ('codeine'), ('opioid'),
  -- counterfeit
  ('counterfeit'), ('fake'), ('replica'), ('knockoff'), ('knock-off'), ('clone'), ('first copy'),
  ('super copy'), ('master copy'), ('aaa grade'), ('mirror quality')
on conflict (term) do nothing;

-- Returns the prohibited terms found in a piece of text. Word boundaries use
-- Postgres \m and \M, which match the lookarounds in lib/catalog/prohibited.ts.
create or replace function public.matched_prohibited_terms(_text text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.term order by t.term), '{}'::text[])
  from public.prohibited_terms t
  where lower(coalesce(_text, '')) ~ ('\m' || t.term || '\M');
$$;

-- A category can hold listings when it is active, not prohibited, has no
-- sub-categories, and (if it has a parent) the parent is active and allowed.
create or replace function public.category_is_assignable(_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.categories c
    where c.slug = _slug
      and c.active
      and not c.prohibited
      and not exists (select 1 from public.categories ch where ch.parent_slug = c.slug)
      and (
        c.parent_slug is null
        or exists (
          select 1 from public.categories p
          where p.slug = c.parent_slug and p.active and not p.prohibited
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- B. products
-- ---------------------------------------------------------------------------

create type public.product_condition as enum ('new', 'open_box', 'refurbished', 'used');

alter table public.products drop constraint products_condition_check;
alter table public.products alter column condition drop default;
alter table public.products
  alter column condition type public.product_condition using condition::public.product_condition;
alter table public.products alter column condition set default 'new';

alter table public.products
  add column corridor_id                uuid references public.corridors (id),
  add column specs                      jsonb   not null default '{}'::jsonb,
  add column condition_notes            text,
  add column warranty_months            int     not null default 0,
  add column requires_special_handling  boolean not null default false,
  add column flagged_at                 timestamptz,
  add column flagged_reason             text;

-- Rows written before this batch ship from the vendor's country to Nigeria.
-- If any row cannot be matched, the NOT NULL below fails and nothing is applied.
update public.products p
   set corridor_id = c.id
  from public.vendors v
  join public.corridors c on c.origin_country = v.country_code and c.destination_country = 'NG'
 where v.id = p.vendor_id and p.corridor_id is null;

alter table public.products alter column corridor_id set not null;

alter table public.products
  add constraint products_category_fkey
    foreign key (category) references public.categories (slug) on update cascade,
  add constraint products_price_range check (price_minor > 0 and price_minor <= 1000000000000),
  add constraint products_warranty_range check (warranty_months between 0 and 120),
  add constraint products_specs_shape check (jsonb_typeof(specs) = 'object' and pg_column_size(specs) <= 4096),
  add constraint products_condition_notes_required check (
    condition = 'new'
    or char_length(btrim(coalesce(condition_notes, ''))) >= 10
  ),
  add constraint products_condition_notes_length check (char_length(condition_notes) <= 1000),
  add constraint products_flag_pair check ((flagged_at is null) = (flagged_reason is null));

-- Full-text search. The 'simple' config does no stemming, so brand names such
-- as Xiaomi or Tecno are kept as typed. Title and brand weigh most.
alter table public.products
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(brand, '')), 'A')
    || setweight(to_tsvector('simple', replace(category, '_', ' ')), 'B')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'D')
  ) stored;

create index products_search_vector_idx on public.products using gin (search_vector);
create index products_corridor_id_idx on public.products (corridor_id);
create index products_category_idx on public.products (category);
create index products_flagged_idx on public.products (flagged_at) where flagged_at is not null;
create index products_shop_idx on public.products (created_at desc) where active;

-- Helpers for triggers. Security definer so they see rows the caller cannot.
create or replace function public.corridor_matches_vendor(_corridor_id uuid, _vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.corridors c
    join public.vendors v on v.country_code = c.origin_country
    where c.id = _corridor_id and v.id = _vendor_id and c.active
  );
$$;

create or replace function public.product_vendor_id(_product_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.vendor_id from public.products p where p.id = _product_id;
$$;

create or replace function public.product_image_count(_product_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.product_images i where i.product_id = _product_id;
$$;

-- Rules every product write must pass. Runs as the caller (security invoker)
-- so is_privileged_session() can tell browser sessions from server code.
create or replace function public.products_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _privileged  boolean := public.is_privileged_session();
  _admin       boolean := public.is_admin();
  _scan        text;
  _hits        text[];
begin
  if not _privileged and not _admin then
    if tg_op = 'INSERT' then
      new.flagged_at := null;
      new.flagged_reason := null;
    else
      -- Only admins (clear_product_flag) and the trigger itself touch flags.
      new.flagged_at := old.flagged_at;
      new.flagged_reason := old.flagged_reason;
      if new.vendor_id <> old.vendor_id then
        raise exception 'A product cannot move to another vendor' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or new.category is distinct from old.category then
    if not public.category_is_assignable(new.category) then
      raise exception 'That category is not available for listings' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT'
     or new.corridor_id is distinct from old.corridor_id
     or new.vendor_id is distinct from old.vendor_id then
    if not public.corridor_matches_vendor(new.corridor_id, new.vendor_id) then
      raise exception 'The corridor must be active and start in the vendor''s country' using errcode = 'P0001';
    end if;
  end if;

  -- Prohibited-terms scan. A match hides the listing and flags it for review.
  -- Once flagged it stays flagged until an admin clears it, so a vendor cannot
  -- edit the wording until it passes.
  if tg_op = 'INSERT'
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.brand is distinct from old.brand
     or new.condition_notes is distinct from old.condition_notes
     or new.specs is distinct from old.specs then
    _scan := concat_ws(' ',
      new.title, new.description, new.brand, new.condition_notes,
      (select string_agg(s.value, ' ')
         from jsonb_each_text(case when jsonb_typeof(new.specs) = 'object' then new.specs else '{}'::jsonb end) s)
    );
    _hits := public.matched_prohibited_terms(_scan);
    if cardinality(_hits) > 0 then
      new.active := false;
      if new.flagged_at is null then
        new.flagged_at := now();
        new.flagged_reason := left('Matched prohibited terms: ' || array_to_string(_hits, ', '), 500);
      end if;
    end if;
  end if;

  -- Publishing rules for browser sessions.
  if new.active and not _privileged then
    if new.flagged_at is not null then
      raise exception 'This listing is under review and cannot be published yet' using errcode = 'P0001';
    end if;
    if (tg_op = 'INSERT' or not old.active) and public.product_image_count(new.id) = 0 then
      raise exception 'Add at least one image before publishing' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger products_guard_write
  before insert or update on public.products
  for each row execute function public.products_guard_write();

create or replace function public.products_audit_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.flagged_at is not null and (tg_op = 'INSERT' or old.flagged_at is null) then
    perform public.write_audit('product.flagged', 'products', new.id,
      jsonb_build_object('reason', new.flagged_reason));
  end if;
  return new;
end;
$$;

create trigger products_audit_flag
  after insert or update of flagged_at on public.products
  for each row execute function public.products_audit_flag();

-- Admin: clear a flag. The product stays inactive until its vendor publishes it.
create or replace function public.clear_product_flag(_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can clear product flags' using errcode = '42501';
  end if;

  update public.products
     set flagged_at = null, flagged_reason = null
   where id = _product_id and flagged_at is not null;

  if not found then
    raise exception 'That product is not flagged' using errcode = 'P0002';
  end if;

  perform public.write_audit('product.flag_cleared', 'products', _product_id);
end;
$$;

-- product_images: max 6 per product; files must sit in the product's own
-- folder. Replaces the Batch 1 version (10 images, security definer).
-- Seed and other server-side code may use demo/<name>.<ext> for local demo data.
create or replace function public.product_images_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _vendor_id  uuid := public.product_vendor_id(new.product_id);
  _demo_path  boolean;
begin
  if _vendor_id is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  -- One upload at a time per product, so the count check below is reliable.
  perform pg_advisory_xact_lock(hashtextextended(new.product_id::text, 0));

  _demo_path := public.is_privileged_session() and new.storage_path ~ '^demo/[a-z0-9-]{1,64}\.(jpg|png|webp)$';

  if not _demo_path
     and new.storage_path !~ ('^' || _vendor_id || '/' || new.product_id || '/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$') then
    raise exception 'Image path must be <vendor_id>/<product_id>/<name>.jpg, .png or .webp'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' and public.product_image_count(new.product_id) >= 6 then
    raise exception 'A product can have at most 6 images' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. vendors
-- ---------------------------------------------------------------------------

alter table public.vendors
  add column phone                text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column business_reg_number  text check (char_length(business_reg_number) between 1 and 50),
  add column categories           text[] not null default '{}'::text[] check (cardinality(categories) <= 12),
  add column id_document_path     text check (char_length(id_document_path) <= 300);

-- Every category a vendor sells in must be one listings can use, with no repeats.
create or replace function public.vendors_validate_categories()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _slug text;
begin
  if cardinality(new.categories) <> (select count(distinct s) from unnest(new.categories) s) then
    raise exception 'Categories contain duplicates' using errcode = 'P0001';
  end if;
  foreach _slug in array new.categories loop
    if not public.category_is_assignable(_slug) then
      raise exception 'Category "%" is not available', _slug using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

create trigger vendors_validate_categories
  before insert or update of categories on public.vendors
  for each row execute function public.vendors_validate_categories();

-- Rules for browser sessions writing vendors rows. Replaces the Batch 2-prep
-- version from the payout-review migration and keeps its payout rules.
--   * New applications start pending and must be complete.
--   * An owner cannot change their own status, except resubmitting after a
--     rejection (rejected -> pending, which clears the reason).
--   * Once a decision is made (approved or suspended) identity details are
--     locked. Phone and categories stay editable.
--   * Payout columns change only through the review functions.
create or replace function public.vendors_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
       new.payout_details_json is distinct from old.payout_details_json
       or new.pending_payout_details_json is distinct from old.pending_payout_details_json
       or new.payout_change_requested_at is distinct from old.payout_change_requested_at
       or new.payout_change_token is distinct from old.payout_change_token
     ) then
    raise exception 'Payout details change through the review process' using errcode = 'P0001';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.verification_notes := null;
    new.pending_payout_details_json := null;
    new.payout_change_requested_at := null;
    new.payout_change_token := null;
  else
    if new.owner_id <> old.owner_id then
      raise exception 'Only admins can change vendor status or notes' using errcode = 'P0001';
    end if;

    if new.status is distinct from old.status then
      if old.status = 'rejected' and new.status = 'pending' then
        new.verification_notes := null;
      else
        raise exception 'Only admins can change vendor status or notes' using errcode = 'P0001';
      end if;
    elsif new.verification_notes is distinct from old.verification_notes then
      raise exception 'Only admins can change vendor status or notes' using errcode = 'P0001';
    end if;

    if old.status in ('approved', 'suspended') and (
         new.business_name is distinct from old.business_name
         or new.country_code is distinct from old.country_code
         or new.city is distinct from old.city
         or new.business_reg_number is distinct from old.business_reg_number
         or new.id_document_path is distinct from old.id_document_path
       ) then
      raise exception 'Contact support to change these business details' using errcode = 'P0001';
    end if;
  end if;

  if new.phone is null or cardinality(new.categories) = 0 or new.id_document_path is null then
    raise exception 'The application needs a phone number, at least one category and an ID document'
      using errcode = 'P0001';
  end if;

  -- The ID document must sit in the applicant's own storage folder.
  if new.id_document_path !~ ('^' || new.owner_id || '/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|pdf)$') then
    raise exception 'The ID document path is not valid' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- One audit row per status change, with the reason for rejections and suspensions.
create or replace function public.vendors_audit_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('vendor.applied', 'vendors', new.id,
      jsonb_build_object('business_name', new.business_name));
  elsif new.status is distinct from old.status then
    perform public.write_audit('vendor.status_changed', 'vendors', new.id,
      jsonb_build_object(
        'from', old.status,
        'to', new.status,
        'reason', case when new.status in ('rejected', 'suspended') then new.verification_notes end
      ));
  end if;
  return new;
end;
$$;

-- Transitions:  pending -> approved | rejected,  approved -> suspended,
--               suspended -> approved (reinstate),  rejected -> pending (owner resubmits).
create or replace function public.approve_vendor(_vendor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner_id  uuid;
  _status    public.vendor_status;
  _doc       text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve vendors' using errcode = '42501';
  end if;

  select v.owner_id, v.status, v.id_document_path into _owner_id, _status, _doc
  from public.vendors v where v.id = _vendor_id for update;

  if not found then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if _status not in ('pending', 'suspended') then
    raise exception 'Only pending or suspended vendors can be approved' using errcode = 'P0001';
  end if;
  if _status = 'pending' and _doc is null then
    raise exception 'The application has no ID document' using errcode = 'P0001';
  end if;

  update public.vendors set status = 'approved', verification_notes = null where id = _vendor_id;
  update public.profiles set role = 'vendor' where id = _owner_id and role = 'buyer';
end;
$$;

create or replace function public.reject_vendor(_vendor_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _status  public.vendor_status;
  _clean   text := btrim(coalesce(_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can reject vendors' using errcode = '42501';
  end if;
  if char_length(_clean) < 5 or char_length(_clean) > 2000 then
    raise exception 'A reason of 5 to 2000 characters is required' using errcode = '22023';
  end if;

  select v.status into _status from public.vendors v where v.id = _vendor_id for update;
  if not found then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if _status <> 'pending' then
    raise exception 'Only pending applications can be rejected' using errcode = 'P0001';
  end if;

  update public.vendors set status = 'rejected', verification_notes = _clean where id = _vendor_id;
end;
$$;

create or replace function public.suspend_vendor(_vendor_id uuid, _note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner_id  uuid;
  _status    public.vendor_status;
  _clean     text := btrim(coalesce(_note, ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can suspend vendors' using errcode = '42501';
  end if;
  if char_length(_clean) < 5 or char_length(_clean) > 2000 then
    raise exception 'A reason of 5 to 2000 characters is required' using errcode = '22023';
  end if;

  select v.owner_id, v.status into _owner_id, _status
  from public.vendors v where v.id = _vendor_id for update;
  if not found then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if _status <> 'approved' then
    raise exception 'Only approved vendors can be suspended' using errcode = 'P0001';
  end if;

  update public.vendors set status = 'suspended', verification_notes = _clean where id = _vendor_id;
  update public.profiles set role = 'buyer' where id = _owner_id and role = 'vendor';
end;
$$;

-- Admin: record that an ID document was opened. Called by the document route.
create or replace function public.log_vendor_document_view(_vendor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view ID documents' using errcode = '42501';
  end if;
  perform public.write_audit('vendor.document_viewed', 'vendors', _vendor_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- D. public views
-- ---------------------------------------------------------------------------

-- Public vendor listing. Runs with the owner's rights so visitors can read it
-- without being able to read the vendors table (phone, ID document, payouts).
create or replace view public.vendor_directory
with (security_barrier = true)
as
  select v.id, v.business_name, v.country_code, v.city, v.categories, v.created_at
  from public.vendors v
  where v.status = 'approved';

-- Brand filter options. security_invoker: visitors only count products they
-- are allowed to see (active, not flagged, vendor approved).
create view public.shop_brands
with (security_invoker = true)
as
  select lower(p.brand) as brand_key, min(p.brand) as brand, count(*)::int as product_count
  from public.products p
  where p.brand is not null and btrim(p.brand) <> ''
  group by lower(p.brand);

-- ---------------------------------------------------------------------------
-- E. grants and RLS
-- ---------------------------------------------------------------------------

revoke all on public.categories, public.prohibited_terms, public.shop_brands from anon, authenticated;

grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.prohibited_terms to authenticated;
grant select on public.shop_brands to anon, authenticated;
grant all on public.categories, public.prohibited_terms to service_role;
grant select on public.shop_brands to service_role;

-- Products: browser sessions write only these columns. Flags, id, vendor on
-- update and the search vector are never client-writable.
revoke insert, update on public.products from authenticated;
grant insert (
  vendor_id, title, description, category, brand, condition, condition_notes, price_minor, currency,
  stock, weight_grams, corridor_id, specs, warranty_months, requires_special_handling, active
) on public.products to authenticated;
grant update (
  title, description, category, brand, condition, condition_notes, price_minor, currency,
  stock, weight_grams, corridor_id, specs, warranty_months, requires_special_handling, active
) on public.products to authenticated;

-- Vendors: the new application columns.
grant insert (phone, business_reg_number, categories, id_document_path) on public.vendors to authenticated;
grant update (phone, business_reg_number, categories, id_document_path) on public.vendors to authenticated;

-- Functions. Helpers are called from invoker triggers, so signed-in users need
-- execute. Nothing here is callable by anonymous visitors.
revoke all on function
  public.matched_prohibited_terms(text),
  public.category_is_assignable(text),
  public.corridor_matches_vendor(uuid, uuid),
  public.product_vendor_id(uuid),
  public.product_image_count(uuid),
  public.products_guard_write(),
  public.products_audit_flag(),
  public.vendors_validate_categories(),
  public.reject_vendor(uuid, text),
  public.log_vendor_document_view(uuid),
  public.clear_product_flag(uuid)
  from public, anon;
grant execute on function
  public.matched_prohibited_terms(text),
  public.category_is_assignable(text),
  public.corridor_matches_vendor(uuid, uuid),
  public.product_vendor_id(uuid),
  public.product_image_count(uuid),
  public.products_guard_write(),
  public.vendors_validate_categories(),
  public.reject_vendor(uuid, text),
  public.log_vendor_document_view(uuid),
  public.clear_product_flag(uuid)
  to authenticated, service_role;
grant execute on function public.products_audit_flag() to service_role;

alter table public.categories       enable row level security;
alter table public.prohibited_terms enable row level security;

create policy categories_public_read on public.categories
  for select to anon, authenticated using (active and not prohibited);
create policy categories_admin_all on public.categories
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy prohibited_terms_admin_all on public.prohibited_terms
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Visitors see a product only when it is active, not under review, and its
-- vendor is approved. Suspending a vendor therefore hides every listing.
drop policy products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using (active and flagged_at is null and public.is_approved_vendor(vendor_id));
