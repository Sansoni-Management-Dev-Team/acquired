import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync('.local-data/route-auth/fixtures.json', 'utf8')) as {
  mandateId: string; emptyMandateId: string; targetIds: string[]; companyNames: string[]; contactNames: string[]; sourceMandateId: string; targetMapping: Record<string, string>; destinationOrganizationId: string;
};
const root = `/mandates/${fixtures.mandateId}`;
const test = base.extend<{ routeAudit: void }>({
  routeAudit: [async ({ page, context }, use, testInfo) => {
    const origin = testInfo.project.use.baseURL;
    const failures: string[] = [];
    const requests: { method: string; path: string; status?: number }[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${path}`);
      if (path.startsWith('/api/')) requests.push({ method: response.request().method(), path, status: response.status() });
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const allowedMandate = [fixtures.mandateId, fixtures.emptyMandateId].some(id => url.pathname === `/api/mandates/${id}/companies` || url.pathname === `/api/mandates/${id}/company-identities`);
      // Normal mount-time recovery/reconciliation only, after setup proves this
      // dedicated workspace has no research jobs, agent operations or enrolments.
      const activateOwnWorkspace = request.method() === 'POST' && url.pathname === '/api/auth/organization/set-active' && request.postDataJSON()?.organizationId === fixtures.destinationOrganizationId;
      const normalReadMaintenance = request.method() === 'POST' && allowedMandate && (url.pathname.endsWith('/companies') || JSON.stringify(request.postDataJSON()) === JSON.stringify({ action: 'reconcile_duplicates' }));
      if (url.origin !== origin || (!['GET', 'HEAD'].includes(request.method()) && !normalReadMaintenance && !activateOwnWorkspace)) {
        failures.push(`Unexpected request: ${request.method()} ${url.pathname}`); await route.abort(); return;
      }
      await route.continue();
    });
    await use();
    await testInfo.attach('observed-api-requests', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' });
    expect(failures, 'Authenticated route errors').toEqual([]);
  }, { auto: true }],
});

for (const [path, heading, destination] of [
  ['/', 'Create a mandate', '/'], ['/mandates', 'Acquisition mandates', '/mandates'],
  ['/mandates/new', 'Create a mandate', '/mandates/new'], ['/targets', 'Acquisition mandates', '/mandates'],
  ['/outreach', 'People', '/outreach'], ['/settings', 'Settings', '/settings'], ['/audit', 'Audit trail', '/audit'],
  ['/onboarding', 'Acquisition mandates', '/mandates'], ['/auth/complete', 'Acquisition mandates', '/mandates'],
  [`${root}/people`, 'People', `${root}/people`],
  [`${root}/outreach/sequences`, 'Sequences', `${root}/outreach/sequences`],
  [`${root}/outreach/campaigns`, 'People', `${root}/people`],
  [`${root}/outreach`, 'People', `${root}/people`],
  [`${root}/outreach/prototype`, 'Outreach studio', `${root}/outreach/prototype`],
  ['/preview/outreach', 'Outreach studio', '/preview/outreach'],
]) {
  test(`authenticated render: ${path.replace(fixtures.mandateId, '[fixture]')}`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' }); expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(url => url.pathname === destination);
    if (path === '/mandates') await expect(page.getByRole('heading', { name: 'Route coverage — copied business sample' })).toBeVisible();
    if (path === `${root}/people`) {
      await expect(page.getByText('People and progress', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: fixtures.contactNames[0], exact: true })).toBeVisible();
    }
  });
}

test('saved brief renders the copied acquisition description', async ({ page }) => {
  const response = await page.goto(root); expect(response?.status()).toBe(200);
  await expect(page.getByRole('textbox', { name: 'Describe the acquisition brief' })).not.toHaveValue('');
  await expect(page.getByRole('button', { name: 'Find companies', exact: true })).toBeVisible();
});

test('companies renders copied records and opens the company panel', async ({ page }) => {
  const recovery = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `${root.replace('/mandates/', '/api/mandates/')}/companies`);
  await page.goto(`${root}/companies`);
  await recovery;
  await expect(page.getByRole('heading', { name: 'Companies', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText(fixtures.companyNames[0]);
  const all = page.getByRole('checkbox', { name: 'Select all matching businesses on this page' });
  await all.check(); await expect(page.getByRole('button', { name: 'Find phone numbers →' })).toBeEnabled();
  await all.uncheck(); await expect(page.getByRole('button', { name: 'Find phone numbers →' })).toBeDisabled();
  await page.getByRole('button', { name: fixtures.companyNames[0], exact: true }).click();
  const dialog = page.getByRole('dialog', { name: fixtures.companyNames[0], exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await expect(dialog.getByRole('tabpanel', { name: 'Contacts' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close company panel' }).click(); await expect(dialog).toHaveCount(0);
});

test('empty company list has a working empty state', async ({ page }) => {
  const recovery = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/mandates/${fixtures.emptyMandateId}/companies`);
  await page.goto(`/mandates/${fixtures.emptyMandateId}/companies`);
  await recovery;
  await expect(page.getByRole('heading', { name: 'Companies', exact: true })).toBeVisible();
  await expect(page.getByText('No companies yet.', { exact: false })).toBeVisible();
});

test('company worksheet renders copied company evidence', async ({ page }) => {
  await page.goto(`${root}/targets/${fixtures.targetIds[0]}`);
  await expect(page.getByRole('heading', { name: fixtures.companyNames[0], exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pipeline and next action', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to companies', exact: true })).toHaveAttribute('href', `${root}/companies`);
});

test('agent route shows setup state without starting work', async ({ page }) => {
  await page.goto(`${root}/agent`);
  await expect(page.getByRole('heading', { name: 'Agent needs setup', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review your saved research brief', exact: true })).toBeVisible();
});

for (const [section, label, suffix] of [['brief', 'Brief', '?tab=brief'], ['targets', 'Companies', '/companies'], ['people', 'People', '/people'], ['sequences', 'Sequences', '/outreach/sequences']]) {
  test(`real workspace picker: ${section}`, async ({ page }) => {
    await page.goto(`/mandates/select/${section}`);
    await expect(page.getByRole('heading', { name: label, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Choose a mandate' }).getByRole('link', { name: 'Route coverage — copied business sample', exact: true })).toHaveAttribute('href', `${root}${suffix}`);
  });
}

test('real API allows the copied mandate and denies the source workspace', async ({ request }) => {
  const copied = await request.get(`/api/mandates/${fixtures.mandateId}?briefOnly=true`); expect(copied.status()).toBe(200);
  const foreign = await request.get(`/api/mandates/${fixtures.sourceMandateId}?briefOnly=true`); expect(foreign.status()).toBe(404);
  expect(await foreign.json()).not.toHaveProperty('mandate');
  const foreignCompanies = await request.get(`/api/mandates/${fixtures.sourceMandateId}/companies`); expect(foreignCompanies.status()).toBe(404);
});


test('company APIs enforce membership and validate identifiers', async ({ request }) => {
  const own = await request.get(`/api/mandates/${fixtures.mandateId}/companies/${fixtures.targetIds[0]}`);
  expect(own.status()).toBe(200); expect((await own.json()).member.target.id).toBe(fixtures.targetIds[0]);
  const sourceTarget = Object.keys(fixtures.targetMapping)[0];
  const foreign = await request.get(`/api/mandates/${fixtures.mandateId}/companies/${sourceTarget}`);
  expect(foreign.status()).toBe(404); expect(await foreign.json()).not.toHaveProperty('member');
  const invalid = await request.get(`/api/mandates/${fixtures.mandateId}/companies/not-a-uuid`); expect(invalid.status()).toBe(400);
  const missing = await request.get('/api/mandates/00000000-0000-4000-8000-000000000099?briefOnly=true'); expect(missing.status()).toBe(404);
});
