-- Reference data. Safe to run more than once: existing rows are left alone,
-- so admin edits survive a re-run.
--
-- Local:  runs automatically on `npx supabase db reset`.
-- Hosted: `npx supabase db push --include-seed`, or paste into the SQL editor.
-- Must run before the first sign-up: new profiles default to NGN.

-- Currencies. The six display currencies are active. AED, GHS and ZAR exist so
-- countries can reference their local currency; admins can switch them on.
insert into public.currencies (code, name, symbol, minor_unit_digits, active) values
  ('NGN', 'Nigerian Naira',     '₦',   2, true),
  ('USD', 'US Dollar',          '$',   2, true),
  ('GBP', 'British Pound',      '£',   2, true),
  ('EUR', 'Euro',               '€',   2, true),
  ('CAD', 'Canadian Dollar',    'CA$', 2, true),
  ('CNY', 'Chinese Yuan',       '¥',   2, true),
  ('AED', 'UAE Dirham',         'AED', 2, false),
  ('GHS', 'Ghanaian Cedi',      'GH₵', 2, false),
  ('ZAR', 'South African Rand', 'R',   2, false)
on conflict (code) do nothing;

-- Countries where buyers, vendors or recipients may live.
insert into public.countries (code, name, currency_code, phone_prefix) values
  ('NG', 'Nigeria',              'NGN', '+234'),
  ('CN', 'China',                'CNY', '+86'),
  ('GB', 'United Kingdom',       'GBP', '+44'),
  ('US', 'United States',        'USD', '+1'),
  ('CA', 'Canada',               'CAD', '+1'),
  ('AE', 'United Arab Emirates', 'AED', '+971'),
  ('IE', 'Ireland',              'EUR', '+353'),
  ('DE', 'Germany',              'EUR', '+49'),
  ('FR', 'France',               'EUR', '+33'),
  ('NL', 'Netherlands',          'EUR', '+31'),
  ('IT', 'Italy',                'EUR', '+39'),
  ('ES', 'Spain',                'EUR', '+34'),
  ('GH', 'Ghana',                'GHS', '+233'),
  ('ZA', 'South Africa',         'ZAR', '+27')
on conflict (code) do nothing;

-- Launch corridors.
insert into public.corridors
  (origin_country, destination_country, name, active, default_transit_days_min, default_transit_days_max)
values
  ('CN', 'NG', 'China to Nigeria', true, 10, 21),
  ('NG', 'NG', 'Within Nigeria',   true, 1,  3)
on conflict (origin_country, destination_country) do nothing;

-- ---------------------------------------------------------------------------
-- PLACEHOLDER FEE RULES. These numbers are examples, not real prices.
-- Replace them with real rates before taking any payment.
-- Amounts are minor units: 200000 kobo = NGN 2,000; 800 cents = USD 8.00.
-- ---------------------------------------------------------------------------
insert into public.fee_rules
  (corridor_id, fee_type, calc_method, amount_minor, percent, currency, min_amount_minor)
select c.id, r.fee_type, r.calc_method, r.amount_minor, r.percent, r.currency, r.min_amount_minor
from (values
  -- China to Nigeria
  ('CN', 'NG', 'service_fee',           'percent', null::bigint, 5.0::numeric, 'NGN', 200000::bigint),
  ('CN', 'NG', 'international_freight', 'per_kg',  800,          null,         'USD', null),
  ('CN', 'NG', 'customs_duty_estimate', 'percent', null,         10.0,         'NGN', null),
  ('CN', 'NG', 'clearing',              'flat',    500000,       null,         'NGN', null),
  ('CN', 'NG', 'last_mile_delivery',    'flat',    350000,       null,         'NGN', null),
  -- Within Nigeria
  ('NG', 'NG', 'service_fee',           'percent', null,         5.0,          'NGN', 100000),
  ('NG', 'NG', 'last_mile_delivery',    'flat',    350000,       null,         'NGN', null)
) as r (origin, destination, fee_type, calc_method, amount_minor, percent, currency, min_amount_minor)
join public.corridors c
  on c.origin_country = r.origin and c.destination_country = r.destination
where not exists (
  select 1 from public.fee_rules f where f.corridor_id = c.id and f.fee_type = r.fee_type
);
