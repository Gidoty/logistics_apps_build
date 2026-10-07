import { expect, test, type Page } from "@playwright/test";

/**
 * Delivered-price estimates in the shop, the public estimator and the cron
 * route, at 375px against the fake Supabase (tests/e2e/mock-supabase.mjs).
 * The numbers come from the engine running on the mock's placeholder rules;
 * the exact arithmetic is covered by the unit tests.
 */
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 54399}`;
const PRODUCT = (n: number) => `d2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function mock(path: string, init?: RequestInit) {
  const response = await fetch(`${MOCK}${path}`, init);
  return response.json();
}
const setMode = (mode: object) => mock("/__mode", { method: "POST", body: JSON.stringify(mode) });

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Reads "Est. delivered: ₦123,456.78" into the digits only. */
async function estimateOf(page: Page, symbol: string): Promise<number> {
  const text = await page
    .locator("p", { hasText: /Est\. delivered:/ })
    .first()
    .innerText();
  const match = new RegExp(`${symbol}([\\d,]+\\.\\d{2})`).exec(text);
  if (!match) throw new Error(`No ${symbol} estimate in: ${text}`);
  return Number(match[1].replaceAll(",", ""));
}

test.beforeEach(async () => {
  await mock("/__reset", { method: "POST" });
});

test.describe("shop estimates", () => {
  test("every card shows an estimated delivered price in naira by default", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByText(/Est\. delivered: ₦[\d,]+\.\d{2}/).first()).toBeVisible();
    const cards = await page.getByText(/Est\. delivered:/).count();
    expect(cards).toBeGreaterThanOrEqual(10);
    await expect(page.getByText("Delivered price on request")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("switching the currency to GBP changes the estimates and is remembered", async ({ page }) => {
    await page.goto("/shop");
    const naira = await estimateOf(page, "₦");
    await page.getByLabel("Show prices in").selectOption("GBP");
    await page.getByRole("button", { name: "Change" }).click();
    await expect(page.getByText(/Est\. delivered: £[\d,]+\.\d{2}/).first()).toBeVisible();
    const pounds = await estimateOf(page, "£");
    // 1 GBP is about 1875 NGN at the mock rates, so the pound figure is far smaller.
    expect(pounds).toBeLessThan(naira / 100);

    await page.reload();
    await expect(page.getByLabel("Show prices in")).toHaveValue("GBP");
    await page.goto(`/shop/${PRODUCT(1)}`);
    await expect(page.getByText(/Est\. delivered: £[\d,]+\.\d{2}/).first()).toBeVisible();
  });

  test("a product page changes its estimate with the destination state", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(1)}`);
    const lagos = await estimateOf(page, "₦");
    await expect(page.getByText("To Lagos.")).toBeVisible();

    await page.getByLabel("Deliver to").selectOption("Kano");
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page).toHaveURL(/state=Kano/);
    await expect(page.getByText("To Kano.")).toBeVisible();
    const kano = await estimateOf(page, "₦");
    // Zone C costs more than Zone A for the same item.
    expect(kano).toBeGreaterThan(lagos);
    await expectNoHorizontalScroll(page);
  });

  test("includes the customs disclaimer on a China product and none on a local one", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(1)}`);
    await expect(
      page.getByText("Customs charges are estimates. Final duty is set by Nigeria Customs Service."),
    ).toBeVisible();
    await page.goto(`/shop/${PRODUCT(10)}`);
    await expect(page.getByText(/Est\. delivered: ₦/)).toBeVisible();
    await expect(page.getByText("Customs charges are estimates")).toHaveCount(0);
  });

  test("ignores an unknown state and falls back to Lagos", async ({ page }) => {
    await page.goto(`/shop/${PRODUCT(1)}?state=Atlantis`);
    await expect(page.getByText("To Lagos.")).toBeVisible();
  });

  test("says 'Delivered price on request' when exchange rates are older than 24 hours", async ({ page }) => {
    // Warm the cache with fresh rates first: a cached price must still not be shown once the rate is stale.
    await page.goto(`/shop/${PRODUCT(1)}`);
    await expect(page.getByText(/Est\. delivered: ₦/)).toBeVisible();

    await setMode({ fxAgeHours: 48 });
    await page.goto(`/shop/${PRODUCT(1)}`);
    await expect(page.getByText("Delivered price on request")).toBeVisible();
    await expect(page.getByText(/Est\. delivered/)).toHaveCount(0);

    await page.goto("/shop");
    await expect(page.getByText("Delivered price on request").first()).toBeVisible();
    await expect(page.getByText(/Est\. delivered/)).toHaveCount(0);
    // The listed price still shows: only the delivered estimate is withheld.
    await expect(page.getByText("₦285,000.00").first()).toBeVisible();

    await setMode({ fxAgeHours: 1 });
    await page.goto("/shop");
    await expect(page.getByText(/Est\. delivered: ₦/).first()).toBeVisible();
  });
});

