import { expect, test, type Page } from "@playwright/test";

/**
 * Public shop pages at 375px, against the fake Supabase server
 * (tests/e2e/mock-supabase.mjs). These check what a phone user sees, how heavy
 * the pages are on a slow network, and which queries the app sends. Whether the
 * database returns the right rows is covered by tests/db.
 */
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 54399}`;
const PRODUCT = (n: number) => `d2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VENDOR = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CN_CORRIDOR = "c0000000-0000-4000-8000-000000000001";

type Logged = { path: string; query: string };

async function mock(path: string, init?: RequestInit) {
  const response = await fetch(`${MOCK}${path}`, init);
  return response.json();
}
const requests = (): Promise<Logged[]> => mock("/__requests");
const setMode = (mode: object) => mock("/__mode", { method: "POST", body: JSON.stringify(mode) });

/** The params of the first request the app made to a table. */
async function firstQuery(table: string): Promise<URLSearchParams> {
  const log = await requests();
  const entry = log.find((r) => r.path === `/rest/v1/${table}` && r.query.includes("select="));
  if (!entry) throw new Error(`No request to ${table}. Saw: ${log.map((r) => r.path).join(", ")}`);
  return new URLSearchParams(entry.query);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await mock("/__reset", { method: "POST" });
});

test.describe("shop grid", () => {
  test("lists products with prices, without sideways scrolling", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("heading", { level: 1, name: "Shop" })).toBeVisible();
    await expect(page.getByText("12 products")).toBeVisible();

    const cards = page.locator('main ul a[href^="/shop/"]');
    await expect(cards).toHaveCount(12);
    await expect(cards.first()).toContainText("Demo Samsung Galaxy A15 128GB");
    await expect(cards.first()).toContainText("¥1,099.00");
    await expect(page.locator("main")).toContainText("₦285,000.00");
    await expect(page.locator("main")).toContainText("From China");
    await expect(page.locator("main")).toContainText("Refurbished");
    await expect(page.locator("main")).toContainText("Out of stock");
    await expectNoHorizontalScroll(page);
  });

  test("turns the URL into the right database query", async ({ page }) => {
    await page.goto(
      "/shop?q=sams+gal&category=electronics&brand=Samsung&condition=used&origin=CN&currency=CNY&min=1000&max=3,000.50&sort=price_asc&page=2",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Shop" })).toBeVisible();

    const query = await firstQuery("products");
    expect(query.get("search_vector")).toBe("fts(simple).sams:* & gal:*");
    // "electronics" is a group, so it expands to its categories.
    expect(query.get("category")).toMatch(/^in\.\(.*phones.*smart_home.*\)$/);
    expect(query.get("category")).not.toContain("electronics");
    expect(query.get("brand")).toBe("ilike.Samsung");
    expect(query.get("condition")).toBe("eq.used");
    expect(query.get("corridor_id")).toBe(`in.(${CN_CORRIDOR})`);
    expect(query.get("currency")).toBe("eq.CNY");
    expect(query.getAll("price_minor")).toEqual(["gte.100000", "lte.300050"]);
    expect(query.get("order")).toBe("price_minor.asc,id.asc");
    expect(query.get("limit")).toBe("20");
    expect(query.get("offset")).toBe("20");
    // Only the first picture of each product is fetched for the grid.
    expect(query.get("product_images.limit")).toBe("1");
    expect(query.get("product_images.order")).toBe("sort_order.asc");

    const corridors = new URLSearchParams(
      (await requests()).find(
        (r) => r.path === "/rest/v1/corridors" && r.query.includes("origin_country=eq.CN"),
      )?.query,
    );
    expect(corridors.get("active")).toBe("eq.true");
  });

  test("keeps the filters in the page and in shareable links", async ({ page }) => {
    await page.goto("/shop?q=phone&condition=refurbished&currency=CNY&sort=price_desc");
    await expect(page.getByLabel("Search products")).toHaveValue("phone");
    await expect(page.getByLabel("Condition")).toHaveValue("refurbished");
    await expect(page.getByLabel("Currency")).toHaveValue("CNY");
    await expect(page.getByLabel("Sort by")).toHaveValue("price_desc");
    await expect(page.getByText("Filters and sorting (2)")).toBeVisible();
  });

  test("falls back to newest when sorting by price without a currency, and says so", async ({ page }) => {
    await page.goto("/shop?sort=price_asc");
    await expect(page.getByText("Choose a currency to sort by price.")).toBeVisible();
    expect((await firstQuery("products")).get("order")).toBe("created_at.desc,id.asc");
  });

  test("ignores a broken link instead of failing", async ({ page }) => {
    await page.goto("/shop?category=%27%3B+drop&currency=XYZ&min=abc&page=-4&sort=popular&origin=CHINA");
    await expect(page.getByText("12 products")).toBeVisible();
    const query = await firstQuery("products");
    expect(query.get("category")).toBeNull();
    expect(query.get("currency")).toBeNull();
    expect(query.get("offset")).toBe("0");
  });

  test("submits the filter form as a plain GET with values in the URL", async ({ page }) => {
    await page.goto("/shop");
    await page.getByLabel("Search products").fill("galaxy");
    await page.getByText("Filters and sorting").click();
    await page.getByLabel("Condition").selectOption("used");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/\/shop\?.*q=galaxy/);
    await expect(page).toHaveURL(/condition=used/);
  });
});

