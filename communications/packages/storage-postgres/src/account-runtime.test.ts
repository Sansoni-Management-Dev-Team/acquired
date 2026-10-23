import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createPostgresAccountRuntime } from './account-runtime';
import { AccountRuntimeVault } from './account-vault';
import { projectV1CanonicalOwner } from '../../adapter-unipile/src/v1-owner';
import type { SqlClient, SqlResult } from './webhook-repository';
import type { ConnectionBinding } from '../../contracts/src';
const b: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'auth-connection', accountId: 'physical', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
const scope = { applicationId: b.applicationId, tenantId: b.tenantId, ownerId: b.ownerId };
const vault = new AccountRuntimeVault({ activeVersion: 'k1', keys: [{ version: 'k1', encryptionKey: Buffer.alloc(32, 1), digestKey: Buffer.alloc(32, 2) }], identityKey: Buffer.alloc(32, 3), identityKeyVersion: 'identity-v1' });
const proof = projectV1CanonicalOwner({ object: 'Account', id: 'provider-account', type: 'GOOGLE_OAUTH', connection_params: { mail: { id: 'provider-owner' } }, sources: [{ id: 'mail', status: 'OK' }] }, { object: 'AccountOwnerProfile', provider: 'GMAIL', email: 'owner@example.com', aliases: [] }, { platform: 'gmail', providerAccountId: 'provider-account' });
if (proof.kind !== 'verified')
    throw Error('Synthetic owner fixture invalid');
