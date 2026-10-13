import { createHash, createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { ConnectionRetirementCodec, createPostgresConnectionRetirement, type ConnectionRetirementOptions } from './connection-retirement';
import type { RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import type { SqlClient } from './webhook-repository';
const record: RecordedLifecycleConnection = { binding: { applicationId: 'retirement-app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 2, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' }, providerAccountId: 'opaque-provider', sourceId: 'source', ownerIdentity: { namespace: 'unipile.v1.linkedin.im.id', value: 'owner-id' } };
const scope = { binding: record.binding, key: 'disconnect-original' };
const key = (version: string, e = 71, d = 72) => ({ version, encryptionKey: Buffer.alloc(32, e), digestKey: Buffer.alloc(32, d) });
const digest = (v: unknown) => createHmac('sha256', Buffer.alloc(32, 73)).update(JSON.stringify(v)).digest('hex');
function fixture() {
    const codec = new ConnectionRetirementCodec({ activeVersion: 'r1', keys: [key('r1')] }), queries: string[] = [], release = vi.fn();
    let stored: Record<string, unknown> | undefined;
    let active = true;
    const generation = { connection_id: record.binding.connectionId, application_id: record.binding.applicationId, tenant_id: record.binding.tenantId, owner_id: record.binding.ownerId, account_id: record.binding.accountId, generation: 2, channel: 'linkedin', platform: 'linkedin', backend: 'unipile', current_generation: 2, current_account_id: 'physical', active: true, integration_id: 'integration', provider_api_version: 'v1', provider_configuration_reference: 'configuration', authority: 'service', provider_account_digest: digest(record.providerAccountId), provider_account_key_version: 'provider-v1', encrypted_provider_account_id: 'synthetic-encrypted-id', credential_reference: 'verified-owner-vault', status_observed_future: false };
    const physical = { id: 'physical', channel: 'linkedin', identity_namespace: 'linkedin_member_id', identity_digest: digest({ namespace: 'linkedin_member_id', value: 'canonical-owner' }), identity_key_version: 'physical-v1', verified: true };
    const blockers = { shared: false, journal: false, lease: false, setup: false };
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
        queries.push(sql);
        let rows: Record<string, unknown>[] = [];
        if (sql.includes('FROM pg_roles'))
            rows = [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }];
        else if (sql.includes('lock_reply_barrier'))
            rows = [{ revision: '1' }];
        else if (sql.includes('to_regclass'))
            rows = [{ present: true }];
        else if (sql.includes('FROM communications.physical_accounts'))
            rows = [physical];
        else if (sql.startsWith('SELECT c.id AS connection_id'))
            rows = [{ ...generation, active }];
        else if (sql.includes('FROM communications.access_grants'))
            rows = [{ application_id: 'retirement-app', tenant_id: 'tenant', owner_id: 'owner', valid: true }];
        else if (sql.includes('AS shared'))
            rows = [{ ...blockers }];
        else if (sql.startsWith('INSERT INTO communications.connection_retirements')) {
            stored = Object.fromEntries(['id', 'application_id', 'tenant_id', 'owner_id', 'connection_id', 'generation', 'account_id', 'channel', 'platform', 'backend', 'operation_key', 'record_fingerprint', 'fingerprint_key_version', 'encrypted_record', 'record_key_version', 'token_hash'].map((name, i) => [name, values[i]]));
            Object.assign(stored, { state: 'pending', encrypted_outcome: null, outcome_key_version: null });
            active = false;
            rows = [stored];
        }
        else if (sql.startsWith('UPDATE communications.connection_retirements')) {
            Object.assign(stored!, { state: values[1], encrypted_outcome: values[2], outcome_key_version: values[3] });
            rows = [stored!];
        }
        else if (sql.includes('FROM communications.connection_retirements'))
            rows = stored ? [stored] : [];
        return { rows, rowCount: rows.length };
    });
    const verify = vi.fn<ConnectionRetirementOptions['verifyRecordedIdentity']>().mockImplementation(async (input) => ({ record: structuredClone(input.record), physicalIdentity: { namespace: 'linkedin_member_id', value: 'canonical-owner' } }));
    const options: ConnectionRetirementOptions = { pool: { connect: async () => ({ query, release }) as SqlClient }, record, integrationId: 'integration', providerConfigurationReference: 'configuration', codec, verifyRecordedIdentity: verify, providerAccountDigest: v => digest(v), physicalIdentityDigest: v => digest(v), transactionTimeoutMs: 1000, statementTimeoutMs: 900, lockTimeoutMs: 100 };
    return { options, codec, queries, query, release, verify, generation, physical, blockers, getStored: () => stored, setStored: (row: Record<string, unknown>) => { stored = row; }, getActive: () => active };
}
it('encrypts and key-digests the exact retirement scope without raw owner/provider bytes', () => {
    const codec = new ConnectionRetirementCodec({ activeVersion: 'r1', keys: [key('r1')] }), envelope = codec.encode(scope, 'record', record);
    expect(codec.decode(scope, 'record', envelope)).toEqual(record);
    expect(JSON.stringify(envelope)).not.toMatch(/opaque-provider|owner-id/);
    expect(codec.digest(scope, record)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => codec.decode({ ...scope, binding: { ...record.binding, ownerId: 'other' } }, 'record', envelope)).toThrow();
    expect(() => codec.decode(scope, 'outcome', envelope)).toThrow();
});
it('retains old encryption/digest keys for exact replay', () => { const old = new ConnectionRetirementCodec({ activeVersion: 'r1', keys: [key('r1')] }), next = new ConnectionRetirementCodec({ activeVersion: 'r2', keys: [key('r2', 74, 75), key('r1')] }), e = old.encode(scope, 'record', record); expect(next.decode(scope, 'record', e)).toEqual(record); expect(next.digest(scope, record, 'r1')).toBe(old.digest(scope, record)); });
it('definitely commits encrypted intent before returning its one-time ticket', async () => { const f = fixture(), repo = createPostgresConnectionRetirement(f.options); const result = await repo.prepareDisconnect(record, scope.key, new AbortController().signal); expect(result.status).toBe('prepared'); expect(f.queries.at(-1)).toBe('COMMIT'); expect(f.getActive()).toBe(false); expect(f.queries.indexOf('SELECT communications.lock_reply_barrier($1,$2)::text AS revision')).toBeLessThan(f.queries.findIndex(q => q.includes('FROM communications.physical_accounts'))); expect(JSON.stringify(f.getStored())).not.toContain('opaque-provider'); expect(f.verify).toHaveBeenCalledTimes(1); });
it.each(['journal', 'lease', 'setup', 'shared'] as const)('refuses account-wide %s blocker without new intent', async (blocker) => { const f = fixture(); f.blockers[blocker] = true; expect(await createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal)).toEqual({ status: 'review' }); expect(f.getStored()).toBeUndefined(); });
it('recomputes both recorded provider and canonical physical keyed identities', async () => { const f = fixture(); f.physical.identity_digest = 'a'.repeat(64); expect(await createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal)).toEqual({ status: 'review' }); expect(f.getStored()).toBeUndefined(); });
it('does not return fresh tickets for same-key pending or unknown intent', async () => {
    const f = fixture(), repo = createPostgresConnectionRetirement(f.options), controller = new AbortController();
    const first = await repo.prepareDisconnect(record, scope.key, controller.signal);
    expect(first.status).toBe('prepared');
    expect(await repo.prepareDisconnect(record, scope.key, controller.signal)).toEqual({ status: 'review' });
    if (first.status !== 'prepared')
        throw Error();
    await repo.finishDisconnect(first.ticket, { status: 'unknown' }, controller.signal);
    expect(await repo.prepareDisconnect(record, scope.key, controller.signal)).toEqual({ status: 'review' });
});
it('exact successful terminal replay returns duplicate without rewriting history', async () => {
    const f = fixture(), repo = createPostgresConnectionRetirement(f.options), signal = new AbortController().signal, first = await repo.prepareDisconnect(record, scope.key, signal);
    if (first.status !== 'prepared')
        throw Error();
    expect(await repo.finishDisconnect(first.ticket, { status: 'disconnected' }, signal)).toEqual({ status: 'recorded' });
    const row = structuredClone(f.getStored());
    expect(await repo.prepareDisconnect(record, scope.key, signal)).toEqual({ status: 'duplicate' });
    expect(f.getStored()).toEqual(row);
});
it('changed same-key encrypted record remains review without overwrite', async () => { const f = fixture(), repo = createPostgresConnectionRetirement(f.options), signal = new AbortController().signal; await repo.prepareDisconnect(record, scope.key, signal); const row = structuredClone(f.getStored()); const changed = { ...record, sourceId: 'other-source' }; await expect(repo.prepareDisconnect(changed, scope.key, signal)).rejects.toThrow('Connection retirement unavailable'); expect(f.getStored()).toEqual(row); });
it('finish requires original ticket token and exact encrypted context', async () => {
    const f = fixture(), repo = createPostgresConnectionRetirement(f.options), signal = new AbortController().signal, first = await repo.prepareDisconnect(record, scope.key, signal);
    if (first.status !== 'prepared')
        throw Error();
    expect(await repo.finishDisconnect({ ...first.ticket, token: 'b'.repeat(43) }, { status: 'disconnected' }, signal)).toEqual({ status: 'unknown' });
    expect(f.getStored()?.state).toBe('pending');
});
it('never upgrades a terminal unknown/rejected outcome on replay', async () => {
    const f = fixture(), repo = createPostgresConnectionRetirement(f.options), signal = new AbortController().signal, first = await repo.prepareDisconnect(record, scope.key, signal);
    if (first.status !== 'prepared')
        throw Error();
    await repo.finishDisconnect(first.ticket, { status: 'rejected' }, signal);
    const row = structuredClone(f.getStored());
    expect(await repo.finishDisconnect(first.ticket, { status: 'disconnected' }, signal)).toEqual({ status: 'unknown' });
    expect(f.getStored()).toEqual(row);
});
it('lost COMMIT cannot return a provider-deletion ticket and discards session', async () => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, values) => {
        const result = await original(sql, values);
        if (sql === 'COMMIT')
            throw Error('synthetic lost COMMIT');
        return result;
    });
    await expect(createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal)).rejects.toThrow('Connection retirement unavailable');
    expect(f.getStored()?.state).toBe('pending');
    expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    expect(f.queries).not.toContain('ROLLBACK');
});
it('retirement schema absence fails closed without writing/bootstrap', async () => { const f = fixture(), original = f.query.getMockImplementation()!; f.query.mockImplementation(async (sql, values) => sql.includes('to_regclass') ? { rows: [{ present: false }], rowCount: 1 } : original(sql, values)); await expect(createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal)).rejects.toThrow('Connection retirement unavailable'); expect(f.getStored()).toBeUndefined(); expect(f.queries.some(q => /CREATE|ALTER/.test(q))).toBe(false); });
it('pre-aborted requests never check out SQL sessions', async () => { const f = fixture(), connect = vi.fn(f.options.pool.connect); f.options.pool = { connect }; const controller = new AbortController(); controller.abort(); await expect(createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, controller.signal)).rejects.toThrow('Connection retirement unavailable'); expect(connect).not.toHaveBeenCalled(); });
it('compares token hashes instead of persisting raw ticket tokens', async () => {
    const f = fixture(), result = await createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal);
    if (result.status !== 'prepared')
        throw Error();
    expect(f.getStored()?.token_hash).toBe(createHash('sha256').update(result.ticket.token).digest('hex'));
    expect(JSON.stringify(f.getStored())).not.toContain(result.ticket.token);
});
it('rejects a forged abort signal without evaluating its getter or opening SQL', async () => {
    const f = fixture(), connect = vi.fn(f.options.pool.connect);
    f.options.pool = { connect };
    const getter = vi.fn(() => { throw Error('synthetic private abort getter'); });
    const signal = Object.defineProperty({}, 'aborted', { get: getter });
    await expect(createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, signal as AbortSignal)).rejects.toThrow('Connection retirement unavailable');
    expect(getter).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
});
it('cancellation during identity verification discards the session and cannot write a late intent', async () => {
    const f = fixture();
    let unblock: (proof: {
        record: RecordedLifecycleConnection;
        physicalIdentity: {
            namespace: string;
            value: string;
        };
    }) => void = () => { };
    f.verify.mockImplementation(() => new Promise(resolve => { unblock = resolve; }));
    const controller = new AbortController(), pending = createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, controller.signal);
    const observed = pending.catch(error => error);
    while (!f.verify.mock.calls.length)
        await new Promise(resolve => setTimeout(resolve, 1));
    controller.abort();
    expect((await observed).message).toBe('Connection retirement unavailable');
    expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    const before = f.queries.length;
    unblock({ record, physicalIdentity: { namespace: 'linkedin_member_id', value: 'canonical-owner' } });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.queries.length).toBe(before);
    expect(f.getStored()).toBeUndefined();
    expect(f.queries).not.toContain('ROLLBACK');
});
it('a stalled active SQL query is disposed without concurrent rollback', async () => {
    const f = fixture();
    f.options.transactionTimeoutMs = 15;
    f.options.statementTimeoutMs = 10;
    f.options.lockTimeoutMs = 5;
    const original = f.query.getMockImplementation()!;
    let unblock: (value: {
        rows: Record<string, unknown>[];
        rowCount: number;
    }) => void = () => { };
    f.query.mockImplementation((sql, values) => sql.includes('FROM communications.physical_accounts') ? new Promise(resolve => { unblock = resolve; }) : original(sql, values));
    await expect(createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal)).rejects.toThrow('Connection retirement unavailable');
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    expect(f.queries).not.toContain('ROLLBACK');
    unblock({ rows: [f.physical], rowCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.getStored()).toBeUndefined();
});
it('scope/owner proof mismatch cannot retire an account', async () => { const f = fixture(); f.verify.mockResolvedValue({ record: { ...record, binding: { ...record.binding, ownerId: 'another-owner' } }, physicalIdentity: { namespace: 'linkedin_member_id', value: 'canonical-owner' } }); await expect(createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, new AbortController().signal)).rejects.toThrow('Connection retirement unavailable'); expect(f.getStored()).toBeUndefined(); });
it('retained codec versions replay old intent without changing fingerprint or ciphertext', async () => {
    const f = fixture(), signal = new AbortController().signal;
    await createPostgresConnectionRetirement(f.options).prepareDisconnect(record, scope.key, signal);
    const before = structuredClone(f.getStored());
    const next = new ConnectionRetirementCodec({ activeVersion: 'r2', keys: [key('r1'), key('r2', 74, 75)] });
    expect(await createPostgresConnectionRetirement({ ...f.options, codec: next }).prepareDisconnect(record, scope.key, signal)).toEqual({ status: 'review' });
    expect(f.getStored()).toEqual(before);
});
it('same-role/cross-role encryption key reuse and mutated authentication tags are rejected', () => {
    expect(() => new ConnectionRetirementCodec({ activeVersion: 'r1', keys: [key('r1', 71, 71)] })).toThrow('Invalid retirement codec configuration');
    const codec = new ConnectionRetirementCodec({ activeVersion: 'r1', keys: [key('r1')] }), envelope = codec.encode(scope, 'record', record);
    expect(() => codec.decode(scope, 'record', { ...envelope, tag: Buffer.alloc(16, 99).toString('base64') })).toThrow('Connection retirement unavailable');
});
