/**
 * A tiny stand-in for Supabase's REST API, for browser tests only.
 *
 * It answers the read queries the public shop makes with fixed demo rows and
 * records every request, so tests can check what the app asked for. It does
 * NOT apply filters the way Postgres does: database behavior is covered by
 * tests/db. Here the goal is layout, weight, speed and request construction.
 *
 * Control endpoints: GET /__requests, POST /__reset, POST /__mode {products, delayMs}.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 54399);

const id = (prefix, n) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VENDORS = [
  {
    id: id("d1", 1),
    business_name: "Demo Shenzhen Mobile Hub",
    country_code: "CN",
    city: "Shenzhen",
    categories: ["phones", "accessories"],
    created_at: "2026-01-15T10:00:00+00:00",
  },
  {
    id: id("d1", 2),
    business_name: "Demo Guangzhou Power and Tech",
    country_code: "CN",
    city: "Guangzhou",
    categories: ["laptops", "solar_power"],
    created_at: "2026-02-01T10:00:00+00:00",
  },
  {
    id: id("d1", 3),
    business_name: "Demo Ikeja Gadget Store",
    country_code: "NG",
    city: "Lagos",
    categories: ["phones", "accessories", "audio"],
    created_at: "2026-03-01T10:00:00+00:00",
  },
];
const CORRIDORS = [
  {
    id: id("c0", 1),
    name: "China to Nigeria",
    origin_country: "CN",
    destination_country: "NG",
    default_transit_days_min: 10,
    default_transit_days_max: 21,
    active: true,
  },
  {
    id: id("c0", 2),
    name: "Within Nigeria",
    origin_country: "NG",
    destination_country: "NG",
    default_transit_days_min: 1,
    default_transit_days_max: 3,
    active: true,
  },
];
const CN = CORRIDORS[0].id;
const NG = CORRIDORS[1].id;

const base = {
  description:
    "Brand new phone with a 6.5 inch display and a 5000 mAh battery. Ships with a charging cable and a one year warranty from the vendor.",
  category: "phones",
  condition_notes: null,
  weight_grams: 300,
  warranty_months: 12,
  requires_special_handling: false,
  specs: { RAM: "6 GB", Storage: "128 GB" },
  stock: 20,
};
const P = (n, vendor, corridor, title, brand, price, currency, image, extra = {}) => ({
  ...base,
  id: id("d2", n),
  vendor_id: VENDORS[vendor].id,
  corridor_id: corridor,
  title,
  brand,
  condition: "new",
  price_minor: price,
  currency,
  product_images: [{ id: id("d3", n), storage_path: `demo/${image}.webp`, sort_order: 0 }],
  ...extra,
});
const PRODUCTS = [
  P(1, 0, CN, "Demo Samsung Galaxy A15 128GB", "Samsung", 109900, "CNY", "galaxy-a15-front", {
    product_images: [
      { id: id("d3", 1), storage_path: "demo/galaxy-a15-front.webp", sort_order: 0 },
      { id: id("d3", 2), storage_path: "demo/galaxy-a15-back.webp", sort_order: 1 },
    ],
  }),
  P(2, 0, CN, "Demo Xiaomi Redmi Note 13 256GB", "Xiaomi", 129900, "CNY", "redmi-note-13"),
  P(3, 0, CN, "Demo Tecno Spark 20 Pro", "Tecno", 89900, "CNY", "spark-20-pro"),
  P(4, 0, CN, "Demo Apple iPhone 13 128GB Refurbished", "Apple", 299900, "CNY", "iphone-13-refurb", {
    condition: "refurbished",
    condition_notes: "Grade A. Battery health 92 percent. Tiny micro-scratches on the frame.",
    stock: 6,
  }),
  P(5, 0, CN, "Demo 65W USB-C GaN Fast Charger", "Baseus", 12900, "CNY", "gan-charger-65w", {
    category: "accessories",
    specs: { Output: "65 W" },
  }),
  P(6, 1, CN, "Demo Lenovo ThinkPad E14 Gen 4 Core i5 16GB", "Lenovo", 489900, "CNY", "thinkpad-e14", {
    category: "laptops",
  }),
  P(7, 1, CN, "Demo HP Pavilion 15 Ryzen 5 8GB", "HP", 369900, "CNY", "pavilion-15", {
    category: "laptops",
    condition: "open_box",
    condition_notes: "Box opened for inspection only. Unit unused with all accessories.",
    stock: 3,
  }),
  P(8, 1, CN, "Demo EcoFlow River 2 Pro Power Station 768Wh", "EcoFlow", 549900, "CNY", "river-2-pro-front", {
    category: "solar_power",
    requires_special_handling: true,
    weight_grams: 7800,
    warranty_months: 24,
    specs: { Capacity: "768 Wh", Output: "800 W" },
  }),
  P(9, 1, CN, "Demo Midea 1.7L Electric Kettle", "Midea", 8900, "CNY", "kettle-1-7l", {
    category: "small_appliances",
    specs: {},
  }),
  P(10, 2, NG, "Demo Samsung Galaxy S21 128GB Used", "Samsung", 28500000, "NGN", "galaxy-s21-used", {
    condition: "used",
    condition_notes: "Good condition. Small scratch on the frame. Battery health 84 percent.",
    stock: 2,
    warranty_months: 3,
  }),
  P(11, 2, NG, "Demo Oraimo 20000mAh Power Bank", "Oraimo", 1850000, "NGN", "power-bank-20000", {
    category: "accessories",
  }),
  P(12, 2, NG, "Demo JBL Flip 6 Bluetooth Speaker", "JBL", 9500000, "NGN", "flip-6-speaker", {
    category: "audio",
    stock: 0,
  }),
];
const CURRENCIES = [
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minor_unit_digits: 2 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", minor_unit_digits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", minor_unit_digits: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", minor_unit_digits: 2 },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", minor_unit_digits: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", minor_unit_digits: 2 },
];
const COUNTRIES = [
  { code: "CN", name: "China" },
  { code: "GB", name: "United Kingdom" },
  { code: "NG", name: "Nigeria" },
  { code: "US", name: "United States" },
];
const CATEGORIES = [
  { slug: "electronics", name: "Electronics", parent_slug: null, sort_order: 10 },
  { slug: "general", name: "General", parent_slug: null, sort_order: 20 },
  ...[
    "phones",
    "laptops",
    "tablets",
    "accessories",
    "audio",
    "cameras",
    "gaming",
    "smart_home",
    "solar_power",
    "small_appliances",
  ].map((slug, i) => ({
    slug,
    name: slug.replace("_", " ").replace(/^./, (c) => c.toUpperCase()),
    parent_slug: "electronics",
    sort_order: 11 + i,
  })),
  ...["fashion", "beauty", "home", "baby", "books", "other"].map((slug, i) => ({
    slug,
    name: slug.replace(/^./, (c) => c.toUpperCase()),
    parent_slug: "general",
    sort_order: 21 + i,
  })),
];
const BRANDS = [...new Set(PRODUCTS.map((p) => p.brand))].sort().map((brand) => ({
  brand_key: brand.toLowerCase(),
  brand,
  product_count: PRODUCTS.filter((p) => p.brand === brand).length,
}));

let requests = [];
let mode = { products: "normal", delayMs: 0 };

function eq(url, column) {
  const value = url.searchParams.get(column);
  return value?.startsWith("eq.") ? value.slice(3) : null;
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function list(res, rows, wantsCount, wantsObject) {
  if (wantsObject)
    return rows.length === 1
      ? respond(res, 200, rows[0])
      : respond(res, 406, { code: "PGRST116", message: "no rows", details: "", hint: null });
  const range = rows.length > 0 ? `0-${rows.length - 1}/${rows.length}` : "*/0";
  respond(res, 200, rows, wantsCount ? { "Content-Range": range } : {});
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/__requests") return respond(res, 200, requests);
  if (url.pathname === "/__reset") {
    requests = [];
    mode = { products: "normal", delayMs: 0 };
    return respond(res, 200, {});
  }
  if (url.pathname === "/__mode") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    mode = { ...mode, ...JSON.parse(raw || "{}") };
    return respond(res, 200, mode);
  }
  if (url.pathname === "/__health") return respond(res, 200, { ok: true });

  requests.push({
    method: req.method,
    path: url.pathname,
    query: url.search,
    url: `${url.pathname}${url.search}`,
  });
  const table = url.pathname.replace("/rest/v1/", "");
  const wantsCount = /count=exact/.test(String(req.headers.prefer ?? ""));
  const wantsObject = /vnd\.pgrst\.object/.test(String(req.headers.accept ?? ""));

  if (table === "products" && mode.delayMs > 0) await new Promise((r) => setTimeout(r, mode.delayMs));

  switch (table) {
    case "products": {
      if (mode.products === "empty") return list(res, [], wantsCount, wantsObject);
      // Like PostgREST when the requested page starts after the last row.
      if (mode.products === "beyond" && Number(url.searchParams.get("offset") ?? 0) > 0) {
        return respond(res, 416, {
          code: "PGRST103",
          message: "Requested range not satisfiable",
          details: null,
          hint: null,
        });
      }
      const productId = eq(url, "id");
      const vendorId = eq(url, "vendor_id");
      const rows = PRODUCTS.filter(
        (p) => (productId ? p.id === productId : true) && (vendorId ? p.vendor_id === vendorId : true),
      );
      return list(res, rows, wantsCount, wantsObject);
    }
    case "corridors": {
      const corridorId = eq(url, "id");
      const origin = eq(url, "origin_country");
      return list(
        res,
        CORRIDORS.filter(
          (c) => (corridorId ? c.id === corridorId : true) && (origin ? c.origin_country === origin : true),
        ),
        false,
        wantsObject,
      );
    }
    case "vendor_directory": {
      const vendorId = eq(url, "id");
      return list(
        res,
        VENDORS.filter((v) => (vendorId ? v.id === vendorId : true)),
        false,
        wantsObject,
      );
    }
    case "currencies":
      return list(res, CURRENCIES, false, false);
    case "countries":
      return list(res, COUNTRIES, false, false);
    case "categories":
      return list(res, CATEGORIES, false, false);
    case "shop_brands":
      return list(res, BRANDS, false, false);
    default:
      return respond(res, 404, { message: `mock: no route for ${table}` });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock supabase listening on ${PORT}`));
