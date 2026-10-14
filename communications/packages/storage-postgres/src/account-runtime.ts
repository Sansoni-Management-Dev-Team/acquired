import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { assertSameBinding, type AccessScope, type Channel, type ConnectionBinding, type ConnectionStatus, type Platform, type OperationSnapshot, type CanonicalIdentity, type SubmissionReceipt } from '../../contracts/src';
import type { AuthStateSnapshot } from './auth-state-repository';
import type { SqlClient, SqlPool } from './webhook-repository';
import { parseVerifiedV1Owner, type VerifiedUnipileOwner } from '../../adapter-unipile/src/v1-owner';
import type { AccountRuntimeVault } from './account-vault';
import { runtimeTransaction } from './runtime-sql';
export interface RuntimeConnection {
    binding: ConnectionBinding;
    owner: VerifiedUnipileOwner;
    status: ConnectionStatus;
    active: boolean;
    isDefault: boolean;
}
export interface SetupStateRoute {
    scope: AccessScope;
    channel: Channel;
    platform: Platform;
    expiresAt: string;
    binding: ConnectionBinding;
    reconnect: boolean;
}
export interface SetupNotification {
    nonce: string;
    capability: string;
    payload: {
        status: 'CREATION_SUCCESS' | 'RECONNECTED';
        account_id: string;
        name: string;
    };
}
export interface AccountRuntimeRepositoryOptions {
    pool: SqlPool;
    vault: AccountRuntimeVault;
    applicationId: string;
    integrationId: string;
    providerConfigurationReference: string;
    timeoutMs?: number;
}
export interface AccountRuntimeRepository {
    preflight(): Promise<boolean>;
    authorizeSignedScope(scope: AccessScope, input: {
        expiresAt: string;
    }): Promise<boolean>;
    requireGrant(scope: AccessScope): Promise<void>;
    lookupSetup(nonce: string): Promise<SetupStateRoute | null>;
    captureSetup(notification: SetupNotification): Promise<'captured' | 'duplicate'>;
    pendingSetup(scope: AccessScope): Promise<SetupNotification[]>;
    finishSetup(nonce: string): Promise<void>;
    bindVerified(client: SqlClient, state: Readonly<AuthStateSnapshot>, owner: VerifiedUnipileOwner): Promise<ConnectionBinding>;
    list(scope: AccessScope): Promise<RuntimeConnection[]>;
    resolve(binding: ConnectionBinding, current?: boolean): Promise<RuntimeConnection | null>;
    observe(binding: ConnectionBinding, owner: VerifiedUnipileOwner): Promise<RuntimeConnection>;
    setDefault(scope: AccessScope, binding: ConnectionBinding): Promise<RuntimeConnection>;
    originalContext(snapshot: OperationSnapshot): Promise<{
        recipient: CanonicalIdentity;
        conversation?: {
            binding: ConnectionBinding;
            id: string;
        };
        rfcMessageId?: string;
        message?: {
            binding: ConnectionBinding;
            id: string;
        };
    }>;
    originalReceipt(snapshot: OperationSnapshot): Promise<SubmissionReceipt | null>;
    trackingSnapshot(providerAccountId: string, trackingId: string): Promise<OperationSnapshot | null>;
}
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'];
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
function fail(): never { throw Error('Account runtime unavailable'); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    if (types.isPromise(value)) {
        void Promise.prototype.then.call(value, undefined, () => { });
        fail();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        fail();
    const d = Object.getOwnPropertyDescriptors(value);
    if (required.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k) || !('value' in d[k])))
        fail();
    for (const v of Object.values(d))
        if (types.isPromise(v.value)) {
            void Promise.prototype.then.call(v.value, undefined, () => { });
            fail();
        }
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value]));
}
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function createPostgresAccountRuntime(options: AccountRuntimeRepositoryOptions): AccountRuntimeRepository {
    let application: string, integration: string, configuration: string, timeout: number, pool: SqlPool, vault: Pick<AccountRuntimeVault, 'open' | 'seal' | 'journal' | 'keyVersion' | 'identityKeyVersion' | 'physicalIdentityDigest' | 'providerAccountDigest' | 'versions' | 'trackingDigest'>;
    try {
        const o = object(options, ['pool', 'vault', 'applicationId', 'integrationId', 'providerConfigurationReference'], ['timeoutMs']);
        application = o.applicationId as string;
        integration = o.integrationId as string;
        configuration = o.providerConfigurationReference as string;
        timeout = (o.timeoutMs ?? 20000) as number;
        pool = o.pool as SqlPool;
        vault = o.vault as AccountRuntimeVault;
        if (!id(application) || !id(integration) || !id(configuration, 2000) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 25000 || types.isProxy(pool) || types.isProxy(vault))
            fail();
        function method(port: object, name: string): (...args: never[]) => unknown { let cursor: object | null = port; for (let i = 0; cursor && i < 8; i++, cursor = Object.getPrototypeOf(cursor)) {
            if (types.isProxy(cursor))
                fail();
            const d = Object.getOwnPropertyDescriptor(cursor, name);
            if (d) {
                if (!('value' in d) || typeof d.value !== 'function' || types.isProxy(d.value))
                    fail();
                return Function.prototype.bind.call(d.value, port);
            }
        } return fail(); }
        const originalPool = pool, originalVault = vault;
        pool = Object.freeze({ connect: method(originalPool, 'connect') as SqlPool['connect'] });
        const codec = originalVault.journal;
        if (!codec || types.isProxy(codec))
            fail();
        const journal = Object.freeze({ keyVersion: codec.keyVersion, encode: method(codec, 'encode') as typeof codec.encode, decode: method(codec, 'decode') as typeof codec.decode, digest: method(codec, 'digest') as typeof codec.digest });
        vault = Object.freeze({ journal, keyVersion: originalVault.keyVersion, identityKeyVersion: originalVault.identityKeyVersion, open: method(originalVault, 'open') as typeof originalVault.open, seal: method(originalVault, 'seal') as typeof originalVault.seal, physicalIdentityDigest: method(originalVault, 'physicalIdentityDigest') as typeof originalVault.physicalIdentityDigest, providerAccountDigest: method(originalVault, 'providerAccountDigest') as typeof originalVault.providerAccountDigest, versions: method(originalVault, 'versions') as typeof originalVault.versions, trackingDigest: method(originalVault, 'trackingDigest') as typeof originalVault.trackingDigest });
    }
    catch {
        throw Error('Invalid account runtime configuration');
    }
    function scope(input: unknown): AccessScope {
        const s = object(input, ['applicationId', 'tenantId', 'ownerId']);
        if (s.applicationId !== application || !id(s.tenantId) || !id(s.ownerId))
            fail();
        return s as unknown as AccessScope;
    }
    function binding(input: unknown): ConnectionBinding {
        const b = object(input, fields) as unknown as ConnectionBinding;
        scope({ applicationId: b.applicationId, tenantId: b.tenantId, ownerId: b.ownerId });
        assertSameBinding(b, b);
        if (b.backend !== 'unipile')
            fail();
        return structuredClone(b);
    }
    const values = (s: AccessScope) => [s.applicationId, s.tenantId, s.ownerId];
    async function grant(c: SqlClient, s: AccessScope) {
        const r = await c.query('SELECT application_id,tenant_id,owner_id FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', values(s));
        if (r.rows.length !== 1 || r.rows[0].application_id !== s.applicationId || r.rows[0].tenant_id !== s.tenantId || r.rows[0].owner_id !== s.ownerId)
            fail();
    }
    const tx = <T>(s: AccessScope | undefined, work: (c: SqlClient) => Promise<T>, mutating = false) => runtimeTransaction(pool, timeout, async (c) => {
        if (s && mutating)
            await tenant(c, s);
        if (s)
            await grant(c, s);
        const result = await work(c);
        if (s)
            await grant(c, s);
        return result;
    });
    const columns = `c.id AS connection_id,c.application_id,c.tenant_id,c.owner_id,c.current_generation,c.status,c.active,g.generation,g.account_id,g.channel,g.platform,g.backend,g.integration_id,g.provider_api_version,g.provider_configuration_reference,g.authority,g.encrypted_provider_account_id,g.provider_account_key_version,g.provider_account_digest,p.identity_namespace,p.identity_digest,p.identity_key_version,(p.verified_at IS NOT NULL AND p.verified_at<=clock_timestamp()) AS identity_verified,m.encrypted_metadata,m.metadata_key_version,m.metadata_digest,EXISTS(SELECT 1 FROM communications.connection_defaults d WHERE d.application_id=c.application_id AND d.tenant_id=c.tenant_id AND d.owner_id=c.owner_id AND d.channel=c.channel AND d.connection_id=c.id AND d.generation=g.generation) AS is_default`;
    function parsed(row: Record<string, unknown>): RuntimeConnection {
        const b = binding({ applicationId: row.application_id, tenantId: row.tenant_id, ownerId: row.owner_id, connectionId: row.connection_id, accountId: row.account_id, generation: row.generation, channel: row.channel, platform: row.platform, backend: row.backend });
        if (row.integration_id !== integration || row.provider_api_version !== 'v1' || row.provider_configuration_reference !== configuration || row.authority !== 'service' || row.identity_verified !== true || typeof row.encrypted_metadata !== 'string' || typeof row.metadata_key_version !== 'string' || typeof row.metadata_digest !== 'string')
            fail();
        const metadata = parseVerifiedV1Owner(vault.open(b, 'metadata', { encrypted: row.encrypted_metadata, keyVersion: row.metadata_key_version, digest: row.metadata_digest }));
        const provider = vault.open(b, 'provider', { encrypted: row.encrypted_provider_account_id as string, keyVersion: row.provider_account_key_version as string, digest: '' }) as {
            providerAccountId: string;
        };
        return { binding: b, owner: metadata, status: row.current_generation === b.generation ? row.status as ConnectionStatus : 'disconnected', active: row.current_generation === b.generation && row.active === true, isDefault: row.current_generation === b.generation && row.is_default === true, ...(() => {
                if (metadata.providerAccountId !== provider.providerAccountId || metadata.platform !== b.platform || metadata.physicalOwner.namespace !== row.identity_namespace || vault.physicalIdentityDigest(metadata.physicalOwner, row.identity_key_version as string) !== row.identity_digest || vault.providerAccountDigest(provider.providerAccountId, row.provider_account_key_version as string) !== row.provider_account_digest || !['connecting', 'connected', 'syncing', 'verification_required', 'disconnected', 'failed'].includes(row.status as string) || typeof row.active !== 'boolean' || typeof row.is_default !== 'boolean')
                    fail();
                return {};
            })() };
    }
    // Generation stores an independent provider-ID digest, not the scoped envelope replay digest.
    async function read(c: SqlClient, b: ConnectionBinding, current: boolean, lock = false) {
        const rows = await c.query(`SELECT ${columns} FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=$5 JOIN communications.physical_accounts p ON p.id=g.account_id JOIN communications.account_runtime_metadata m ON m.connection_id=g.connection_id AND m.generation=g.generation WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 ${current ? 'AND c.current_generation=g.generation' : ''} ${lock ? 'FOR UPDATE OF c FOR SHARE OF g,m,p' : ''}`, [...values(b), b.connectionId, b.generation]);
        if (rows.rows.length > 1)
            fail();
        return rows.rows.length ? parsed(rows.rows[0]) : null;
    }
    async function tenant(c: SqlClient, s: AccessScope) { await c.query('SELECT communications.lock_reply_barrier($1,$2)', [s.applicationId, s.tenantId]); }
    function setupRow(row: Record<string, unknown>, digest: string): SetupStateRoute {
        const s = scope({ applicationId: row.application_id, tenantId: row.tenant_id, ownerId: row.owner_id });
        if (row.backend !== 'unipile' || typeof row.expires_at !== 'string' && !(row.expires_at instanceof Date))
            fail();
        const channel = row.channel as Channel, platform = row.platform as Platform, connectionId = row.reconnect_connection_id === null ? `auth-${hash(JSON.stringify(['communications.auth.connection.v1', digest, ...values(s), channel, platform, 'unipile']))}` : row.reconnect_connection_id as string;
        return { scope: s, channel, platform, expiresAt: new Date(row.expires_at as string).toISOString(), binding: { ...s, connectionId, accountId: `pending-${digest}`, generation: row.reconnect_generation === null ? 1 : Number(row.reconnect_generation) + 1, channel, platform, backend: 'unipile' }, reconnect: row.reconnect_connection_id !== null };
    }
    async function setup(c: SqlClient, nonce: string, lock = false) {
        const r = await c.query('SELECT state_digest,application_id,tenant_id,owner_id,channel,platform,backend,reconnect_connection_id,reconnect_generation,expires_at,(expires_at>clock_timestamp()) AS alive FROM communications.auth_states WHERE state_digest=$1 ' + (lock ? 'FOR UPDATE' : 'FOR SHARE'), [hash(nonce)]);
        if (r.rows.length > 1)
            fail();
        return r.rows[0];
    }
    return {
        async preflight() {
            try {
                return await tx(undefined, async (c) => { const rows = await c.query("SELECT to_regclass('communications.account_runtime_metadata') IS NOT NULL AND to_regclass('communications.connection_defaults') IS NOT NULL AND to_regclass('communications.setup_notification_inbox') IS NOT NULL AND to_regclass('communications.connection_retirements') IS NOT NULL AND to_regclass('communications.email_tracking_associations') IS NOT NULL AND to_regclass('communications.provider_webhook_spool') IS NOT NULL AS ready"); return rows.rows.length === 1 && rows.rows[0].ready === true; });
            }
            catch {
                return false;
            }
        },
        async authorizeSignedScope(input, expiry) {
            const s = scope(input), e = object(expiry, ['expiresAt']);
            if (typeof e.expiresAt !== 'string' || !Number.isFinite(Date.parse(e.expiresAt)))
                return false;
            return tx(undefined, async (c) => { const r = await c.query(`INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) SELECT $1,$2,$3,$4::timestamptz WHERE $4::timestamptz>clock_timestamp() AND $4::timestamptz<=clock_timestamp()+interval '60 seconds' ON CONFLICT(application_id,tenant_id,owner_id) DO UPDATE SET expires_at=CASE WHEN communications.access_grants.expires_at>clock_timestamp()+interval '60 seconds' THEN EXCLUDED.expires_at ELSE GREATEST(communications.access_grants.expires_at,EXCLUDED.expires_at) END WHERE communications.access_grants.revoked_at IS NULL RETURNING true AS authorized`, [...values(s), e.expiresAt]); return r.rows.length === 1 && r.rows[0].authorized === true; });
        },
        async requireGrant(input) { const s = scope(input); await tx(s, async () => { }); },
        async lookupSetup(nonce) {
            if (!/^[A-Za-z0-9_-]{43}$/.test(nonce))
                return null;
            return tx(undefined, async (c) => { const row = await setup(c, nonce); return row ? setupRow(row, hash(nonce)) : null; });
        },
        async captureSetup(notification) {
            const raw = object(notification, ['nonce', 'capability', 'payload']), payload = object(raw.payload, ['name', 'account_id', 'status']);
            if (!id(raw.capability, 128) || !id(payload.account_id, 2048) || !['CREATION_SUCCESS', 'RECONNECTED'].includes(payload.status as string))
                fail();
            const copy = structuredClone({ ...raw, payload }) as unknown as SetupNotification, nonce = copy.nonce;
            if (!/^[A-Za-z0-9_-]{43}$/.test(nonce) || copy.payload.name !== nonce)
                fail();
            return tx(undefined, async (c) => {
                const row = await setup(c, nonce, true);
                if (!row || row.alive !== true)
                    fail();
                const route = setupRow(row, hash(nonce));
                if (copy.payload.status !== (route.reconnect ? 'RECONNECTED' : 'CREATION_SUCCESS'))
                    fail();
                const sealed = vault.seal(route.binding, 'notification', copy), existing = await c.query('SELECT encrypted_notification,key_version,payload_digest FROM communications.setup_notification_inbox WHERE state_digest=$1 FOR UPDATE', [hash(nonce)]);
                if (existing.rows.length) {
                    const old = existing.rows[0];
                    const known = vault.open(route.binding, 'notification', { encrypted: old.encrypted_notification as string, keyVersion: old.key_version as string, digest: old.payload_digest as string });
                    if (!isDeepStrictEqual(known, copy))
                        fail();
                    return 'duplicate';
                }
                await c.query('INSERT INTO communications.setup_notification_inbox(state_digest,encrypted_notification,key_version,payload_digest) VALUES($1,$2,$3,$4)', [hash(nonce), sealed.encrypted, sealed.keyVersion, sealed.digest]);
                return 'captured';
            });
        },
        async pendingSetup(input) { const s = scope(input); return tx(s, async (c) => { const r = await c.query(`SELECT a.state_digest,a.application_id,a.tenant_id,a.owner_id,a.channel,a.platform,a.backend,a.reconnect_connection_id,a.reconnect_generation,a.expires_at,n.encrypted_notification,n.key_version,n.payload_digest FROM communications.setup_notification_inbox n JOIN communications.auth_states a ON a.state_digest=n.state_digest WHERE a.application_id=$1 AND a.tenant_id=$2 AND a.owner_id=$3 AND n.processed_at IS NULL AND a.expires_at>clock_timestamp() ORDER BY n.created_at LIMIT 5`, values(s)); return r.rows.map(row => vault.open(setupRow(row, row.state_digest as string).binding, 'notification', { encrypted: row.encrypted_notification as string, keyVersion: row.key_version as string, digest: row.payload_digest as string }) as SetupNotification); }); },
        async finishSetup(nonce) { await tx(undefined, async (c) => { await c.query('UPDATE communications.setup_notification_inbox SET processed_at=clock_timestamp() WHERE state_digest=$1 AND processed_at IS NULL AND EXISTS(SELECT 1 FROM communications.auth_states a WHERE a.state_digest=communications.setup_notification_inbox.state_digest AND a.consumed_at IS NOT NULL)', [hash(nonce)]); }); },
        async bindVerified(c, state, input) {
            const owner = parseVerifiedV1Owner(input), s = scope(state.scope);
            if (owner.platform !== state.platform || state.backend !== 'unipile' || !id(owner.providerAccountId, 2048) || !id(owner.sourceId, 2048))
                fail();
            await tenant(c, s);
            const physicalDigest = vault.physicalIdentityDigest(owner.physicalOwner);
            await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [physicalDigest]);
            const physical = await c.query('SELECT id,identity_namespace,identity_digest,identity_key_version FROM communications.physical_accounts WHERE identity_namespace=$1 AND identity_digest=$2 FOR UPDATE', [owner.physicalOwner.namespace, physicalDigest]);
            if (physical.rows.length > 1)
                fail();
            const accountId = physical.rows.length ? physical.rows[0].id as string : `physical-${physicalDigest}`;
            if (state.reconnectBinding) {
                const old = await read(c, state.reconnectBinding, true, true);
                if (!old || old.binding.accountId !== accountId || old.owner.providerAccountId !== owner.providerAccountId || !isDeepStrictEqual(old.owner.physicalOwner, owner.physicalOwner) || !isDeepStrictEqual(old.owner.providerOwner, owner.providerOwner))
                    fail();
            }
            const unresolved = await c.query("SELECT 1 FROM communications.connection_retirements WHERE account_id=$1 AND state<>'disconnected' LIMIT 1", [accountId]);
            if (unresolved.rows.length)
                fail();
            if (!physical.rows.length)
                await c.query('INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())', [accountId, state.channel, owner.physicalOwner.namespace, physicalDigest, vault.identityKeyVersion]);
            const b: ConnectionBinding = { ...s, connectionId: state.expectedConnectionId, accountId, generation: state.expectedGeneration, channel: state.channel, platform: state.platform, backend: 'unipile' };
            assertSameBinding(b, b);
            if (!state.reconnectBinding)
                await c.query('INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)', [b.connectionId, ...values(s), accountId, b.channel, b.platform, b.backend, b.generation, owner.status]);
            const provider = vault.seal(b, 'provider', { providerAccountId: owner.providerAccountId }), metadata = vault.seal(b, 'metadata', owner);
            await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,provider_account_digest,encrypted_provider_account_id,provider_account_key_version,authority,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'unipile',$9,'v1',$10,$11,$12,$13,'service',$14::jsonb)", [b.connectionId, b.generation, ...values(s), accountId, b.channel, b.platform, integration, configuration, vault.providerAccountDigest(owner.providerAccountId, provider.keyVersion), provider.encrypted, provider.keyVersion, JSON.stringify(owner.capabilities)]);
            await c.query('INSERT INTO communications.account_runtime_metadata(connection_id,generation,encrypted_metadata,metadata_key_version,metadata_digest) VALUES($1,$2,$3,$4,$5)', [b.connectionId, b.generation, metadata.encrypted, metadata.keyVersion, metadata.digest]);
            for (const alias of owner.aliases) {
                const namespace = alias.kind === 'email' ? 'email_address' : alias.kind === 'phone' ? 'e164' : 'linkedin_profile', digest = vault.physicalIdentityDigest({ namespace, value: alias.value }), encrypted = vault.seal(b, 'alias', { identity: owner.canonicalIdentity, namespace, value: alias.value });
                await c.query('INSERT INTO communications.identity_aliases(application_id,tenant_id,owner_id,connection_id,generation,account_id,namespace,alias_digest,canonical_kind,canonical_digest,encrypted_identity,key_version,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp())', [...values(s), b.connectionId, b.generation, b.accountId, namespace, digest, owner.canonicalIdentity.kind, vault.physicalIdentityDigest({ namespace: owner.canonicalIdentity.kind, value: owner.canonicalIdentity.value }), encrypted.encrypted, encrypted.keyVersion]);
            }
            await c.query('UPDATE communications.connections SET current_generation=$2,account_id=$3,status=$4,status_observed_at=clock_timestamp(),active=true WHERE id=$1', [b.connectionId, b.generation, b.accountId, owner.status]);
            return b;
        },
        async list(input) { const s = scope(input); return tx(s, async (c) => { const r = await c.query(`SELECT ${columns} FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation JOIN communications.physical_accounts p ON p.id=g.account_id JOIN communications.account_runtime_metadata m ON m.connection_id=g.connection_id AND m.generation=g.generation WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND g.integration_id=$4 AND g.provider_configuration_reference=$5 ORDER BY c.created_at LIMIT 100`, [...values(s), integration, configuration]); return r.rows.map(parsed); }); },
        async resolve(input, current = true) { const b = binding(input); return tx(b, c => read(c, b, current)); },
        async observe(input, owner) {
            const b = binding(input);
            return tx(b, async (c) => {
                const current = await read(c, b, true, true);
                if (!current || !isDeepStrictEqual(current.owner.providerOwner, owner.providerOwner) || !isDeepStrictEqual(current.owner.physicalOwner, owner.physicalOwner) || current.owner.sourceId !== owner.sourceId || current.owner.providerAccountId !== owner.providerAccountId)
                    fail();
                await c.query('UPDATE communications.connections SET status=$2,status_observed_at=clock_timestamp() WHERE id=$1 AND current_generation=$3', [b.connectionId, owner.status, b.generation]);
                return { ...current, status: owner.status };
            }, true);
        },
        async setDefault(input, requested) {
            const s = scope(input), b = binding(requested);
            if (!isDeepStrictEqual(s, { applicationId: b.applicationId, tenantId: b.tenantId, ownerId: b.ownerId }))
                fail();
            return tx(s, async (c) => {
                const current = await read(c, b, true, true);
                if (!current || !current.active || current.status !== 'connected')
                    fail();
                await c.query('INSERT INTO communications.connection_defaults(application_id,tenant_id,owner_id,channel,connection_id,generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(application_id,tenant_id,owner_id,channel) DO UPDATE SET connection_id=EXCLUDED.connection_id,generation=EXCLUDED.generation,updated_at=clock_timestamp() RETURNING connection_id', [...values(s), b.channel, b.connectionId, b.generation]);
                return { ...current, isDefault: true };
            }, true);
        },
        async originalContext(input) {
            const raw = object(input, ['binding', 'key', 'operation', 'payloadDigest']);
            if (!id(raw.key) || !['message', 'invitation'].includes(raw.operation as string) || typeof raw.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.payloadDigest))
                fail();
            const snapshot = { ...raw, binding: binding(raw.binding) } as unknown as OperationSnapshot, b = snapshot.binding;
            return tx(b, async (c) => {
                const r = await c.query('SELECT encrypted_operation_context,operation_context_key_version,operation_context_digest,recipient_digest,recipient_key_version,payload_digest,connection_id,generation,account_id FROM communications.operation_journal WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4', [...values(b), snapshot.key]);
                const row = r.rows[0];
                if (r.rows.length !== 1 || row.payload_digest !== snapshot.payloadDigest || row.connection_id !== b.connectionId || row.generation !== b.generation || row.account_id !== b.accountId)
                    fail();
                const decoded = vault.journal.decode(snapshot, 'context', JSON.parse(row.encrypted_operation_context as string));
                if (vault.journal.digest(snapshot, 'context', decoded, row.operation_context_key_version as string) !== row.operation_context_digest)
                    fail();
                const ctx = object(decoded, ['recipient'], ['conversation', 'message', 'rfcMessageId']), recipient = object(ctx.recipient, ['kind', 'value']);
                if (!['email', 'phone', 'linkedin_profile'].includes(recipient.kind as string) || !id(recipient.value, 4096) || vault.physicalIdentityDigest({ namespace: recipient.kind as string, value: recipient.value as string }, row.recipient_key_version as string) !== row.recipient_digest)
                    fail();
                return ctx as unknown as Awaited<ReturnType<AccountRuntimeRepository['originalContext']>>;
            });
        },
        async originalReceipt(input) {
            const raw = object(input, ['binding', 'key', 'operation', 'payloadDigest']);
            if (!id(raw.key) || !['message', 'invitation'].includes(raw.operation as string) || typeof raw.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.payloadDigest))
                fail();
            const snapshot = { ...raw, binding: binding(raw.binding) } as unknown as OperationSnapshot, b = snapshot.binding;
            return tx(b, async (c) => {
                const r = await c.query('SELECT payload_digest,connection_id,generation,account_id,state,encrypted_receipt,receipt_key_version FROM communications.operation_journal WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4', [...values(b), snapshot.key]);
                const row = r.rows[0];
                if (r.rows.length !== 1 || row.payload_digest !== snapshot.payloadDigest || row.connection_id !== b.connectionId || row.generation !== b.generation || row.account_id !== b.accountId)
                    fail();
                if (row.state !== 'submitted')
                    return null;
                const receipt = vault.journal.decode(snapshot, 'receipt', JSON.parse(row.encrypted_receipt as string)) as SubmissionReceipt;
                const ref = 'message' in receipt ? receipt.message : receipt.operation;
                if (!ref?.binding)
                    fail();
                assertSameBinding(b, ref.binding);
                return receipt;
            });
        },
        async trackingSnapshot(providerAccountId, trackingId) {
            const digests = vault.versions().map(v => vault.trackingDigest({ integrationId: integration, providerConfigurationReference: configuration, providerAccountId, trackingId }, v));
            return tx(undefined, async (c) => {
                const r = await c.query(`SELECT j.application_id,j.tenant_id,j.owner_id,j.connection_id,j.generation,j.account_id,j.operation_key,j.payload_digest,g.channel,g.platform,g.backend FROM communications.email_tracking_acknowledgements a JOIN communications.operation_journal j ON j.id=a.journal_id JOIN communications.connection_generations g ON g.connection_id=j.connection_id AND g.generation=j.generation JOIN communications.access_grants ag ON ag.application_id=j.application_id AND ag.tenant_id=j.tenant_id AND ag.owner_id=j.owner_id WHERE a.integration_id=$1 AND a.provider_configuration_reference=$2 AND a.tracking_digest=ANY($3::text[]) AND ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp()`, [integration, configuration, digests]);
                if (r.rows.length > 1)
                    fail();
                if (!r.rows.length)
                    return null;
                const row = r.rows[0], b = binding({ applicationId: row.application_id, tenantId: row.tenant_id, ownerId: row.owner_id, connectionId: row.connection_id, accountId: row.account_id, generation: row.generation, channel: row.channel, platform: row.platform, backend: row.backend });
                await grant(c, b);
                return { binding: b, key: row.operation_key as string, payloadDigest: row.payload_digest as string, operation: 'message' };
            });
        }
    };
}
