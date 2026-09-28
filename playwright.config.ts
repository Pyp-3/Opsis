import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Africa/Nairobi',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command:
        'PORT=8100 OPSIS_DB_PATH=:memory: OPSIS_RATE_LIMIT=10000 OPSIS_SPEECH=off pnpm --filter api exec node --import tsx src/main.ts',
      url: 'http://127.0.0.1:8100/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'OPSIS_API_URL=http://127.0.0.1:8100 pnpm --filter web dev --port 3100',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
