import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignInForm } from './sign-in-form';
import { SignUpForm } from './sign-up-form';
import { ForgotPasswordForm } from './forgot-password-form';
import { ResetPasswordForm } from './reset-password-form';
import { OrganizationForm } from './organization-form';
import { AuthComplete } from './auth-complete';
const f = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn(), list: vi.fn(), activate: vi.fn(), createOrg: vi.fn(), requestReset: vi.fn(), reset: vi.fn(), router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => f.router }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: f.signIn }, signUp: { email: f.signUp }, organization: { list: f.list, setActive: f.activate, create: f.createOrg }, requestPasswordReset: f.requestReset, resetPassword: f.reset } }));
vi.mock('./google-sign-in-button', () => ({ GoogleSignInButton: () => null }));
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { location: { origin: 'http://route-test.invalid' } });
  vi.stubGlobal('FormData', class { constructor(private data: Record<string, string>) {} get(key: string) { return this.data[key] ?? null; } });
  f.signIn.mockResolvedValue({}); f.signUp.mockResolvedValue({}); f.list.mockResolvedValue({ data: [{ id: 'org-a' }] }); f.activate.mockResolvedValue({}); f.createOrg.mockResolvedValue({}); f.requestReset.mockResolvedValue({}); f.reset.mockResolvedValue({});
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); vi.unstubAllGlobals(); });
async function mount(node: React.ReactElement) { await act(async () => { tree = create(node); }); }
async function submit(data: Record<string, string>) { await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault: vi.fn(), currentTarget: data }); }); }
const alert = () => tree.root.findByProps({ role: 'alert' }).children.join('');
const button = () => tree.root.findAllByType('button').at(-1)!;
const credentials = { email: 'synthetic@example.invalid', password: 'fixture-password' };
it('signs in, activates the available workspace, and preserves the requested destination', async () => {
  await mount(<SignInForm redirectTo="/mandates" />); await submit(credentials);
  expect(f.signIn).toHaveBeenCalledWith(credentials);
  expect(f.activate).toHaveBeenCalledWith({ organizationId: 'org-a' });
  expect(f.router.replace).toHaveBeenCalledWith('/mandates'); expect(f.router.refresh).toHaveBeenCalledOnce();
});
it.each([null, []])('routes a successful sign-in without memberships to onboarding (%j)', async data => {
  f.list.mockResolvedValue({ data }); await mount(<SignInForm />); await submit(credentials);
  expect(f.router.replace).toHaveBeenCalledWith('/onboarding'); expect(f.activate).not.toHaveBeenCalled();
});
it.each(['Invalid credentials', undefined])('shows sign-in errors and permits a retry (%s)', async message => {
  f.signIn.mockResolvedValue({ error: { message } }); await mount(<SignInForm />); await submit(credentials);
  expect(alert()).toBe(message || 'Sign in failed'); expect(button().props.disabled).toBeFalsy(); expect(f.list).not.toHaveBeenCalled(); expect(f.router.replace).not.toHaveBeenCalled();
});
it('disables sign-in while the request is pending', async () => {
  let finish!: (value: object) => void; f.signIn.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount(<SignInForm />);
  let pending!: Promise<void>;
  await act(async () => { pending = tree.root.findByType('form').props.onSubmit({ preventDefault() {}, currentTarget: credentials }); });
  expect(button().props.disabled).toBe(true); expect(button().children.join('')).toBe('Signing in…');
  await act(async () => { finish({ error: { message: 'Try again' } }); await pending; });
  expect(button().props.disabled).toBeFalsy();
});
it('registers trimmed identity and creates a workspace before navigation', async () => {
  await mount(<SignUpForm />); await submit({ ...credentials, name: ' Ada ', organizationName: ' Example Holdings ', email: ' synthetic@example.invalid ' });
  expect(f.signUp).toHaveBeenCalledWith({ ...credentials, name: 'Ada' });
  expect(f.createOrg).toHaveBeenCalledWith({ name: 'Example Holdings', slug: expect.stringMatching(/^example-holdings-/) });
  expect(f.router.replace).toHaveBeenCalledWith('/targets');
});
it.each(['Email unavailable', undefined])('does not create a workspace after failed registration (%s)', async message => {
  f.signUp.mockResolvedValue({ error: { message } }); await mount(<SignUpForm />); await submit({ ...credentials, name: 'Ada', organizationName: 'Example' });
  expect(alert()).toBe(message || 'Registration failed'); expect(f.createOrg).not.toHaveBeenCalled(); expect(button().props.disabled).toBeFalsy();
});
it('preserves a successful registration when workspace setup requires onboarding', async () => {
  f.createOrg.mockResolvedValue({ error: { message: 'Unavailable' } }); await mount(<SignUpForm />); await submit({ ...credentials, name: 'Ada', organizationName: 'Example' });
  expect(f.router.replace).toHaveBeenCalledWith('/onboarding');
});
it('creates a trimmed workspace and navigates after success', async () => {
  await mount(<OrganizationForm />); await submit({ organizationName: ' Example Holdings ' });
  expect(f.createOrg).toHaveBeenCalledWith({ name: 'Example Holdings', slug: expect.stringMatching(/^example-holdings-/) }); expect(f.router.replace).toHaveBeenCalledWith('/targets');
});
it.each(['Workspace exists', undefined])('keeps workspace setup retryable after rejection (%s)', async message => {
  f.createOrg.mockResolvedValue({ error: { message } }); await mount(<OrganizationForm />); await submit({ organizationName: 'Example' });
  expect(alert()).toBe(message || 'Workspace creation failed'); expect(button().props.disabled).toBeFalsy(); expect(f.router.replace).not.toHaveBeenCalled();
});
it('requests a reset with an origin-bound return URL and non-enumerating confirmation', async () => {
  await mount(<ForgotPasswordForm />); await submit({ email: ' synthetic@example.invalid ' });
  expect(f.requestReset).toHaveBeenCalledWith({ email: credentials.email, redirectTo: 'http://route-test.invalid/reset-password' });
  expect(tree.root.findByProps({ role: 'status' }).children.join('')).toBe('If that email is registered, a reset link is on its way.'); expect(button().props.disabled).toBe(true);
});
it.each(['Rate limited', undefined])('shows password request rejection and re-enables submission (%s)', async message => {
  f.requestReset.mockResolvedValue({ error: { message } }); await mount(<ForgotPasswordForm />); await submit(credentials);
  expect(alert()).toBe(message || 'Password reset is temporarily unavailable'); expect(button().props.disabled).toBeFalsy();
});
it.each([{}, { token: 'expired', invalid: true }])('disables invalid reset links (%j)', async props => {
  await mount(<ResetPasswordForm {...props} />); expect(alert()).toBe('This reset link is invalid or has expired.'); expect(button().props.disabled).toBeTruthy(); expect(f.reset).not.toHaveBeenCalled();
});
it('rejects mismatched passwords locally without consuming the reset token', async () => {
  await mount(<ResetPasswordForm token="synthetic-token" />); await submit({ password: 'fixture-password', confirmPassword: 'different-password' });
  expect(alert()).toBe('Passwords do not match'); expect(f.reset).not.toHaveBeenCalled(); expect(button().props.disabled).toBeFalsy();
});
it.each(['Token expired', undefined])('shows reset failures and allows retry (%s)', async message => {
  f.reset.mockResolvedValue({ error: { message } }); await mount(<ResetPasswordForm token="synthetic-token" />); await submit({ password: credentials.password, confirmPassword: credentials.password });
  expect(alert()).toBe(message || 'Password reset failed'); expect(button().props.disabled).toBeFalsy();
});
it('consumes the supplied token and replaces the form with confirmation', async () => {
  await mount(<ResetPasswordForm token="synthetic-token" />); await submit({ password: credentials.password, confirmPassword: credentials.password });
  expect(f.reset).toHaveBeenCalledWith({ token: 'synthetic-token', newPassword: credentials.password }); expect(tree.root.findAllByType('form')).toHaveLength(0); expect(JSON.stringify(tree.toJSON())).toContain('Your password has been updated');
});
it('completes social sign-in by activating an existing workspace', async () => {
  await mount(<AuthComplete />); expect(f.activate).toHaveBeenCalledWith({ organizationId: 'org-a' }); expect(f.router.replace).toHaveBeenCalledWith('/targets');
});
it('sends a social sign-in without memberships to onboarding', async () => {
  f.list.mockResolvedValue({ data: [] }); await mount(<AuthComplete />); expect(f.router.replace).toHaveBeenCalledWith('/onboarding'); expect(f.activate).not.toHaveBeenCalled();
});
it.each([['list', 'Could not load your workspace'], ['activate', 'Could not activate your workspace']] as const)('keeps social sign-in on an actionable error when %s fails', async (stage, fallback) => {
  f[stage].mockResolvedValue({ error: {} }); await mount(<AuthComplete />); expect(alert()).toBe(fallback); expect(f.router.replace).not.toHaveBeenCalled();
});
