-- Batch 5, step 3: delivery code, public tracking, vendor order list, payouts and refunds.
--
-- A. delivery_codes: the code is stored twice, never in clear text. A keyed
--    hash (checked on the door) and an encrypted copy (shown to the buyer).
--    The keys live in server environment variables. Nobody signed in can read
--    this table.
-- B. issue_delivery_code, confirm_delivery_with_code, unlock_delivery_code,
--    admin_mark_delivered
-- C. get_tracking: the only thing the public tracking page may read
-- D. vendor_orders: a vendor's paid orders, recipient city only
-- E. release_to_vendor, record_refund (admin through server code)

-- ---------------------------------------------------------------------------
-- A. delivery_codes
-- ---------------------------------------------------------------------------

create table public.delivery_codes (
  id               uuid        primary key default gen_random_uuid(),
  order_id         uuid        not null unique references public.orders (id) on delete cascade,
  code_hash        text        not null check (char_length(code_hash) = 64),
  code_ciphertext  text        not null check (char_length(code_ciphertext) between 20 and 500),
  attempts         int         not null default 0 check (attempts between 0 and 5),
  locked_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint delivery_codes_lock_matches_attempts check (locked_at is null or attempts >= 5)
);
-- order_id already has a unique index, which also covers the foreign key.

create trigger delivery_codes_set_updated_at
  before update on public.delivery_codes
  for each row execute function public.set_updated_at();

alter table public.delivery_codes enable row level security;
-- No client may read or write this table. Server code uses the service role.
create policy delivery_codes_no_client_access on public.delivery_codes
  for all to authenticated using (false) with check (false);
revoke all on public.delivery_codes from anon, authenticated;
grant all on public.delivery_codes to service_role;

-- ---------------------------------------------------------------------------
-- B. Delivery code functions
-- ---------------------------------------------------------------------------

