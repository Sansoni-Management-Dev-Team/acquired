import { defineConfig, devices } from '@playwright/test';

// Explicit opt-in: this tests the running isolated main checkout, not the
// credential-free worktree server used by playwright.config.ts.
export default defineConfig({
  testDir: './tests/routes',
  testMatch: '**/authenticated.e2e.ts',
  globalSetup: './tests/routes/authenticated-setup.ts',
  workers: 1, retries: 0, fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), timeout: 90_000,
  expect: { timeout: 30_000 },
  outputDir: '.local-data/route-auth/results',
  reporter: [
    ['list'],
    ['json', { outputFile: '.local-data/route-auth/results.json' }],
    ['html', { outputFolder: '.local-data/route-auth/report', open: 'never' }],
  ],
  use: {
    baseURL: 'https://acquire-isolated.orb.local',
    storageState: '.local-data/route-auth/storage-state.json',
    ignoreHTTPSErrors: true, serviceWorkers: 'block',
    locale: 'en-AU', timezoneId: 'Australia/Sydney',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  projects: [
    { name: 'authenticated-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'authenticated-mobile-chromium', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
