import { defineConfig, devices } from "@playwright/test";

const PORT = 3123;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * E2E do ontarget.
 * Sobe o servidor com o client já construído e um banco separado (data/e2e.db),
 * para não tocar no banco de desenvolvimento.
 */
export default defineConfig({
  testDir: "./e2e",
  // Apenas `*.e2e.ts`: arquivos `*.spec.ts` seriam capturados pelo `bun test`.
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "bun run e2e:server",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DATABASE_PATH: "data/e2e.db",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
