import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
import type { WebhookCapture, WebhookCapturePort } from '../../core/src/reply-ingress';
import type { EventEnvelope, EventPayload, EventScope } from '../../core/src/event-codec';
import type { NormalizedWebhookPort, NormalizedWebhookOutcome } from '../../core/src/webhook-events';

/** Minimal injected driver protocol, compatible with a PostgreSQL pool without importing its runtime. */
export interface SqlResult<Row = Record<string, unknown>> { rows: Row[]; rowCount?: number | null }
export interface SqlClient {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlResult<Row>>;
  release(error?: Error): void;
}
export interface SqlPool { connect(): Promise<SqlClient> }
export interface WebhookRepositoryCodec {
  encode(capture: WebhookCapture): { format: string; keyVersion: string; nonce: string; ciphertext: string; tag: string };
  decode(scope: { binding: ConnectionBinding; key: string }, envelope: unknown): WebhookCapture;
  digest(scope: { binding: ConnectionBinding; key: string }, rawBody: Uint8Array, keyVersion?: string): string;
}
export interface WebhookEventRepositoryCodec {
  encode(scope: EventScope, payload: EventPayload): EventEnvelope;
  decode(scope: EventScope, envelope: unknown): EventPayload;
}
export interface PostgresWebhookRepositoryOptions {
  pool: SqlPool;
  binding: ConnectionBinding;
  integrationId: string;
  providerConfigurationReference: string;
  /** Exact configured subscriber; publishing does not imply application receipt or person hold. */
  subscriberId: string;
  codec: WebhookRepositoryCodec;
  /** Required for event/review completion; capture/claim-only compositions may omit it. */
  eventCodec?: WebhookEventRepositoryCodec;
  leaseSeconds?: number;
  retentionSeconds?: number;
}

const bindingFields = ['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(): never { throw new Error('Webhook repository unavailable'); }
function exactBinding(expected: ConnectionBinding, value: unknown) {
  if (!object(value) || Object.keys(value).some(key => !bindingFields.includes(key)) ||
      bindingFields.some(key => key !== 'generation' && !id(value[key])) ||
      !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 || Number(value.generation) > 2_147_483_647) fail();
  assertSameBinding(expected, value as unknown as ConnectionBinding);
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function scopedReceiptKey(capture: WebhookCapture) {
  const b = capture.binding;
  return createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1',
    [b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend],
    createHash('sha256').update(capture.rawBody).digest('hex')])).digest('hex');
}
function validateCapture(binding: ConnectionBinding, value: WebhookCapture) {
  exactBinding(binding, value.binding);
  if (!hex(value.key) || !validDate(value.receivedAt) || !(value.rawBody instanceof Uint8Array) ||
      value.rawBody.byteLength < 1 || value.rawBody.byteLength > 1_048_576 || scopedReceiptKey(value) !== value.key) fail();
}

const SCOPE_SQL = `SELECT c.id AS connection_id, c.application_id, c.tenant_id, c.owner_id, c.account_id,
 g.generation, c.channel, c.platform, c.backend, g.integration_id, g.provider_configuration_reference,
 g.provider_api_version, g.authority, c.active,
 (ag.revoked_at IS NULL AND ag.expires_at > clock_timestamp()) AS grant_valid
 FROM communications.connections c
 JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation
 JOIN communications.access_grants ag ON ag.application_id=c.application_id AND ag.tenant_id=c.tenant_id AND ag.owner_id=c.owner_id
 WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 AND c.account_id=$5
 AND c.current_generation=$6 AND c.channel=$7 AND c.platform=$8 AND c.backend=$9 AND c.active=true
 AND g.integration_id=$10 AND g.provider_configuration_reference=$11 AND g.provider_api_version='v1'
 AND g.authority='service' AND ag.revoked_at IS NULL AND ag.expires_at > clock_timestamp()
 FOR SHARE OF c,g,ag`;
const INBOX_COLUMNS = `id, backend, integration_id, dedupe_key, payload_digest, encrypted_payload, key_version, state,
 (expires_at > clock_timestamp()) AS alive, (retry_at IS NULL OR retry_at <= clock_timestamp()) AS retry_due,
 (lease_until IS NULL OR lease_until <= clock_timestamp()) AS lease_expired`;

/** Durable service receipt/event/outbox transactions. No migration/startup, application hold,
 * provider I/O or memory fallback. Application policy consumes the scoped outbox separately. */
