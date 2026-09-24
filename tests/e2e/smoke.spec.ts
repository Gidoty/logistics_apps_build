import { expect, test, type Page } from "@playwright/test";

/** Fails when the page is wider than the phone screen (horizontal scroll). */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("public pages at 375px", () => {
  test("home page loads with sign-up and login links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Deliver to anyone in Nigeria");
    await expect(page.getByRole("link", { name: "Create a free account" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("login page shows password and magic link options", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("unauthorized page explains the block", async ({ page }) => {
    await page.goto("/unauthorized");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("do not have access");
    await expectNoHorizontalScroll(page);
  });
});

test.describe("route protection when logged out", () => {
  for (const path of ["/account", "/vendor", "/admin"]) {
    test(`${path} sends visitors to login and keeps the return path`, async ({ page }) => {
      await page.goto(path);
      const expected = path === "/account" ? /\/login$/ : new RegExp(`/login\\?next=%2F${path.slice(1)}$`);
      await expect(page).toHaveURL(expected);
    });
  }

  test("auth callback without a code fails safely", async ({ page }) => {
    await page.goto("/auth/callback?next=//evil.example");
    await expect(page).toHaveURL(/\/login\?error=link_invalid$/);
    await expect(page.getByText("That link is invalid or has expired")).toBeVisible();
  });
});
