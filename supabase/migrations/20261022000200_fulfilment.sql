-- Batch 5, step 2: fulfilment. Purchase, inspection proof, the buyer's
-- decision, disputes and manual shipments.
--
-- A. state machine: domestic orders may skip the customs steps
-- B. orders, inspections, disputes: new columns, direct writes closed
-- C. inspection-media bucket and its rules
-- D. functions
-- E. privileges
--
-- Every status change goes through transition_order().

-- ---------------------------------------------------------------------------
-- A. State machine
-- ---------------------------------------------------------------------------

-- Nigeria to Nigeria orders have no customs. lib/orders/state-machine.ts holds
-- the same three moves and a test compares the two.
insert into public.order_status_transitions (from_status, to_status) values
  ('shipped', 'out_for_delivery'),
  ('in_transit', 'out_for_delivery'),
  ('arrived_destination', 'out_for_delivery');

-- ---------------------------------------------------------------------------
-- B. Columns, and closing direct writes
-- ---------------------------------------------------------------------------

alter table public.orders
  add column supplier_reference text check (char_length(supplier_reference) <= 200),
  add column purchased_at       timestamptz;

alter table public.inspections add column auto_approved boolean not null default false;
-- One inspection waits for the buyer at a time.
create unique index inspections_one_undecided_per_order on public.inspections (order_id) where buyer_decision is null;

-- Where the order was when the dispute opened, so a dispute decided for the
-- seller can put it back.
alter table public.disputes add column previous_status public.order_status;

-- An order is on at most one shipment.
create unique index shipment_orders_order_once on public.shipment_orders (order_id);

-- Shipment history is not rewritten.
create trigger shipment_events_append_only
  before update or delete on public.shipment_events
  for each row execute function public.block_mutation();

-- These tables change through the functions below, so a status and its
-- records can never disagree. Reading stays as before.
revoke insert, update, delete on
  public.shipments, public.shipment_orders, public.shipment_events,
  public.inspections, public.inspection_media
  from authenticated;
revoke insert, update on public.disputes from authenticated;
drop policy disputes_buyer_open on public.disputes;

-- ---------------------------------------------------------------------------
-- C. inspection-media (private)
-- ---------------------------------------------------------------------------

-- 2 to 6 photos and one optional video of at most 20 MB. Files go to
-- <order_id>/<file>. Only the order's vendor (while the item is being
-- prepared) or an admin uploads. The buyer, the vendor and admins read, through
-- short-lived signed links made by the app. Nobody else, and never public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-media', 'inspection-media', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.inspection_folder_order(_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when (storage.foldername(_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(_name))[1])::uuid end;
$$;

