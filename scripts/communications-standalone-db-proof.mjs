// Opt-in synthetic proof only. Never starts containers, changes schemas or calls providers.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateDirectory = join(root, '.local-data/communications');
const containerName = 'acquire-communications-standalone-postgres-1';
const imageReference = 'postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193';
const tables = ['access_grants', 'physical_accounts', 'connections', 'connection_generations', 'operation_journal', 'account_leases', 'quota_buckets', 'auth_states', 'identity_aliases', 'event_cursors', 'webhook_inbox', 'events', 'event_outbox', 'tenant_reply_barriers', 'webhook_receipt_routes', 'reply_review_latches'].sort();
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const vector = b => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];

export function validateStandaloneContainer(m) {
  assert.equal(m.Name, `/${containerName}`);
  assert.equal(m.Config?.Labels?.['acquire.fixture'], 'communications-standalone');
  assert.equal(m.Config?.Labels?.['com.docker.compose.project'], 'acquire-communications-standalone');
  assert.equal(m.Config?.Image, imageReference);
  assert.equal(m.State?.Running, true); assert.equal(m.State?.Health?.Status, 'healthy');
  assert.equal(m.HostConfig?.NetworkMode, 'acquire-communications-standalone_default');
  const ports = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5446' }] };
  assert.deepEqual(m.HostConfig.PortBindings, ports); assert.deepEqual(m.NetworkSettings?.Ports, ports);
  assert.match(m.Image, /^sha256:[a-f0-9]{64}$/);
  return m.Image;
}
export function parseStandaloneEnv(text) {
  const v = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^(POSTGRES_USER|POSTGRES_DB|POSTGRES_PASSWORD)=([A-Za-z0-9_-]+)$/.exec(line);
    assert.ok(match && !Object.hasOwn(v, match[1]), 'Invalid fixture credential format');
    v[match[1]] = match[2];
  }
  assert.equal(v.POSTGRES_USER, 'communications_fixture'); assert.equal(v.POSTGRES_DB, 'communications_fixture');
  assert.match(v.POSTGRES_PASSWORD ?? '', /^[A-Za-z0-9_-]{32,256}$/);
  return v;
}
export function validateHashes(expected, actual) {
  assert.ok(expected && typeof expected === 'object' && !Array.isArray(expected) && Object.keys(expected).length);
  for (const [path, digest] of Object.entries(expected)) {
    assert.ok(path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => !p || p === '..' || p === '.'));
    assert.match(digest, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(Object.entries(actual).sort(), Object.entries(expected).sort());
}
function inventory(directory, sources = false) {
  const hashes = {}, excluded = new Set(['node_modules', 'dist', 'coverage', '.git']);
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (sources && (excluded.has(entry.name) || entry.name.startsWith('.env'))) continue;
      const path = join(current, entry.name); assert.ok(!entry.isSymbolicLink(), 'Artifact symlinks are not accepted');
      if (entry.isDirectory()) walk(path);
      else { assert.ok(entry.isFile()); hashes[relative(directory, path)] = sha(readFileSync(path)); }
    }
  }
  walk(directory); return hashes;
}
function privateFile(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid() && stat.size > 0 && stat.size <= 2097152);
  return readFileSync(path, 'utf8');
}
function copiedPackage() {
  const report = JSON.parse(privateFile(join(privateDirectory, 'verification/independent-copy.json'))), checked = Date.parse(report.checkedAt);
  assert.ok(Number.isFinite(checked) && checked <= Date.now() && Date.now() - checked <= 86400000, 'Requires last fresh independent copy');
  assert.equal(report.providerWrites, 0); assert.equal(report.migrationsApplied, 0); assert.equal(report.dockerContext, 'orbstack');
  const copy = report.retainedPrivateCopy;
  assert.ok(typeof copy === 'string' && resolve(copy) === copy && copy.startsWith(`${privateDirectory}/independent-copy-`) && /^independent-copy-[A-Za-z0-9]+$/.test(basename(copy)));
  assert.equal(realpathSync(copy), copy);
  validateHashes(report.sourceHashes, inventory(join(root, 'communications'), true));
  const copiedSources = inventory(copy, true);
  if (!Object.hasOwn(report.sourceHashes, 'package-lock.json')) delete copiedSources['package-lock.json'];
  validateHashes(report.sourceHashes, copiedSources);
  assert.equal(sha(readFileSync(join(copy, 'package-lock.json'))), report.resolvedDependencyLockSha256);
  const compiled = inventory(join(copy, 'dist')), prefixed = Object.fromEntries(Object.entries(compiled).map(([p, h]) => [`dist/${p}`, h]));
  validateHashes(report.compiledHashes, Object.keys(report.compiledHashes ?? {}).every(p => p.startsWith('dist/')) ? prefixed : compiled);
  const index = join(copy, 'dist/src/index.js'); assert.equal(realpathSync(index), index);
  const api = createRequire(import.meta.url)(index);
  for (const name of ['JournalCodec', 'WebhookCodec', 'EventCodec', 'createPostgresDispatchJournal', 'createDispatchCoordinator', 'createPostgresWebhookRepository', 'createPostgresReplyBarrier', 'createPostgresOutboxRepository', 'createWebhookEventProcessor', 'createOutboxDeliveryWorker']) assert.equal(typeof api[name], 'function');
  return { api, report, copy, compiled };
}
function selfTest() {
  const m = { Name: `/${containerName}`, Image: `sha256:${'a'.repeat(64)}`, Config: { Image: imageReference, Labels: { 'acquire.fixture': 'communications-standalone', 'com.docker.compose.project': 'acquire-communications-standalone' } }, State: { Running: true, Health: { Status: 'healthy' } }, HostConfig: { NetworkMode: 'acquire-communications-standalone_default', PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5446' }] } }, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5446' }] } } };
  assert.equal(validateStandaloneContainer(m), m.Image);
  for (const change of [v => { v.Name = '/another'; }, v => { v.Config.Labels['acquire.fixture'] = 'other'; }, v => { v.Config.Labels['com.docker.compose.project'] = 'other'; }, v => { v.State.Running = false; }, v => { v.State.Health.Status = 'unhealthy'; }, v => { v.HostConfig.NetworkMode = 'host'; }, v => { v.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0'; }, v => { v.NetworkSettings.Ports['5432/tcp'][0].HostPort = '5434'; }, v => { v.NetworkSettings.Ports['8080/tcp'] = []; }, v => { v.Image = 'postgres:latest'; }]) { const altered = structuredClone(m); change(altered); assert.throws(() => validateStandaloneContainer(altered)); }
  const wrongImage = structuredClone(m); wrongImage.Config.Image = 'postgres:latest'; assert.throws(() => validateStandaloneContainer(wrongImage));
  const env = `POSTGRES_USER=communications_fixture\nPOSTGRES_DB=communications_fixture\nPOSTGRES_PASSWORD=${'x'.repeat(43)}\n`;
  assert.equal(parseStandaloneEnv(env).POSTGRES_DB, 'communications_fixture');
  for (const text of [env.replace('POSTGRES_DB=communications_fixture', 'POSTGRES_DB=project_acquire'), env.replace('POSTGRES_USER=communications_fixture', 'POSTGRES_USER=postgres'), `${env}DATABASE_URL=forbidden\n`, `${env}POSTGRES_DB=communications_fixture\n`, env.replace('x'.repeat(43), 'short')]) assert.throws(() => parseStandaloneEnv(text));
  const hashes = { 'src/index.ts': 'b'.repeat(64) }; validateHashes(hashes, { ...hashes });
  for (const actual of [{}, { 'src/index.ts': 'c'.repeat(64) }, { ...hashes, 'extra.ts': 'd'.repeat(64) }]) assert.throws(() => validateHashes(hashes, actual));
  assert.throws(() => validateHashes({ '../index.ts': 'b'.repeat(64) }, { '../index.ts': 'b'.repeat(64) }));
  console.log('Standalone proof pure guards passed; no database/container operation ran.');
}

async function main() {
  assert.equal(process.env.COMMUNICATIONS_STANDALONE_AUDIT, '1', 'Explicit standalone opt-in required');
  const credentials = parseStandaloneEnv(privateFile(join(privateDirectory, 'standalone.env'))), copied = copiedPackage(), { api } = copied;
  const docker = args => execFileSync('docker', ['--context', 'orbstack', ...args], { cwd: root, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  const inspected = JSON.parse(docker(['inspect', containerName])); assert.equal(inspected.length, 1);
  const image = validateStandaloneContainer(inspected[0]);
  const insideId = docker(['exec', containerName, 'psql', '--no-psqlrc', '--no-password', '--username=communications_fixture', '--dbname=communications_fixture', '--tuples-only', '--no-align', '--command=SELECT system_identifier::text FROM pg_control_system()']).trim();
  assert.match(insideId, /^[1-9][0-9]{0,19}$/);
  const { Pool } = createRequire(import.meta.url)('pg'); // Injected host driver only; all service code is the independently compiled copy.
  const pool = new Pool({ host: '127.0.0.1', port: 5446, database: credentials.POSTGRES_DB, user: credentials.POSTGRES_USER, password: credentials.POSTGRES_PASSWORD, ssl: false, options: '-c search_path=pg_catalog,communications', application_name: 'communications_standalone_proof', max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
  const driver = { async connect() { const c = await pool.connect(); return { async query(text, values) { const r = await c.query(text, values); return { rows: r.rows, rowCount: r.rowCount }; }, release(error) { c.release(error); } }; } };
  const retired = [], cases = [], key = version => ({ version, encryptionKey: randomBytes(32), digestKey: randomBytes(32) });
  let completedReport;
  const jk = key('standalone-journal-v1'), wk = key('standalone-webhook-v1'), ek = key('standalone-event-v1'), recipientKey = randomBytes(32);
  const journalCodec = new api.JournalCodec({ activeVersion: jk.version, keys: [jk] }), webhookCodec = new api.WebhookCodec({ activeVersion: wk.version, keys: [wk] }), eventCodec = new api.EventCodec({ activeVersion: ek.version, keys: [ek] });
  async function control(work) { const c = await driver.connect(); try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE communications_control'); const result = await work(c); await c.query('COMMIT'); return result; } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); } }
  try {
    const identity = (await pool.query('SELECT current_database() AS database,current_user AS username,system_identifier::text AS identity FROM pg_control_system()')).rows[0];
    assert.deepEqual(identity, { database: 'communications_fixture', username: 'communications_fixture', identity: insideId });
    const relations = (await pool.query("SELECT c.relname AS name,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='communications' AND c.relkind IN ('r','p') ORDER BY c.relname")).rows;
    assert.deepEqual(relations.map(r => r.name), tables); assert.ok(relations.every(r => r.relrowsecurity && r.relforcerowsecurity));
    async function publicRelationCount() { return (await pool.query("SELECT count(*)::integer AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')")).rows[0].count; }
    assert.equal(await publicRelationCount(), 0);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM pg_roles WHERE left(rolname,8)='acquire_'")).rows[0].count, 0);
    const roles = (await pool.query("SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN ('communications_control','communications_scoped') ORDER BY rolname")).rows;
    assert.deepEqual(roles.map(r => r.rolname), ['communications_control', 'communications_scoped']); assert.ok(roles.every(r => !r.rolsuper && !r.rolbypassrls && !r.rolcanlogin));
    for (const channel of ['email', 'whatsapp', 'linkedin']) {
      const suffix = randomUUID(), integrationId = `standalone-source-${suffix}`, subscriberId = 'synthetic-independent-app';
      const binding = { applicationId: `standalone-${suffix}`, tenantId: 'standalone-tenant', ownerId: 'standalone-owner', connectionId: `standalone-connection-${suffix}`, accountId: `standalone-account-${suffix}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile' };
      await control(async c => {
        await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [binding.applicationId, binding.tenantId, binding.ownerId]);
        await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'standalone_fixture',$3,'fixture-v1',clock_timestamp())", [binding.accountId, channel, hash(suffix)]);
        await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, channel, binding.platform]);
        await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,'unipile',$8,'v1','synthetic-config','service','{}')", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, channel, binding.platform, integrationId]);
      }); retired.push(binding);
      const recipient = channel === 'email' ? { kind: 'email', value: 'standalone@example.test' } : channel === 'whatsapp' ? { kind: 'phone', value: '+15550000546' } : { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/standalone-fixture/' };
      const conversation = { binding, id: `chat-${suffix}` }, message = { recipient, text: 'Synthetic private standalone body', conversation }, snapshot = { binding, operation: 'message', key: `standalone-operation-${suffix}`, payloadDigest: api.messageDigest('message', message) };
      const journal = api.createPostgresDispatchJournal({ pool: driver, binding, integrationId, providerConfigurationReference: 'synthetic-config', providerApiVersion: 'v1', authority: 'service', leaseOwnerToken: `standalone-worker-${suffix}`, codec: journalCodec, recipientDigest: { keyVersion: 'fixture-recipient-v1', digest(target, version) { assert.equal(version, 'fixture-recipient-v1'); return createHmac('sha256', recipientKey).update('standalone.recipient.v1\0').update(JSON.stringify([target.kind, target.value])).digest('hex'); } } });
      let providerWrites = 0;
      const coordinator = api.createDispatchCoordinator(binding, { async ready() { return { status: 'ready' }; }, async submit() { providerWrites++; throw Error('Synthetic provider write must never run'); }, async lookup() { throw Error('Synthetic lookup must never run'); } }, journal);
      assert.deepEqual(await coordinator.submit({ snapshot, message }), { status: 'review', code: 'delivery_disabled' });
      const originalJournal = (await pool.query('SELECT * FROM communications.operation_journal WHERE application_id=$1 AND operation_key=$2', [binding.applicationId, snapshot.key])).rows[0];
      assert.equal(originalJournal.state, 'blocked'); assert.equal(originalJournal.quota_reserved, false);
      assert.ok(!originalJournal.encrypted_operation_context.includes(recipient.value) && !originalJournal.encrypted_operation_context.includes(message.text)); assert.ok(!originalJournal.encrypted_outcome.includes('delivery_disabled'));
      assert.deepEqual(await coordinator.submit({ snapshot, message }), { status: 'review', code: 'delivery_disabled' });
      assert.deepEqual((await pool.query('SELECT * FROM communications.operation_journal WHERE id=$1', [originalJournal.id])).rows[0], originalJournal); assert.equal(providerWrites, 0);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM communications.quota_buckets WHERE account_id=$1', [binding.accountId])).rows[0].count, 0);
      const barrier = api.createPostgresReplyBarrier({ binding, integrationId, codec: webhookCodec, eventCodec }), repository = api.createPostgresWebhookRepository({ pool: driver, binding, integrationId, providerConfigurationReference: 'synthetic-config', subscriberId, codec: webhookCodec, eventCodec, replyBarrier: barrier });
      const rawBody = Buffer.from(JSON.stringify({ event: channel === 'email' ? 'mail_received' : 'message_received', account_id: 'synthetic-provider', message_id: suffix, content: 'Synthetic private inbound fixture' }));
      const capture = { binding, key: hash(['communications.webhook.receipt.v1', vector(binding), sha(rawBody)]), rawBody, receivedAt: new Date().toISOString() };
      assert.equal((await repository.capture(capture)).status, 'accepted'); assert.equal((await repository.capture(capture)).status, 'duplicate');
      const inbox = (await pool.query('SELECT encrypted_payload FROM communications.webhook_inbox WHERE id=$1', [capture.key])).rows[0].encrypted_payload;
      assert.ok(!inbox.includes('Synthetic private inbound fixture')); assert.deepEqual(Buffer.from(webhookCodec.decode({ binding, key: capture.key }, JSON.parse(inbox)).rawBody), rawBody);
      async function gate() { return control(async c => { await barrier.lock(c, binding.applicationId, binding.tenantId); return c.query('SELECT communications.assert_dispatch_reply_barrier($1,$2)::text AS revision', [binding.applicationId, binding.tenantId]); }); }
      await assert.rejects(gate, /remains pending/);
      const event = { type: 'message', reference: { binding, id: suffix }, conversation, direction: 'inbound', sender: recipient, occurredAt: new Date(Date.parse(capture.receivedAt) - 1000).toISOString() };
      // Explicit synthetic normalization authority, not a provider ownership/authentication proof.
      const processor = api.createWebhookEventProcessor({ binding, journal: repository, async normalize(raw) { assert.equal(raw.message_id, suffix); return { kind: 'event', event }; } });
      assert.deepEqual(await processor.process(capture.key), { status: 'processed' }); assert.deepEqual(await processor.process(capture.key), { status: 'duplicate' }); await assert.rejects(gate, /remains pending/);
      const outbox = api.createPostgresOutboxRepository({ pool: driver, binding, subscriberId, codec: eventCodec, replyBarrier: barrier }), appReceipts = new Map(); let delivery, receipt;
      const worker = api.createOutboxDeliveryWorker({ binding, subscriberId, outbox, async apply(d) {
        await assert.rejects(gate, /remains pending/);
        const existing = appReceipts.get(d.eventId); if (existing) assert.equal(existing, d.payload.fingerprint); else appReceipts.set(d.eventId, d.payload.fingerprint);
        // Separate synthetic MEMORY app commit; never claim Acquire or application PostgreSQL proof.
        delivery = structuredClone(d); receipt = { binding, subscriberId, eventId: d.eventId, fingerprint: d.payload.fingerprint, status: existing ? 'duplicate' : 'committed' }; return receipt;
      } });
      assert.deepEqual(await worker.run(), { status: 'delivered' }); assert.equal(appReceipts.size, 1); assert.ok(delivery && receipt);
      assert.deepEqual(await outbox.acknowledge({ delivery, receipt }), { status: 'duplicate' }); assert.deepEqual(await worker.run(), { status: 'busy' }); await gate();
      const persisted = (await pool.query('SELECT encrypted_event FROM communications.events WHERE id=$1', [delivery.eventId])).rows[0].encrypted_event;
      assert.ok(!persisted.includes(recipient.value)); assert.deepEqual(eventCodec.decode({ binding, key: delivery.sourceEventKey }, JSON.parse(persisted)), delivery.payload);
      cases.push({ channel, journal: 'encrypted_disabled_replay', webhook: 'encrypted_processed_replay', applicationReceipt: 'synthetic_memory_commit_before_ack', outbox: 'acknowledged_terminal_replay', pendingGate: 'blocked_before_ack_clear_after', providerWrites: 0 });
    }
    validateHashes(copied.compiled, inventory(join(copied.copy, 'dist'))); validateHashes(copied.report.sourceHashes, inventory(join(root, 'communications'), true)); assert.equal(await publicRelationCount(), 0);
    completedReport = { checkedAt: new Date().toISOString(), scope: 'Service-only PostgreSQL, independently installed copied modules, synthetic authority ports', database: 'communications_fixture', databaseSystemIdentifier: insideId, container: containerName, image, dockerContext: 'orbstack', copiedPackage: copied.copy, sourceHashes: copied.report.sourceHashes, compiledHashes: copied.report.compiledHashes, dependencyLockSha256: copied.report.resolvedDependencyLockSha256, scriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))), serviceTablesForceRls: 16, publicRelations: 0, acquireTables: 0, acquireRoles: 0, cases, providerWrites: 0, migrationsApplied: 0, applicationPostgresProof: false, completeReplyCoverageProof: false, applicationReadinessProof: false, completeDispatchRepositoryProof: false, wholeBackendRuntimeExtractionVerified: false };
  } finally {
    let cleanupFailed = false;
    try {
      for (const b of retired) {
        try { await pool.query('UPDATE communications.connections SET active=false WHERE id=$1', [b.connectionId]); }
        catch { cleanupFailed = true; } // Unresolved durable history can prevent retirement.
        try { await pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [b.applicationId, b.tenantId, b.ownerId]); }
        catch { cleanupFailed = true; }
      }
    } finally { await pool.end(); }
    assert.equal(cleanupFailed, false, 'Fixture cleanup incomplete; no successful proof is emitted');
  }
  const directory = join(privateDirectory, 'verification'); mkdirSync(directory, { recursive: true, mode: 0o700 }); const path = join(directory, 'standalone-db-proof.json'); writeFileSync(path, `${JSON.stringify({ ...completedReport, fixtureConnectionsRetired: retired.length, fixtureGrantsRevoked: retired.length, historyRetained: true }, null, 2)}\n`, { mode: 0o600 }); chmodSync(path, 0o600);
  console.log('Standalone synthetic database proof passed; provider/app readiness and whole runtime extraction remain unverified.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') selfTest();
  else if (process.argv.length === 2) main().catch(() => { console.error('Standalone proof unavailable; prerequisite or bounded verification failed. No automatic startup/schema operation occurs.'); process.exitCode = 1; });
  else { console.error('Unsupported standalone proof arguments'); process.exitCode = 1; }
}
