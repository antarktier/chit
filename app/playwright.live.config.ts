import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-live",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  outputDir: "/tmp/chit-codex/playwright",
  use: {
    baseURL: "https://chit.antarktier.com",
    viewport: { width: 1440, height: 900 },
  },
});
