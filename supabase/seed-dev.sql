-- DEMO DATA FOR LOCAL DEVELOPMENT ONLY. Never run this on a real project.
--
-- 3 approved demo vendors (2 in China, 1 in Lagos) and 12 demo products with
-- placeholder pictures from /public/demo. Run after migrations and seed.sql:
--
--   npm run db:seed-dev
--
-- or paste into the local Supabase Studio SQL editor (http://127.0.0.1:54323),
-- starting with:   set mapk.dev_seed = 'yes';
--
-- Safety: the script refuses to run unless that setting is 'yes', so it cannot
-- run by accident. The demo users have no password and no login record, so
-- nobody can sign in as them. Safe to run again: rows that exist are kept.

do $$
begin
  if coalesce(current_setting('mapk.dev_seed', true), '') <> 'yes' then
    raise exception 'Refusing to load demo data. This file is for local development only. Set mapk.dev_seed = ''yes'' to confirm.';
  end if;
  if not exists (select 1 from public.categories where slug = 'phones') then
    raise exception 'Run supabase/seed.sql first (categories are missing).';
  end if;
end;
$$;

-- Demo accounts. The sign-up trigger creates their profiles.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demo-vendor-1@demo.mapk.test', '', now(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Demo Vendor Shenzhen","country_code":"CN"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demo-vendor-2@demo.mapk.test', '', now(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Demo Vendor Guangzhou","country_code":"CN"}', now(), now()),
  ('d0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'demo-vendor-3@demo.mapk.test', '', now(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Demo Vendor Lagos","country_code":"NG"}', now(), now())
on conflict (id) do nothing;

insert into public.vendors (id, owner_id, business_name, country_code, city, status, phone, business_reg_number, categories)
values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'Demo Shenzhen Mobile Hub', 'CN', 'Shenzhen', 'approved', '+8613800138001', null,
   array['phones', 'accessories']),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002',
   'Demo Guangzhou Power and Tech', 'CN', 'Guangzhou', 'approved', '+8613800138002', null,
   array['laptops', 'solar_power', 'small_appliances']),
  ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003',
   'Demo Ikeja Gadget Store', 'NG', 'Lagos', 'approved', '+2348031234567', 'RC 0000000',
   array['phones', 'accessories', 'audio'])
on conflict (id) do nothing;

update public.profiles set role = 'vendor'
 where id in ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002',
              'd0000000-0000-4000-8000-000000000003')
   and role = 'buyer';

-- 12 products. Prices are in minor units: 109900 CNY cents is 1,099.00 CNY.
-- Each ships on the vendor's own route: China to Nigeria, or within Nigeria.
with route as (
  select
    (select id from public.corridors where origin_country = 'CN' and destination_country = 'NG') as cn_ng,
    (select id from public.corridors where origin_country = 'NG' and destination_country = 'NG') as ng_ng
)
insert into public.products
  (id, vendor_id, title, description, category, brand, condition, condition_notes, price_minor, currency, stock,
   weight_grams, corridor_id, specs, warranty_months, requires_special_handling, active, created_at)
select p.id::uuid, p.vendor_id::uuid, p.title, p.description, p.category, p.brand, p.condition::public.product_condition,
       p.condition_notes, p.price_minor, p.currency, p.stock, p.weight_grams,
       case p.route when 'cn' then route.cn_ng else route.ng_ng end,
       p.specs::jsonb, p.warranty_months, p.special, true, now() - (p.age_hours || ' hours')::interval
