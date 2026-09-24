-- Batch 1: security layer.
-- Helper functions, guard triggers, audit triggers, grants and RLS policies.
--
-- How access works
-- * Browser clients connect as `anon` or `authenticated`. RLS policies and
--   column grants decide what they can see and change.
-- * Server code with the service role key (and the database owner) bypasses
--   RLS. Only that path may write payments, ledger entries, audit log rows
--   and notifications.
-- * Guard triggers add rules RLS cannot express (who may change a role,
--   which columns a buyer may edit). They run as the caller (security
--   invoker), so `current_user` tells us whether the caller is a browser
--   client or server-side code.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- True for server-side sessions (service role, database owner, and code
-- running inside security definer functions). False for browser clients.
-- Must stay security invoker: it inspects the calling role.
create or replace function public.is_privileged_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('anon', 'authenticated');
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.current_user_role()) = 'admin', false);
$$;

-- The caller's vendor id, only when the vendor is approved and the caller
-- holds the vendor role. Null otherwise.
create or replace function public.current_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
  from public.vendors v
  join public.profiles p on p.id = v.owner_id
  where v.owner_id = (select auth.uid())
    and v.status = 'approved'
    and p.role = 'vendor';
$$;

create or replace function public.is_approved_vendor(_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vendors v where v.id = _vendor_id and v.status = 'approved'
  );
$$;

