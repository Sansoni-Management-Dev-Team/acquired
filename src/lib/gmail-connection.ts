import "server-only";
import { GmailMailbox } from "@/adapters/mailbox";
import { refreshGoogleAccessToken } from "@/lib/google-oauth";
import { decryptToken } from "@/lib/token-crypto";

export type GmailConnectionGrant = {
  encryptedRefreshToken: string | null;
  reconnectRequired: boolean;
  scopes: string[] | null;
};

export function connectionCanCompose(connection: GmailConnectionGrant) {
  return !connection.reconnectRequired
    && Boolean(connection.encryptedRefreshToken)
    && Boolean(connection.scopes?.some((scope) => scope === "https://www.googleapis.com/auth/gmail.compose"));
}

export function mailboxForConnection(connection: GmailConnectionGrant) {
  if (!connectionCanCompose(connection) || !connection.encryptedRefreshToken) {
    throw new Error("Connect Gmail with draft permission before approving outreach.");
  }
  const refreshToken = decryptToken(connection.encryptedRefreshToken);
  let accessToken: Promise<string> | undefined;
  return new GmailMailbox(() => accessToken ??= refreshGoogleAccessToken(refreshToken));
}
