import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { localCampaignDatabase } from '../../scripts/campaign-integration-support.mjs';
import { WebhookCodec } from '../../communications/packages/core/src/webhook-codec';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { WebhookCapture } from '../../communications/packages/core/src/reply-ingress';
import type { SqlPool, WebhookEventRepositoryCodec } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';

/** Synthetic DML only, against the specifically approved isolated database. Never bootstrap schema. */
export function createCommunicationsLocalFixture() {
  const pool = new pg.Pool({ connectionString: localCampaignDatabase, max: 8, connectionTimeoutMillis: 5000 });
  const retired: ConnectionBinding[] = [];
  const driver: SqlPool = { async connect() {
    const client = await pool.connect();
    return { async query<Row>(text: string, values?: unknown[]) {
      const result = await client.query(text, values); return { rows: result.rows as Row[], rowCount: result.rowCount };
    }, release(error?: Error) { client.release(error); } };
  } };
  const webhookCodec = new WebhookCodec({ activeVersion: 'terminal-webhook-v1', keys: [{ version: 'terminal-webhook-v1', encryptionKey: Buffer.alloc(32, 101), digestKey: Buffer.alloc(32, 102) }] });
  async function preflight() {
    if (process.env.COMMUNICATIONS_AUDIT_LOCAL_DB !== '1' || process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK !== '1') throw Error('Requires explicit isolated communications database opt-in');
    const url = new URL(localCampaignDatabase);
    if (url.hostname !== '127.0.0.1' || url.port !== '5445' || url.pathname !== '/acquire_channels') throw Error('Unexpected database target');
    const { rows: [row] } = await pool.query("SELECT current_database() AS name, system_identifier::text AS identity, to_regclass('communications.events') AS events, to_regclass('communications.event_outbox') AS outbox FROM pg_control_system()");
    if (row.name !== 'acquire_channels' || row.identity !== '7694812678792806433') throw Error('Unexpected isolated database identity');
    if (!row.events || !row.outbox) throw Error('Approved service schema is absent; no automatic migration occurs and missing prerequisites are not a TDD red.');
  }
  async function fixture(channel: 'email' | 'whatsapp' | 'linkedin' = 'whatsapp') {
    const suffix = randomUUID();
    const binding: ConnectionBinding = { applicationId: `terminal-${suffix}`, tenantId: 'terminal-tenant', ownerId: 'terminal-owner', connectionId: `terminal-connection-${suffix}`, accountId: `terminal-account-${suffix}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [binding.applicationId, binding.tenantId, binding.ownerId]);
      await client.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'terminal_fixture',$3,'fixture-v1',clock_timestamp())", [binding.accountId, channel, createHash('sha256').update(suffix).digest('hex')]);
      await client.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, channel, binding.platform]);
      await client.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,'unipile','terminal-integration','v1','terminal-configuration','service','{}')", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, channel, binding.platform]);
      await client.query('COMMIT'); retired.push(binding);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    function capture(extra: Record<string, unknown> = {}): WebhookCapture {
      const rawBody = Buffer.from(JSON.stringify({ event: 'message_received', account_id: 'synthetic-provider', message_id: suffix, content: 'synthetic-private-message', ...extra }));
      const key = createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1', [binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.accountId, binding.generation, binding.channel, binding.platform, binding.backend], createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
      return { binding: structuredClone(binding), key, rawBody, receivedAt: new Date().toISOString() };
    }
    return { binding, suffix, capture };
  }
  async function close() {
    try {
      for (const b of retired) {
        await pool.query('UPDATE communications.connections SET active=false WHERE id=$1', [b.connectionId]);
        await pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [b.applicationId, b.tenantId, b.ownerId]);
      }
    } finally { await pool.end(); }
  }
  function replyBarrier(binding: ConnectionBinding, integrationId = 'terminal-integration', eventCodec?: WebhookEventRepositoryCodec) {
    return createPostgresReplyBarrier({ binding, integrationId, codec: webhookCodec, ...(eventCodec ? { eventCodec } : {}) });
  }
  return { pool, driver, webhookCodec, preflight, fixture, close, replyBarrier };
}