const owner = proof.owner;
function fixture() {
    const statements: {
        sql: string;
        values: unknown[];
    }[] = [];
    let grant = true;
    const row = { connection_id: b.connectionId, ...{ application_id: b.applicationId, tenant_id: b.tenantId, owner_id: b.ownerId }, account_id: b.accountId, current_generation: 1, generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile', status: 'connected', active: true, integration_id: 'integration', provider_configuration_reference: 'config-v1', provider_api_version: 'v1', authority: 'service', identity_namespace: owner.physicalOwner.namespace, identity_digest: vault.physicalIdentityDigest(owner.physicalOwner), identity_key_version: vault.identityKeyVersion, identity_verified: true, is_default: false, ...(() => { const p = vault.seal(b, 'provider', { providerAccountId: owner.providerAccountId }), m = vault.seal(b, 'metadata', owner); return { encrypted_provider_account_id: p.encrypted, provider_account_key_version: p.keyVersion, provider_account_digest: vault.providerAccountDigest(owner.providerAccountId, p.keyVersion), encrypted_metadata: m.encrypted, metadata_key_version: m.keyVersion, metadata_digest: m.digest }; })() };
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        statements.push({ sql, values });
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
        if (sql.includes('to_regclass'))
            return { rows: [{ ready: true }] };
        if (sql.includes('INSERT INTO communications.access_grants'))
            return { rows: [{ authorized: true }] };
        if (sql.includes('FROM communications.access_grants'))
            return { rows: grant ? [scope].map(s => ({ application_id: s.applicationId, tenant_id: s.tenantId, owner_id: s.ownerId })) : [] };
        if (sql.includes('FROM communications.connections'))
            return { rows: [row] };
        if (sql.startsWith('INSERT INTO communications.connection_defaults')) {
            row.is_default = true;
            return { rows: [{ connection_id: b.connectionId }] };
        }
        return { rows: [] };
    });
    const release = vi.fn(), client = { query, release } as SqlClient;
    const pool = { connect: async () => client };
    const repo = createPostgresAccountRuntime({ pool, vault, applicationId: 'app', integrationId: 'integration', providerConfigurationReference: 'config-v1' });
    return { repo, row, query, release, statements, pool, revoke: () => { grant = false; } };
}
describe('configured account runtime store protocol (scripted SQL)', () => {
    it('requires exact current grant and decrypts original provider plus canonical physical owner', async () => { const f = fixture(); expect(await f.repo.resolve(b)).toMatchObject({ binding: b, owner, active: true, isDefault: false }); expect(f.statements.at(-1)?.sql).toBe('COMMIT'); });
    it('rejects cross-owner binding before SQL', async () => { const f = fixture(); await expect(f.repo.resolve({ ...b, applicationId: 'other' })).rejects.toThrow(); expect(f.query).not.toHaveBeenCalled(); });
    it('cannot list after current grant is revoked', async () => { const f = fixture(); f.revoke(); await expect(f.repo.list(scope)).rejects.toThrow(); expect(f.statements.at(-1)?.sql).toBe('ROLLBACK'); });
    it('trusted signed grant bootstrap is bound to original short token expiry', async () => { const f = fixture(), expiresAt = new Date(Date.now() + 30000).toISOString(); expect(await f.repo.authorizeSignedScope(scope, { expiresAt })).toBe(true); const insert = f.statements.find(q => q.sql.includes('INSERT INTO communications.access_grants'))!; expect(insert.values).toContain(expiresAt); expect(insert.sql).toContain("interval '60 seconds'"); expect(insert.sql).toContain('revoked_at IS NULL'); });
    it('selects exact new-work default without mutating journals or existing bindings', async () => { const f = fixture(); expect((await f.repo.setDefault(scope, b)).isDefault).toBe(true); expect(f.statements.filter(q => q.sql.includes('operation_journal') && /UPDATE|DELETE/.test(q.sql))).toHaveLength(0); });
    it('verifies provider cipher/digest and rejects canonical owner mismatch', async () => { const f = fixture(); f.row.provider_account_digest = createHash('sha256').update('wrong').digest('hex'); await expect(f.repo.resolve(b)).rejects.toThrow(); });
    it('retains exact configured pool and vault callbacks after caller mutates their objects', async () => { const f = fixture(), originalOpen = vault.open; try {
        f.pool.connect = async () => { throw Error('Synthetic replaced pool'); };
        Object.defineProperty(vault, 'open', { value: () => { throw Error('Synthetic replaced vault'); }, configurable: true });
        await expect(f.repo.resolve(b)).resolves.toMatchObject({ binding: b });
    }
    finally {
        Object.defineProperty(vault, 'open', { value: originalOpen, configurable: true, writable: true });
    } });
});
it('rejects accessor-based pool callbacks before executing their getter', () => { let getterCalls = 0; const pool = Object.defineProperty({}, 'connect', { enumerable: true, get() { getterCalls++; return async () => { throw Error('not used'); }; } }); expect(() => createPostgresAccountRuntime({ pool: pool as never, vault, applicationId: 'app', integrationId: 'integration', providerConfigurationReference: 'config-v1' })).toThrow('Invalid account runtime configuration'); expect(getterCalls).toBe(0); });
it('rejects encrypted metadata with invalid typed capabilities instead of exposing it as trusted owner state', async () => { const f = fixture(), bad = structuredClone(owner) as unknown as {
    capabilities: {
        messaging: {
            send: unknown;
        };
    };
}; bad.capabilities.messaging.send = 'yes'; const sealed = vault.seal(b, 'metadata', bad); Object.assign(f.row, { encrypted_metadata: sealed.encrypted, metadata_key_version: sealed.keyVersion, metadata_digest: sealed.digest }); await expect(f.repo.resolve(b)).rejects.toThrow(); });
it('rejects accessor callback payloads without executing getters or touching SQL', async () => { const f = fixture(); let calls = 0; const notification = Object.defineProperty({ capability: 'private', payload: { name: 'a'.repeat(43), account_id: 'provider', status: 'CREATION_SUCCESS' } }, 'nonce', { enumerable: true, get() { calls++; return 'a'.repeat(43); } }); await expect(f.repo.captureSetup(notification as never)).rejects.toThrow(); expect(calls).toBe(0); expect(f.query).not.toHaveBeenCalled(); });
it('exact historical generation never inherits successor active/connected status', async () => { const f = fixture(); f.row.current_generation = 2; const old = await f.repo.resolve(b, false); expect(old).toMatchObject({ binding: b, status: 'disconnected', active: false, isDefault: false }); });

