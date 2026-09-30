-- Two hardening items found in the Batch 1 review.
--
-- 1. Vendor payout details can no longer be edited directly. A vendor asks for
--    a change, an admin approves it, and only then does it go live. Payouts
--    (Batch 5 and 8) must read payout_details_json, never the pending column.
-- 2. Product image storage: a public-read bucket that only the owning approved
--    vendor (or an admin) can write to, plus a check that product_images rows
--    point at files inside the product's own folder.
--
-- Added as a new migration (not an edit of the Batch 1 files) so it is safe to
-- apply whether or not Batch 1 is already on your project.

-- ---------------------------------------------------------------------------
-- 1. Payout details change review
-- ---------------------------------------------------------------------------

alter table public.vendors
  add column pending_payout_details_json jsonb,
  add column payout_change_requested_at  timestamptz,
  add column payout_change_token         uuid;

alter table public.vendors
  add constraint vendors_payout_details_shape check (
    jsonb_typeof(payout_details_json) = 'object' and pg_column_size(payout_details_json) <= 4096
  ),
  add constraint vendors_pending_payout_shape check (
    pending_payout_details_json is null
    or (jsonb_typeof(pending_payout_details_json) = 'object'
        and pending_payout_details_json <> '{}'::jsonb
        and pg_column_size(pending_payout_details_json) <= 4096)
  ),
  add constraint vendors_pending_payout_complete check (
    (pending_payout_details_json is null) = (payout_change_requested_at is null)
    and (pending_payout_details_json is null) = (payout_change_token is null)
  );

-- Clients may set payout details once, when applying. After that the column is
-- changed only by approve_payout_change(). The pending columns have no client
-- grants at all: request_payout_change() writes them.
revoke update (payout_details_json) on public.vendors from authenticated;

-- Belt and braces: even if a grant is added back by mistake, browser sessions
-- (admins included) cannot touch payout columns on UPDATE. Server-side code and
-- the security definer functions below are not affected.
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
    new.status = 'pending';
    new.verification_notes = null;
    new.pending_payout_details_json = null;
    new.payout_change_requested_at = null;
    new.payout_change_token = null;
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

