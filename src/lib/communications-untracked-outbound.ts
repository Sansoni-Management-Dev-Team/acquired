import { isDeepStrictEqual } from "node:util";
import type { ConnectionBinding } from "../../communications/packages/contracts/src";
import type { SqlClient } from "../../communications/packages/storage-postgres/src/webhook-repository";
import { verifyRuntimeSentEmail } from "../../communications/packages/adapter-unipile/src/v1-runtime-email";
/** Caller holds the normal tenant reply barrier. Unknown, blocked and unacknowledged
 * sends for this recipient remain unresolved. A supported immutable recipient digest
 * may prove a different person; unknown keys or malformed digests remain blocking. */
export async function assertUntrackedOutboundIsUnassociated(
  c: SqlClient,
  b: ConnectionBinding,
  integration: string,
  configuration: string,
  digests: string[],
  recipient?: { keyVersion: string; digest: string },
) {
  if (!digests.length) throw Error("Send association unavailable");
  if (
    recipient &&
    (!recipient.keyVersion || !/^[a-f0-9]{64}$/.test(recipient.digest))
  )
    throw Error("Recipient identity unavailable");
  const rows = await c.query(
    `SELECT 1 WHERE EXISTS(
 SELECT 1 FROM communications.operation_journal j WHERE j.application_id=$1 AND j.tenant_id=$2 AND j.owner_id=$3 AND j.connection_id=$4 AND j.generation=$5 AND j.account_id=$6
 AND ($10::text IS NULL OR j.recipient_key_version IS DISTINCT FROM $10 OR j.recipient_digest IS NULL OR j.recipient_digest !~ '^[a-f0-9]{64}$' OR j.recipient_digest=$11)
 AND (j.state NOT IN ('submitted','delivered','read') OR NOT EXISTS(SELECT 1 FROM communications.email_tracking_acknowledgements a WHERE a.journal_id=j.id)))
 OR EXISTS(SELECT 1 FROM communications.email_tracking_acknowledgements a WHERE a.integration_id=$7 AND a.provider_configuration_reference=$8 AND a.tracking_digest=ANY($9::text[]))`,
    [
      b.applicationId,
      b.tenantId,
      b.ownerId,
      b.connectionId,
      b.generation,
      b.accountId,
      integration,
      configuration,
      digests,
      recipient?.keyVersion ?? null,
      recipient?.digest ?? null,
    ],
  );
  if (rows.rows.length) throw Error("Send association unresolved or present");
}
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
