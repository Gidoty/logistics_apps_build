import { defineConfig, devices } from "@playwright/test";

const APP_PORT = Number(process.env.E2E_PORT ?? 3100);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 54399);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${APP_PORT}`;
const useOwnServers = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  // The fake data server keeps state (request log, mode), so tests run one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Optional: point at a pre-installed Chromium instead of `npx playwright install`.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  // Mobile first: most buyers and recipients use phones. 375px is the
  // narrowest common phone width (iPhone SE, many Android phones).
  projects: [
    {
      name: "mobile-375",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 667 } },
    },
  ],
  // By default the tests build the app and run it against a fake Supabase
  // (tests/e2e/mock-supabase.mjs). Set E2E_BASE_URL to test a running app
  // with real Supabase instead; then only the real-account tests apply.
  webServer: useOwnServers
    ? [
        {
          command: "node tests/e2e/mock-supabase.mjs",
          url: `http://127.0.0.1:${MOCK_PORT}/__health`,
          env: { MOCK_PORT: String(MOCK_PORT) },
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `npm run build && npx next start -p ${APP_PORT}`,
          url: baseURL,
          timeout: 300_000,
          reuseExistingServer: !process.env.CI,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "mock-anon-key",
            NEXT_PUBLIC_APP_URL: baseURL,
          },
        },
      ]
    : undefined,
});
