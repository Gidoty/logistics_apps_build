import { expect, test } from "@playwright/test";

// Smoke tests that need no signed-in user. The full buyer flow comes in a later batch.

test("home page loads with sign-up links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Deliver to anyone in Nigeria");
  await expect(page.getByRole("link", { name: "Create a free account" })).toBeVisible();
});

test("sign-in page shows password and magic link options", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
});

test("protected pages send visitors to sign-in and keep the return path", async ({ page }) => {
  await page.goto("/admin?q=test");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%3Fq%3Dtest$/);

  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("auth callback without a code fails safely", async ({ page }) => {
  await page.goto("/auth/callback?next=//evil.example");
  await expect(page).toHaveURL(/\/sign-in\?error=link_invalid$/);
  await expect(page.getByText("That link is invalid or has expired")).toBeVisible();
});
