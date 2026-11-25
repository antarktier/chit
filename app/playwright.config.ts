import { defineConfig } from "@playwright/test";

const rpcPort = process.env.CHIT_E2E_RPC_PORT ?? "48545";
const apiPort = process.env.CHIT_E2E_API_PORT ?? "48787";
const appPort = process.env.CHIT_E2E_APP_PORT ?? "45173";
const api = `http://127.0.0.1:${apiPort}`;
const baseURL = `http://127.0.0.1:${appPort}`;
const outDir = `node_modules/.cache/chit-e2e-${appPort}`;

/** End-to-end against the LOCAL DEVNET: Anvil + test-only PQC mock + ChitPay + the real service. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL, acceptDownloads: true, actionTimeout: 20_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: "bun scripts/devnet.ts",
      cwd: "..",
      url: `${api}/v1/status`,
      timeout: 120_000,
      env: {
        ANVIL_PORT: rpcPort,
        CHIT_API_PORT: apiPort,
        CHIT_LOCAL_DEPLOYMENT: `.deployments-local/e2e-${apiPort}.json`,
        CHIT_MIN_CONFIRMATIONS: "2",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      command: `vp build --outDir ${outDir} && vp preview --outDir ${outDir} --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: baseURL,
      timeout: 120_000,
      env: { VITE_CHIT_API: api },
    },
  ],
});
