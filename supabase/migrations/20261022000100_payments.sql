-- Batch 5, step 1: payments, catalog orders and the money ledger.
--
-- A. orders: review flags
-- B. payments: quote link, display amount, guard
-- C. ledger_entries: reference, idempotency, balance that cannot go below zero
-- D. create_catalog_order, create_payment, apply_successful_payment, ...
-- E. privileges
--
-- V1 charges in NGN through Paystack. Every function that moves money is for
-- server code only (service role): the browser never writes a payment, a
-- ledger entry or an order status.

-- ---------------------------------------------------------------------------
-- A. Orders: things an admin must look at
-- ---------------------------------------------------------------------------

alter table public.orders
  add column review_flags       text[]      not null default '{}',
  add column review_flagged_at  timestamptz,
  add constraint orders_review_flags_known check (
    review_flags <@ array['paid_after_quote_expired', 'stock_unavailable', 'duplicate_payment', 'payment_on_closed_order']
  );

create index orders_needs_review_idx on public.orders (review_flagged_at) where cardinality(review_flags) > 0;

-- ---------------------------------------------------------------------------
-- B. Payments
-- ---------------------------------------------------------------------------

-- amount_minor / currency: what is charged (NGN in V1). display_*: the quote
-- total the buyer accepted, in their own currency. fx_note: how one became the other.
alter table public.payments
  add column quote_id               uuid references public.quotes (id),
  add column display_currency       char(3) references public.currencies (code),
  add column display_amount_minor   bigint check (display_amount_minor > 0),
  add column fx_note                jsonb,
  add column paid_at                timestamptz,
  add constraint payments_status_known check (status in ('pending', 'success', 'failed', 'abandoned', 'mismatch'));

create index payments_quote_id_idx on public.payments (quote_id);
create index payments_display_currency_idx on public.payments (display_currency);

-- A payment's money details never change. Its status moves forward only:
-- pending to anything, a failed or abandoned one to success (the money did
-- arrive after all). Success is final; a mismatch needs a human.
create or replace function public.payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments are never deleted' using errcode = 'P0001';
  end if;
  if new.order_id is distinct from old.order_id
     or new.provider is distinct from old.provider
     or new.provider_reference is distinct from old.provider_reference
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.quote_id is distinct from old.quote_id
     or new.display_currency is distinct from old.display_currency
     or new.display_amount_minor is distinct from old.display_amount_minor
     or new.fx_note is distinct from old.fx_note then
    raise exception 'A payment''s amount and order cannot change' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       old.status = 'pending'
       or (old.status in ('failed', 'abandoned') and new.status = 'success')
     ) then
    raise exception 'A payment cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger payments_guard
  before update or delete on public.payments
  for each row execute function public.payments_guard();

-- ---------------------------------------------------------------------------
-- C. Ledger
-- ---------------------------------------------------------------------------

alter table public.ledger_entries add column reference text check (char_length(reference) <= 200);

-- One payment is received and held once, however many times its webhook arrives.
create unique index ledger_entries_payment_once_idx
  on public.ledger_entries (payment_id, entry_type)
  where payment_id is not null and entry_type in ('payment_received', 'held');

-- Held balance of an order: what was held, less what left. Never below zero.
create or replace function public._held_balance(_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
           when entry_type = 'held' then amount_minor
           when entry_type in ('released_to_vendor', 'platform_fee', 'refunded_to_buyer') then -amount_minor
           else 0 end), 0)::bigint
  from public.ledger_entries where order_id = _order_id;
$$;

create or replace function public.ledger_entries_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _balance bigint;
begin
  if new.entry_type = 'adjustment' then
    raise exception 'Adjustments are not available yet' using errcode = 'P0001';
  end if;
  if new.entry_type in ('payment_received', 'held') and new.payment_id is null then
    raise exception 'A received or held amount belongs to a payment' using errcode = 'P0001';
  end if;
  if new.entry_type in ('released_to_vendor', 'platform_fee', 'refunded_to_buyer') then
    -- One order at a time, so two releases cannot both see the same balance.
    perform 1 from public.orders where id = new.order_id for update;
    _balance := public._held_balance(new.order_id);
    if _balance - new.amount_minor < 0 then
      raise exception 'Not enough is held for this order: % available, % requested', _balance, new.amount_minor
        using errcode = 'P0001', hint = 'insufficient_balance';
    end if;
  end if;
  return new;
end;
$$;

create trigger ledger_entries_check
  before insert on public.ledger_entries
  for each row execute function public.ledger_entries_check();

