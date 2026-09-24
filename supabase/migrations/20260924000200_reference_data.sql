-- Batch 1: reference data needed in every environment (not only local dev).
-- Safe to re-run: existing rows are left untouched so admin edits survive.

-- Display currencies from the brief are active. Others exist so countries can
-- reference their local currency, and admins can switch them on later.
insert into public.currencies (code, name, symbol, minor_unit, is_active) values
  ('NGN', 'Nigerian Naira',     '₦',   2, true),
  ('USD', 'US Dollar',          '$',   2, true),
  ('GBP', 'British Pound',      '£',   2, true),
  ('CAD', 'Canadian Dollar',    'CA$', 2, true),
  ('CNY', 'Chinese Yuan',       '¥',   2, true),
  ('EUR', 'Euro',               '€',   2, true),
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

-- Launch corridors. Delivery day estimates are placeholders for admins to set.
insert into public.corridors
  (code, name, origin_country, destination_country, est_delivery_days_min, est_delivery_days_max, is_active)
values
  ('CN-NG', 'China to Nigeria',   'CN', 'NG', null, null, true),
  ('NG-NG', 'Within Nigeria',     'NG', 'NG', null, null, true)
on conflict (code) do nothing;
