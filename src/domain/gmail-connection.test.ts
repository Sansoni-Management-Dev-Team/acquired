import { expect, it } from 'vitest';
import { connectionCanCompose, connectionCanMonitorReplies, gmailConnectionStatus } from './gmail-connection';
it('never certifies Unipile readiness from historical Gmail permissions', () => {
  const historical = { hasRefreshToken: true, reconnectRequired: false, scopes: ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'] };
  expect(connectionCanCompose(historical)).toBe(false);
  expect(connectionCanMonitorReplies(historical)).toBe(false);
  expect(gmailConnectionStatus(historical)).toBe('reconnect_required');
});
it('reports absence without loading any historical token or scopes', () => {
  expect(gmailConnectionStatus()).toBe('not_connected');
  const historical = { get hasRefreshToken(): boolean { throw Error('Unexpected historical grant access'); }, get scopes(): string[] { throw Error('Unexpected historical grant access'); }, reconnectRequired: false };
  expect(gmailConnectionStatus(historical)).toBe('reconnect_required');
});
