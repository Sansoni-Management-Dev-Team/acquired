import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/routes',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'output/playwright/routes/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/routes/report', open: 'never' }],
    ['json', { outputFile: 'output/playwright/routes/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3217',
    locale: 'en-AU', timezoneId: 'Australia/Sydney',
    serviceWorkers: 'block',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/route-test-server.mjs',
    url: 'http://127.0.0.1:3217/sign-in',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
