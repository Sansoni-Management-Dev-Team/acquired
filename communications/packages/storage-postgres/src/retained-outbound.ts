import { createHash } from "node:crypto";
import { assertUntrackedOutboundIsUnassociated } from "./untracked-outbound-association";
import type {
  AccessScope,
  ConnectionBinding,
} from "../../contracts/src";
import type { SqlPool } from "./webhook-repository";
import { createPostgresWebhookRepository } from "./webhook-repository";
import { createPostgresReplyBarrier } from "./reply-barrier";
import { runtimeTransaction } from "./runtime-sql";
import type { WebhookCodec } from "../../core/src/webhook-codec";
import type { EventCodec } from "../../core/src/event-codec";
export type UntrackedOutboundProof = {
  kind: "untracked_authenticated_outbound";
  sourceKey: string;
  serviceEventId: string;
  originalPayloadDigest: string;
  bindingDigest: string;
  receivedAt: string;
  noAssociation: true;
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function createRetainedOutboundReview(o: {
  pool: SqlPool;
  captureCodec: WebhookCodec;
  eventCodec: EventCodec;
  subscriberId: string;
  providerDigest(value: string, version: string): string;
  providerAccount(
    binding: ConnectionBinding,
    encrypted: string,
    version: string,
  ): string;
  authorize(scope: AccessScope): Promise<void>;
  withAuthority<T>(scope: AccessScope, work: () => Promise<T>): Promise<T>;
  externalSent?: {
    verify(
      binding: ConnectionBinding,
      raw: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<boolean>;
    recipientIdentity?(raw: Record<string, unknown>): {
      keyVersion: string;
      digest: string;
    };
    trackingDigests(
      row: Record<string, unknown>,
      raw: Record<string, unknown>,
    ): string[];
  };
}) {
  const scopedBase = `FROM communications.webhook_inbox w JOIN communications.webhook_receipt_routes r ON r.webhook_inbox_id=w.id JOIN communications.connection_generations g ON g.connection_id=r.connection_id AND g.generation=r.generation AND g.account_id=r.account_id AND g.application_id=r.application_id AND g.tenant_id=r.tenant_id AND g.owner_id=r.owner_id JOIN communications.connections c ON c.id=g.connection_id AND c.current_generation=g.generation AND c.account_id=g.account_id JOIN communications.access_grants ag ON ag.application_id=g.application_id AND ag.tenant_id=g.tenant_id AND ag.owner_id=g.owner_id WHERE g.application_id=$1 AND g.tenant_id=$2 AND g.owner_id=$3 AND c.active AND g.channel='email' AND g.backend='unipile' AND g.authority='service' AND g.integration_id=w.integration_id AND ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp() AND w.authenticated_at IS NOT NULL AND w.received_at<clock_timestamp()-interval '5 minutes' AND w.expires_at>clock_timestamp()`;
  const associationAbsent = ` AND NOT EXISTS(SELECT 1 FROM communications.operation_journal j WHERE j.connection_id=g.connection_id AND j.generation=g.generation AND j.account_id=g.account_id)`;
  const base = scopedBase + associationAbsent;
  function binding(r: Record<string, unknown>): ConnectionBinding {
    return {
      applicationId: r.application_id,
      tenantId: r.tenant_id,
      ownerId: r.owner_id,
      connectionId: r.connection_id,
      accountId: r.account_id,
      generation: r.generation,
      channel: r.channel,
      platform: r.platform,
      backend: r.backend,
    } as ConnectionBinding;
  }
  function original(r: Record<string, unknown>) {
    const b = binding(r),
      key = r.id as string,
      decoded = o.captureCodec.decode(
        { binding: b, key },
        JSON.parse(r.encrypted_payload as string),
      );
    if (
      Date.parse(decoded.receivedAt) >
        new Date(r.received_at as string).getTime() ||
      o.captureCodec.digest(
        { binding: b, key },
        decoded.rawBody,
        r.key_version as string,
      ) !== r.payload_digest
    )
      throw Error("Original callback proof changed");
    const raw = JSON.parse(Buffer.from(decoded.rawBody).toString("utf8"));
    if (
      raw.event !== "mail_sent" ||
      typeof raw.account_id !== "string" ||
      !raw.account_id ||
      typeof r.provider_account_key_version !== "string" ||
      o.providerDigest(raw.account_id, r.provider_account_key_version) !==
        r.provider_account_digest ||
      o.providerAccount(
        b,
        r.encrypted_provider_account_id as string,
        r.provider_account_key_version,
      ) !== raw.account_id ||
      typeof raw.tracking_id !== "string" ||
      !raw.tracking_id ||
      typeof raw.email_id !== "string" ||
      !raw.email_id
    )
      throw Error("Not an untracked outbound callback");
    return { b, key, decoded, raw };
  }
  return {
    async drain(scope: AccessScope, bound = 1) {
      if (!Number.isInteger(bound) || bound < 1 || bound > 5)
        throw Error("Invalid retained callback bound");
      await o.authorize(scope);
      const rows = await runtimeTransaction(
        o.pool,
        5000,
        async (c) =>
          (
            await c.query(
              `SELECT w.*,to_char(w.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stored_received_at,g.application_id,g.tenant_id,g.owner_id,g.connection_id,g.account_id,g.generation,g.channel,g.platform,g.backend,g.provider_configuration_reference,g.provider_account_digest,g.provider_account_key_version,g.encrypted_provider_account_id ${o.externalSent ? scopedBase : base} AND (w.state='pending' OR w.state='processing' AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp())) ORDER BY w.received_at LIMIT $4`,
              [scope.applicationId, scope.tenantId, scope.ownerId, bound],
            )
          ).rows,
      );
      let reviewed = 0;
      for (const row of rows) {
        try {
          const { b, key, raw } = original(row);
          const external =
            o.externalSent &&
            (await o.externalSent.verify(b, raw, AbortSignal.timeout(10000)));
          const recipient = external
            ? o.externalSent!.recipientIdentity?.(raw)
            : undefined;
          const digests = external
            ? o.externalSent!.trackingDigests(row, raw)
            : [];
          const barrier = createPostgresReplyBarrier({
            binding: b,
            integrationId: row.integration_id as string,
            codec: o.captureCodec,
            eventCodec: o.eventCodec,
          });
          const repo = createPostgresWebhookRepository({
            pool: o.pool,
            binding: b,
            integrationId: row.integration_id as string,
            providerConfigurationReference:
              row.provider_configuration_reference as string,
            subscriberId: o.subscriberId,
            codec: o.captureCodec,
            eventCodec: o.eventCodec,
            replyBarrier: {
              ...barrier,
              async lock(c, app, tenant) {
                await barrier.lock(c, app, tenant);
                if (external) {
                  await assertUntrackedOutboundIsUnassociated(
                    c,
                    b,
                    row.integration_id as string,
                    row.provider_configuration_reference as string,
                    digests,
                    recipient,
                  );
                  return;
                }
                const q = await c.query(
                  "SELECT 1 FROM communications.operation_journal WHERE connection_id=$1 AND generation=$2 AND account_id=$3 LIMIT 1",
                  [b.connectionId, b.generation, b.accountId],
                );
                if (q.rows.length)
                  throw Error("Original send association exists");
              },
            },
          });
          const claim = await repo.claim({ binding: b, key });
          if (claim.kind !== "claimed") continue;
          await o.authorize(scope);
          if (!external && !(await this.verifyOriginal(scope, key))) continue;
          const result = await o.withAuthority(scope, () =>
            repo.finish({
              record: claim.record,
              outcome: external
                ? { kind: "ignore", reason: "outgoing_message" }
                : { kind: "review", code: "protocol" },
            }),
          );
          if (result.committed) reviewed++;
        } catch {
          /* Retain exact original work if any proof or authority fails. */
        }
      }
      return { reviewed };
    },
    async verifyOriginal(scope: AccessScope, key: string) {
      await o.authorize(scope);
      return runtimeTransaction(o.pool, 5000, async (c) => {
        const rows = await c.query(
          `SELECT w.*,to_char(w.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stored_received_at,g.application_id,g.tenant_id,g.owner_id,g.connection_id,g.account_id,g.generation,g.channel,g.platform,g.backend,g.provider_account_digest,g.provider_account_key_version,g.encrypted_provider_account_id ${base} AND w.id=$4`,
          [scope.applicationId, scope.tenantId, scope.ownerId, key],
        );
        if (rows.rows.length !== 1) return false;
        try {
          original(rows.rows[0]);
          return true;
        } catch {
          return false;
        }
      });
    },
    async proof(
      scope: AccessScope,
      b: ConnectionBinding,
      eventId: string,
    ): Promise<UntrackedOutboundProof | null> {
      await o.authorize(scope);
      return runtimeTransaction(o.pool, 5000, async (c) => {
        await c.query("SELECT communications.lock_reply_barrier($1,$2)", [
          scope.applicationId,
          scope.tenantId,
        ]);
        const rows = await c.query(
          `SELECT w.*,to_char(w.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stored_received_at,g.application_id,g.tenant_id,g.owner_id,g.connection_id,g.account_id,g.generation,g.channel,g.platform,g.backend,g.provider_account_digest,g.provider_account_key_version,g.encrypted_provider_account_id,e.id::text AS event_id,e.source_namespace,e.source_event_key,e.encrypted_event,e.key_version AS event_key_version,e.event_type,e.occurred_at AS event_occurred_at ${base.replace(" WHERE g.application_id=", " JOIN communications.events e ON e.webhook_inbox_id=w.id AND e.id=$7::bigint WHERE g.application_id=")} AND w.state='processed' AND w.failure_code='reply_protocol' AND g.connection_id=$4 AND g.generation=$5 AND g.account_id=$6 AND EXISTS(SELECT 1 FROM communications.events x WHERE x.webhook_inbox_id=w.id AND x.id=$7::bigint)`,
          [
            scope.applicationId,
            scope.tenantId,
            scope.ownerId,
            b.connectionId,
            b.generation,
            b.accountId,
            eventId,
          ],
        );
        if (rows.rows.length !== 1) return null;
        const r = rows.rows[0];
        try {
          const { b: actual, key, decoded } = original(r);
          if (JSON.stringify(actual) !== JSON.stringify(b)) return null;
          const event = o.eventCodec.decode(
            { binding: b, key },
            JSON.parse(r.encrypted_event as string),
          ) as {
            outcome: {
              kind: string;
              code: string;
            };
            fingerprint: string;
            receivedAt: string;
          };
          const vector = [
            b.applicationId,
            b.tenantId,
            b.ownerId,
            b.connectionId,
            b.accountId,
            b.generation,
            b.channel,
            b.platform,
            b.backend,
          ];
          if (
            r.source_namespace !== "reply_review/v1" ||
            r.source_event_key !== key ||
            r.event_type !== "account" ||
            event.outcome.kind !== "review" ||
            event.outcome.code !== "protocol" ||
            event.fingerprint !==
              hash([
                "communications.reply.review.v1",
                vector,
                key,
                "protocol",
              ]) ||
            event.receivedAt !== decoded.receivedAt ||
            new Date(r.event_occurred_at as string).toISOString() !==
              decoded.receivedAt
          )
            return null;
          return {
            kind: "untracked_authenticated_outbound",
            sourceKey: key,
            serviceEventId: eventId,
            originalPayloadDigest: r.payload_digest as string,
            bindingDigest: hash(vector),
            receivedAt: r.stored_received_at as string,
            noAssociation: true,
          };
        } catch {
          return null;
        }
      });
    },
  };
}
