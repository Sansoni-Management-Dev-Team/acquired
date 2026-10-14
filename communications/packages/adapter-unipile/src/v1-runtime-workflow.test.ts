import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createConfiguredUnipileV1Runtime } from './v1-runtime';
import type { SqlClient, SqlResult } from '../../storage-postgres/src/webhook-repository';
const scope = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner' };
/** Scripted SQL protocol, real crypto and real adapter code. No transaction/RLS/Postgres proof. */
function fixture() {
    const statements: {
        sql: string;
        values: unknown[];
    }[] = [], states = new Map<string, Record<string, unknown>>(), notifications = new Map<string, Record<string, unknown>>(), connections = new Map<string, Record<string, unknown>>();
    let allowed = true, changedOwner = false;
    const physical = new Map<string, Record<string, unknown>>();
    let callback: {
        nonce: string;
        capability: string;
    } | undefined;
    const grant = () => ({ application_id: scope.applicationId, tenant_id: scope.tenantId, owner_id: scope.ownerId });
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        statements.push({ sql, values });
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
        if (sql.includes('to_regclass'))
            return { rows: [{ ready: true }] };
        if (sql.startsWith('INSERT INTO communications.access_grants')) {
            allowed = true;
            return { rows: [{ authorized: true }] };
        }
        if (sql.includes('FROM communications.access_grants'))
            return { rows: allowed ? [grant()] : [] };
        if (sql.includes('INSERT INTO communications.auth_states')) {
            const row = { state_digest: values[0], application_id: values[1], tenant_id: values[2], owner_id: values[3], channel: values[4], platform: values[5], backend: values[6], redirect_origin: values[7], reconnect_connection_id: values[8], reconnect_generation: values[9], created_at: new Date(), expires_at: new Date(Date.now() + 900000), consumed_at: null, alive: true };
            states.set(values[0] as string, row);
            return { rows: [{ expires_at: row.expires_at }] };
        }
        if (sql.includes('UPDATE communications.auth_states')) {
            const row = states.get(values[0] as string);
            if (!row)
                return { rows: [] };
            row.consumed_at = new Date();
            return { rows: [{ state_digest: values[0] }] };
        }
        if (sql.includes('FROM communications.setup_notification_inbox n'))
            return { rows: [...notifications.entries()].filter(([digest, row]) => !row.processed_at && states.get(digest)?.application_id === values[0]).map(([digest, row]) => ({ ...states.get(digest), ...row })) };
        if (sql.includes('FROM communications.auth_states'))
            return { rows: states.has(values[0] as string) ? [states.get(values[0] as string)!] : [] };
        if (sql.startsWith('SELECT encrypted_notification'))
            return { rows: notifications.has(values[0] as string) ? [notifications.get(values[0] as string)!] : [] };
        if (sql.startsWith('INSERT INTO communications.setup_notification_inbox')) {
            notifications.set(values[0] as string, { encrypted_notification: values[1], key_version: values[2], payload_digest: values[3], processed_at: null });
            return { rows: [] };
        }
        if (sql.startsWith('UPDATE communications.setup_notification_inbox')) {
            notifications.get(values[0] as string)!.processed_at = new Date();
            return { rows: [] };
        }
        if (sql.includes('FROM communications.physical_accounts'))
            return { rows: physical.has(values[1] as string) ? [physical.get(values[1] as string)!] : [] };
        if (sql.startsWith('INSERT INTO communications.physical_accounts')) {
            physical.set(values[3] as string, { id: values[0], identity_namespace: values[2], identity_digest: values[3], identity_key_version: values[4], identity_verified: true });
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO communications.connections')) {
            connections.set(values[0] as string, { connection_id: values[0], application_id: values[1], tenant_id: values[2], owner_id: values[3], account_id: values[4], current_account_id: values[4], channel: values[5], platform: values[6], backend: values[7], current_generation: values[8], status: values[9], active: false, is_default: false });
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO communications.connection_generations')) {
            Object.assign(connections.get(values[0] as string)!, { generation: values[1], account_id: values[5], integration_id: values[8], provider_configuration_reference: values[9], provider_api_version: 'v1', provider_account_digest: values[10], encrypted_provider_account_id: values[11], provider_account_key_version: values[12], authority: 'service' });
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO communications.account_runtime_metadata')) {
            Object.assign(connections.get(values[0] as string)!, { encrypted_metadata: values[2], metadata_key_version: values[3], metadata_digest: values[4] });
            return { rows: [] };
        }
        if (sql.startsWith('UPDATE communications.connections SET current_generation')) {
            Object.assign(connections.get(values[0] as string)!, { current_generation: values[1], account_id: values[2], current_account_id: values[2], status: values[3], active: true });
            return { rows: [] };
        }
        if (sql.includes('FROM communications.connections c')) {
            const rows = [...connections.values()].filter(c => values[3] === undefined || values[3] === 'integration' || c.connection_id === values[3]);
            return { rows: rows.filter(c=>!sql.includes('AND c.current_generation=g.generation')||c.current_generation===c.generation).map(c => ({ ...c, ...[...physical.values()].find(p => p.id === c.account_id), connection_id: c.connection_id })) };
        }
        if (sql.startsWith('INSERT INTO communications.connection_defaults')) {
            connections.get(values[4] as string)!.is_default = true;
            return { rows: [{ connection_id: values[4] }] };
        }
        return { rows: [] };
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === 'POST') {
            expect(statements.at(-1)?.sql).toBe('COMMIT');
            const payload = JSON.parse(init.body as string);
            callback = { nonce: payload.name, capability: new URL(payload.notify_url).searchParams.get('capability')! };
            expect(states.has(createHash('sha256').update(payload.name).digest('hex'))).toBe(true);
            return Response.json({ object: 'HostedAuthURL', url: 'https://account.unipile.com/hosted/opaque' });
        }
        if (url.pathname.endsWith('/users/me'))
            return Response.json({ object: 'AccountOwnerProfile', provider: 'GMAIL', email: 'verified-owner@example.test', aliases: [] });
        return Response.json({ object: 'Account', id: 'provider', type: changedOwner ? 'OUTLOOK' : 'GOOGLE_OAUTH', name: 'untrusted-display-name', connection_params: { mail: { id: 'actual-owner-provider-id', username: 'opaque-login' } }, sources: [{ id: 'mail', status: 'OK' }] });
    });
    const runtime = createConfiguredUnipileV1Runtime({ pool: { connect: async () => ({ query, release() { } } as SqlClient) }, provider: { apiVersion: 'v1', baseUrl: 'https://synthetic.unipile.example:20255/api/v1', apiKey: 'synthetic', fetch }, applicationId: 'app', integrationId: 'integration', providerConfigurationReference: 'config-v1', vault: { activeVersion: 'k1', keys: [{ version: 'k1', encryptionKey: Buffer.alloc(32, 1), digestKey: Buffer.alloc(32, 2) }], identityKey: Buffer.alloc(32, 3), identityKeyVersion: 'identity-v1' }, callbackKey: Buffer.alloc(32, 4), webhookSecret: 'synthetic-webhook-secret', redirectOrigin: 'https://app.example.test', successPath: '/settings?setup=returned', failurePath: '/settings?setup=failed', notifyUrl: 'https://service.example.test/v1/setup/notify' });
    return { runtime, fetch, query, states, connections, statements, revoke: () => { allowed = false; }, changedOwner: () => { changedOwner = true; }, async notify() { return runtime.completeSetupNotification({ rawBody: Buffer.from(JSON.stringify({ status: 'CREATION_SUCCESS', name: callback!.nonce, account_id: 'provider' })), capability: callback!.capability }); } };
}
describe('concrete hosted setup workflow protocol (no actual database)', () => {
    it('reports an exact historical generation as disconnected without provider reads or status writes', async () => {
        const f = fixture();
        await f.runtime.setup(scope, { channel: 'email', platform: 'gmail' });
        await f.notify();
        const initial = (await f.runtime.list(scope)).connections[0];
        f.connections.get(initial.binding.connectionId)!.current_generation = 2;
        const readsBefore = f.fetch.mock.calls.length;
        const writesBefore = f.statements.filter(q => q.sql.startsWith('UPDATE communications.connections')).length;
        expect(await f.runtime.status(scope, initial.binding)).toMatchObject({ binding: initial.binding, status: 'disconnected', isDefault: false, readiness: { status: 'review', code: 'reconnect' } });
        expect(f.fetch).toHaveBeenCalledTimes(readsBefore);
        expect(f.statements.filter(q => q.sql.startsWith('UPDATE communications.connections'))).toHaveLength(writesBefore);
    });
    it('commits issued state before one hosted POST, queues callback, then fresh owner polling binds canonical owner', async () => { const f = fixture(); expect((await f.runtime.setup(scope, { channel: 'email', platform: 'gmail' })).status).toBe('redirect'); expect(await f.notify()).toEqual({ status: 'queued' }); expect(f.connections.size).toBe(0); expect(f.fetch).toHaveBeenCalledTimes(1); const result = await f.runtime.list(scope); expect(result.connections).toHaveLength(1); expect(result.connections[0]).toMatchObject({ label: 'verified-owner@example.test', status: 'connected', readiness: { status: 'waiting', code: 'incomplete' } }); expect(result.connections[0].binding.accountId).toMatch(/^physical-[a-f0-9]{64}$/); expect(f.statements.filter(q => q.sql.includes('INSERT INTO communications.connection_generations'))).toHaveLength(1); expect(f.statements.flatMap(q => q.values)).not.toContain('actual-owner-provider-id'); expect(f.statements.flatMap(q => q.values)).not.toContain('verified-owner@example.test'); expect((await f.runtime.setDefault(scope, result.connections[0].binding)).isDefault).toBe(true); });
    it('callback does not resurrect expired membership; a freshly signed current-owner request drains the same nonce', async () => { const f = fixture(); await f.runtime.setup(scope, { channel: 'email', platform: 'gmail' }); f.revoke(); expect(await f.notify()).toEqual({ status: 'queued' }); await expect(f.runtime.list(scope)).rejects.toThrow(); expect(f.connections.size).toBe(0); expect(await f.runtime.authorizeSignedScope(scope, { expiresAt: new Date(Date.now() + 30000).toISOString() })).toBe(true); expect((await f.runtime.list(scope)).connections).toHaveLength(1); expect(f.fetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1); });
    it('changed account product never binds or consumes the original stored callback', async () => { const f = fixture(); await f.runtime.setup(scope, { channel: 'email', platform: 'gmail' }); await f.notify(); f.changedOwner(); expect((await f.runtime.list(scope)).connections).toHaveLength(0); expect([...f.states.values()][0].consumed_at).toBeNull(); expect(f.statements.filter(q => q.sql.includes('INSERT INTO communications.connection_generations'))).toHaveLength(0); });
    it('historical journal options and lookup-only provider preserve exact old binding without reopening sends', async () => { const f = fixture(); await f.runtime.setup(scope, { channel: 'email', platform: 'gmail' }); await f.notify(); const initial = (await f.runtime.list(scope)).connections[0]; f.connections.get(initial.binding.connectionId)!.current_generation = 2; await expect(f.runtime.dispatchOptions(initial.binding, { historical: true })).resolves.toMatchObject({ providerApiVersion: 'v1', authority: 'service' }); const provider = await f.runtime.providerFactory(initial.binding, { lookupOnly: true }); expect(await provider.ready(initial.binding)).toEqual({ status: 'review', code: 'reconnect' }); expect(await provider.submit({ snapshot: { binding: initial.binding, key: 'original', operation: 'message', payloadDigest: 'a'.repeat(64) }, message: { recipient: { kind: 'email', value: 'recipient@example.test' }, text: 'no send' } })).toEqual({ status: 'review', code: 'reconnect' }); expect(f.fetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1); });
});
