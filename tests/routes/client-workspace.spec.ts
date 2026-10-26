import { test, expect } from './mock-api';
import { emptyBrief } from '../../src/domain/acquisition';
const id = '00000000-0000-4000-8000-000000000001';
const mandate = { id, brief: { ...emptyBrief(), name: 'Synthetic acquisition mandate' }, createdAt: '2026-01-01T00:00:00Z' };
test.beforeEach(async ({ context, api }) => {
  // This cookie only gets past the proxy's presence check. It is not a valid
  // server session. Every session/data API is intercepted by the fixture.
  await context.addCookies([{ name: 'better-auth.session_token', value: 'browser-fixture-not-a-real-session', url: 'http://127.0.0.1:3217' }]);
  api.reply('/api/acquisition-session', { scope: 'synthetic-workspace:synthetic-user', expiresAt: Date.now() + 3_600_000 });
  api.reply('/api/campaigns/reply-alerts', { scope: 'synthetic-workspace:synthetic-user', alerts: [] });
  api.reply('/api/mandates', { scope: 'synthetic-workspace:synthetic-user', mandates: [mandate] });
});
test('saved mandate list renders API data and correct destination links', async ({ page }) => {
  await page.goto('/mandates'); await expect(page.getByRole('heading', { name: 'Acquisition mandates' })).toBeVisible(); await expect(page.getByRole('heading', { name: mandate.brief.name })).toBeVisible();
  await expect(page.getByRole('link').filter({ has: page.getByRole('heading', { name: mandate.brief.name }) })).toHaveAttribute('href', `/mandates/${id}?tab=search+enrich`);
  await expect(page.getByText('Loading your mandates…')).toHaveCount(0);
});
test('empty mandate list offers creation instead of stale records', async ({ page, api }) => {
  api.reply('/api/mandates', { scope: 'synthetic-workspace:synthetic-user', mandates: [] }); await page.goto('/mandates');
  await expect(page.getByText('Create your first mandate to review a brief and build its target universe.')).toBeVisible(); await page.getByRole('link', { name: 'Create a mandate', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Create a mandate', exact: true })).toBeVisible();
});
test('failed mandate load offers retry and recovers without losing the page', async ({ page, api }) => {
  api.reply('/api/mandates', { error: 'Unavailable' }, 503); await page.goto('/mandates'); await expect(page.getByRole('alert').filter({ hasText: 'Could not refresh mandates' })).toBeVisible();
  api.reply('/api/mandates', { scope: 'synthetic-workspace:synthetic-user', mandates: [mandate] }); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(page.getByRole('heading', { name: mandate.brief.name })).toBeVisible(); await expect(page.getByRole('alert').filter({ hasText: 'Could not refresh mandates' })).toHaveCount(0);
});
for (const [section, title, suffix] of [['brief', 'Brief', '?tab=brief'], ['targets', 'Companies', '/companies'], ['people', 'People', '/people'], ['sequences', 'Sequences', '/outreach/sequences']]) {
  test(`mandate picker exposes the ${section} destination`, async ({ page }) => {
    await page.goto(`/mandates/select/${section}`); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Choose a mandate' }).getByRole('link', { name: mandate.brief.name })).toHaveAttribute('href', `/mandates/${id}${suffix}`);
  });
}