test.describe("empty and loading states", () => {
  test("shows a friendly message when the shop has no products", async ({ page }) => {
    await setMode({ products: "empty" });
    await page.goto("/shop");
    await expect(page.getByRole("heading", { name: "No products yet" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("offers a way out when a search finds nothing", async ({ page }) => {
    await setMode({ products: "empty" });
    await page.goto("/shop?q=nonexistent");
    await expect(page.getByRole("heading", { name: "No products match your search" })).toBeVisible();
    await page.getByRole("link", { name: "Clear search and filters" }).click();
    await expect(page).toHaveURL(/\/shop$/);
  });

  test("explains a page past the end of the results and links back to page 1", async ({ page }) => {
    await setMode({ products: "beyond" });
    await page.goto("/shop?q=phone&page=9");
    await expect(page.getByRole("heading", { name: "That page is empty" })).toBeVisible();
    await page.getByRole("link", { name: "Go to the first page" }).click();
    await expect(page).toHaveURL(/\/shop\?q=phone$/);
    await expect(page.getByText("12 products")).toBeVisible();
  });

  test("shows grey placeholders while products load", async ({ page }) => {
    await setMode({ delayMs: 1500 });
    await page.goto("/shop", { waitUntil: "commit" });
    await expect(page.getByLabel("Loading products")).toBeVisible();
    await expect(page.getByText("12 products")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Loading products")).toHaveCount(0);
  });
});

test.describe("product page", () => {
  test("shows the price, the promise, a disabled buy button and the delivery window", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(8)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Demo EcoFlow River 2 Pro Power Station 768Wh",
    );
    await expect(page.getByText("¥5,499.00 CNY")).toBeVisible();
    await expect(
      page.getByText("Final delivered price, including shipping and customs, is shown before you pay."),
    ).toBeVisible();

    const buy = page.getByRole("button", { name: "Coming soon" });
    await expect(buy).toBeVisible();
    await expect(buy).toBeDisabled();

    await expect(page.getByText("Ships from")).toBeVisible();
    await expect(page.locator("dd", { hasText: "China" })).toBeVisible();
    await expect(page.locator("dd", { hasText: "10 to 21 days" })).toBeVisible();
    await expect(page.getByText("2 years warranty")).toBeVisible();
    await expect(page.getByText("needs special handling for shipping")).toBeVisible();
    await expect(page.getByRole("cell", { name: "768 Wh" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("names the vendor with a verified badge and links to their page", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(1)}`);
    await expect(page.getByText("Verified vendor")).toBeVisible();
    const vendor = page.getByRole("link", { name: "Demo Shenzhen Mobile Hub" });
    await expect(vendor).toHaveAttribute("href", `/vendors/${VENDOR(1)}`);
    await expect(page.getByText("Shenzhen, China")).toBeVisible();
    await expect(page.getByText("Swipe to see all 2 photos.")).toBeVisible();
  });

  test("shows the condition badge and notes for items that are not new", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(4)}`);
    await expect(page.getByText("Refurbished", { exact: true })).toBeVisible();
    await expect(page.getByText("About the condition")).toBeVisible();
    await expect(page.getByText("Battery health 92 percent")).toBeVisible();
  });

  test("shows local delivery times for a vendor in Lagos", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(10)}`);
    await expect(page.getByText("₦285,000.00 NGN")).toBeVisible();
    await expect(page.locator("dd", { hasText: "1 to 3 days" })).toBeVisible();
    await expect(page.locator("dd", { hasText: "Nigeria" }).first()).toBeVisible();
  });

  test("shows a not-found page for unknown and malformed ids", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(99)}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.goto("/shop/not-a-real-id");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("vendor page", () => {
  test("lists the vendor's products under a verified badge", async ({ page }) => {
    await page.goto(`/vendors/${VENDOR(1)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo Shenzhen Mobile Hub");
    await expect(page.getByText("Verified vendor")).toBeVisible();
    await expect(page.getByText(/Shenzhen, China\. On the platform since 2026/)).toBeVisible();
    const query = await firstQuery("products");
    expect(query.get("vendor_id")).toBe(`eq.${VENDOR(1)}`);
    await expect(page.locator('main ul a[href^="/shop/"]').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("returns not found for an unknown vendor", async ({ page }) => {
    await page.goto(`/vendors/${VENDOR(9)}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("Slow 4G", () => {
  // DevTools "Slow 4G": 1.6 Mbps down, 750 Kbps up, 150 ms round trip.
  const SLOW_4G = {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  };

  async function measure(page: Page, context: import("@playwright/test").BrowserContext, path: string) {
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Network.emulateNetworkConditions", SLOW_4G);

    const types = new Map<string, string>();
    const bytes: Record<string, number> = {};
    let total = 0;
    client.on("Network.responseReceived", (event) => types.set(event.requestId, event.type));
    client.on("Network.loadingFinished", (event) => {
      const type = types.get(event.requestId) ?? "Other";
      bytes[type] = (bytes[type] ?? 0) + event.encodedDataLength;
      total += event.encodedDataLength;
    });

    const started = Date.now();
    await page.goto(path, { waitUntil: "load" });
    const loadMs = Date.now() - started;
    const lcpMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            resolve(entries[entries.length - 1]?.startTime ?? 0);
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }),
    );
    const kb = (n = 0) => Math.round(n / 1024);
    const summary = `${path}: load ${loadMs} ms, LCP ${Math.round(lcpMs)} ms, total ${kb(total)} KB (html ${kb(bytes.Document)}, js ${kb(bytes.Script)}, css ${kb(bytes.Stylesheet)}, images ${kb(bytes.Image)}, fonts ${kb(bytes.Font)})`;
    console.log(`SLOW4G ${summary}`);
    test.info().annotations.push({ type: "slow-4g", description: summary });
    return { loadMs, lcpMs, total, bytes };
  }

  test("/shop stays light and fast", async ({ page, context }) => {
    const result = await measure(page, context, "/shop");
    await expect(page.getByText("12 products")).toBeVisible();
    // Budgets: generous enough to be stable, tight enough to catch a heavy page.
    expect(result.total).toBeLessThan(700 * 1024);
    expect(result.bytes.Script ?? 0).toBeLessThan(260 * 1024);
    expect(result.bytes.Font ?? 0).toBe(0);
    expect(result.lcpMs).toBeLessThan(5000);
    expect(result.loadMs).toBeLessThan(8000);
  });

  test("a product page stays light and fast", async ({ page, context }) => {
    const result = await measure(page, context, `/shop/${PRODUCT(1)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(result.total).toBeLessThan(600 * 1024);
    expect(result.lcpMs).toBeLessThan(5000);
    expect(result.loadMs).toBeLessThan(8000);
  });
});
