import { test, expect } from './mock-api';
const email = 'synthetic@example.invalid', password = 'synthetic-test-password';
test('sign-in rejection stays on the page and permits a retry', async ({ page, api }) => {
  api.reply('/api/auth/sign-in/email', { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }, 401);
  await page.goto('/sign-in?next=/settings');
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled(); await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(api.calls).toEqual([expect.objectContaining({ path: '/api/auth/sign-in/email', method: 'POST', body: expect.objectContaining({ email, password }) })]);
});
test('registration rejection retains entered values', async ({ page, api }) => {
  api.reply('/api/auth/sign-up/email', { message: 'Registration temporarily unavailable' }, 422);
  await page.goto('/sign-up'); await page.getByLabel('Your name').fill('Synthetic Buyer'); await page.getByLabel('Organisation').fill('Example Holdings'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Registration temporarily unavailable' })).toBeVisible(); await expect(page.getByLabel('Your name')).toHaveValue('Synthetic Buyer'); await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled();
  expect(api.calls).toHaveLength(1);
});
test('password-reset request confirms without exposing account existence', async ({ page, api }) => {
  api.reply('/api/auth/request-password-reset', { status: true, message: 'Request accepted' });
  await page.goto('/forgot-password'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toHaveText('If that email is registered, a reset link is on its way.'); await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled();
  expect(api.calls[0]).toMatchObject({ method: 'POST', body: { email, redirectTo: 'http://127.0.0.1:3217/reset-password' } });
});
test('password-reset request can recover from rate limiting', async ({ page, api }) => {
  api.reply('/api/auth/request-password-reset', { message: 'Please try again later' }, 429);
  await page.goto('/forgot-password'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Please try again later' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  api.reply('/api/auth/request-password-reset', { status: true }); await page.getByRole('button', { name: 'Send reset link' }).click(); await expect(page.getByRole('status')).toContainText('If that email is registered'); expect(api.calls).toHaveLength(2);
});
test('missing reset token disables submission without an API request', async ({ page, api }) => {
  await page.goto('/reset-password'); await expect(page.getByRole('alert').filter({ hasText: 'This reset link is invalid or has expired.' })).toBeVisible(); await expect(page.getByLabel('New password', { exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled(); expect(api.calls).toHaveLength(0);
});
test('reset checks confirmation before consuming the token and shows success', async ({ page, api }) => {
  api.reply('/api/auth/reset-password', { status: true }); await page.goto('/reset-password?token=synthetic-reset-token');
  await page.getByLabel('New password', { exact: true }).fill(password); await page.getByLabel('Confirm new password', { exact: true }).fill('different-password'); await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Passwords do not match' })).toBeVisible(); expect(api.calls).toHaveLength(0);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Your password has been updated and other sessions have been signed out.')).toBeVisible(); expect(api.calls[0]).toMatchObject({ method: 'POST', body: { token: 'synthetic-reset-token', newPassword: password } });
  await page.getByRole('link', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sign in to the deal desk' })).toBeVisible();
});
test('social sign-in errors do not navigate to a provider', async ({ page, api }) => {
  api.reply('/api/auth/sign-in/social', { message: 'Google sign-in unavailable' }, 503); await page.goto('/sign-in'); await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Google sign-in unavailable' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled(); expect(api.calls[0]).toMatchObject({ method: 'POST', body: { provider: 'google', callbackURL: '/auth/complete' } });
});