export function createPostgresWebhookRepository(options: PostgresWebhookRepositoryOptions): WebhookCapturePort & NormalizedWebhookPort {
  let binding: ConnectionBinding;
  try {
    exactBinding(options.binding, options.binding);
    binding = structuredClone(options.binding);
  } catch { throw new Error('Invalid webhook repository configuration'); }
  const integrationId = options.integrationId, configurationReference = options.providerConfigurationReference, subscriberId = options.subscriberId;
  const leaseSeconds = options.leaseSeconds ?? 60, retentionSeconds = options.retentionSeconds ?? 2_592_000;
  if (binding.backend !== 'unipile' || !id(integrationId) || !id(configurationReference, 2000) || !id(options.subscriberId) ||
      !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600 ||
      !Number.isSafeInteger(retentionSeconds) || retentionSeconds < 1 || retentionSeconds > 31_536_000 ||
      typeof options.pool?.connect !== 'function' || typeof options.codec?.encode !== 'function' ||
      typeof options.codec?.decode !== 'function' || typeof options.codec?.digest !== 'function' ||
      options.eventCodec !== undefined && (typeof options.eventCodec.encode !== 'function' || typeof options.eventCodec.decode !== 'function')) {
    throw new Error('Invalid webhook repository configuration');
  }
  const connect = options.pool.connect.bind(options.pool);
  const encode = options.codec.encode.bind(options.codec), decode = options.codec.decode.bind(options.codec), digest = options.codec.digest.bind(options.codec);
  const encodeEvent = options.eventCodec?.encode.bind(options.eventCodec), decodeEvent = options.eventCodec?.decode.bind(options.eventCodec);
  const scopeValues = [binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,
    binding.generation,binding.channel,binding.platform,binding.backend,integrationId,configurationReference];
  async function currentScope(client: SqlClient): Promise<boolean> {
    const result = await client.query(SCOPE_SQL, [...scopeValues]);
    if (result.rows.length !== 1) return false;
    const row = result.rows[0];
    return row.connection_id === binding.connectionId && row.application_id === binding.applicationId &&
      row.tenant_id === binding.tenantId && row.owner_id === binding.ownerId && row.account_id === binding.accountId &&
      row.generation === binding.generation && row.channel === binding.channel && row.platform === binding.platform &&
      row.backend === binding.backend && row.integration_id === integrationId &&
      row.provider_configuration_reference === configurationReference && row.provider_api_version === 'v1' &&
      row.authority === 'service' && row.active === true && row.grant_valid === true;
  }
  function openRow(key: string, row: Record<string, unknown>): WebhookCapture {
    if (row.id !== key || row.backend !== binding.backend || row.integration_id !== integrationId || row.dedupe_key !== key ||
        !hex(row.payload_digest) || !id(row.key_version, 64) || typeof row.encrypted_payload !== 'string' ||
        row.encrypted_payload.length > 2_200_000) fail();
    const envelope: unknown = JSON.parse(row.encrypted_payload);
    if (!object(envelope) || envelope.keyVersion !== row.key_version) fail();
    const record = structuredClone(decode({ binding: structuredClone(binding), key }, envelope));
    validateCapture(binding, record);
    if (record.key !== key) fail();
    const actualDigest = digest({ binding: structuredClone(binding), key }, Uint8Array.from(record.rawBody), row.key_version);
    if (!hex(actualDigest) || !timingSafeEqual(Buffer.from(actualDigest, 'hex'), Buffer.from(row.payload_digest, 'hex'))) fail();
    return record;
  }
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const eventScope = [binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend];
  function semanticEvent(outcome: Extract<NormalizedWebhookOutcome, { kind: 'event' }>) {
    const event = outcome.event;
    if (!event || event.type !== 'message') fail();
    exactBinding(binding, event.reference.binding);
    if (event.conversation) exactBinding(binding, event.conversation.binding);
    const eventKey = hash(['communications.reply.event.v1',eventScope,event.conversation?.id ?? null,event.reference.id]);
    const fingerprint = hash(['communications.reply.content.v1',eventScope,event.reference.id,event.conversation?.id ?? null,event.direction,event.sender.kind,event.sender.value,new Date(event.occurredAt).toISOString()]);
    if (outcome.eventKey !== eventKey || outcome.fingerprint !== fingerprint) fail();
    return { eventKey, fingerprint };
  }
  function reviewFingerprint(key: string, code: string) { return hash(['communications.reply.review.v1',eventScope,key,code]); }
  function sealedEvent(key: string, payload: EventPayload) {
    if (!encodeEvent) fail();
    const envelope = encodeEvent({ binding: structuredClone(binding), key }, structuredClone(payload));
    if (!object(envelope) || ![Object.prototype,null].includes(Object.getPrototypeOf(envelope))) fail();
    const fields = ['format','keyVersion','nonce','ciphertext','tag'];
    const descriptors = Object.getOwnPropertyDescriptors(envelope);
    if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(field => !Object.hasOwn(descriptors,field)) ||
        Reflect.ownKeys(descriptors).some(field => typeof field !== 'string' || !fields.includes(field) || !('value' in descriptors[field]!) || !descriptors[field]!.enumerable) ||
        envelope.format !== 'communications-event-v1' || !id(envelope.keyVersion,64) || !id(envelope.nonce,200) || !id(envelope.tag,200) ||
        typeof envelope.ciphertext !== 'string' || !envelope.ciphertext.length) fail();
    const encrypted = JSON.stringify(envelope);
    if (encrypted.length > 2_200_000) fail();
    return { encrypted, keyVersion: envelope.keyVersion };
  }
  function decodedEvent(key: string, namespace: string, row: Record<string,unknown>): EventPayload {
    if (!decodeEvent || row.application_id !== binding.applicationId || row.tenant_id !== binding.tenantId || row.owner_id !== binding.ownerId ||
        row.connection_id !== binding.connectionId || row.generation !== binding.generation || row.account_id !== binding.accountId ||
        row.source_namespace !== namespace || row.source_event_key !== key || !id(row.key_version,64) ||
        typeof row.encrypted_event !== 'string' || row.encrypted_event.length > 2_200_000) fail();
    const envelope: unknown = JSON.parse(row.encrypted_event);
    if (!object(envelope) || envelope.keyVersion !== row.key_version) fail();
    const payload = structuredClone(decodeEvent({ binding: structuredClone(binding), key },envelope));
    if (!payload || !hex(payload.fingerprint) || !validDate(payload.receivedAt)) fail();
    if (namespace === 'reply_message/v1') {
      if (payload.outcome.kind !== 'event') fail();
      const semantic = semanticEvent(payload.outcome), event = payload.outcome.event;
      if (event.type !== 'message' || semantic.fingerprint !== payload.fingerprint || row.event_type !== 'message' || row.direction !== event.direction ||
          new Date(row.occurred_at as string).toISOString() !== new Date(event.occurredAt).toISOString()) fail();
    } else if (payload.outcome.kind !== 'review' || payload.fingerprint !== reviewFingerprint(key,payload.outcome.code) ||
        row.event_type !== 'account' || row.direction !== null ||
        new Date(row.occurred_at as string).toISOString() !== new Date(payload.receivedAt).toISOString()) fail();
    return payload;
  }
  function eventId(value: unknown): string {
    const result = typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string' ? String(value) : '';
    if (!/^[1-9][0-9]{0,18}$/.test(result)) fail();
    return result;
  }
  async function persistEvent(client: SqlClient, receiptKey: string, key: string, namespace: string, payload: EventPayload) {
    const sealed = sealedEvent(key,payload), event = payload.outcome.kind === 'event' ? payload.outcome.event : undefined;
    const eventType = event?.type === 'message' ? 'message' : 'account';
    const direction = event?.type === 'message' ? event.direction : null;
    const occurredAt = event?.type === 'message' ? event.occurredAt : payload.receivedAt;
    const inserted = await client.query(`INSERT INTO communications.events
 (application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version,webhook_inbox_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
 ON CONFLICT(connection_id,generation,source_namespace,source_event_key) DO NOTHING RETURNING id`,
      [binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.generation,binding.accountId,namespace,key,eventType,direction,occurredAt,sealed.encrypted,sealed.keyVersion,receiptKey]);
    if (inserted.rows.length === 1) return { id: eventId(inserted.rows[0].id), conflict: false };
    if (inserted.rows.length !== 0) fail();
    const existing = await client.query(`SELECT id,application_id,tenant_id,owner_id,connection_id,generation,account_id,
 source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version
 FROM communications.events WHERE connection_id=$1 AND generation=$2 AND source_namespace=$3 AND source_event_key=$4 FOR SHARE`,
      [binding.connectionId,binding.generation,namespace,key]);
    if (existing.rows.length !== 1) fail();
    const original = decodedEvent(key,namespace,existing.rows[0]);
    // A review key identifies one immutable webhook receipt, including its capture time.
    // Message semantic duplicates can legitimately come from different delivery times.
    if (namespace === 'reply_review/v1' && original.receivedAt !== payload.receivedAt) fail();
    return { id: eventId(existing.rows[0].id), conflict: original.fingerprint !== payload.fingerprint };
  }
  async function queueEvent(client: SqlClient, id: string) {
    await client.query(`INSERT INTO communications.event_outbox(event_id,subscriber_id,application_id,tenant_id,owner_id)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,subscriber_id) DO NOTHING`,
      [id,subscriberId,binding.applicationId,binding.tenantId,binding.ownerId]);
    const existing = await client.query(`SELECT event_id,subscriber_id,application_id,tenant_id,owner_id
 FROM communications.event_outbox WHERE event_id=$1 AND subscriber_id=$2 FOR SHARE`,[id,subscriberId]);
    if (existing.rows.length !== 1 || eventId(existing.rows[0].event_id) !== id || existing.rows[0].subscriber_id !== subscriberId ||
        existing.rows[0].application_id !== binding.applicationId || existing.rows[0].tenant_id !== binding.tenantId || existing.rows[0].owner_id !== binding.ownerId) fail();
  }
  async function transaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T> {
    let client: SqlClient | undefined, commitAttempted = false, discard: Error | undefined;
    try {
      client = await connect();
      const query: SqlClient['query'] = client.query.bind(client);
      const transactional: SqlClient = {
        async query<Row = Record<string, unknown>>(text: string, values?: unknown[]) {
          if (text === 'COMMIT') commitAttempted = true;
          return query<Row>(text, values);
        },
        release() { /* Only the outer owner releases the checked-out client. */ },
      };
      await transactional.query('BEGIN');
      await transactional.query('SET LOCAL ROLE communications_control');
      const role = await transactional.query(`SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls, r.rolcanlogin
 FROM pg_roles r WHERE r.rolname=current_user`);
      if (role.rows.length !== 1 || role.rows[0].role_name !== 'communications_control' ||
          role.rows[0].rolsuper !== false || role.rows[0].rolbypassrls !== false || role.rows[0].rolcanlogin !== false) fail();
      return await operation(transactional);
    } catch (error) {
      const connectionCodes = ['08000','08003','08006','08001','08004','08007','08P01','57P01','57P02','57P03','ECONNRESET','ETIMEDOUT','EPIPE'];
      if (commitAttempted || error && typeof error === 'object' && 'code' in error && connectionCodes.includes(String(error.code))) {
        discard = new Error('Webhook database session unavailable');
      }
      if (client) {
        try { await client.query('ROLLBACK'); }
        catch { discard = new Error('Webhook database session unavailable'); }
      }
      return fail();
    } finally {
      if (client) {
        try { if (discard) client.release(discard); else client.release(); }
        catch { /* Never expose driver/session errors. */ }
      }
    }
  }
  return {
    async capture(input) {
      let captured: WebhookCapture, encryptedPayload: string, keyVersion: string, payloadDigest: string;
      try {
        captured = structuredClone(input);
        validateCapture(binding, captured);
        const envelope = encode(structuredClone(captured));
        if (!object(envelope) || ![Object.prototype, null].includes(Object.getPrototypeOf(envelope))) fail();
        const fields = ['format','keyVersion','nonce','ciphertext','tag'];
        const descriptors = Object.getOwnPropertyDescriptors(envelope);
        if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(field => !Object.hasOwn(descriptors, field)) ||
            Reflect.ownKeys(descriptors).some(field => typeof field !== 'string' || !fields.includes(field) ||
              !('value' in descriptors[field]!) || !descriptors[field]!.enumerable)) fail();
        if (envelope.format !== 'communications-webhook-v1' || !id(envelope.keyVersion, 64) ||
            !id(envelope.nonce, 200) || !id(envelope.tag, 200) || typeof envelope.ciphertext !== 'string' || !envelope.ciphertext.length) fail();
        keyVersion = envelope.keyVersion;
        encryptedPayload = JSON.stringify(envelope);
        payloadDigest = digest({ binding: structuredClone(binding), key: captured.key }, Uint8Array.from(captured.rawBody), keyVersion);
        if (!hex(payloadDigest) || encryptedPayload.length > 2_200_000) fail();
      } catch { return fail(); }
      return transaction(async client => {
        if (!await currentScope(client)) fail();
        const inserted = await client.query(`INSERT INTO communications.webhook_inbox
 (id,backend,integration_id,dedupe_key,payload_digest,encrypted_payload,key_version,authenticated_at,received_at,expires_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),clock_timestamp(),clock_timestamp()+($8::double precision * interval '1 second'))
 ON CONFLICT (backend,integration_id,dedupe_key) DO NOTHING RETURNING id`,
          [captured.key,binding.backend,integrationId,captured.key,payloadDigest,encryptedPayload,keyVersion,retentionSeconds]);
        let status: 'accepted' | 'duplicate';
        if (inserted.rows.length === 1 && inserted.rows[0].id === captured.key) status = 'accepted';
        else if (inserted.rows.length === 0) {
          const existing = await client.query(`SELECT ${INBOX_COLUMNS} FROM communications.webhook_inbox
 WHERE id=$1 AND backend=$2 AND integration_id=$3 AND dedupe_key=$4 FOR SHARE`,
            [captured.key,binding.backend,integrationId,captured.key]);
          if (existing.rows.length !== 1) fail();
          const original = openRow(captured.key, existing.rows[0]);
          // Never acknowledge an unprocessed receipt that can no longer be claimed. A terminal
          // processed receipt retains its durable downstream history and remains deduplicated.
          const existingState = existing.rows[0].state;
          if (existingState !== 'processed' &&
              (!['pending','processing'].includes(String(existingState)) || existing.rows[0].alive !== true)) fail();
          const expectedDigest = digest({ binding: structuredClone(binding), key: captured.key }, Uint8Array.from(captured.rawBody), String(existing.rows[0].key_version));
          if (!hex(expectedDigest) || expectedDigest !== existing.rows[0].payload_digest ||
              !Buffer.from(original.rawBody).equals(Buffer.from(captured.rawBody))) fail();
          status = 'duplicate';
        } else return fail();
        if (!await currentScope(client)) fail();
        await client.query('COMMIT');
        return { binding: structuredClone(binding), key: captured.key, status };
      });
    },
    async finish(input) {
      let record: typeof input.record, outcome: NormalizedWebhookOutcome;
      try {
        const copy = structuredClone(input); record = copy.record; outcome = copy.outcome;
        validateCapture(binding,record);
        if (!id(record.token) || !object(outcome)) fail();
        if (outcome.kind === 'ignore') {
          if (Object.keys(outcome).some(key => !['kind','reason'].includes(key)) || typeof outcome.reason !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(outcome.reason)) fail();
        } else if (outcome.kind === 'review') {
          if (Object.keys(outcome).some(key => !['kind','code'].includes(key)) || !['protocol','account_changed','identity_pending'].includes(outcome.code)) fail();
          sealedEvent(record.key,{ outcome, fingerprint: reviewFingerprint(record.key,outcome.code), receivedAt: record.receivedAt });
        } else if (outcome.kind === 'event') {
          semanticEvent(outcome);
          sealedEvent(outcome.eventKey,{ outcome, fingerprint: outcome.fingerprint, receivedAt: record.receivedAt });
        } else return fail();
      } catch { return fail(); }
      const rejected = () => ({ binding: structuredClone(binding), key: record.key, committed: false });
      return transaction(async client => {
        if (!await currentScope(client)) { await client.query('ROLLBACK'); return rejected(); }
        const selected = await client.query(`SELECT ${INBOX_COLUMNS},
 (state='processing' AND lease_token=$5 AND lease_until>clock_timestamp()) AS claim_valid
 FROM communications.webhook_inbox WHERE id=$1 AND backend=$2 AND integration_id=$3 AND dedupe_key=$4 FOR UPDATE`,
          [record.key,binding.backend,integrationId,record.key,record.token]);
        if (selected.rows.length !== 1 || selected.rows[0].alive !== true || selected.rows[0].claim_valid !== true) {
          await client.query('ROLLBACK'); return rejected();
        }
        const original = openRow(record.key,selected.rows[0]);
        if (original.receivedAt !== record.receivedAt || !Buffer.from(original.rawBody).equals(Buffer.from(record.rawBody))) fail();
        let eventResult: { id: string; conflict: boolean } | undefined;
        let reviewCode: 'protocol' | 'account_changed' | 'identity_pending' | undefined;
        if (outcome.kind === 'event') {
          eventResult = await persistEvent(client,record.key,outcome.eventKey,'reply_message/v1',{
            outcome,fingerprint:outcome.fingerprint,receivedAt:record.receivedAt,
          });
          if (eventResult.conflict) reviewCode = 'protocol';
        } else if (outcome.kind === 'review') reviewCode = outcome.code;
        if (reviewCode) {
          const review: Extract<NormalizedWebhookOutcome,{ kind:'review' }> = { kind:'review',code:reviewCode };
          eventResult = await persistEvent(client,record.key,record.key,'reply_review/v1',{
            outcome:review,fingerprint:reviewFingerprint(record.key,reviewCode),receivedAt:record.receivedAt,
          });
          if (eventResult.conflict) fail();
          // Invalidating cursor leases prevents an old crawler from clearing this review barrier.
          await client.query(`UPDATE communications.event_cursors SET invalidated=true, complete=false, lease_token=NULL, lease_until=NULL
 WHERE connection_id=$1 AND generation=$2 AND application_id=$3 AND tenant_id=$4 AND owner_id=$5 AND account_id=$6`,
            [binding.connectionId,binding.generation,binding.applicationId,binding.tenantId,binding.ownerId,binding.accountId]);
        }
        if (eventResult) await queueEvent(client,eventResult.id);
        if (!await currentScope(client)) { await client.query('ROLLBACK'); return rejected(); }
        const updated = await client.query(`UPDATE communications.webhook_inbox SET state='processed',lease_token=NULL,lease_until=NULL,retry_at=NULL,failure_code=$6
 WHERE id=$1 AND backend=$2 AND integration_id=$3 AND dedupe_key=$4 AND state='processing' AND lease_token=$5
 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id`,
          [record.key,binding.backend,integrationId,record.key,record.token,reviewCode ? `reply_${reviewCode}` : outcome.kind === 'ignore' ? `ignored_${outcome.reason}` : null]);
        if (updated.rows.length === 0 || !await currentScope(client)) { await client.query('ROLLBACK'); return rejected(); }
        if (updated.rows.length !== 1 || updated.rows[0].id !== record.key) fail();
        await client.query('COMMIT');
        return { binding: structuredClone(binding), key: record.key, committed: true };
      });
    },
    async claim(input) {
      let key: string;
      try { const copied = structuredClone(input); exactBinding(binding, copied.binding); if (!hex(copied.key)) fail(); key = copied.key; }
      catch { return fail(); }
      return transaction(async client => {
        if (!await currentScope(client)) { await client.query('ROLLBACK'); return { kind: 'forbidden' }; }
        const selected = await client.query(`SELECT ${INBOX_COLUMNS} FROM communications.webhook_inbox
 WHERE id=$1 AND backend=$2 AND integration_id=$3 AND dedupe_key=$4 FOR UPDATE SKIP LOCKED`,
          [key,binding.backend,integrationId,key]);
        if (selected.rows.length === 0) { await client.query('COMMIT'); return { kind: 'busy' }; }
        if (selected.rows.length !== 1) fail();
        const row = selected.rows[0], record = openRow(key, row);
        if (row.state === 'processed') { await client.query('COMMIT'); return { kind: 'completed' }; }
        if (row.alive !== true || row.retry_due !== true ||
            !(row.state === 'pending' || row.state === 'processing' && row.lease_expired === true)) {
          await client.query('COMMIT'); return { kind: 'busy' };
        }
        const token = randomBytes(32).toString('base64url');
        const updated = await client.query(`UPDATE communications.webhook_inbox SET state='processing', attempts=attempts+1,
 lease_token=$5, lease_until=clock_timestamp()+($6::double precision * interval '1 second'), failure_code=NULL
 WHERE id=$1 AND backend=$2 AND integration_id=$3 AND dedupe_key=$4
 AND expires_at>clock_timestamp() AND (retry_at IS NULL OR retry_at<=clock_timestamp())
 AND (state='pending' OR (state='processing' AND (lease_until IS NULL OR lease_until<=clock_timestamp()))) RETURNING id`,
          [key,binding.backend,integrationId,key,token,leaseSeconds]);
        if (updated.rows.length !== 1 || updated.rows[0].id !== key || !await currentScope(client)) fail();
        await client.query('COMMIT');
        return { kind: 'claimed', record: { ...record, rawBody: Uint8Array.from(record.rawBody), token } };
      });
    },
  };
}
