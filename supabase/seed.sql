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


-- Categories. Electronics and General are groups; listings go in the leaf
-- categories. The last four are prohibited: they exist so they can be refused
-- and are never shown to shoppers or vendors.
insert into public.categories (slug, name, parent_slug, active, prohibited, sort_order) values
  ('electronics',      'Electronics',      null,          true,  false, 10),
  ('general',          'General',          null,          true,  false, 20),
  ('phones',           'Phones',           'electronics', true,  false, 11),
  ('laptops',          'Laptops',          'electronics', true,  false, 12),
  ('tablets',          'Tablets',          'electronics', true,  false, 13),
  ('accessories',      'Accessories',      'electronics', true,  false, 14),
  ('audio',            'Audio',            'electronics', true,  false, 15),
  ('cameras',          'Cameras',          'electronics', true,  false, 16),
  ('gaming',           'Gaming',           'electronics', true,  false, 17),
  ('smart_home',       'Smart home',       'electronics', true,  false, 18),
  ('solar_power',      'Solar and power',  'electronics', true,  false, 19),
  ('small_appliances', 'Small appliances', 'electronics', true,  false, 20),
  ('fashion',          'Fashion',          'general',     true,  false, 21),
  ('beauty',           'Beauty',           'general',     true,  false, 22),
  ('home',             'Home',             'general',     true,  false, 23),
  ('baby',             'Baby',             'general',     true,  false, 24),
  ('books',            'Books',            'general',     true,  false, 25),
  ('other',            'Other',            'general',     true,  false, 26),
  ('weapons',          'Weapons',          null,          false, true,  90),
  ('drugs',            'Drugs',            null,          false, true,  91),
  ('counterfeit',      'Counterfeit goods', null,         false, true,  92),
  ('hazardous',        'Hazardous goods',  null,          false, true,  93)
on conflict (slug) do nothing;

-- Nigerian states: the 36 states and the Federal Capital Territory. Used by
-- the recipient address form and checked by the database.
insert into public.regions (country_code, name) values
  ('NG', 'Abia'), ('NG', 'Adamawa'), ('NG', 'Akwa Ibom'), ('NG', 'Anambra'), ('NG', 'Bauchi'),
  ('NG', 'Bayelsa'), ('NG', 'Benue'), ('NG', 'Borno'), ('NG', 'Cross River'), ('NG', 'Delta'),
  ('NG', 'Ebonyi'), ('NG', 'Edo'), ('NG', 'Ekiti'), ('NG', 'Enugu'), ('NG', 'Federal Capital Territory'),
  ('NG', 'Gombe'), ('NG', 'Imo'), ('NG', 'Jigawa'), ('NG', 'Kaduna'), ('NG', 'Kano'),
  ('NG', 'Katsina'), ('NG', 'Kebbi'), ('NG', 'Kogi'), ('NG', 'Kwara'), ('NG', 'Lagos'),
  ('NG', 'Nasarawa'), ('NG', 'Niger'), ('NG', 'Ogun'), ('NG', 'Ondo'), ('NG', 'Osun'),
  ('NG', 'Oyo'), ('NG', 'Plateau'), ('NG', 'Rivers'), ('NG', 'Sokoto'), ('NG', 'Taraba'),
  ('NG', 'Yobe'), ('NG', 'Zamfara')
on conflict (country_code, name) do nothing;