-- Vendor: ask for new payout details. Replaces any earlier unreviewed request.
-- Returns a random token for this request. The admin must echo it back to
-- approve, which proves they reviewed this exact request. (A token, not a
-- timestamp: timestamps lose precision when they pass through JavaScript.)
create or replace function public.request_payout_change(_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _vendor_id  uuid;
  _status     public.vendor_status;
  _token      uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;

  if _details is null or jsonb_typeof(_details) <> 'object' or _details = '{}'::jsonb then
    raise exception 'Payout details must be a non-empty object' using errcode = '22023';
  end if;
  if pg_column_size(_details) > 4096 then
    raise exception 'Payout details are too large' using errcode = '22023';
  end if;

  select v.id, v.status into _vendor_id, _status
  from public.vendors v
  where v.owner_id = (select auth.uid())
  for update;

  if _vendor_id is null then
    raise exception 'No vendor record for this account' using errcode = 'P0002';
  end if;
  if _status = 'suspended' then
    raise exception 'Suspended vendors cannot change payout details' using errcode = '42501';
  end if;

  update public.vendors
     set pending_payout_details_json = _details,
         payout_change_requested_at = now(),
         payout_change_token = _token
   where id = _vendor_id;

  -- The audit log records that a change happened, never the account numbers.
  perform public.write_audit('vendor.payout_change_requested', 'vendors', _vendor_id);
  return _token;
end;
$$;

-- Admin: make a pending change live. _token must match the request the admin
-- reviewed, so a change submitted a moment later is never approved blind.
create or replace function public.approve_payout_change(_vendor_id uuid, _token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _pending    jsonb;
  _requested  timestamptz;
  _current    uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve payout changes' using errcode = '42501';
  end if;

  select v.pending_payout_details_json, v.payout_change_requested_at, v.payout_change_token
    into _pending, _requested, _current
  from public.vendors v
  where v.id = _vendor_id
  for update;

  if not found then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if _pending is null then
    raise exception 'No payout change is waiting for review' using errcode = 'P0001';
  end if;
  if _current is distinct from _token then
    raise exception 'The request changed since you opened it. Review it again.' using errcode = 'P0001';
  end if;

  update public.vendors
     set payout_details_json = _pending,
         pending_payout_details_json = null,
         payout_change_requested_at = null,
         payout_change_token = null
   where id = _vendor_id;

  perform public.write_audit('vendor.payout_change_approved', 'vendors', _vendor_id,
    jsonb_build_object('requested_at', _requested));
end;
$$;

-- Admin: discard a pending change. The live details stay as they were.
create or replace function public.reject_payout_change(_vendor_id uuid, _note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _requested timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only admins can reject payout changes' using errcode = '42501';
  end if;

  select v.payout_change_requested_at into _requested
  from public.vendors v
  where v.id = _vendor_id and v.pending_payout_details_json is not null
  for update;

  if not found then
    raise exception 'No payout change is waiting for review' using errcode = 'P0002';
  end if;

  update public.vendors
     set pending_payout_details_json = null,
         payout_change_requested_at = null,
         payout_change_token = null
   where id = _vendor_id;

  perform public.write_audit('vendor.payout_change_rejected', 'vendors', _vendor_id,
    jsonb_build_object('requested_at', _requested, 'note', left(nullif(btrim(_note), ''), 500)));
end;
$$;

-- New functions start with broad default execute rights on Supabase. Lock them
-- down to signed-in users (each function also checks who is calling).
revoke all on function
  public.request_payout_change(jsonb),
  public.approve_payout_change(uuid, uuid),
  public.reject_payout_change(uuid, text)
  from public, anon;
grant execute on function
  public.request_payout_change(jsonb),
  public.approve_payout_change(uuid, uuid),
  public.reject_payout_change(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Product image storage
-- ---------------------------------------------------------------------------

-- Public read: product photos are shown to everyone, so the bucket is public and
-- images load from the CDN with no auth round trip (good on slow networks).
-- Trade-off: anyone holding the exact URL can fetch a file, even for a product
-- that is not published yet. Paths contain two random UUIDs, so they cannot be
-- guessed. Writing and listing are restricted by the policies below.
--
-- Path layout: <vendor_id>/<product_id>/<random>.<jpg|png|webp>
-- Keep limits in sync with lib/storage/product-images.ts (a test checks this).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- An approved vendor manages files inside their own <vendor_id>/ folder only.
-- Reads through the API (listing) follow the same rule. Public URLs do not use
-- these policies, so shoppers are unaffected.
create policy product_images_vendor_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select public.current_vendor_id())::text
  );
create policy product_images_vendor_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select public.current_vendor_id())::text
  );
create policy product_images_vendor_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select public.current_vendor_id())::text
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select public.current_vendor_id())::text
  );
create policy product_images_vendor_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select public.current_vendor_id())::text
  );
create policy product_images_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()))
  with check (bucket_id = 'product-images' and (select public.is_admin()));

-- product_images rows must point at a file inside the product's own folder, and
-- a product may have at most 10 images. Without this, a vendor could attach
-- another vendor's photo to their listing.
create or replace function public.product_images_guard_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _vendor_id uuid;
begin
  -- Lock the product so two uploads cannot both slip past the count check.
  select p.vendor_id into _vendor_id
  from public.products p
  where p.id = new.product_id
  for update;

  if _vendor_id is null then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;

  if new.storage_path !~ ('^' || _vendor_id || '/' || new.product_id || '/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$') then
    raise exception 'Image path must be <vendor_id>/<product_id>/<name>.jpg, .png or .webp'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT'
     and (select count(*) from public.product_images i where i.product_id = new.product_id) >= 10 then
    raise exception 'A product can have at most 10 images' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger product_images_guard_write
  before insert or update of product_id, storage_path on public.product_images
  for each row execute function public.product_images_guard_write();

revoke all on function public.product_images_guard_write() from public, anon, authenticated;
