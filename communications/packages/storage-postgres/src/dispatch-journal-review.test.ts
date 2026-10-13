import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding, OperationSnapshot } from '../../contracts/src';
import { JournalCodec } from '../../core/src/journal-codec';
import { createPostgresDispatchJournal, type PostgresDispatchJournalOptions } from './dispatch-journal';
import type { SqlClient } from './webhook-repository';

const binding: ConnectionBinding = { applicationId: 'review-app', tenantId: 'review-tenant', ownerId: 'review-owner', connectionId: 'review-connection', accountId: 'review-account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const snapshot: OperationSnapshot = { binding, key: 'review-operation', operation: 'message', payloadDigest: 'a'.repeat(64) };
const codec = new JournalCodec({ activeVersion: 'review-journal-v1', keys: [{ version: 'review-journal-v1', encryptionKey: Buffer.alloc(32, 231), digestKey: Buffer.alloc(32, 232) }] });
function options(connect: PostgresDispatchJournalOptions['pool']['connect']): PostgresDispatchJournalOptions {
    return { pool: { connect }, binding, integrationId: 'review-integration', providerConfigurationReference: 'review-configuration', providerApiVersion: 'v1', authority: 'service', leaseOwnerToken: 'review-worker', codec,
        recipientDigest: { keyVersion: 'review-recipient-v1', digest: (recipient, version) => createHmac('sha256', Buffer.alloc(32, 233)).update(JSON.stringify([version, recipient.kind, recipient.value])).digest('hex') },
        transactionTimeoutMs: 5, statementTimeoutMs: 4, lockTimeoutMs: 1 };
}
// Scripted driver exercises callback/lifecycle boundaries only; real durable SQL is covered separately.
function scriptedClaim() {
    const queries: string[] = [], release = vi.fn();
    let stored: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
        queries.push(sql);
        let rows: Record<string, unknown>[] = [];
        if (sql.includes('FROM pg_roles')) rows = [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }];
        else if (sql.includes('lock_reply_barrier')) rows = [{ revision: '0' }];
        else if (sql.includes('FROM communications.connections')) rows = [{ connection_id: binding.connectionId, application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, channel: binding.channel, platform: binding.platform, backend: binding.backend, current_generation: 1, current_account_id: binding.accountId, active: true, status: 'connected', generation: 1, account_id: binding.accountId, integration_id: 'review-integration', provider_api_version: 'v1', provider_configuration_reference: 'review-configuration', authority: 'service' }];
        else if (sql.includes('FROM communications.physical_accounts')) rows = [{ id: binding.accountId, channel: binding.channel, verified_at: new Date() }];
        else if (sql.includes('FROM communications.access_grants')) rows = [{ application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId }];
        else if (sql.startsWith('INSERT INTO communications.operation_journal')) {
            stored = Object.fromEntries(['id', 'application_id', 'tenant_id', 'owner_id', 'operation_key', 'connection_id', 'generation', 'account_id', 'operation', 'payload_digest', 'recipient_digest', 'recipient_key_version', 'encrypted_operation_context', 'operation_context_key_version', 'operation_context_digest', 'claim_token'].map((key, index) => [key, values[index]]));
            Object.assign(stored, { digest_version: 'message-v1', state: 'claimed', claim_until: new Date(Date.now() + 60000), fencing_token: values[17], lease_owner_token: values[18], quota_reserved: false, encrypted_receipt: null, receipt_key_version: null, outcome_status: null, encrypted_outcome: null, outcome_key_version: null, submitted_at: null, delivered_at: null, read_at: null, claim_alive: true });
            rows = [stored];
        } else if (sql.includes('FROM communications.account_leases')) rows = [{ account_id: binding.accountId, owner_token: 'review-worker', fencing_token: '1', alive: true }];
        else if (sql.includes('FROM communications.operation_journal')) rows = stored ? [stored] : [];
        return { rows };
    });
    const client = { query, release } as unknown as SqlClient;
    const config = { ...options(async () => client), transactionTimeoutMs: 1000, statementTimeoutMs: 900, lockTimeoutMs: 100 };
    return { queries, query, release, client, config, getStored: () => stored };
}
describe('independent gated journal deadline/session review (no database durability claim)', () => {
    it('captures a validated codec method once without exposing a later accessor exception', () => {
        const connect = vi.fn(async () => { throw Error('Unexpected SQL'); });
        const config = options(connect);
        const getter = vi.fn(() => {
            if (getter.mock.calls.length > 1) throw Error('Synthetic private method configuration failure');
            return codec.encode.bind(codec);
        });
        config.codec = { keyVersion: codec.keyVersion, decode: codec.decode.bind(codec), digest: codec.digest.bind(codec) } as typeof config.codec;
        Object.defineProperty(config.codec, 'encode', { enumerable: true, get: getter });
        expect(() => createPostgresDispatchJournal(config)).not.toThrow();
        expect(getter).toHaveBeenCalledOnce();
        expect(connect).not.toHaveBeenCalled();
    });
    it('rejects accessor configuration before running its hook or exposing its exception', () => {
        const connect = vi.fn(async () => { throw Error('Unexpected SQL'); });
        const getter = vi.fn(() => { throw Error('Synthetic private getter failure'); });
        const config = Object.defineProperty(options(connect), 'claimSeconds', { enumerable: true, get: getter });
        expect(() => createPostgresDispatchJournal(config)).toThrow('Invalid dispatch journal configuration');
        expect(getter).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
    it.each(['codec', 'recipientDigest', 'pool'] as const)('rejects a proxied %s configuration port before accessing its properties', kind => {
        const connect = vi.fn(async () => { throw Error('Unexpected SQL'); }), config = options(connect);
        const get = vi.fn((target: object, property: PropertyKey) => Reflect.get(target, property));
        config[kind] = new Proxy(config[kind], { get }) as never;
        expect(() => createPostgresDispatchJournal(config)).toThrow('Invalid dispatch journal configuration');
        expect(get).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
    it('rejects a Date-valued client retry timestamp before entering SQL', async () => {
        const connect = vi.fn(async () => { throw Error('Unexpected SQL'); });
        const journal = createPostgresDispatchJournal(options(connect));
        await expect(journal.complete({ token: 'review-token', record: { snapshot, recipient: { kind: 'phone', value: '+15550000001' }, state: 'claimed' }, outcome: { status: 'waiting', code: 'timeout', retryAt: new Date('2026-10-13T00:00:00Z') } } as never)).rejects.toThrow('Dispatch journal unavailable');
        expect(connect).not.toHaveBeenCalled();
    });
    it('rejects a decoded historical outcome whose retry timestamp is a Date object', async () => {
        const f = scriptedClaim();
        expect((await createPostgresDispatchJournal(f.config).claim({ snapshot, recipient: { kind: 'phone', value: '+15550000001' } })).kind).toBe('claimed');
        const waiting = { status: 'waiting', code: 'timeout', retryAt: '2026-10-13T00:00:00.000Z' };
        Object.assign(f.getStored()!, { state: 'blocked', outcome_status: 'waiting', encrypted_outcome: JSON.stringify(codec.encode(snapshot, 'outcome', waiting)), outcome_key_version: codec.keyVersion });
        let outcomes = 0;
        f.config.codec = { keyVersion: codec.keyVersion, encode: codec.encode.bind(codec), digest: codec.digest.bind(codec), decode(s, purpose, envelope) { const value = codec.decode(s, purpose, envelope); if (purpose === 'outcome') { outcomes++; return { ...(value as object), retryAt: new Date(waiting.retryAt) }; } return value; } };
        f.queries.length = 0;
        await expect(createPostgresDispatchJournal(f.config).get(snapshot)).rejects.toThrow('Dispatch journal unavailable');
        expect(outcomes).toBe(1);
        expect(f.queries).not.toContain('COMMIT');
    });
    it.each(['context', 'recipient'] as const)('isolates the captured claim from a %s digester mutating its callback arguments', async kind => {
        const f = scriptedClaim(), input = { snapshot: structuredClone(snapshot), recipient: { kind: 'phone' as const, value: '+15550000001' } }, expected = structuredClone(input);
        let callbacks = 0;
        if (kind === 'context') f.config.codec = {
            keyVersion: codec.keyVersion, encode: codec.encode.bind(codec), decode: codec.decode.bind(codec),
            digest(s, purpose, value, version) {
                callbacks++; const result = codec.digest(s, purpose, value, version);
                s.key = 'mutated-operation'; (value as { recipient: { value: string } }).recipient.value = '+15550000002';
                return result;
            },
        };
        else {
            const original = f.config.recipientDigest.digest;
            f.config.recipientDigest = { keyVersion: f.config.recipientDigest.keyVersion, digest(recipient, version) { callbacks++; const result = original(recipient, version); recipient.value = '+15550000002'; return result; } };
        }
        const result = await createPostgresDispatchJournal(f.config).claim(input);
        expect(callbacks).toBeGreaterThanOrEqual(2);
        expect(result.kind).toBe('claimed');
        if (result.kind !== 'claimed') throw Error('Expected captured claim');
        expect(result.record.snapshot).toEqual(expected.snapshot);
        expect(result.record.recipient).toEqual(expected.recipient);
        expect(input).toEqual(expected);
        expect(f.getStored()?.operation_key).toBe(expected.snapshot.key);
        expect(f.queries.at(-1)).toBe('COMMIT');
    });
    it('cannot commit after a synchronous decoder exhausts the transaction budget', async () => {
        const f = scriptedClaim(), repo = createPostgresDispatchJournal(f.config);
        expect((await repo.claim({ snapshot, recipient: { kind: 'phone', value: '+15550000001' } })).kind).toBe('claimed');
        f.queries.length = 0; f.release.mockClear();
        const decode = vi.fn((...args: Parameters<typeof codec.decode>) => {
            const value = codec.decode(...args), end = performance.now() + 100;
            while (performance.now() < end) { /* Deliberate timer starvation inside synchronous port. */ }
            return value;
        });
        f.config.codec = { keyVersion: codec.keyVersion, encode: codec.encode.bind(codec), digest: codec.digest.bind(codec), decode };
        f.config.transactionTimeoutMs = 50; f.config.statementTimeoutMs = 40; f.config.lockTimeoutMs = 10;
        await expect(createPostgresDispatchJournal(f.config).get(snapshot)).rejects.toThrow('Dispatch journal unavailable');
        expect(decode).toHaveBeenCalledOnce();
        expect(f.queries).not.toContain('COMMIT');
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it.each(['ECONNRESET', '08006'])('retires a connection after %s even if its rollback promise subsequently resolves', async code => {
        const release = vi.fn(), query = vi.fn(async (sql: string) => {
            if (sql === 'BEGIN') throw Object.assign(Error('Synthetic connection failure'), { code });
            if (sql === 'ROLLBACK') return { rows: [] };
            throw Error('Unexpected SQL after connection failure');
        });
        const client = { query, release } as unknown as SqlClient;
        await expect(createPostgresDispatchJournal({ ...options(async () => client), transactionTimeoutMs: 1000, statementTimeoutMs: 900, lockTimeoutMs: 100 }).get(snapshot)).rejects.toThrow('Dispatch journal unavailable');
        expect(query).toHaveBeenCalledWith('BEGIN', undefined);
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(expect.any(Error));
    });
    it('retires a late checked-out client exactly once before issuing any SQL', async () => {
        let arrive!: () => void;
        const waiting = new Promise<void>(resolve => { arrive = resolve; });
        const query = vi.fn(async () => ({ rows: [] })), release = vi.fn(), client = { query, release } as SqlClient;
        const connect = vi.fn(async () => { await waiting; return client; });
        const journal = createPostgresDispatchJournal(options(connect));
        const settled = journal.get(snapshot).then(() => 'returned', () => 'unavailable');
        try {
            expect(await Promise.race([settled, new Promise<string>(resolve => setTimeout(() => resolve('still_pending'), 60))])).toBe('unavailable');
            expect(connect).toHaveBeenCalledOnce();
        } finally { arrive(); await settled; }
        await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
        expect(release).toHaveBeenCalledWith(expect.any(Error));
        expect(query).not.toHaveBeenCalled();
    });
    it('uses a monotonic budget when synchronous connect work starves the deadline timer', async () => {
        const query = vi.fn(async () => ({ rows: [] })), release = vi.fn(), client = { query, release } as SqlClient;
        const connect = vi.fn(async () => { const end = performance.now() + 20; while (performance.now() < end) { /* Deliberate timer starvation. */ } return client; });
        const journal = createPostgresDispatchJournal(options(connect));
        await expect(journal.get(snapshot)).rejects.toThrow();
        expect(connect).toHaveBeenCalledOnce();
        expect(query).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(expect.any(Error));
    });
    it('observes a synchronously late rejected connection promise under strict native Node', () => {
        const script = String.raw`
            const fs=require('node:fs'),ts=require('typescript');
            require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
            const {createPostgresDispatchJournal}=require(process.argv[1]),{JournalCodec}=require(process.argv[2]);
            const binding={applicationId:'review-app',tenantId:'review-tenant',ownerId:'review-owner',connectionId:'review-connection',accountId:'review-account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
            let connects=0;const journal=createPostgresDispatchJournal({binding,integrationId:'review-integration',providerConfigurationReference:'review-configuration',providerApiVersion:'v1',authority:'service',leaseOwnerToken:'review-worker',transactionTimeoutMs:5,statementTimeoutMs:4,lockTimeoutMs:1,
              pool:{connect(){connects++;const end=performance.now()+20;while(performance.now()<end){}return Promise.reject(Error('Synthetic late rejected connection'));}},codec:new JournalCodec({activeVersion:'review-journal-v1',keys:[{version:'review-journal-v1',encryptionKey:Buffer.alloc(32,231),digestKey:Buffer.alloc(32,232)}]}),recipientDigest:{keyVersion:'review-recipient-v1',digest:()=> 'b'.repeat(64)}});
            journal.get({binding,key:'review-operation',operation:'message',payloadDigest:'a'.repeat(64)}).then(()=>process.exitCode=2,()=>setTimeout(()=>process.stdout.write(JSON.stringify({connects})),40));
        `;
        const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, fileURLToPath(new URL('./dispatch-journal.ts', import.meta.url)), fileURLToPath(new URL('../../core/src/journal-codec.ts', import.meta.url))], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ connects: 1 });
    });
    it('observes rejected asynchronous factories accidentally supplied as synchronous configuration ports', () => {
        const script = String.raw`
            const fs=require('node:fs'),ts=require('typescript');
            require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
            const {createPostgresDispatchJournal}=require(process.argv[1]);
            const binding={applicationId:'review-app',tenantId:'review-tenant',ownerId:'review-owner',connectionId:'review-connection',accountId:'review-account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
            const rejected=[];
            for(const port of ['pool','codec','recipientDigest']) {
              const config={binding,integrationId:'review-integration',providerConfigurationReference:'review-configuration',providerApiVersion:'v1',authority:'service',leaseOwnerToken:'review-worker',
                pool:{async connect(){throw Error('Unexpected SQL');}},codec:{keyVersion:'review-journal-v1',encode(){throw Error('Unexpected codec');},decode(){throw Error('Unexpected codec');},digest:()=> 'a'.repeat(64)},recipientDigest:{keyVersion:'review-recipient-v1',digest:()=> 'b'.repeat(64)}};
              config[port]=Promise.reject(Error('Synthetic forgotten await'));
              try {createPostgresDispatchJournal(config);}catch(error){if(error.message==='Invalid dispatch journal configuration')rejected.push(port);}
            }
            setTimeout(()=>process.stdout.write(JSON.stringify({rejected})),30);
        `;
        const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, fileURLToPath(new URL('./dispatch-journal.ts', import.meta.url))], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ rejected: ['pool', 'codec', 'recipientDigest'] });
    });
});