-- Stores for "Buy it for me" links. Matching also covers subdomains
-- (m.aliexpress.com matches aliexpress.com). Change these rows to change the
-- rules: nothing about stores is hardcoded in the app.
--   supported       false blocks the request with a clear message
--   preview_allowed true lets the server read the page's title and image tags
-- Previews are off for 1688.com and taobao.com because those sites usually
-- answer with a login or bot-check page, so a fetch would only fail.
insert into public.store_domains (domain, display_name, corridor_id, preview_allowed, supported, notes)
select s.domain, s.display_name, c.id, s.preview_allowed, s.supported, s.notes
from (values
  ('aliexpress.com',  'AliExpress', 'CN', 'NG', true,  true,  null),
  ('1688.com',        '1688',       'CN', 'NG', false, true,  'Chinese wholesale site. Pages are in Chinese and often need a login.'),
  ('taobao.com',      'Taobao',     'CN', 'NG', false, true,  'Pages are in Chinese and often need a login.'),
  ('temu.com',        'Temu',       'CN', 'NG', true,  true,  null),
  ('jumia.com.ng',    'Jumia',      'NG', 'NG', true,  true,  null),
  ('konga.com',       'Konga',      'NG', 'NG', true,  true,  null),
  ('amazon.com',      'Amazon',     null, null, false, false, 'Not supported yet.'),
  ('amazon.co.uk',    'Amazon UK',  null, null, false, false, 'Not supported yet.')
) as s (domain, display_name, origin, destination, preview_allowed, supported, notes)
left join public.corridors c on c.origin_country = s.origin and c.destination_country = s.destination
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- PLACEHOLDER PRICING. These numbers are examples, not real prices or real
-- customs rates. Replace them in /admin/pricing before taking any payment.
-- Verify with a licensed customs broker before production.
-- Money is in minor units: 200000 kobo = NGN 2,000; 900 cents = USD 9.00.
-- ---------------------------------------------------------------------------

-- Delivery zones (PLACEHOLDER groupings). Zone C is every state not in A or B.
insert into public.delivery_zones (name, states)
select z.name, z.states
from (values
  ('Zone A', array['Lagos', 'Federal Capital Territory', 'Rivers']),
  ('Zone B', array['Abia', 'Akwa Ibom', 'Anambra', 'Bayelsa', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
                   'Ekiti', 'Enugu', 'Imo', 'Ogun', 'Ondo', 'Osun', 'Oyo'])
) as z (name, states)
where not exists (select 1 from public.delivery_zones x where x.name = z.name);

insert into public.delivery_zones (name, states)
select 'Zone C', array_agg(r.name order by r.name)
from public.regions r
where r.country_code = 'NG'
  and not exists (select 1 from public.delivery_zones z where z.states @> array[r.name])
  and not exists (select 1 from public.delivery_zones x where x.name = 'Zone C')
having count(*) > 0;

-- Fee rules. Weight bands are [from, to) in grams. A weight above the last
-- band has no rule, and the engine says so instead of guessing.
insert into public.fee_rules
  (corridor_id, fee_type, calc_method, value, currency, min_amount_minor, max_amount_minor,
   weight_from_g, weight_to_g, zone_id, notes)
select c.id, r.fee_type::public.fee_type, r.calc_method::public.fee_calc_method, r.value, r.currency,
       r.min_amount_minor, r.max_amount_minor, r.weight_from_g, r.weight_to_g, z.id,
       'PLACEHOLDER: replace before taking payments.'
