import "server-only";
import { connectionCanCompose as canCompose, connectionCanMonitorReplies as canMonitorReplies } from "@/domain/gmail-connection";
import { GmailMailbox } from "@/adapters/mailbox";
import { refreshGoogleAccessToken } from "@/lib/google-oauth";
import { decryptToken } from "@/lib/token-crypto";

export type GmailConnectionGrant = {
  encryptedRefreshToken: string | null;
  reconnectRequired: boolean;
  scopes: string[] | null;
};

export function connectionCanCompose(connection: GmailConnectionGrant) {
  return canCompose({ ...connection, hasRefreshToken: Boolean(connection.encryptedRefreshToken) });
}

export function connectionCanMonitorReplies(connection: GmailConnectionGrant) {
  return canMonitorReplies({ ...connection, hasRefreshToken: Boolean(connection.encryptedRefreshToken) });
}

export function mailboxForConnection(connection: GmailConnectionGrant) {
  if (!connectionCanCompose(connection) || !connection.encryptedRefreshToken) {
    throw new Error("Connect Gmail with draft permission before approving outreach.");
  }
  const refreshToken = decryptToken(connection.encryptedRefreshToken);
  let accessToken: Promise<string> | undefined;
  return new GmailMailbox(() => accessToken ??= refreshGoogleAccessToken(refreshToken));
}
