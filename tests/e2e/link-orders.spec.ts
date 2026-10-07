import { expect, test, type Page } from "@playwright/test";

/**
 * "Buy it for me" with real accounts. Needs a running Supabase project with
 * migrations and seed applied, and these variables (existing, confirmed accounts):
 *   E2E_BASE_URL, E2E_BUYER_EMAIL / E2E_BUYER_PASSWORD, E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 * Skipped otherwise. The AliExpress link is never fetched in a way that matters
 * here: the order is created whether or not the preview loads.
 */
const realApp = Boolean(process.env.E2E_BASE_URL);
const buyer = { email: process.env.E2E_BUYER_EMAIL, password: process.env.E2E_BUYER_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test.describe("link orders", () => {
  test.skip(
    !realApp || !buyer.email || !buyer.password || !admin.email || !admin.password,
    "Set E2E_BASE_URL and the buyer and admin account variables",
  );

  test("an Amazon link is blocked with a clear message", async ({ page }) => {
    await logIn(page, buyer.email!, buyer.password!);
    await page.goto("/order/link");
    const link = page.getByLabel("Product link");
    await link.fill("https://www.amazon.com/dp/B000000000");
    await link.blur();
    await expect(page.getByText("We cannot buy from Amazon yet")).toBeVisible();
  });

  test("buyer requests, admin quotes and revises, buyer accepts", async ({ page, browser }) => {
    await logIn(page, buyer.email!, buyer.password!);
    await page.goto("/order/link");
    await page.getByLabel("Product link").fill("https://www.aliexpress.com/item/1005000000000001.html");
    await page.getByLabel("Recipient").selectOption("new");
    await page.getByLabel("Recipient's full name").fill("Ada Obi");
    await page.getByLabel("Recipient's mobile number").fill("0803 123 4567");
    await page.getByLabel("Street address").fill("12 Aba Road");
    await page.getByLabel("City or town").fill("Port Harcourt");
    await page.getByLabel("State").selectOption("Rivers");
    await page.getByRole("button", { name: "Request a quote" }).click();
    await expect(page).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}\?new=1$/);
    const orderPath = new URL(page.url()).pathname;
    const orderId = orderPath.split("/").pop()!;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await logIn(adminPage, admin.email!, admin.password!);
    await adminPage.goto(`/admin/quotes/${orderId}`);
    const amounts = ["100", "10", "25", "15", "5"];
    for (const [index, amount] of amounts.entries()) await adminPage.locator(`#amount-${index}`).fill(amount);
    await adminPage.getByRole("button", { name: "Send quote" }).click();
    await expect(adminPage.getByText("Quote sent.")).toBeVisible();

    await adminPage.reload();
    await adminPage.locator("#amount-1").fill("20");
    await adminPage.getByRole("button", { name: "Send revised quote" }).click();
    await expect(adminPage.getByText("Revised quote sent.")).toBeVisible();

    await page.goto(orderPath);
    await expect(page.getByText("160.00")).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Accept quote" }).click();
    await expect(page.getByText("Awaiting payment").first()).toBeVisible();
    await adminContext.close();
  });
});
