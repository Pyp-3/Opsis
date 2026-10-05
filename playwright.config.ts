import { defineConfig, devices } from '@playwright/test';

// Allow independent checkouts to run isolated QA without sharing a server/database.
const apiPort = Number(process.env.OPSIS_QA_API_PORT ?? 8100);
const webPort = Number(process.env.OPSIS_QA_WEB_PORT ?? 3100);
for (const port of [apiPort, webPort]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid QA port.');
}

export default defineConfig({
  testDir: './tests',
  testMatch: ['workspace/**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The API uses one in-memory persistence/cache instance so cross-file timing is deterministic.
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Africa/Nairobi',
    ...devices['Desktop Chrome'],
  },
  // Variables go through `env` rather than `NAME=value cmd`, which cmd.exe cannot run.
  webServer: [
    {
      command: process.env.OPSIS_QA_DESKTOP_BINARY
        ? 'node scripts/run-desktop-qa.mjs'
        : 'pnpm --filter api exec node --import tsx src/main.ts',
      env: process.env.OPSIS_QA_DESKTOP_BINARY
        ? { PORT: String(apiPort) }
        : {
            PORT: String(apiPort),
            OPSIS_DB_PATH: ':memory:',
            OPSIS_RATE_LIMIT: '10000',
            OPSIS_SPEECH: 'off',
          },
      url: `http://127.0.0.1:${apiPort}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter web dev --port ${webPort}`,
      env: { OPSIS_API_URL: `http://127.0.0.1:${apiPort}` },
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