-- Held, released, refunded and fee totals for one order. Admin only.
create or replace function public.order_ledger_summary(_order_id uuid)
returns table (
  held_minor bigint, released_minor bigint, refunded_minor bigint, platform_fee_minor bigint,
  balance_minor bigint, currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can read the ledger' using errcode = '42501';
  end if;
  return query
  select
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'held'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'released_to_vendor'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'refunded_to_buyer'), 0)::bigint,
    coalesce(sum(l.amount_minor) filter (where l.entry_type = 'platform_fee'), 0)::bigint,
    public._held_balance(_order_id),
    'NGN'::text
  from public.ledger_entries l where l.order_id = _order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Functions (server code only, unless noted)
-- ---------------------------------------------------------------------------

-- Creates a catalog order with its item, its automatic 30-minute quote (the
-- lines come from the pricing engine, run on the server) and the pricing
-- snapshot, and leaves the order waiting for payment. The server passes the
-- buyer's id; browsers cannot call this, so no one can send their own prices.
create or replace function public.create_catalog_order(
  _buyer uuid,
  _product_id uuid,
  _quantity int,
  _recipient_id uuid,
  _buyer_currency text,
  _lines jsonb,
  _snapshot jsonb,
  _weight_grams int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _product   public.products;
  _order_id  uuid;
  _quote_id  uuid;
  _line      jsonb;
  _count     int;
  _total     numeric := 0;
  _has_item  boolean := false;
  _amount    numeric;
  _i         int;
begin
  if _quantity is null or _quantity < 1 or _quantity > 100 then
    raise exception 'Choose a quantity between 1 and 100' using errcode = 'P0001';
  end if;

  select * into _product from public.products where id = _product_id for share;
  if not found or not _product.active or _product.flagged_at is not null
     or not public.is_approved_vendor(_product.vendor_id) then
    raise exception 'This product is not available' using errcode = 'P0001';
  end if;
  if _product.stock < _quantity then
    raise exception 'Only % in stock', _product.stock using errcode = 'P0001', hint = 'out_of_stock';
  end if;
  if not exists (
    select 1 from public.recipients r where r.id = _recipient_id and r.created_by = _buyer and not r.archived
  ) then
    raise exception 'Choose one of your recipients' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.currencies c where c.code = upper(_buyer_currency) and c.active) then
    raise exception 'Choose an available currency' using errcode = 'P0001';
  end if;
  if _snapshot is null or jsonb_typeof(_snapshot) <> 'object'
     or nullif(btrim(coalesce(_snapshot ->> 'engine_version', '')), '') is null then
    raise exception 'A quote needs the pricing snapshot from the calculation' using errcode = '22023';
  end if;
  -- Unpaid checkouts pile up if someone clicks all day; cap them.
  if (select count(*) from public.orders o
       where o.buyer_id = _buyer and o.order_type = 'catalog' and o.status = 'awaiting_payment'
         and o.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'You have many unpaid orders. Pay or cancel some first.'
      using errcode = 'P0001', hint = 'rate_limited';
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
    _amount := (_line ->> 'amount_minor')::numeric;
    if _amount <> trunc(_amount) or _amount < 0 or _amount > 1000000000000 then
      raise exception 'Line % has an invalid amount', _i + 1 using errcode = '22023';
    end if;
    _total := _total + _amount;
    if _line ->> 'type' = 'item_price' and _amount > 0 then _has_item := true; end if;
  end loop;
  if not _has_item or _total <= 0 or _total > 1000000000000 then
    raise exception 'The quote total is not valid' using errcode = '22023';
  end if;

  insert into public.orders (
    buyer_id, recipient_id, corridor_id, vendor_id, order_type, status, buyer_currency, quantity
  ) values (
    _buyer, _recipient_id, _product.corridor_id, _product.vendor_id, 'catalog', 'awaiting_payment',
    upper(_buyer_currency), _quantity
  ) returning id into _order_id;

  insert into public.order_items (order_id, product_id, description, quantity, unit_price_minor, currency)
  values (_order_id, _product.id, left(_product.title, 500), _quantity, _product.price_minor, _product.currency);

  insert into public.quotes (order_id, prepared_by, total_minor, currency, expires_at, version, status, weight_estimate_grams)
  values (_order_id, _buyer, _total::bigint, upper(_buyer_currency), now() + interval '30 minutes', 1, 'sent', _weight_grams)
  returning id into _quote_id;

  for _i in 0 .. _count - 1 loop
    _line := _lines -> _i;
    insert into public.quote_lines (quote_id, line_type, label, amount_minor, currency, sort_order)
    values (_quote_id, _line ->> 'type', btrim(_line ->> 'label'), (_line ->> 'amount_minor')::bigint,
            upper(_buyer_currency), _i);
  end loop;

  insert into public.quote_pricing_snapshots (quote_id, engine_version, snapshot)
  values (_quote_id, left(btrim(_snapshot ->> 'engine_version'), 40), _snapshot);

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (_buyer, 'order.created', 'orders', _order_id,
          jsonb_build_object('type', 'catalog', 'product_id', _product.id, 'quantity', _quantity,
                             'total_minor', _total::bigint, 'currency', upper(_buyer_currency)));
  return _order_id;
end;
$$;

-- Opens a payment for an order: the amount to charge in NGN is worked out by
-- the server from the quote and its snapshot. The quote must still be valid.
create or replace function public.create_payment(
  _order_id uuid,
  _buyer uuid,
  _amount_minor bigint,
  _display_currency text,
  _display_amount_minor bigint,
  _fx_note jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _order public.orders;
  _quote public.quotes;
  _id    uuid := gen_random_uuid();
begin
  select * into _order from public.orders where id = _order_id for update;
  if not found or _order.buyer_id <> _buyer then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status <> 'awaiting_payment' then
    raise exception 'This order is not waiting for payment' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments p where p.order_id = _order_id and p.status = 'success') then
    raise exception 'This order has already been paid' using errcode = 'P0001';
  end if;

  select * into _quote from public.quotes q
   where q.order_id = _order_id and q.status in ('sent', 'accepted')
   order by q.version desc limit 1;
  if not found then
    raise exception 'This order has no quote to pay' using errcode = 'P0001', hint = 'quote_expired';
  end if;
  if _quote.expires_at <= now() then
    raise exception 'This quote has expired. Cancel the order and ask for a new quote.'
      using errcode = 'P0001', hint = 'quote_expired';
  end if;
  if upper(_display_currency) <> _quote.currency or _display_amount_minor <> _quote.total_minor then
    raise exception 'The amount does not match the quote' using errcode = 'P0001';
  end if;
  if _amount_minor is null or _amount_minor <= 0 or _amount_minor > 100000000000000 then
    raise exception 'The amount to charge is not valid' using errcode = '22023';
  end if;
  if (select count(*) from public.payments p
       where p.order_id = _order_id and p.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many payment attempts. Please wait a little.' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.payments (
    id, order_id, provider, provider_reference, amount_minor, currency, status,
    quote_id, display_currency, display_amount_minor, fx_note
  ) values (
    _id, _order_id, 'paystack', _id::text, _amount_minor, 'NGN', 'pending',
    _quote.id, _quote.currency, _quote.total_minor, _fx_note
  );
  return _id;
end;
$$;

-- Applies a payment that Paystack confirmed. One transaction: the payment, the
-- ledger, the order status and the stock all change together or not at all.
-- Calling it again for the same payment changes nothing. A payment that
-- arrives when it should not (late, twice, for a closed order, with no stock)
-- is kept and the order is flagged for an admin.
create or replace function public.apply_successful_payment(
  _payment_id uuid,
  _paid_at timestamptz default null,
  _payload jsonb default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _pay    public.payments;
  _order  public.orders;
  _quote  public.quotes;
  _item   public.order_items;
  _when   timestamptz;
  _flags  text[] := '{}';
  _stock  int;
begin
  select * into _pay from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if _pay.status = 'success' then return 'already_applied'; end if;
  if _pay.status = 'mismatch' then
    raise exception 'This payment is on hold for review' using errcode = 'P0001';
  end if;

  select * into _order from public.orders where id = _pay.order_id for update;
  _when := coalesce(_paid_at, now());

  update public.payments
     set status = 'success', paid_at = _when, raw_payload = coalesce(_payload, raw_payload)
   where id = _payment_id;

  insert into public.ledger_entries (order_id, entry_type, amount_minor, currency, payment_id, note)
  values (_pay.order_id, 'payment_received', _pay.amount_minor, _pay.currency, _pay.id, 'Paystack ' || _pay.provider_reference),
         (_pay.order_id, 'held', _pay.amount_minor, _pay.currency, _pay.id, 'Held until delivery');

  if _order.status = 'awaiting_payment' then
    select * into _quote from public.quotes where id = _pay.quote_id;
    if found and _quote.expires_at < _when then
      _flags := array_append(_flags, 'paid_after_quote_expired');
    end if;

    perform public.transition_order(_pay.order_id, 'paid', 'Payment received', null);

    if _order.order_type = 'catalog' then
      select * into _item from public.order_items where order_id = _pay.order_id order by created_at limit 1;
      -- The row lock makes two payments for the last unit take turns.
      select p.stock into _stock from public.products p where p.id = _item.product_id for update;
      if _stock is not null and _stock >= _item.quantity then
        update public.products set stock = stock - _item.quantity where id = _item.product_id;
      else
        _flags := array_append(_flags, 'stock_unavailable');
      end if;
    end if;
  elsif _order.status in ('paid', 'purchased', 'inspection_pending', 'inspection_approved', 'shipped', 'in_transit',
                          'arrived_destination', 'customs_cleared', 'out_for_delivery', 'delivered', 'disputed', 'refunded') then
    _flags := array_append(_flags, 'duplicate_payment');
  else
    _flags := array_append(_flags, 'payment_on_closed_order');
  end if;

  if cardinality(_flags) > 0 then
    update public.orders
       set review_flags = (select coalesce(array_agg(distinct f), '{}') from unnest(review_flags || _flags) f),
           review_flagged_at = now()
     where id = _pay.order_id;
    perform public.queue_notification(null, 'admins', 'order_needs_review',
      jsonb_build_object('order_id', _pay.order_id, 'flags', to_jsonb(_flags)));
  end if;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (null, 'payment.success', 'payments', _pay.id,
          jsonb_build_object('order_id', _pay.order_id, 'amount_minor', _pay.amount_minor, 'flags', to_jsonb(_flags)));

  return case when cardinality(_flags) > 0 then 'applied_flagged' else 'applied' end;
end;
$$;

-- Failed, abandoned or mismatched payments. A pending payment only.
create or replace function public.mark_payment_status(_payment_id uuid, _status text, _payload jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _status not in ('failed', 'abandoned', 'mismatch') then
    raise exception 'Unknown payment status' using errcode = '22023';
  end if;
  update public.payments
     set status = _status, raw_payload = coalesce(_payload, raw_payload)
   where id = _payment_id and status = 'pending';
  if _status = 'mismatch' then
    perform public.queue_notification(null, 'admins', 'payment_mismatch', jsonb_build_object('payment_id', _payment_id));
    insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
    values (null, 'payment.mismatch', 'payments', _payment_id, '{}'::jsonb);
  end if;
end;
$$;

-- The buyer gives up on an unpaid order (for example the quote ran out).
create or replace function public.cancel_unpaid_order(_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _buyer  uuid := (select auth.uid());
  _order  public.orders;
begin
  select * into _order from public.orders where id = _order_id and buyer_id = _buyer for update;
  if _buyer is null or not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if _order.status <> 'awaiting_payment' then
    raise exception 'Only an unpaid order can be cancelled' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments p where p.order_id = _order_id and p.status = 'success') then
    raise exception 'This order has been paid' using errcode = 'P0001';
  end if;
  update public.payments set status = 'abandoned' where order_id = _order_id and status = 'pending';
  update public.quotes set status = 'expired' where order_id = _order_id and status = 'sent';
  perform public.transition_order(_order_id, 'cancelled', 'Cancelled by the buyer before payment', _buyer);
end;
$$;

-- Admin looked at an order flagged for review and dealt with it.
create or replace function public.clear_order_flags(_order_id uuid, _note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old text[];
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can clear review flags' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(_note, ''))) < 5 then
    raise exception 'Write a note of at least 5 characters about what you did' using errcode = 'P0001';
  end if;
  select review_flags into _old from public.orders where id = _order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  update public.orders set review_flags = '{}', review_flagged_at = null where id = _order_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'order.flags_cleared', 'orders', _order_id,
          jsonb_build_object('flags', to_jsonb(_old), 'note', left(btrim(_note), 500)));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public._held_balance(uuid),
  public.ledger_entries_check(),
  public.payments_guard(),
  public.order_ledger_summary(uuid),
  public.create_catalog_order(uuid, uuid, int, uuid, text, jsonb, jsonb, int),
  public.create_payment(uuid, uuid, bigint, text, bigint, jsonb),
  public.apply_successful_payment(uuid, timestamptz, jsonb),
  public.mark_payment_status(uuid, text, jsonb),
  public.cancel_unpaid_order(uuid),
  public.clear_order_flags(uuid, text)
  from public, anon, authenticated;

-- Trigger functions run as the caller and need execute on themselves.
grant execute on function public.payments_guard(), public.ledger_entries_check() to authenticated, service_role;

grant execute on function
  public.create_catalog_order(uuid, uuid, int, uuid, text, jsonb, jsonb, int),
  public.create_payment(uuid, uuid, bigint, text, bigint, jsonb),
  public.apply_successful_payment(uuid, timestamptz, jsonb),
  public.mark_payment_status(uuid, text, jsonb),
  public._held_balance(uuid)
  to service_role;

grant execute on function
  public.order_ledger_summary(uuid),
  public.cancel_unpaid_order(uuid),
  public.clear_order_flags(uuid, text)
  to authenticated, service_role;