-- Stores the code made by the server. Does nothing if the order already has
-- one, so it is safe to call again after a failure. Returns true if stored.
create or replace function public.issue_delivery_code(_order_id uuid, _hash text, _ciphertext text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _status public.order_status;
  _rows   int;
begin
  select status into _status from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _status <> 'out_for_delivery' then
    raise exception 'A delivery code is issued once the order is out for delivery' using errcode = 'P0001';
  end if;
  insert into public.delivery_codes (order_id, code_hash, code_ciphertext)
  values (_order_id, _hash, _ciphertext)
  on conflict (order_id) do nothing;
  get diagnostics _rows = row_count;
  return _rows = 1;
end;
$$;

-- The recipient enters the code on the tracking page. One atomic step: count
-- the attempt, lock after 5 wrong ones, and deliver on a match. The hash is
-- made by the server (it holds the key). Wrong attempts are kept: this
-- function answers instead of raising, so nothing rolls back.
--   result: delivered | wrong | locked | not_ready | not_found
create or replace function public.confirm_delivery_with_code(_token text, _hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order public.orders;
  _code  public.delivery_codes;
begin
  select * into _order from public.orders where public_tracking_token = _token for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if _order.status <> 'out_for_delivery' then
    return jsonb_build_object('result', 'not_ready');
  end if;
  select * into _code from public.delivery_codes where order_id = _order.id for update;
  if not found then
    return jsonb_build_object('result', 'not_ready');
  end if;
  if _code.locked_at is not null then
    return jsonb_build_object('result', 'locked');
  end if;

  if _code.code_hash = _hash then
    perform public.transition_order(_order.id, 'delivered', 'The recipient confirmed with the delivery code', null);
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (null, 'delivery.confirmed_with_code', 'orders', _order.id,
            jsonb_build_object('attempts_before', _code.attempts));
    return jsonb_build_object('result', 'delivered');
  end if;

  update public.delivery_codes
     set attempts = attempts + 1,
         locked_at = case when attempts + 1 >= 5 then now() end
   where id = _code.id
  returning * into _code;
  if _code.locked_at is not null then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (null, 'delivery.code_locked', 'orders', _order.id, '{}'::jsonb);
    perform public.queue_notification(null, 'admins', 'delivery_code_locked',
      jsonb_build_object('order_id', _order.id));
    return jsonb_build_object('result', 'locked');
  end if;
  return jsonb_build_object('result', 'wrong', 'attempts_left', 5 - _code.attempts);
end;
$$;

-- Admin lets the recipient try again after a lock.
create or replace function public.unlock_delivery_code(_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can unlock a delivery code' using errcode = '42501';
  end if;
  update public.delivery_codes set attempts = 0, locked_at = null where order_id = _order_id;
  if not found then
    raise exception 'This order has no delivery code' using errcode = 'P0001';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'delivery.code_unlocked', 'orders', _order_id, '{}'::jsonb);
end;
$$;

-- Admin confirms delivery without the code (for example the recipient lost the
-- SMS and the rider has a signed receipt). A note is required and kept.
create or replace function public.admin_mark_delivered(_order_id uuid, _note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin  uuid := (select auth.uid());
  _status public.order_status;
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can mark an order as delivered' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(_note, ''))) < 5 or char_length(btrim(_note)) > 1000 then
    raise exception 'Write a note of at least 5 characters about how delivery was confirmed' using errcode = 'P0001';
  end if;
  select status into _status from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _status <> 'out_for_delivery' then
    raise exception 'Only an order that is out for delivery can be marked as delivered' using errcode = 'P0001';
  end if;
  perform public.transition_order(_order_id, 'delivered', 'Marked as delivered by an admin: ' || btrim(_note), _admin);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_admin, 'delivery.marked_by_admin', 'orders', _order_id, jsonb_build_object('note', left(btrim(_note), 500)));
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Public tracking
-- ---------------------------------------------------------------------------

-- Everything the public tracking page may know. Nothing else is selected, so
-- a new column on orders can never leak through it: no phone, no address, no
-- price, no buyer. Returns null for an unknown token.
create or replace function public.get_tracking(_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _order public.orders;
  _first text;
begin
  if _token is null or _token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select * into _order from public.orders where public_tracking_token = _token;
  if not found or _order.status in ('draft', 'quote_requested', 'quoted', 'quote_expired', 'awaiting_payment', 'cancelled') then
    return null;
  end if;
  select split_part(btrim(r.full_name), ' ', 1) into _first
    from public.recipients r where r.id = _order.recipient_id;

  return jsonb_build_object(
    'status', _order.status,
    'item', (select i.description from public.order_items i where i.order_id = _order.id order by i.created_at limit 1),
    'recipient_first_name', _first,
    'recipient_city', (select r.city from public.recipients r where r.id = _order.recipient_id),
    'updated_at', _order.updated_at,
    'can_enter_code', _order.status = 'out_for_delivery'
                      and exists (select 1 from public.delivery_codes c where c.order_id = _order.id and c.locked_at is null),
    'code_locked', exists (select 1 from public.delivery_codes c where c.order_id = _order.id and c.locked_at is not null)
                   and _order.status = 'out_for_delivery',
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('status', a.details ->> 'to', 'at', a.created_at) order by a.created_at)
      from public.audit_log a
      where a.entity_type = 'orders' and a.entity_id = _order.id and a.action = 'order.status_changed'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Vendor order list
-- ---------------------------------------------------------------------------

-- A vendor's paid catalog orders. The recipient's city is the only part of
-- the delivery address a vendor sees.
create or replace function public.vendor_orders()
returns table (
  order_id uuid,
  status public.order_status,
  created_at timestamptz,
  quantity int,
  item text,
  recipient_city text,
  supplier_reference text,
  needs_review boolean,
  proof_submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.status, o.created_at, o.quantity,
         (select i.description from public.order_items i where i.order_id = o.id order by i.created_at limit 1),
         r.city, o.supplier_reference, cardinality(o.review_flags) > 0,
         (select max(n.created_at) from public.inspections n where n.order_id = o.id)
    from public.orders o
    left join public.recipients r on r.id = o.recipient_id
   where o.order_type = 'catalog'
     and o.vendor_id is not null
     and o.vendor_id = (select public.current_vendor_id())
     and o.status in ('paid', 'purchased', 'inspection_pending', 'inspection_approved', 'shipped', 'in_transit',
                      'arrived_destination', 'customs_cleared', 'out_for_delivery', 'delivered', 'disputed', 'refunded')
   order by o.created_at desc
   limit 200;
$$;

-- ---------------------------------------------------------------------------
-- E. Payouts and refunds (money: server code with the service role only)
-- ---------------------------------------------------------------------------

-- Admin records a bank transfer to the vendor (or, for a link order, the cost
-- of buying the item) and the platform's fee. Partial release is allowed.
-- Together they cannot exceed what is held.
create or replace function public.release_to_vendor(
  _order_id uuid,
  _actor uuid,
  _amount_minor bigint,
  _fee_minor bigint,
  _reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order   public.orders;
  _balance bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = _actor and p.role = 'admin') then
    raise exception 'Only admins can release money' using errcode = '42501';
  end if;
  select * into _order from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status <> 'delivered' then
    raise exception 'Money is released after delivery' using errcode = 'P0001';
  end if;
  if _amount_minor is null or _amount_minor < 1 or _fee_minor is null or _fee_minor < 0 then
    raise exception 'Enter a release amount above zero and a fee of zero or more' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(_reference, ''))) < 3 or char_length(btrim(_reference)) > 200 then
    raise exception 'Enter the bank transfer reference' using errcode = 'P0001';
  end if;
  _balance := public._held_balance(_order_id);
  if _amount_minor + _fee_minor > _balance then
    raise exception 'Not enough is held for this order: % available, % requested', _balance, _amount_minor + _fee_minor
      using errcode = 'P0001', hint = 'insufficient_balance';
  end if;

  insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, reference, created_by)
  values (_order_id, 'released_to_vendor', _amount_minor, 'NGN', btrim(_reference), _actor);
  if _fee_minor > 0 then
    insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, reference, created_by)
    values (_order_id, 'platform_fee', _fee_minor, 'NGN', btrim(_reference), _actor);
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_actor, 'ledger.released', 'orders', _order_id,
          jsonb_build_object('amount_minor', _amount_minor, 'fee_minor', _fee_minor, 'reference', left(btrim(_reference), 200)));
