-- LOCAL TESTING ONLY. Never run this against production.
-- Makes the waiting quote of an order look like it expired an hour ago, so you
-- can check that it can no longer be accepted. Sent quotes are locked against
-- changes, so the guard trigger is switched off for this one statement.
--
-- Usage (psql): \set order_id '<the order uuid>'   then   \i supabase/dev/backdate-quote.sql
-- Or replace :'order_id' below with the uuid in quotes.

begin;
alter table public.quotes disable trigger quotes_guard_update;
update public.quotes
   set expires_at = now() - interval '1 hour'
 where order_id = :'order_id' and status = 'sent';
alter table public.quotes enable trigger quotes_guard_update;
commit;

-- Then, as the buyer, press "Accept quote" on the order page: it answers that
-- the quote has expired and the order moves to "quote_expired".
