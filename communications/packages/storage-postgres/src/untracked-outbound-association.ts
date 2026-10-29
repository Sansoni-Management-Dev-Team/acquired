import type { ConnectionBinding } from "../../contracts/src";
import type { SqlClient } from "./webhook-repository";
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
