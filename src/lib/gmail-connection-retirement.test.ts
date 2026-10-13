import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { encryptToken } from './token-crypto';
import { mailboxForConnection, connectionCanCompose, connectionCanMonitorReplies } from './gmail-connection';
import { campaignMailboxForConnection } from './campaign-mailbox';
const scopes = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'];
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('cannot use an encrypted historical Gmail grant to construct a live mailbox', () => {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
  const connection = { encryptedRefreshToken: encryptToken('synthetic-old-refresh'), reconnectRequired: false, scopes };
  expect(() => mailboxForConnection(connection)).toThrow(expect.objectContaining({ code: 'delivery_disabled', channel: 'email' }));
  expect(connectionCanCompose(connection)).toBe(false);
  expect(connectionCanMonitorReplies(connection)).toBe(false);
});
it('never accesses retired refresh-token fields or refreshes through a provider', () => {
  const getter = vi.fn(() => { throw Error('Unexpected old credential read'); });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const connection = { reconnectRequired: false, scopes, get encryptedRefreshToken() { return getter(); } };
  expect(() => mailboxForConnection(connection)).toThrow(expect.objectContaining({ code: 'delivery_disabled' }));
  expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a historical campaign mailbox when no dedicated synthetic sink is selected', () => {
  vi.stubEnv('CAMPAIGN_TEST_SINK_URL', '');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
  expect(() => campaignMailboxForConnection({ encryptedRefreshToken: encryptToken('synthetic-old-refresh'), reconnectRequired: false, scopes }, 'old-mailbox')).toThrow(expect.objectContaining({ code: 'delivery_disabled' }));
});