from route,
(values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'cn',
   'Demo Samsung Galaxy A15 128GB', 'Brand new and sealed. Dual SIM, 6.5 inch Super AMOLED display, 50 MP camera and a 5000 mAh battery. Ships with a charging cable.',
   'phones', 'Samsung', 'new', null, 109900, 'CNY', 40, 300, '{"RAM":"6 GB","Storage":"128 GB","Screen size":"6.5 in","Battery":"5000 mAh"}', 12, false, 2),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'cn',
   'Demo Xiaomi Redmi Note 13 256GB', 'New in box. 6.67 inch AMOLED screen, 108 MP main camera and 33W fast charging. Global version with Google services.',
   'phones', 'Xiaomi', 'new', null, 129900, 'CNY', 25, 310, '{"RAM":"8 GB","Storage":"256 GB","Screen size":"6.67 in"}', 12, false, 5),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'cn',
   'Demo Tecno Spark 20 Pro', 'New phone with a 6.78 inch 120 Hz display and a 5000 mAh battery. A popular budget choice in Nigeria.',
   'phones', 'Tecno', 'new', null, 89900, 'CNY', 60, 290, '{"RAM":"8 GB","Storage":"256 GB","Battery":"5000 mAh"}', 12, false, 8),
  ('d2000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', 'cn',
   'Demo Apple iPhone 13 128GB Refurbished', 'Professionally refurbished and tested. Comes with a new battery cable and a 6 month warranty from the vendor.',
   'phones', 'Apple', 'refurbished', 'Grade A. Battery health 92 percent. Tiny micro-scratches on the frame, not visible when a case is on.', 299900, 'CNY', 6, 330, '{"Storage":"128 GB","Screen size":"6.1 in","Battery health":"92%"}', 6, false, 11),
  ('d2000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 'cn',
   'Demo 65W USB-C GaN Fast Charger', 'Compact 65 watt charger with two USB-C ports and one USB-A port. Charges a laptop and a phone at the same time.',
   'accessories', 'Baseus', 'new', null, 12900, 'CNY', 200, 180, '{"Output":"65 W","Ports":"2x USB-C, 1x USB-A"}', 6, false, 14),
  ('d2000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000002', 'cn',
   'Demo Lenovo ThinkPad E14 Gen 4 Core i5 16GB', 'Business laptop with a 14 inch full HD screen, 16 GB memory and a 512 GB SSD. Windows 11 Pro installed.',
   'laptops', 'Lenovo', 'new', null, 489900, 'CNY', 10, 1700, '{"Processor":"Intel Core i5","RAM":"16 GB","Storage":"512 GB SSD","Screen size":"14 in"}', 12, false, 17),
  ('d2000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000002', 'cn',
   'Demo HP Pavilion 15 Ryzen 5 8GB', 'Open box unit, never used. Full HD 15.6 inch screen, 8 GB memory and a 256 GB SSD.',
   'laptops', 'HP', 'open_box', 'Box opened for inspection only. Unit unused with all accessories and the original charger.', 369900, 'CNY', 3, 1750, '{"Processor":"AMD Ryzen 5","RAM":"8 GB","Storage":"256 GB SSD"}', 6, false, 20),
  ('d2000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000002', 'cn',
   'Demo EcoFlow River 2 Pro Power Station 768Wh', 'Portable power station with solar input. Runs a fridge, TV and lights during power cuts. Contains a large lithium battery, so it ships with special handling.',
   'solar_power', 'EcoFlow', 'new', null, 549900, 'CNY', 7, 7800, '{"Capacity":"768 Wh","Output":"800 W","Battery":"LiFePO4"}', 24, true, 23),
  ('d2000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000002', 'cn',
   'Demo Midea 1.7L Electric Kettle', 'Stainless steel kettle with automatic shut-off and boil-dry protection. 2200 watts.',
   'small_appliances', 'Midea', 'new', null, 8900, 'CNY', 150, 900, '{"Capacity":"1.7 L","Power":"2200 W"}', 12, false, 26),
  ('d2000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000003', 'ng',
   'Demo Samsung Galaxy S21 128GB Used', 'Used phone tested and cleaned, sold in Lagos. Charger and case included. Pick-up or delivery anywhere in Nigeria.',
   'phones', 'Samsung', 'used', 'Good condition. Small scratch on the frame, screen clean. Battery health 84 percent.', 28500000, 'NGN', 2, 280, '{"RAM":"8 GB","Storage":"128 GB","Battery health":"84%"}', 3, false, 29),
  ('d2000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000003', 'ng',
   'Demo Oraimo 20000mAh Power Bank', 'Fast-charging power bank with two outputs and a digital display. Keeps a phone going for days during outages.',
   'accessories', 'Oraimo', 'new', null, 1850000, 'NGN', 35, 420, '{"Capacity":"20000 mAh","Output":"22.5 W"}', 6, false, 32),
  ('d2000000-0000-4000-8000-000000000012', 'd1000000-0000-4000-8000-000000000003', 'ng',
   'Demo JBL Flip 6 Bluetooth Speaker', 'Waterproof portable speaker with 12 hours of playtime and punchy bass. Brand new and sealed.',
   'audio', 'JBL', 'new', null, 9500000, 'NGN', 12, 550, '{"Playtime":"12 hours","Water resistance":"IP67"}', 12, false, 35)
) as p (id, vendor_id, route, title, description, category, brand, condition, condition_notes, price_minor, currency,
        stock, weight_grams, specs, warranty_months, special, age_hours)
on conflict (id) do nothing;

-- Pictures: demo/<name>.webp is served from /public/demo. Only server-side code
-- may use these paths, so vendors cannot.
insert into public.product_images (id, product_id, storage_path, sort_order) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'demo/galaxy-a15-front.webp', 0),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'demo/galaxy-a15-back.webp', 1),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', 'demo/redmi-note-13.webp', 0),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003', 'demo/spark-20-pro.webp', 0),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000004', 'demo/iphone-13-refurb.webp', 0),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000005', 'demo/gan-charger-65w.webp', 0),
  ('d3000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-000000000006', 'demo/thinkpad-e14.webp', 0),
  ('d3000000-0000-4000-8000-000000000008', 'd2000000-0000-4000-8000-000000000007', 'demo/pavilion-15.webp', 0),
  ('d3000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000008', 'demo/river-2-pro-front.webp', 0),
  ('d3000000-0000-4000-8000-000000000010', 'd2000000-0000-4000-8000-000000000008', 'demo/river-2-pro-side.webp', 1),
  ('d3000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-000000000009', 'demo/kettle-1-7l.webp', 0),
  ('d3000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000010', 'demo/galaxy-s21-used.webp', 0),
  ('d3000000-0000-4000-8000-000000000013', 'd2000000-0000-4000-8000-000000000011', 'demo/power-bank-20000.webp', 0),
  ('d3000000-0000-4000-8000-000000000014', 'd2000000-0000-4000-8000-000000000012', 'demo/flip-6-speaker.webp', 0)
on conflict (id) do nothing;
