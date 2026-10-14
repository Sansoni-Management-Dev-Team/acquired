// Historical synthetic campaign fixture only; never imported by production.
import "server-only";

/** Historical application grant shape retained only for recorded data and fixture compatibility. */
export type GmailConnectionGrant = { encryptedRefreshToken: string | null; reconnectRequired: boolean; scopes: string[] | null };
export function connectionCanMonitorReplies(_connection: GmailConnectionGrant) { void _connection; return false; }
