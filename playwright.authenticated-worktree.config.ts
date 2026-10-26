import { defineConfig } from '@playwright/test';
import authenticated from './playwright.authenticated.config';

// Exercise this checkout, preserving the isolated-main report and session.
export default defineConfig(authenticated, {
  outputDir: '.local-data/route-auth/worktree/results',
  reporter: [
    ['list'],
    ['json', { outputFile: '.local-data/route-auth/worktree/results.json' }],
    ['html', { outputFolder: '.local-data/route-auth/worktree/report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3218',
    storageState: '.local-data/route-auth/worktree/storage-state.json',
  },
  webServer: {
    command: 'node scripts/authenticated-route-test-server.mjs',
    url: 'http://127.0.0.1:3218/sign-in',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
