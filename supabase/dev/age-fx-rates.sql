-- LOCAL TESTING ONLY. Never run this against production.
-- Makes the newest fetched exchange rate of every currency look 2 days old, so
-- you can check that quotes refuse to calculate (FX_STALE) and the shop shows
-- "Delivered price on request". Exchange rate rows cannot be edited, so the
-- guard trigger is switched off for this one statement.
--
-- To undo it, fetch fresh rates (call /api/cron/fx with your CRON_SECRET) or
-- set an override in /admin/pricing > FX rates.

begin;
alter table public.fx_rates disable trigger fx_rates_guard;
update public.fx_rates
   set fetched_at = now() - interval '2 days'
 where id in (
   select distinct on (quote_currency) id
     from public.fx_rates
    where not is_override
    order by quote_currency, fetched_at desc
 );
alter table public.fx_rates enable trigger fx_rates_guard;
commit;