test.describe("public estimator", () => {
  test("works without logging in and shows every line, the total and the customs note", async ({ page }) => {
    await page.goto("/estimate");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Delivered price estimator");
    await expectNoHorizontalScroll(page);

    await page.getByLabel("Price of one item").fill("1099");
    await page.getByLabel("Currency of that price").selectOption("CNY");
    await page.getByLabel("Weight of one item, in grams").fill("1500");
    await page.getByLabel("Category").selectOption("phones");
    await page.getByLabel("Deliver to (state)").selectOption("Lagos");
    await page.getByLabel("Show the total in").selectOption("NGN");
    await page.getByRole("button", { name: "Work out the price" }).click();

    await expect(page).toHaveURL(/itemPrice=1099/);
    const result = page.getByRole("region", { name: "Your estimate" });
    for (const label of [
      "Item price",
      "International freight",
      "Insurance",
      "Import duty (Estimated)",
      "VAT on imports (Estimated)",
      "Customs clearing",
      "Delivery to Lagos",
      "Service fee",
      "Payment processing",
      "Currency conversion fee",
    ]) {
      await expect(result.getByText(label, { exact: false }).first()).toBeVisible();
    }
    await expect(result.getByText("Total")).toBeVisible();
    await expect(
      result
        .getByText("Customs charges are estimates. Final duty is set by Nigeria Customs Service.")
        .first(),
    ).toBeVisible();
    await expect(
      result.getByText("No box size was given").or(page.getByText("No box size was given")),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);

    const quote = page.getByRole("link", { name: "Get an exact quote" });
    await expect(quote).toHaveAttribute("href", "/order/link");
    await quote.click();
    // Logged out, so the exact quote asks you to sign in first.
    await expect(page).toHaveURL(/\/login\?next=%2Forder%2Flink/);
  });

  test("a result link can be shared: the same address gives the same numbers", async ({ page, context }) => {
    await page.goto(
      "/estimate?itemPrice=500&itemCurrency=USD&quantity=2&weightGrams=800&categorySlug=laptops&corridorId=c0000000-0000-4000-8000-000000000001&destinationState=Rivers&buyerCurrency=USD",
    );
    const total = await page.getByText(/Total/).last().locator("xpath=following-sibling::dd").innerText();
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.getByText(total)).toBeVisible();
  });

  test("shows what to fix instead of a number when the details are incomplete", async ({ page }) => {
    await page.goto(
      "/estimate?itemPrice=abc&itemCurrency=USD&quantity=1&weightGrams=&categorySlug=&buyerCurrency=NGN",
    );
    await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Your estimate" })).toHaveCount(0);
  });

  test("handles a local item with no freight or duty", async ({ page }) => {
    const ng = "c0000000-0000-4000-8000-000000000002";
    await page.goto(
      `/estimate?itemPrice=150000&itemCurrency=NGN&quantity=1&weightGrams=800&categorySlug=phones&corridorId=${ng}&destinationState=Anambra&buyerCurrency=GBP`,
    );
    const result = page.getByRole("region", { name: "Your estimate" });
    await expect(result.getByText("Service fee")).toBeVisible();
    await expect(result.getByText("International freight")).toHaveCount(0);
    await expect(result.getByText("Import duty")).toHaveCount(0);
    await expect(result.getByText(/£/).first()).toBeVisible();
  });

  test("stops after the hourly limit with a plain message", async ({ page }) => {
    await setMode({ throttleBlocked: true });
    await page.goto(
      "/estimate?itemPrice=500&itemCurrency=USD&quantity=1&weightGrams=800&categorySlug=phones&buyerCurrency=USD&destinationState=Lagos&corridorId=c0000000-0000-4000-8000-000000000001",
    );
    await expect(page.getByText("You have used all 30 estimates for this hour")).toBeVisible();
    await expect(page.getByRole("region", { name: "Your estimate" })).toHaveCount(0);
  });

  test("tells visitors to ask for a quote, without naming internal rules, when exchange rates are stale", async ({
    page,
  }) => {
    await setMode({ fxAgeHours: 48 });
    await page.goto(
      "/estimate?itemPrice=500&itemCurrency=USD&quantity=1&weightGrams=800&categorySlug=phones&buyerCurrency=NGN&destinationState=Lagos&corridorId=c0000000-0000-4000-8000-000000000001",
    );
    await expect(page.getByText("Exchange rates are being updated")).toBeVisible();
    await expect(page.getByText(/FX_STALE|USD to NGN/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ask for an exact quote" })).toBeVisible();
  });
});

test.describe("exchange-rate cron route", () => {
  test("answers 401 without the secret, with a wrong one, and for other schemes", async ({ request }) => {
    expect((await request.get("/api/cron/fx")).status()).toBe(401);
    expect(
      (
        await request.get("/api/cron/fx", { headers: { authorization: "Bearer wrong-secret-value-123" } })
      ).status(),
    ).toBe(401);
    expect((await request.get("/api/cron/fx", { headers: { "x-cron-secret": "" } })).status()).toBe(401);
    expect(
      (
        await request.get("/api/cron/fx", { headers: { authorization: "e2e-cron-secret-0123456789" } })
      ).status(),
    ).toBe(401);
  });
});
