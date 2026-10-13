import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPostgresEmailTracking, createTrackedEmailSubmission, type EmailTrackingOptions, type VerifiedEmailSentAssociation } from './email-tracking';
import { JournalCodec } from '../../core/src/journal-codec';
import type { ConnectionBinding, OperationSnapshot } from '../../contracts/src';
import type { SqlClient, SqlResult } from './webhook-repository';
const b: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'conn', accountId: 'physical', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
const snapshot: OperationSnapshot = { binding: b, key: 'original-operation', operation: 'message', payloadDigest: 'a'.repeat(64) };
const codec = new JournalCodec({ activeVersion: 'k1', keys: [{ version: 'k1', encryptionKey: Buffer.alloc(32, 1), digestKey: Buffer.alloc(32, 2) }] });
const recipient = { kind: 'email' as const, value: 'recipient@example.com' };
const ref = (id: string) => ({ binding: { ...b }, id });
const association: VerifiedEmailSentAssociation = { receipt: { message: ref('real/email'), recipient, submittedAt: '2026-10-14T01:00:00.000Z' }, rfcMessageId: '<original@example.com>', evidenceDigest: 'e'.repeat(64) };
function fixture(overrides: Partial<EmailTrackingOptions> = {}) {
    const statements: {
        sql: string;
        values: unknown[];
    }[] = [];
    let ack: Record<string, unknown> | undefined, linked: Record<string, unknown> | undefined;
    const ctx = { recipient };
    const journal = { id: 'journal', application_id: b.applicationId, tenant_id: b.tenantId, owner_id: b.ownerId, operation_key: snapshot.key, connection_id: b.connectionId, generation: 1, account_id: b.accountId, operation: 'message', payload_digest: snapshot.payloadDigest, state: 'unknown', quota_reserved: true, encrypted_operation_context: JSON.stringify(codec.encode(snapshot, 'context', ctx)), operation_context_key_version: 'k1', operation_context_digest: codec.digest(snapshot, 'context', ctx), recipient_digest: 'b'.repeat(64), recipient_key_version: 'r1' };
    const generation = { connection_id: b.connectionId, application_id: b.applicationId, tenant_id: b.tenantId, owner_id: b.ownerId, channel: 'email', platform: 'gmail', backend: 'unipile', generation: 1, account_id: b.accountId, integration_id: 'integration', provider_api_version: 'v1', provider_configuration_reference: 'config-v1', authority: 'service', encrypted_provider_account_id: 'encrypted-original', provider_account_key_version: 'owner-v1', provider_account_digest: 'c'.repeat(64) };
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        statements.push({ sql, values });
        if (sql.includes('lock_reply_barrier'))
            return { rows: [{ revision: '0' }] };
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
        if (sql.includes('connection_generations'))
            return { rows: [generation] };
        if (sql.includes('physical_accounts'))
            return { rows: [{ id: b.accountId, channel: 'email', verified_at: new Date(), identity_verified: true }] };
        if (sql.includes('access_grants'))
            return { rows: [{ application_id: b.applicationId, tenant_id: b.tenantId, owner_id: b.ownerId }] };
        if (sql.includes('FROM communications.operation_journal'))
            return { rows: [journal] };
        if (sql.startsWith('INSERT INTO communications.email_tracking_acknowledgements')) {
            ack = { id: values[0], journal_id: values[1], tracking_digest: values[2], tracking_key_version: values[3], encrypted_ack: values[4], ack_key_version: values[5], ack_digest: values[6] };
            return { rows: [ack] };
        }
        if (sql.startsWith('INSERT INTO communications.email_tracking_associations')) {
            linked = { acknowledgement_id: values[0], encrypted_association: values[1], association_key_version: values[2], association_digest: values[3], evidence_digest: values[4] };
            return { rows: [linked] };
        }
        if (sql.includes('FROM communications.email_tracking_associations'))
            return { rows: linked ? [linked] : [] };
        if (sql.includes('FROM communications.email_tracking_acknowledgements'))
            return { rows: ack ? [ack] : [] };
        return { rows: [] };
    });
    const release = vi.fn();
    const client = { query, release } as SqlClient;
    const options: EmailTrackingOptions = { pool: { connect: vi.fn(async () => client) }, binding: { ...b }, integrationId: 'integration', providerConfigurationReference: 'config-v1', providerAccountId: 'provider-account', codec, recipientDigest: { keyVersion: 'r1', digest: () => 'b'.repeat(64) }, trackingDigest: { keyVersion: 't1', versions: ['t1'], digest: (v, version) => createHmac('sha256', version).update(JSON.stringify(v)).digest('hex') }, decodeProviderAccount: vi.fn(() => 'provider-account'), authenticateNotification: vi.fn(async () => true), verifySentMessage: vi.fn(async () => structuredClone(association)), ...overrides };
    const repo = createPostgresEmailTracking(options);
    const notification = (extra: Record<string, unknown> = {}) => ({ rawBody: Buffer.from(JSON.stringify({ event: 'mail_sent', tracking_id: 'tracking-private', account_id: 'provider-account', email_id: 'real/email', message_id: '<original@example.com>', date: '2026-10-14T01:00:00.000Z', role: 'sent', origin: 'unipile', to_attendees: [{ identifier: recipient.value }], cc_attendees: [], bcc_attendees: [], ...extra })), rawHeaders: ['Synthetic-Auth', 'synthetic'] });
    return { repo, options, query, release, statements, journal, generation, notification, ack: () => ack, linked: () => linked };
}
describe('durable email tracking protocol (scripted driver, not PostgreSQL)', () => {
    it('reconciliation rejects accessor metadata without executing private getters', async () => { const f = fixture(); let reads = 0; const record = { snapshot, recipient, state: 'unknown' as const, outcome: { status: 'unknown' as const } }; Object.defineProperty(record, 'snapshot', { get() { reads++; throw Error('private caller content'); } }); await expect(f.repo.verifyReconciliation(record, { status: 'unknown' })).rejects.toThrow('Email tracking unavailable'); expect(reads).toBe(0); expect(f.query).not.toHaveBeenCalled(); });
    it('does not acknowledge a scripted INSERT before the driver COMMIT resolves', async () => { const f = fixture(); const underlying = f.query.getMockImplementation()!; let finish!: (result: SqlResult) => void; f.query.mockImplementation((sql, values) => sql === 'COMMIT' ? new Promise<SqlResult>(resolve => { finish = resolve; }) : underlying(sql, values)); let done = false; const result = f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }).then(value => { done = true; return value; }); await vi.waitFor(() => expect(finish).toBeTypeOf('function')); expect(done).toBe(false); finish({ rows: [] }); expect(await result).toEqual({ kind: 'recorded' }); });
    it('records encrypted acknowledgement only after COMMIT; does not expose tracking to SQL plaintext or alter original unknown/quota', async () => { const f = fixture(); expect(await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' })).toEqual({ kind: 'recorded' }); expect(f.statements.at(-1)?.sql).toBe('COMMIT'); expect(JSON.stringify(f.statements)).not.toContain('tracking-private'); expect(f.ack()).toBeDefined(); expect(f.statements.some(q => /UPDATE communications\.(operation_journal|quota_buckets)/.test(q.sql))).toBe(false); });
    it('replay verifies exact encrypted original without overwriting', async () => { const f = fixture(); await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }); expect(await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' })).toEqual({ kind: 'duplicate' }); expect(f.statements.filter(q => q.sql.startsWith('INSERT INTO communications.email_tracking_acknowledgements'))).toHaveLength(1); await expect(f.repo.recordAcknowledgement({ snapshot, trackingId: 'changed' })).rejects.toThrow('Email tracking unavailable'); });
    it('rejects original operation without reserved quota', async () => { const f = fixture(); f.journal.quota_reserved = false; await expect(f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' })).rejects.toThrow('Email tracking unavailable'); expect(f.ack()).toBeUndefined(); });
    it('rejects caller-invented provider-account provenance', async () => { const f = fixture({ decodeProviderAccount: () => 'other' }); await expect(f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' })).rejects.toThrow('Email tracking unavailable'); expect(f.ack()).toBeUndefined(); });
    it('requires authenticated sent notification and independent exact read-only verification before association commit', async () => { const f = fixture(); await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }); expect(await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification() })).toEqual({ kind: 'associated', association }); expect(f.options.authenticateNotification).toHaveBeenCalledTimes(1); expect(f.options.verifySentMessage).toHaveBeenCalledTimes(1); expect(f.statements.at(-1)?.sql).toBe('COMMIT'); expect(f.linked()).toBeDefined(); });
    it('unauthenticated notification never queries SQL or provider', async () => { const f = fixture({ authenticateNotification: async () => false }); expect(await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification() })).toEqual({ kind: 'review' }); expect(f.query).not.toHaveBeenCalled(); expect(f.options.verifySentMessage).not.toHaveBeenCalled(); });
    it('early event without recorded ACK stays missing and cannot invent an operation association', async () => { const f = fixture(); expect(await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification() })).toEqual({ kind: 'missing' }); expect(f.linked()).toBeUndefined(); expect(f.options.verifySentMessage).not.toHaveBeenCalled(); });
    it.each([{ event: 'mail_received' }, { account_id: 'other' }, { tracking_id: 'other' }, { origin: 'external' }, { role: 'draft' }, { cc_attendees: { identifier: 'other@example.com' } }, { bcc_attendees: null }, { to_attendees: [{ identifier: 'other@example.com' }] }])('changed/inbound event %j cannot be accepted', async (extra) => { const f = fixture(); await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }); expect(await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification(extra) })).toEqual({ kind: 'review' }); expect(f.linked()).toBeUndefined(); });
    it('a read verifier cannot invent a different accepted message ID', async () => { const f = fixture({ verifySentMessage: async () => ({ ...association, receipt: { ...association.receipt, message: ref('invented') } }) }); await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }); expect(await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification() })).toEqual({ kind: 'review' }); expect(f.linked()).toBeUndefined(); });
    it('only a committed exact association can settle the original unknown record', async () => { const f = fixture(); const record = { snapshot, recipient, state: 'unknown' as const, outcome: { status: 'unknown' as const } }; expect(await f.repo.verifyReconciliation(record, { status: 'submitted', receipt: association.receipt })).toBeNull(); await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }); await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification() }); expect(await f.repo.verifyReconciliation(record, { status: 'submitted', receipt: association.receipt })).toEqual({ status: 'submitted', receipt: association.receipt }); expect(await f.repo.verifyReconciliation(record, { status: 'submitted', receipt: { ...association.receipt, message: ref('other') } })).toBeNull(); });
    it('rolls back verifier mismatch and never promotes tracking IDs to a receipt', async () => { const f = fixture({ verifySentMessage: async () => null }); await f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' }); expect(await f.repo.associate({ snapshot, trackingId: 'tracking-private', notification: f.notification() })).toEqual({ kind: 'review' }); expect(f.linked()).toBeUndefined(); });
    it('retires a connection that arrives after the overall deadline without issuing SQL', async () => { const release = vi.fn(), query = vi.fn(); const f = fixture({ timeoutMs: 5, statementTimeoutMs: 4, lockTimeoutMs: 1, pool: { connect: () => new Promise<SqlClient>(resolve => setTimeout(() => resolve({ query, release }), 20)) } }); await expect(f.repo.recordAcknowledgement({ snapshot, trackingId: 'tracking-private' })).rejects.toThrow('Email tracking unavailable'); await new Promise(resolve => setTimeout(resolve, 30)); expect(query).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledExactlyOnceWith(expect.any(Error)); });
});
describe('durable acknowledgement producer composition', () => {
    it('awaits known durable acknowledgement commit and still reports unknown', async () => {
        let commit!: (v: {
            kind: 'recorded';
        }) => void;
        const recordAcknowledgement = vi.fn(() => new Promise<{
            kind: 'recorded';
        }>(resolve => commit = resolve));
        const producer = { ready: vi.fn(async () => ({ status: 'ready' as const })), lookup: vi.fn(async () => null), submitAcknowledged: vi.fn(async () => ({ status: 'acknowledged' as const, receipt: { operation: ref('tracking-private'), recipient } })) };
        const adapter = createTrackedEmailSubmission({ producer, tracking: { recordAcknowledgement } });
        const message = { recipient, text: 'synthetic' };
        let settled = false;
        const result = adapter.submit({ snapshot, message }).then(value => { settled = true; return value; });
        await vi.waitFor(() => expect(recordAcknowledgement).toHaveBeenCalledTimes(1));
        expect(settled).toBe(false);
        commit({ kind: 'recorded' });
        expect(await result).toEqual({ status: 'unknown' });
        expect(recordAcknowledgement).toHaveBeenCalledWith({ snapshot, trackingId: 'tracking-private' });
        expect(producer.submitAcknowledged).toHaveBeenCalledTimes(1);
    });
    it('never retries a send or acknowledgement when commit response is lost', async () => { const recordAcknowledgement = vi.fn(async () => { throw Error('synthetic committed response loss'); }); const producer = { ready: async () => ({ status: 'ready' as const }), lookup: async () => null, submitAcknowledged: vi.fn(async () => ({ status: 'acknowledged' as const, receipt: { operation: ref('tracking-private'), recipient } })) }; const adapter = createTrackedEmailSubmission({ producer, tracking: { recordAcknowledgement } }); expect(await adapter.submit({ snapshot, message: { recipient, text: 'synthetic' } })).toEqual({ status: 'unknown' }); expect(producer.submitAcknowledged).toHaveBeenCalledTimes(1); expect(recordAcknowledgement).toHaveBeenCalledTimes(1); });
    it('refuses a malformed runtime producer that invents a completed message result', async () => { const recordAcknowledgement = vi.fn(async () => ({ kind: 'recorded' as const })); const producer = { ready: async () => ({ status: 'ready' as const }), lookup: async () => null, submitAcknowledged: async () => ({ status: 'submitted', receipt: association.receipt }) } as unknown as import('./email-tracking').EmailAcknowledgementProducer; const adapter = createTrackedEmailSubmission({ producer, tracking: { recordAcknowledgement } }); expect(await adapter.submit({ snapshot, message: { recipient, text: 'synthetic' } })).toEqual({ status: 'unknown' }); expect(recordAcknowledgement).not.toHaveBeenCalled(); });
});
describe('native strict tracking deadline boundaries', () => {
    it('observes synchronous-overrun rejection and retires late connection without SQL', () => {
        const entry = fileURLToPath(new URL('./email-tracking.ts', import.meta.url));
        const script = `const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{performance}=require('node:perf_hooks');require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,p);const {createPostgresEmailTracking}=require(process.argv[1]);const b={applicationId:'native-app',tenantId:'native-tenant',ownerId:'native-owner',connectionId:'native-conn',accountId:'native-physical',generation:1,channel:'email',platform:'gmail',backend:'unipile'},snapshot={binding:b,key:'native-operation',operation:'message',payloadDigest:'a'.repeat(64)};let sql=0,released=0;const client={query(){sql++;throw Error('must not query');},release(e){assert.ok(e instanceof Error);released++;}};const options={pool:{connect:async()=>client},binding:b,integrationId:'native-integration',providerConfigurationReference:'native-config',providerAccountId:'native-provider',codec:{keyVersion:'k1',encode(){throw Error('unused');},decode(){throw Error('unused');},digest(){return 'b'.repeat(64);}},recipientDigest:{keyVersion:'r1',digest(){return 'b'.repeat(64);}},trackingDigest:{keyVersion:'t1',versions:['t1'],digest(){return 'c'.repeat(64);}},decodeProviderAccount(){return 'native-provider';},authenticateNotification(){const until=performance.now()+15;while(performance.now()<until){}return Promise.reject(Error('synthetic late authentication'));},verifySentMessage:async()=>null,timeoutMs:5,statementTimeoutMs:4,lockTimeoutMs:1};(async()=>{await assert.rejects(createPostgresEmailTracking(options).recordAcknowledgement({snapshot,trackingId:Promise.reject(Error('synthetic private rejected scalar'))}),/^Error: Email tracking unavailable$/);await new Promise(r=>setImmediate(r));const auth=createPostgresEmailTracking(options);await assert.rejects(auth.associate({snapshot,trackingId:'native-tracking',notification:{rawHeaders:['Synthetic','yes'],rawBody:Buffer.from('{}')}}),/^Error: Email tracking unavailable$/);await new Promise(r=>setImmediate(r));assert.equal(sql,0);const late=createPostgresEmailTracking({...options,pool:{connect:()=>new Promise(r=>setTimeout(()=>r(client),20))}});await assert.rejects(late.recordAcknowledgement({snapshot,trackingId:'native-tracking'}),/^Error: Email tracking unavailable$/);await new Promise(r=>setTimeout(r,30));assert.equal(sql,0);assert.equal(released,1);console.log('native tracking guards passed');})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
        expect(execFileSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, entry], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, timeout: 10000 })).toContain('native tracking guards passed');
    });
});
