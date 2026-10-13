import "server-only";
import { ReplyCheckReview } from "./campaign-reply-status";

/** Historical application grant shape retained only for recorded data and fixture compatibility. */
export type GmailConnectionGrant = { encryptedRefreshToken: string | null; reconnectRequired: boolean; scopes: string[] | null };
export function connectionCanCompose(_connection: GmailConnectionGrant) { return false; }
export function connectionCanMonitorReplies(_connection: GmailConnectionGrant) { return false; }
export function mailboxForConnection(_connection: GmailConnectionGrant): never { throw new ReplyCheckReview("delivery_disabled", "email"); }
