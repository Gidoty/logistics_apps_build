import { expect, test, type Page } from "@playwright/test";

/**
 * The public tracking page at 375px, against the fake Supabase server. Checks
 * what a visitor sees and that nothing private is in the HTML. The database
 * function that limits the fields is tested in tests/db/delivery.test.ts.
 */
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 54399}`;
const OUT_FOR_DELIVERY = "a".repeat(32);
const IN_TRANSIT = "b".repeat(32);
const LOCKED = "c".repeat(32);

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
});

test.describe("public tracking page", () => {
  test("shows the timeline, item and first name without logging in", async ({ page }) => {
    const response = await page.goto(`/t/${IN_TRANSIT}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Delivery tracking");
    await expect(page.getByText("Samsung Galaxy A15 for Ada, Port Harcourt")).toBeVisible();
    const steps = page.getByRole("list", { name: "Order progress" }).getByRole("listitem");
    await expect(steps).toHaveCount(9);
    await expect(page.getByText("In transit (current step)")).toBeVisible();
    await expect(page.getByLabel("Delivery code (6 digits)")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("asks for the delivery code only when the order is out for delivery", async ({ page }) => {
    await page.goto(`/t/${OUT_FOR_DELIVERY}`);
    await expect(page.getByLabel("Delivery code (6 digits)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm delivery" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a wrong code shows how many tries are left", async ({ page }) => {
    await page.goto(`/t/${OUT_FOR_DELIVERY}`);
    await page.getByLabel("Delivery code (6 digits)").fill("123456");
    await page.getByRole("button", { name: "Confirm delivery" }).click();
    await expect(page.getByText("That code is not right. 4 tries left.")).toBeVisible();
  });

  test("a short code is refused before it reaches the database", async ({ page }) => {
    await page.goto(`/t/${OUT_FOR_DELIVERY}`);
    await page.getByLabel("Delivery code (6 digits)").fill("123");
    await page.getByRole("button", { name: "Confirm delivery" }).click();
    await expect(page.getByText("Enter the 6 digits of the delivery code.")).toBeVisible();
    const log: { path: string }[] = await (await fetch(`${MOCK}/__requests`)).json();
    expect(log.some((r) => r.path.endsWith("confirm_delivery_with_code"))).toBe(false);
  });

  test("tells the recipient when the code is locked", async ({ page }) => {
    await page.goto(`/t/${LOCKED}`);
    await expect(page.getByText(/delivery code is locked/i)).toBeVisible();
    await expect(page.getByLabel("Delivery code (6 digits)")).toHaveCount(0);
  });

  test("contains no phone, address, price or buyer detail, and is hidden from search engines", async ({
    page,
  }) => {
    const response = await page.goto(`/t/${OUT_FOR_DELIVERY}`);
    const html = (await response?.text()) ?? "";
    for (const secret of ["+234", "2348", "Aba Road", "₦", "NGN"]) {
      expect(
        html.toLowerCase().includes(secret.toLowerCase()),
        `page contains "${secret}": ...${html.slice(Math.max(0, html.toLowerCase().indexOf(secret.toLowerCase()) - 80), html.toLowerCase().indexOf(secret.toLowerCase()) + 80)}...`,
      ).toBe(false);
    }
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/[₦£€¥]\s?\d/);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("answers 404 for an unknown or malformed link", async ({ page }) => {
    for (const token of ["f".repeat(32), "short", "A".repeat(32)]) {
      const response = await page.goto(`/t/${token}`);
      expect(response?.status()).toBe(404);
    }
  });

  test("slows a visitor who asks too often", async ({ page }) => {
    await fetch(`${MOCK}/__mode`, { method: "POST", body: JSON.stringify({ throttleBlocked: true }) });
    await page.goto(`/t/${IN_TRANSIT}`);
    await expect(page.getByText(/Too many requests/)).toBeVisible();
  });
});
