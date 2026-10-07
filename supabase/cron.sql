-- Schedules the quote-expiry job. Run once per Supabase project, after the
-- pg_cron extension is enabled (Dashboard > Database > Extensions > pg_cron).
-- Safe to run again: it replaces the job of the same name.
--
-- Every 15 minutes this marks quotes that ran out of time as expired and puts
-- their orders in "quote_expired". Expiry is also checked whenever a quote is
-- opened or accepted, so a late job never lets an expired quote be accepted.

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'expire-quotes';

select cron.schedule('expire-quotes', '*/15 * * * *', $$select public.expire_due_quotes()$$);

-- Check: select jobname, schedule, active from cron.job;
-- Recent runs: select * from cron.job_run_details order by start_time desc limit 10;