it('partitions pending setup lookup by its server-owned callback origin while retaining old states',async()=>{const f=fixture(),origin='https://127.0.0.1:5891',repo=createPostgresAccountRuntime({pool:f.pool,vault,applicationId:'app',integrationId:'demo',providerConfigurationReference:'demo-v1',setupRedirectOrigin:origin}as never);await repo.lookupSetup('A'.repeat(43));await repo.pendingSetup(scope);const lookup=f.statements.find(x=>x.sql.includes('FROM communications.auth_states WHERE state_digest'));expect(lookup?.sql).toContain('redirect_origin=$2');expect(lookup?.values).toEqual([createHash('sha256').update('A'.repeat(43)).digest('hex'),origin]);const pending=f.statements.find(x=>x.sql.includes('FROM communications.setup_notification_inbox'));expect(pending?.sql).toContain('a.redirect_origin=$4');expect(pending?.values).toEqual(['app','tenant','owner',origin]);expect(f.statements.some(x=>/DELETE|UPDATE communications.auth_states/.test(x.sql))).toBe(false);});

it('retires prior coverage before advancing a verified reconnect generation without rewriting encrypted evidence',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(sql,values=[])=>sql.includes('FROM communications.physical_accounts WHERE identity_namespace')?{rows:[{id:b.accountId,identity_namespace:owner.physicalOwner.namespace,identity_digest:vault.physicalIdentityDigest(owner.physicalOwner),identity_key_version:vault.identityKeyVersion}]}:original(sql,values));
 const state={scope,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const,redirectOrigin:'https://app.example.test',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),expectedConnectionId:b.connectionId,expectedGeneration:2,reconnectBinding:b};
 expect(await f.repo.bindVerified(await f.pool.connect(),state,owner)).toEqual({...b,generation:2});
 const invalidation=f.statements.findIndex(c=>c.sql.startsWith('UPDATE communications.event_cursors'));
 const advance=f.statements.findIndex(c=>c.sql.startsWith('UPDATE communications.connections SET current_generation'));
 expect(invalidation).toBeGreaterThanOrEqual(0);expect(invalidation).toBeLessThan(advance);
 const sql=f.statements[invalidation].sql;expect(sql).toContain('complete=false');expect(sql).toContain('initial_sync_complete=false');expect(sql).toContain('invalidated=true');expect(sql).not.toContain('lease_token=');expect(sql).not.toContain('lease_until=');expect(sql).not.toContain('encrypted_cursor=');
 expect(f.statements[invalidation].values).toEqual([b.connectionId,b.applicationId,b.tenantId,b.ownerId,b.accountId,b.generation]);
});
it('local sync epoch uses an original consumed and processed setup and never treats an expired pending state as success',async()=>{const f=fixture(),nonce='A'.repeat(43),state={state_digest:createHash('sha256').update(nonce).digest('hex'),application_id:'app',tenant_id:'tenant',owner_id:'owner',channel:'whatsapp',platform:'whatsapp',backend:'unipile',redirect_origin:'https://127.0.0.1:5991',reconnect_connection_id:'connection',reconnect_generation:1,expires_at:'2000-01-01T00:00:00.000Z',consumed_at:'2000-01-01T00:00:00.000Z',processed_at:'2000-01-01T00:00:00.000Z'},pending={...b,connectionId:'connection',accountId:'pending-'+createHash('sha256').update(nonce).digest('hex'),generation:2,channel:'whatsapp' as const,platform:'whatsapp' as const},notification={nonce,capability:'original-capability',payload:{name:nonce,account_id:'provider',status:'RECONNECTED'}},sealed=vault.seal(pending,'notification',notification),query=vi.fn(async(sql:string)=>({rows:sql.includes('setup_notification_inbox')?[{...state,encrypted_notification:sealed.encrypted,key_version:sealed.keyVersion,payload_digest:sealed.digest}]:sql.includes('FROM communications.connections')?[{account_id:'physical',provider_account_digest:vault.providerAccountDigest('provider',vault.keyVersion),provider_account_key_version:vault.keyVersion}]:[]})),client={query,release:vi.fn()}as SqlClient;
 expect(await f.repo.verifyLocalSyncEpoch(client,nonce,'provider')).toEqual({...pending,accountId:'physical'});state.consumed_at=null as never;await expect(f.repo.verifyLocalSyncEpoch(client,nonce,'provider')).rejects.toThrow();expect(query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
});