-- Who may add proof for an order: an admin, or the approved vendor of a catalog order that is being prepared.
create or replace function public.can_manage_inspection(_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _order_id is not null and (
    (select public.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = _order_id and o.order_type = 'catalog' and o.status = 'purchased'
        and o.vendor_id = (select public.current_vendor_id())
        and public.is_approved_vendor(o.vendor_id)
    )
  );
$$;

-- Who may see proof: the buyer, the order's vendor, admins.
create or replace function public.can_view_inspection(_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _order_id is not null and (
    (select public.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = _order_id
        and (o.buyer_id = (select auth.uid())
             or (o.order_type = 'catalog' and o.vendor_id = (select public.current_vendor_id())))
    )
  );
$$;

-- Security definer so the count does not re-enter the storage.objects policies.
create or replace function public.inspection_folder_count(_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from storage.objects o
  where o.bucket_id = 'inspection-media' and o.name like _order_id::text || '/%';
$$;

create policy inspection_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-media'
    and array_length(storage.foldername(name), 1) = 1
    and public.can_manage_inspection(public.inspection_folder_order(name))
    and public.inspection_folder_count(public.inspection_folder_order(name)) < 12
  );
create policy inspection_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-media' and public.can_view_inspection(public.inspection_folder_order(name)));
create policy inspection_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'inspection-media' and public.can_manage_inspection(public.inspection_folder_order(name)));

-- ---------------------------------------------------------------------------
-- D. Functions
-- ---------------------------------------------------------------------------

-- The item has been bought: by the admin for a link order, by the vendor for
-- their own catalog order. An order flagged for review waits for an admin first.
create or replace function public.mark_purchased(_order_id uuid, _supplier_reference text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _user   uuid := (select auth.uid());
  _order  public.orders;
begin
  select * into _order from public.orders where id = _order_id for update;
  if _user is null or not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not coalesce((select public.is_admin())
          or (_order.order_type = 'catalog' and _order.vendor_id = (select public.current_vendor_id())
              and public.is_approved_vendor(_order.vendor_id)), false) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status <> 'paid' then
    raise exception 'Only a paid order can be marked as purchased' using errcode = 'P0001';
  end if;
  if cardinality(_order.review_flags) > 0 then
    raise exception 'This order needs an admin''s review first' using errcode = 'P0001', hint = 'flagged';
  end if;
  if char_length(coalesce(_supplier_reference, '')) > 200 then
    raise exception 'The reference is too long' using errcode = '22023';
  end if;
  update public.orders
     set supplier_reference = nullif(btrim(_supplier_reference), ''), purchased_at = now()
   where id = _order_id;
  perform public.transition_order(_order_id, 'purchased', 'Item purchased', _user);
end;
$$;

-- Records the inspection proof and moves the order to inspection_pending.
-- Server code only: the app checks the video length (the database cannot read
-- a video), and passes who is acting. This function checks that person is an
-- admin or the order's vendor, the files exist in the bucket, and the counts.
create or replace function public.submit_inspection(
  _order_id uuid,
  _actor uuid,
  _media jsonb,
  _serial text,
  _notes text default null,
  _video_seconds int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order    public.orders;
  _item     jsonb;
  _path     text;
  _type     text;
  _images   int := 0;
  _videos   int := 0;
  _size     bigint;
  _inspection uuid;
begin
  select * into _order from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not (
    exists (select 1 from public.profiles p where p.id = _actor and p.role = 'admin')
    or (_order.order_type = 'catalog' and exists (
          select 1 from public.vendors v
          where v.id = _order.vendor_id and v.owner_id = _actor and v.status = 'approved'))
  ) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status <> 'purchased' then
    raise exception 'Proof can be added once the item is marked as purchased' using errcode = 'P0001';
  end if;
  if cardinality(_order.review_flags) > 0 then
    raise exception 'This order needs an admin''s review first' using errcode = 'P0001', hint = 'flagged';
  end if;
  if char_length(btrim(coalesce(_serial, ''))) < 2 or char_length(btrim(_serial)) > 100 then
    raise exception 'Enter the serial number or IMEI (or N/A)' using errcode = 'P0001';
  end if;
  if char_length(coalesce(_notes, '')) > 5000 then
    raise exception 'The notes are too long' using errcode = '22023';
  end if;
  if _media is null or jsonb_typeof(_media) <> 'array' or jsonb_array_length(_media) > 7 then
    raise exception 'Add 2 to 6 photos and at most one video' using errcode = 'P0001';
  end if;

  for _item in select * from jsonb_array_elements(_media) loop
    _path := _item ->> 'path';
    _type := _item ->> 'type';
    if _type not in ('image', 'video') or _path is null
       or _path !~ ('^' || _order_id::text || '/[A-Za-z0-9._-]{1,100}$') or _path like '%..%' then
      raise exception 'A file is not in this order''s folder' using errcode = 'P0001';
    end if;
    if _type = 'image' and lower(_path) !~ '\.(jpe?g|png|webp)$' then
      raise exception 'Photos must be JPG, PNG or WebP' using errcode = 'P0001';
    end if;
    if _type = 'video' and lower(_path) !~ '\.(mp4|mov)$' then
      raise exception 'The video must be MP4 or MOV' using errcode = 'P0001';
    end if;
    select (o.metadata ->> 'size')::bigint into _size
      from storage.objects o where o.bucket_id = 'inspection-media' and o.name = _path;
    if not found then
      raise exception 'A file was not uploaded' using errcode = 'P0001';
    end if;
    if _type = 'video' then
      _videos := _videos + 1;
      if _size > 20971520 then
        raise exception 'The video is over 20 MB' using errcode = 'P0001';
      end if;
    else
      _images := _images + 1;
    end if;
  end loop;
  if _images < 2 or _images > 6 or _videos > 1 then
    raise exception 'Add 2 to 6 photos and at most one video' using errcode = 'P0001';
  end if;
  if _videos = 1 and (_video_seconds is null or _video_seconds < 1 or _video_seconds > 30) then
    raise exception 'The video can be at most 30 seconds' using errcode = 'P0001';
  end if;

  insert into public.inspections (order_id, submitted_by, notes, serial_or_imei)
  values (_order_id, _actor, nullif(btrim(_notes), ''), btrim(_serial))
  returning id into _inspection;

  insert into public.inspection_media (inspection_id, storage_path, media_type)
  select _inspection, m ->> 'path', m ->> 'type' from jsonb_array_elements(_media) m;

  perform public.transition_order(_order_id, 'inspection_pending', 'Inspection proof uploaded', _actor);
  perform public.queue_notification(_order.buyer_id, null, 'inspection_ready',
    jsonb_build_object('order_id', _order_id));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_actor, 'inspection.submitted', 'inspections', _inspection,
          jsonb_build_object('order_id', _order_id, 'photos', _images, 'videos', _videos));
  return _inspection;
end;
$$;

-- The buyer looks at the proof: approve, or dispute with a reason.
create or replace function public.decide_inspection(_order_id uuid, _decision text, _reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _buyer  uuid := (select auth.uid());
  _order  public.orders;
  _insp   public.inspections;
begin
  select * into _order from public.orders where id = _order_id and buyer_id = _buyer for update;
  if _buyer is null or not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _decision not in ('approved', 'disputed') then
    raise exception 'Choose approve or dispute' using errcode = '22023';
  end if;
  if _order.status <> 'inspection_pending' then
    raise exception 'There is no proof waiting for your answer' using errcode = 'P0001';
  end if;
  select * into _insp from public.inspections
   where order_id = _order_id and buyer_decision is null order by created_at desc limit 1 for update;
  if not found then
    raise exception 'There is no proof waiting for your answer' using errcode = 'P0001';
  end if;

  if _decision = 'disputed' then
    if char_length(btrim(coalesce(_reason, ''))) < 10 or char_length(btrim(_reason)) > 5000 then
      raise exception 'Tell us what is wrong, in at least 10 characters' using errcode = 'P0001';
    end if;
    update public.inspections set buyer_decision = 'disputed', decided_at = now() where id = _insp.id;
    insert into public.disputes (order_id, raised_by, reason, previous_status)
    values (_order_id, _buyer, btrim(_reason), _order.status);
    perform public.transition_order(_order_id, 'disputed', 'The buyer disputed the inspection proof', _buyer);
    perform public.queue_notification(null, 'admins', 'dispute_opened', jsonb_build_object('order_id', _order_id));
  else
    update public.inspections set buyer_decision = 'approved', decided_at = now() where id = _insp.id;
    perform public.transition_order(_order_id, 'inspection_approved', 'The buyer approved the inspection proof', _buyer);
  end if;
end;
$$;

-- Approves every inspection the buyer left unanswered for 48 hours. Run by a
-- schedule (Batch 6). Returns how many.
create or replace function public.auto_approve_inspections()
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
    select i.id as inspection_id, i.order_id
      from public.inspections i
      join public.orders o on o.id = i.order_id and o.status = 'inspection_pending'
     where i.buyer_decision is null and i.created_at <= now() - interval '48 hours'
     order by i.created_at
     limit 500
     for update of i skip locked
  loop
    update public.inspections
       set buyer_decision = 'approved', decided_at = now(), auto_approved = true
     where id = _row.inspection_id;
    perform public.transition_order(_row.order_id, 'inspection_approved',
      'Approved automatically: no answer within 48 hours', null);
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (null, 'inspection.auto_approved', 'inspections', _row.inspection_id,
            jsonb_build_object('order_id', _row.order_id));
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

-- Admin decides a dispute.
--   'buyer'  the buyer is right: the order stays disputed until the refund is recorded.
--   'seller' the seller is right: the order goes back to where it was.
create or replace function public.resolve_dispute(_dispute_id uuid, _outcome text, _note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin   uuid := (select auth.uid());
  _dispute public.disputes;
  _status  public.order_status;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can resolve disputes' using errcode = '42501';
  end if;
  if _outcome not in ('buyer', 'seller') then
    raise exception 'Choose who the dispute is decided for' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(_note, ''))) < 5 or char_length(btrim(_note)) > 5000 then
    raise exception 'Write a note of at least 5 characters' using errcode = 'P0001';
  end if;
  select * into _dispute from public.disputes where id = _dispute_id for update;
  if not found then
    raise exception 'Dispute not found' using errcode = 'P0002';
  end if;
  if _dispute.status not in ('open', 'under_review') then
    raise exception 'This dispute is already resolved' using errcode = 'P0001';
  end if;

  update public.disputes
     set status = case when _outcome = 'buyer' then 'resolved_buyer' else 'resolved_vendor' end::public.dispute_status,
         resolution_note = btrim(_note)
   where id = _dispute_id;

  if _outcome = 'seller' then
    select o.status into _status from public.orders o where o.id = _dispute.order_id for update;
    if _status = 'disputed' and _dispute.previous_status is not null then
      -- The proof the buyer disputed counts as accepted, so the order resumes after inspection.
      perform public.transition_order(_dispute.order_id,
        case when _dispute.previous_status = 'inspection_pending'
             then 'inspection_approved'::public.order_status else _dispute.previous_status end,
        'Dispute decided for the seller', _admin);
    end if;
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_admin, 'dispute.resolved', 'disputes', _dispute_id,
          jsonb_build_object('order_id', _dispute.order_id, 'outcome', _outcome, 'note', left(btrim(_note), 500)));
end;
$$;

-- Manual shipments. Admin only.
create or replace function public.create_shipment(
  _partner text,
  _tracking_number text,
  _origin char(2),
  _destination char(2),
  _order_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id  uuid;
  _o   uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can create shipments' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(_partner, ''))) < 1 or char_length(btrim(_partner)) > 80 then
    raise exception 'Enter the shipping partner' using errcode = 'P0001';
  end if;
  insert into public.shipments (logistics_partner, adapter, tracking_number, status, origin_country, destination_country)
  values (btrim(_partner), 'manual', nullif(btrim(_tracking_number), ''), 'pending', _origin, _destination)
  returning id into _id;
  foreach _o in array coalesce(_order_ids, '{}') loop
    perform public.attach_order_to_shipment(_id, _o);
  end loop;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'shipment.created', 'shipments', _id,
          jsonb_build_object('partner', btrim(_partner), 'orders', coalesce(cardinality(_order_ids), 0)));
  return _id;
end;
$$;

-- Adds an inspected order to a shipment that has not started yet.
create or replace function public.attach_order_to_shipment(_shipment_id uuid, _order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _shipment public.shipments;
  _order    public.orders;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can change shipments' using errcode = '42501';
  end if;
  select * into _shipment from public.shipments where id = _shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if _shipment.status <> 'pending' then
    raise exception 'This shipment has already started. Orders can only join before the first event.' using errcode = 'P0001';
  end if;
  select * into _order from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status <> 'inspection_approved' then
    raise exception 'Only an order whose inspection was approved can be shipped' using errcode = 'P0001';
  end if;
  if cardinality(_order.review_flags) > 0 then
    raise exception 'This order needs an admin''s review first' using errcode = 'P0001', hint = 'flagged';
  end if;
  insert into public.shipment_orders (shipment_id, order_id) values (_shipment_id, _order_id);
end;
$$;

-- One event on a shipment moves every attached order that can legally take
-- that step. Orders that cannot (for example one that is disputed) are skipped
-- and listed in the answer. Steps go forward only.
create or replace function public.add_shipment_event(
  _shipment_id uuid,
  _status text,
  _note text default null,
  _location text default null,
  _occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin     uuid := (select auth.uid());
  _shipment  public.shipments;
  _steps     text[] := array['shipped', 'in_transit', 'arrived_destination', 'customs_cleared', 'out_for_delivery'];
  _rank      int := array_position(_steps, _status);
  _current   int;
  _row       record;
  _moved     uuid[] := '{}';
  _skipped   jsonb := '[]'::jsonb;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can add shipment events' using errcode = '42501';
  end if;
  if _rank is null then
    raise exception 'Choose one of: shipped, in transit, arrived in Nigeria, customs cleared, out for delivery'
      using errcode = '22023';
  end if;
  select * into _shipment from public.shipments where id = _shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  _current := coalesce(array_position(_steps, _shipment.status), 0);
  if _rank <= _current then
    raise exception 'This shipment is already at or past that step' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.shipment_orders so where so.shipment_id = _shipment_id) then
    raise exception 'Attach at least one order first' using errcode = 'P0001';
  end if;

  insert into public.shipment_events (shipment_id, status, note, location, occurred_at, created_by)
  values (_shipment_id, _status, nullif(btrim(_note), ''), nullif(btrim(_location), ''),
          coalesce(_occurred_at, now()), _admin);
  update public.shipments set status = _status where id = _shipment_id;

  for _row in
    select o.id, o.status
      from public.shipment_orders so join public.orders o on o.id = so.order_id
     where so.shipment_id = _shipment_id
     order by o.created_at
     for update of o
  loop
    -- A disputed order waits for the admin; it never rides along with a shipment.
    if _row.status <> 'disputed' and exists (
      select 1 from public.order_status_transitions t
       where t.from_status = _row.status and t.to_status = _status::public.order_status
    ) then
      perform public.transition_order(_row.id, _status::public.order_status,
        'Shipment: ' || replace(_status, '_', ' '), _admin);
      _moved := array_append(_moved, _row.id);
    else
      _skipped := _skipped || jsonb_build_object('order_id', _row.id, 'status', _row.status);
    end if;
  end loop;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_admin, 'shipment.event', 'shipments', _shipment_id,
          jsonb_build_object('status', _status, 'moved', cardinality(_moved), 'skipped', jsonb_array_length(_skipped)));
  return jsonb_build_object('moved', to_jsonb(_moved), 'skipped', _skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.inspection_folder_order(text),
  public.can_manage_inspection(uuid),
  public.can_view_inspection(uuid),
  public.inspection_folder_count(uuid),
  public.mark_purchased(uuid, text),
  public.submit_inspection(uuid, uuid, jsonb, text, text, int),
  public.decide_inspection(uuid, text, text),
  public.auto_approve_inspections(),
  public.resolve_dispute(uuid, text, text),
  public.create_shipment(text, text, char, char, uuid[]),
  public.attach_order_to_shipment(uuid, uuid),
  public.add_shipment_event(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;

-- Used by storage policies, which run as the caller.
grant execute on function
  public.inspection_folder_order(text),
  public.can_manage_inspection(uuid),
  public.can_view_inspection(uuid),
  public.inspection_folder_count(uuid)
  to authenticated, service_role;

grant execute on function
  public.mark_purchased(uuid, text),
  public.decide_inspection(uuid, text, text),
  public.resolve_dispute(uuid, text, text),
  public.create_shipment(text, text, char, char, uuid[]),
  public.attach_order_to_shipment(uuid, uuid),
  public.add_shipment_event(uuid, text, text, text, timestamptz)
  to authenticated, service_role;

grant execute on function
  public.submit_inspection(uuid, uuid, jsonb, text, text, int),
  public.auto_approve_inspections()
  to service_role;
