import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

const configuredChromium = process.env.E2E_CHROMIUM_PATH;
const executablePath =
  configuredChromium !== undefined && configuredChromium.length > 0
    ? configuredChromium
    : existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : undefined;

export default defineConfig({
  testDir: "./__tests__/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/e2e",
  use: {
    baseURL: "http://127.0.0.1:4174",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: "bun __tests__/e2e/server.ts",
    url: "http://127.0.0.1:4174/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
