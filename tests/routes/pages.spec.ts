import { test, expect } from '@playwright/test';
import coverage from './coverage.json';

for (const route of coverage.filter(entry => entry.kind === 'page')) {
  test(`${route.expectation === 'render' ? 'public render' : 'signed-out redirect'}: ${route.path}`, async ({ page, context }, testInfo) => {
    const failures: string[] = [];
    // The shared shell probes these before the signed-out redirect completes.
    const signedOutEndpoints = new Set(['/api/acquisition-session', '/api/campaigns/reply-alerts']);
    page.on('pageerror', error => failures.push(`JavaScript: ${error.message}`));
    page.on('console', message => {
      // Chromium reports an expected unauthenticated session response as a resource error.
      if (message.type() === 'error' && !(message.text().includes('401 (Unauthorized)') && signedOutEndpoints.has(new URL(message.location().url || 'http://127.0.0.1:3217').pathname))) failures.push(`Console: ${message.text()}`);
    });
    page.on('response', response => {
      if (response.status() >= 400 && !(signedOutEndpoints.has(new URL(response.url()).pathname) && response.status() === 401)) {
        failures.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
      }
    });
    page.on('requestfailed', request => {
      // Client-side auth redirects cancel obsolete RSC/prefetch requests.
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(`Network: ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
    });
    await context.route('**/*', async intercepted => {
      const request = intercepted.request(), url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:3217' || !['GET', 'HEAD'].includes(request.method())) {
        failures.push(`Unexpected request: ${request.method()} ${url.origin}${url.pathname}`);
        await intercepted.abort(); return;
      }
      await intercepted.continue();
    });
    const response = await page.goto(route.url!, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    if (route.expectation === 'redirect') {
      await expect(page).toHaveURL(url => url.pathname === '/sign-in' && url.searchParams.get('next') === route.url);
    } else {
      await expect(page).toHaveURL(url => url.pathname === route.url);
    }
    await expect(page.getByRole('heading', { name: route.heading!, exact: true, level: 1 })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error:');
    // Wait for page hydration and exercise a real client control present on every page.
    const theme = page.getByRole('button', { name: /switch to .* mode/i });
    await expect(theme).toBeVisible();
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await testInfo.attach('route-scope', { body: JSON.stringify({ path: route.path, expectation: route.expectation, gap: route.gap ?? null }, null, 2), contentType: 'application/json' });
    expect(failures, 'Unexpected browser errors or requests').toEqual([]);
  });
}