-- Internal: writes one audit row. Not callable by browser clients.
create or replace function public.write_audit(
  _action text,
  _entity_type text,
  _entity_id uuid,
  _details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), _action, _entity_type, _entity_id, coalesce(_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Append-only tables: block UPDATE and DELETE for everyone, service role and
-- table owner included. Corrections are new rows (ledger entry type
-- 'adjustment').
-- ---------------------------------------------------------------------------

create or replace function public.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function public.block_mutation();

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------------------
-- Profiles: sign-up, email sync, role protection
-- ---------------------------------------------------------------------------

-- Sign-up metadata is user-controlled, so it is trimmed and checked here.
-- A role in the metadata is ignored: every new account is a buyer.
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
  -- country when that currency is active, else NGN.
  select c.code, case when cur.active then cur.code end
    into country, currency
  from public.countries c
  join public.currencies cur on cur.code = c.currency_code
  where c.code = meta_country and c.active;

  insert into public.profiles (id, email, full_name, country_code, role, preferred_currency)
  values (new.id, new.email, meta_name, country, 'buyer', coalesce(currency, 'NGN'));

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

-- Nobody changes their own role. Only admins change other people's roles.
-- Server-side code (service role, make-admin script, approve_vendor) is allowed.
create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'Profile id cannot change' using errcode = 'P0001';
  end if;

  if public.is_privileged_session() then
    return new;
  end if;

  if new.email is distinct from old.email then
    raise exception 'Email is managed by sign-in settings' using errcode = 'P0001';
  end if;

  if new.role is distinct from old.role then
    if old.id = (select auth.uid()) then
      raise exception 'You cannot change your own role' using errcode = 'P0001';
    end if;
    if not public.is_admin() then
      raise exception 'Only admins can change roles' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- Applies to everyone, server code included: there must always be an admin.
create or replace function public.profiles_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    -- Lock admin rows so two concurrent demotions cannot both pass.
    perform 1 from public.profiles where role = 'admin' for update;
    if (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'Cannot remove the last admin' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger profiles_protect_last_admin
  before update of role or delete on public.profiles
  for each row execute function public.profiles_protect_last_admin();

create or replace function public.profiles_audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.write_audit(
    'profile.role_changed', 'profiles', new.id,
    jsonb_build_object('from', old.role, 'to', new.role)
  );
  return new;
end;
$$;

create trigger profiles_audit_role_change
  after update of role on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function public.profiles_audit_role_change();

-- ---------------------------------------------------------------------------
-- Vendors: applications start pending; only admins change status
-- ---------------------------------------------------------------------------

create or replace function public.vendors_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status = 'pending';
    new.verification_notes = null;
    return new;
  end if;

  if new.owner_id <> old.owner_id
     or new.status <> old.status
     or new.verification_notes is distinct from old.verification_notes then
    raise exception 'Only admins can change vendor status or notes' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger vendors_guard_write
  before insert or update on public.vendors
  for each row execute function public.vendors_guard_write();

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
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

create trigger vendors_audit_write
  after insert or update on public.vendors
  for each row execute function public.vendors_audit_write();

-- Admin actions. Approval also gives the owner the vendor role; suspension
-- takes it back. Admin owners keep the admin role.
create or replace function public.approve_vendor(_vendor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve vendors' using errcode = '42501';
  end if;

  update public.vendors
     set status = 'approved'
   where id = _vendor_id
  returning owner_id into _owner_id;

  if _owner_id is null then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;

  update public.profiles set role = 'vendor' where id = _owner_id and role = 'buyer';
end;
$$;

create or replace function public.suspend_vendor(_vendor_id uuid, _note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _owner_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can suspend vendors' using errcode = '42501';
  end if;

  update public.vendors
     set status = 'suspended',
         verification_notes = coalesce(nullif(btrim(_note), ''), verification_notes)
   where id = _vendor_id
  returning owner_id into _owner_id;

  if _owner_id is null then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;

  update public.profiles set role = 'buyer' where id = _owner_id and role = 'vendor';
end;
$$;

-- Public vendor listing: approved vendors, name and country only.
-- Runs with the view owner's rights so anon can read it without being able
-- to read the vendors table (which holds payout details).
create view public.vendor_directory
with (security_barrier = true)
as
  select v.id, v.business_name, v.country_code
  from public.vendors v
  where v.status = 'approved';

-- ---------------------------------------------------------------------------
-- Orders: buyers create drafts or quote requests and edit drafts only.
-- Every later status change goes through server-side code.
-- ---------------------------------------------------------------------------

create or replace function public.orders_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() or public.is_admin() then
    return new;
  end if;

  if new.vendor_id is distinct from old.vendor_id
     or new.link_preview_json is distinct from old.link_preview_json
     or new.delivery_code_hash is distinct from old.delivery_code_hash then
    raise exception 'This order field can only be changed by the platform' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger orders_guard_update
  before update on public.orders
  for each row execute function public.orders_guard_update();

-- ---------------------------------------------------------------------------
-- Privileges. Explicit so they do not depend on platform defaults.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Reference data
grant select on public.currencies, public.countries, public.corridors to anon, authenticated;
grant insert, update, delete on public.currencies, public.countries, public.corridors to authenticated;
grant select, insert, update, delete on public.fx_rates, public.fee_rules to authenticated;

-- Profiles: users edit these columns only. role is guarded by trigger.
grant select on public.profiles to authenticated;
grant update (full_name, phone, country_code, preferred_currency, role) on public.profiles to authenticated;

-- Vendors
grant select, delete on public.vendors to authenticated;
grant insert (owner_id, business_name, country_code, city, payout_details_json) on public.vendors to authenticated;
grant update (business_name, country_code, city, payout_details_json, status, verification_notes)
  on public.vendors to authenticated;
grant select on public.vendor_directory to anon, authenticated;

-- Catalog
grant select on public.products, public.product_images to anon, authenticated;
grant insert, update, delete on public.products, public.product_images to authenticated;

-- Recipients
grant select, insert, update, delete on public.recipients to authenticated;

-- Orders. public_tracking_token, buyer_id and order_type never change from a client.
grant select, delete on public.orders to authenticated;
grant insert (buyer_id, recipient_id, corridor_id, vendor_id, order_type, status, source_url, buyer_currency)
  on public.orders to authenticated;
grant update (recipient_id, corridor_id, vendor_id, source_url, link_preview_json, status,
              buyer_currency, delivery_code_hash)
  on public.orders to authenticated;

-- Written by admins now, by server functions in later batches.
grant select, insert, update, delete on
  public.order_items, public.quotes, public.quote_lines,
  public.shipments, public.shipment_orders, public.shipment_events,
  public.inspections, public.inspection_media
  to authenticated;

-- Money and audit: read-only for clients (admins via RLS). Writes are server-only.
grant select on public.payments, public.ledger_entries, public.audit_log to authenticated;

-- Disputes: buyers open them; admins resolve them.
grant select on public.disputes to authenticated;
grant insert (order_id, reason) on public.disputes to authenticated;
grant update (status, resolution_note) on public.disputes to authenticated;

-- Notifications: users read their own. Writes are server-only.
grant select on public.notifications to authenticated;

-- Functions
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_privileged_session(),
  public.current_user_role(),
  public.is_admin(),
  public.current_vendor_id(),
  public.is_approved_vendor(uuid)
  to anon, authenticated;
grant execute on function public.approve_vendor(uuid), public.suspend_vendor(uuid, text) to authenticated;
-- Trigger functions run as the caller and need execute on themselves.
grant execute on function
  public.set_updated_at(),
  public.block_mutation(),
  public.profiles_guard_update(),
  public.vendors_guard_write(),
  public.orders_guard_update()
  to anon, authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security: on for every table in the schema.
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- Reference data: everyone reads active rows. Admins read and write all.
create policy currencies_public_read on public.currencies
  for select to anon, authenticated using (active);
create policy countries_public_read on public.countries
  for select to anon, authenticated using (active);
create policy corridors_public_read on public.corridors
  for select to anon, authenticated using (active);

create policy currencies_admin_all on public.currencies
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy countries_admin_all on public.countries
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy corridors_admin_all on public.corridors
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy fx_rates_admin_all on public.fx_rates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy fee_rules_admin_all on public.fee_rules
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Profiles. Rows are created by the sign-up trigger only.
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy profiles_admin_read on public.profiles
  for select to authenticated using ((select public.is_admin()));
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Vendors. The public uses vendor_directory instead of this table.
create policy vendors_read_own on public.vendors
  for select to authenticated using (owner_id = (select auth.uid()));
create policy vendors_apply on public.vendors
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy vendors_update_own on public.vendors
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy vendors_admin_all on public.vendors
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Products: public sees active products from approved vendors.
create policy products_public_read on public.products
  for select to anon, authenticated
  using (active and public.is_approved_vendor(vendor_id));
create policy products_vendor_all on public.products
  for all to authenticated
  using (vendor_id = (select public.current_vendor_id()))
  with check (vendor_id = (select public.current_vendor_id()));
create policy products_admin_all on public.products
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Product images follow the visibility of their product.
create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id));
create policy product_images_vendor_write on public.product_images
  for all to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.vendor_id = (select public.current_vendor_id())
  ))
  with check (exists (
    select 1 from public.products p
    where p.id = product_id and p.vendor_id = (select public.current_vendor_id())
  ));
