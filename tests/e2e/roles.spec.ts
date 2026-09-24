import { expect, test, type Page } from "@playwright/test";

/**
 * Signed-in role checks. These need a running Supabase project and two
 * existing, confirmed accounts:
 *   E2E_BUYER_EMAIL / E2E_BUYER_PASSWORD  a plain buyer
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  an account promoted with make-admin
 * They are skipped when those variables are not set.
 */
const buyer = { email: process.env.E2E_BUYER_EMAIL, password: process.env.E2E_BUYER_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test.describe("buyer", () => {
  test.skip(!buyer.email || !buyer.password, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD");

  test("can log in, is blocked from /admin and /vendor, and can log out", async ({ page }) => {
    await logIn(page, buyer.email!, buyer.password!);
    await expect(page.getByText("Buyer", { exact: true })).toBeVisible();

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/unauthorized$/);
    await page.goto("/vendor");
    await expect(page).toHaveURL(/\/unauthorized$/);

    await page.goto("/account");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("admin", () => {
  test.skip(!admin.email || !admin.password, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD");

  test("can open /admin", async ({ page }) => {
    await logIn(page, admin.email!, admin.password!);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  });
});
