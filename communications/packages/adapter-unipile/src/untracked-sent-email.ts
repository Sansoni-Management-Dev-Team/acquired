import {isDeepStrictEqual} from "node:util";
import type {ConnectionBinding} from "../../contracts/src";
import {verifyRuntimeSentEmail} from "./v1-runtime-email";
type CanonicalRead = (
  b: ConnectionBinding,
  emailId: string,
  signal: AbortSignal,
) => Promise<{
  binding: ConnectionBinding;
  providerAccountId: string;
  ownerAddresses: string[];
  raw: unknown;
} | null>;
export async function verifyUntrackedSentEmail(
  b: ConnectionBinding,
  raw: Record<string, unknown>,
  read: CanonicalRead,
  signal: AbortSignal,
): Promise<boolean> {
  if (
    signal.aborted ||
    b.channel !== "email" ||
    raw.event !== "mail_sent" ||
    raw.origin !== "unipile" ||
    raw.role !== "sent" ||
    !["account_id", "tracking_id", "email_id", "message_id", "date"].every(
      (k) => typeof raw[k] === "string" && raw[k],
    ) ||
    !Array.isArray(raw.to_attendees) ||
    raw.to_attendees.length !== 1 ||
    typeof raw.to_attendees[0]?.identifier !== "string" ||
    ["cc_attendees", "bcc_attendees"].some(
      (k) =>
        raw[k] !== undefined && (!Array.isArray(raw[k]) || raw[k].length !== 0),
    )
  )
    return false;
  const current = await read(b, raw.email_id as string, signal);
  if (
    signal.aborted ||
    !current ||
    !isDeepStrictEqual(current.binding, b) ||
    current.providerAccountId !== raw.account_id
  )
    return false;
  return !!verifyRuntimeSentEmail({
    binding: b,
    providerAccountId: current.providerAccountId,
    ownerAddresses: current.ownerAddresses,
    raw: current.raw,
    evidence: {
      trackingId: raw.tracking_id as string,
      providerAccountId: raw.account_id as string,
      emailId: raw.email_id as string,
      rfcMessageId: raw.message_id as string,
      recipient: raw.to_attendees[0].identifier,
      occurredAt: raw.date as string,
    },
    recipient: raw.to_attendees[0].identifier,
  });
}