create policy product_images_admin_all on public.product_images
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Recipients: owned by the buyer who created them.
create policy recipients_own on public.recipients
  for all to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy recipients_admin_all on public.recipients
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Orders
create policy orders_buyer_read on public.orders
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy orders_vendor_read on public.orders
  for select to authenticated using (vendor_id = (select public.current_vendor_id()));
create policy orders_buyer_create on public.orders
  for insert to authenticated
  with check (
    buyer_id = (select auth.uid())
    and status in ('draft', 'quote_requested')
    and (recipient_id is null or exists (
      select 1 from public.recipients r where r.id = recipient_id and r.created_by = (select auth.uid())
    ))
    and (vendor_id is null or public.is_approved_vendor(vendor_id))
  );
create policy orders_buyer_edit_draft on public.orders
  for update to authenticated
  using (buyer_id = (select auth.uid()) and status = 'draft')
  with check (
    buyer_id = (select auth.uid())
    and status in ('draft', 'quote_requested')
    and (recipient_id is null or exists (
      select 1 from public.recipients r where r.id = recipient_id and r.created_by = (select auth.uid())
    ))
  );
create policy orders_buyer_delete_draft on public.orders
  for delete to authenticated using (buyer_id = (select auth.uid()) and status = 'draft');
create policy orders_admin_all on public.orders
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Order items: visible with the order. Written by admins or server code.
create policy order_items_read_with_order on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy order_items_admin_all on public.order_items
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Quotes: the buyer reads quotes for their own orders.
create policy quotes_buyer_read on public.quotes
  for select to authenticated
  using (exists (
    select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())
  ));
create policy quotes_admin_all on public.quotes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy quote_lines_buyer_read on public.quote_lines
  for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id));
create policy quote_lines_admin_all on public.quote_lines
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Shipments: visible to buyers and vendors of any order inside them.
create policy shipment_orders_read_with_order on public.shipment_orders
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy shipment_orders_admin_all on public.shipment_orders
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy shipments_read_with_order on public.shipments
  for select to authenticated
  using (exists (select 1 from public.shipment_orders so where so.shipment_id = shipments.id));
create policy shipments_admin_all on public.shipments
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy shipment_events_read_with_shipment on public.shipment_events
  for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
create policy shipment_events_admin_all on public.shipment_events
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Inspections: visible to the order's buyer and vendor.
create policy inspections_read_with_order on public.inspections
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy inspections_admin_all on public.inspections
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy inspection_media_read_with_inspection on public.inspection_media
  for select to authenticated
  using (exists (select 1 from public.inspections i where i.id = inspection_id));
create policy inspection_media_admin_all on public.inspection_media
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Payments, ledger, audit log: admins read. No client writes (no grants).
create policy payments_admin_read on public.payments
  for select to authenticated using ((select public.is_admin()));
create policy ledger_entries_admin_read on public.ledger_entries
  for select to authenticated using ((select public.is_admin()));
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using ((select public.is_admin()));

-- Disputes: the buyer opens one on their own order; buyer and vendor read.
create policy disputes_read_with_order on public.disputes
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy disputes_buyer_open on public.disputes
  for insert to authenticated
  with check (
    raised_by = (select auth.uid())
    and status = 'open'
    and resolution_note is null
    and exists (
      select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())
    )
  );
create policy disputes_admin_all on public.disputes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Notifications: users read their own.
create policy notifications_read_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_admin_read on public.notifications
  for select to authenticated using ((select public.is_admin()));
