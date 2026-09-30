-- Batch 2, part 1: a fourth vendor status.
-- Its own file because Postgres cannot use a new enum value in the same
-- transaction that adds it. The next migration uses it.
alter type public.vendor_status add value if not exists 'rejected';