end;
$$;

-- Admin records that the buyer was refunded by bank transfer or on the
-- provider's dashboard. The refund is always the full held balance. The order
-- moves to refunded and its review flags are closed.
create or replace function public.record_refund(_order_id uuid, _actor uuid, _reference text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order   public.orders;
  _balance bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = _actor and p.role = 'admin') then
    raise exception 'Only admins can record a refund' using errcode = '42501';
  end if;
  select * into _order from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(_reference, ''))) < 3 or char_length(btrim(_reference)) > 200 then
    raise exception 'Enter the refund reference' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.disputes d where d.order_id = _order_id and d.status in ('open', 'under_review')) then
    raise exception 'Resolve the dispute first' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.order_status_transitions t where t.from_status = _order.status and t.to_status = 'refunded'
  ) then
    raise exception 'An order that is % cannot be refunded here', _order.status using errcode = 'P0001';
  end if;
  _balance := public._held_balance(_order_id);
  if _balance < 1 then
    raise exception 'Nothing is held for this order' using errcode = 'P0001';
  end if;

  insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, reference, created_by)
  values (_order_id, 'refunded_to_buyer', _balance, 'NGN', btrim(_reference), _actor);
  perform public.transition_order(_order_id, 'refunded', 'Refund recorded: ' || btrim(_reference), _actor);
  update public.orders set review_flags = '{}', review_flagged_at = null where id = _order_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_actor, 'ledger.refunded', 'orders', _order_id,
          jsonb_build_object('amount_minor', _balance, 'reference', left(btrim(_reference), 200)));
  perform public.queue_notification(_order.buyer_id, null, 'order_refunded', jsonb_build_object('order_id', _order_id));
  return _balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.issue_delivery_code(uuid, text, text),
  public.confirm_delivery_with_code(text, text),
  public.unlock_delivery_code(uuid),
  public.admin_mark_delivered(uuid, text),
  public.get_tracking(text),
  public.vendor_orders(),
  public.release_to_vendor(uuid, uuid, bigint, bigint, text),
  public.record_refund(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function
  public.issue_delivery_code(uuid, text, text),
  public.confirm_delivery_with_code(text, text),
  public.get_tracking(text),
  public.release_to_vendor(uuid, uuid, bigint, bigint, text),
  public.record_refund(uuid, uuid, text)
  to service_role;

grant execute on function
  public.unlock_delivery_code(uuid),
  public.admin_mark_delivered(uuid, text),
  public.vendor_orders()
  to authenticated, service_role;