from (values
  -- China to Nigeria
  ('CN', 'NG', 'service_fee',           'percent', 5.0::numeric,  'NGN', 200000::bigint, null::bigint, null::int,  null::int,  null::text),
  ('CN', 'NG', 'international_freight', 'per_kg',  900,           'USD', 900,            null,         0,          5000,       null),
  ('CN', 'NG', 'international_freight', 'per_kg',  800,           'USD', null,           null,         5000,       20000,      null),
  ('CN', 'NG', 'international_freight', 'per_kg',  650,           'USD', null,           null,         20000,      100000,     null),
  ('CN', 'NG', 'insurance',             'percent', 1.0,           'USD', null,           null,         null,       null,       null),
  ('CN', 'NG', 'clearing',              'flat',    500000,        'NGN', null,           null,         null,       null,       null),
  ('CN', 'NG', 'special_handling',      'flat',    300000,        'NGN', null,           null,         null,       null,       null),
  ('CN', 'NG', 'payment_processing',    'percent', 1.5,           'NGN', null,           200000,       null,       null,       null),
  ('CN', 'NG', 'payment_processing',    'flat',    10000,         'NGN', null,           null,         null,       null,       null),
  ('CN', 'NG', 'last_mile',             'flat',    250000,        'NGN', null,           null,         0,          5000,       'Zone A'),
  ('CN', 'NG', 'last_mile',             'flat',    400000,        'NGN', null,           null,         5000,       20000,      'Zone A'),
  ('CN', 'NG', 'last_mile',             'flat',    900000,        'NGN', null,           null,         20000,      100000,     'Zone A'),
  ('CN', 'NG', 'last_mile',             'flat',    350000,        'NGN', null,           null,         0,          5000,       'Zone B'),
  ('CN', 'NG', 'last_mile',             'flat',    550000,        'NGN', null,           null,         5000,       20000,      'Zone B'),
  ('CN', 'NG', 'last_mile',             'flat',    1200000,       'NGN', null,           null,         20000,      100000,     'Zone B'),
  ('CN', 'NG', 'last_mile',             'flat',    450000,        'NGN', null,           null,         0,          5000,       'Zone C'),
  ('CN', 'NG', 'last_mile',             'flat',    700000,        'NGN', null,           null,         5000,       20000,      'Zone C'),
  ('CN', 'NG', 'last_mile',             'flat',    1500000,       'NGN', null,           null,         20000,      100000,     'Zone C'),
  -- Within Nigeria
  ('NG', 'NG', 'service_fee',           'percent', 5.0,           'NGN', 100000,         null,         null,       null,       null),
  ('NG', 'NG', 'special_handling',      'flat',    300000,        'NGN', null,           null,         null,       null,       null),
  ('NG', 'NG', 'payment_processing',    'percent', 1.5,           'NGN', null,           200000,       null,       null,       null),
  ('NG', 'NG', 'payment_processing',    'flat',    10000,         'NGN', null,           null,         null,       null,       null),
  ('NG', 'NG', 'last_mile',             'flat',    250000,        'NGN', null,           null,         0,          5000,       'Zone A'),
  ('NG', 'NG', 'last_mile',             'flat',    400000,        'NGN', null,           null,         5000,       20000,      'Zone A'),
  ('NG', 'NG', 'last_mile',             'flat',    900000,        'NGN', null,           null,         20000,      100000,     'Zone A'),
  ('NG', 'NG', 'last_mile',             'flat',    350000,        'NGN', null,           null,         0,          5000,       'Zone B'),
  ('NG', 'NG', 'last_mile',             'flat',    550000,        'NGN', null,           null,         5000,       20000,      'Zone B'),
  ('NG', 'NG', 'last_mile',             'flat',    1200000,       'NGN', null,           null,         20000,      100000,     'Zone B'),
  ('NG', 'NG', 'last_mile',             'flat',    450000,        'NGN', null,           null,         0,          5000,       'Zone C'),
  ('NG', 'NG', 'last_mile',             'flat',    700000,        'NGN', null,           null,         5000,       20000,      'Zone C'),
  ('NG', 'NG', 'last_mile',             'flat',    1500000,       'NGN', null,           null,         20000,      100000,     'Zone C')
) as r (origin, destination, fee_type, calc_method, value, currency, min_amount_minor, max_amount_minor,
        weight_from_g, weight_to_g, zone)
join public.corridors c
  on c.origin_country = r.origin and c.destination_country = r.destination
left join public.delivery_zones z on z.name = r.zone
where not exists (
  select 1 from public.fee_rules f
  where f.corridor_id = c.id
    and f.fee_type = r.fee_type::public.fee_type
    and f.calc_method = r.calc_method::public.fee_calc_method
    and f.zone_id is not distinct from z.id
    and f.weight_from_g is not distinct from r.weight_from_g
    and f.effective_to is null
);

-- Import duty, VAT and other levies on goods entering Nigeria. PLACEHOLDER
-- percentages, not the real tariff. Verify with a licensed customs broker
-- before production. A category rule beats the general rule; a parent category
-- (electronics) covers its children (phones) when they have none of their own.
insert into public.duty_rates
  (corridor_id, category_slug, import_duty_percent, vat_percent, other_levies_percent, notes)
select c.id, d.category_slug, d.duty, d.vat, d.levies,
       'PLACEHOLDER: verify with a licensed customs broker before production.'
from (values
  (null::text,   20.0::numeric, 7.5::numeric, 4.0::numeric),
  ('electronics', 10.0,         7.5,          4.0),
  ('phones',       5.0,         7.5,          4.0)
) as d (category_slug, duty, vat, levies)
join public.corridors c on c.origin_country = 'CN' and c.destination_country = 'NG'
where not exists (
  select 1 from public.duty_rates x
  where x.corridor_id = c.id and x.category_slug is not distinct from d.category_slug and x.effective_to is null
);
