import { it, expect, vi } from 'vitest';
import type { ConfiguredUnipileV1Runtime } from './v1-runtime';
import { createConfiguredUnipileV1History } from './v1-history-runtime';
import { HistoryCheckpointCodec } from '../../storage-postgres/src/history-checkpoint-codec';
import { EventCodec } from '../../core/src/event-codec';
import { WebhookCodec } from '../../core/src/webhook-codec';
import { JournalCodec } from '../../core/src/journal-codec';
import type { ConnectionBinding } from '../../contracts/src';
const b: ConnectionBinding = { applicationId: 'a', tenantId: 't', ownerId: 'o', connectionId: 'c', accountId: 'p', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' };
it('builds concrete per-generation history/read relationships with retained owner and same runtime journal keys', async () => {
    const owner = { platform: 'linkedin', providerAccountId: 'provider', sourceId: 'classic', providerOwner: { namespace: 'unipile.v1.linkedin.im.id', value: 'owner' }, physicalOwner: { namespace: 'linkedin_member', value: 'owner' }, canonicalIdentity: { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/owner/' }, aliases: [], status: 'connected', capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false } } }, record = { binding: b, providerAccountId: 'provider', sourceId: 'classic', ownerIdentity: owner.providerOwner }, codec = new HistoryCheckpointCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 41), digestKey: Buffer.alloc(32, 42) }] }), eventCodec = new EventCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 43), digestKey: Buffer.alloc(32, 44) }] }), captureCodec = new WebhookCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 45), digestKey: Buffer.alloc(32, 46) }] }), journal = new JournalCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 47), digestKey: Buffer.alloc(32, 48) }] });
    const runtime = { store: { resolve: vi.fn(async () => ({ binding: b, owner, status: 'connected', active: true, isDefault: true })) }, resolveCurrent: vi.fn(async () => record), dispatchOptions: vi.fn(async () => ({ integrationId: 'integration', providerConfigurationReference: 'config', codec: journal, recipientDigest: { keyVersion: 'v1', digest: () => 'f'.repeat(64) } })), providerAccountDigests: vi.fn(async () => ['a'.repeat(64)]), providerFactory: vi.fn() } as unknown as ConfiguredUnipileV1Runtime;
    const result = await createConfiguredUnipileV1History({ binding: b, runtime, pool: { connect: vi.fn() }, provider: { apiVersion: 'v1', baseUrl: 'https://fixture.invalid/api/v1', apiKey: 'synthetic-only' }, integrationId: 'integration', providerConfigurationReference: 'config', subscriberId: 'subscriber', codec, eventCodec, captureCodec, product: 'classic', expectedSyncProduct: 'classic' });
    expect(result).toMatchObject({ repository: { assertCoverage: expect.any(Function), recordInitialSync: expect.any(Function) }, refresh: expect.any(Function), relationships: { inspect: expect.any(Function), lookupInvitation: expect.any(Function) } });
    expect(runtime.dispatchOptions).toHaveBeenCalledWith(b);
});
it('configured Gmail empty original-source scan can commit a query baseline with real owner reads and no status-OK shortcut', async () => {
    const binding: ConnectionBinding = { ...b, channel: 'email', platform: 'gmail' }, canonicalIdentity = { kind: 'email' as const, value: 'owner@example.com' }, owner = { platform: 'gmail' as const, providerAccountId: 'provider', sourceId: 'mail', providerOwner: { namespace: 'unipile.v1.google.mail.id', value: 'opaque-owner' }, physicalOwner: { namespace: 'mailbox_address' as const, value: 'owner@example.com' }, canonicalIdentity, aliases: [canonicalIdentity], status: 'connected' as const, capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false } } }, record = { binding, providerAccountId: 'provider', sourceId: 'mail', ownerIdentity: owner.providerOwner }, startedAt = new Date().toISOString();
    let tokenHash: string;
    const queries: string[] = [];
    const client = { release: vi.fn(), query: vi.fn(async (sql: string, values?: unknown[]) => {
            queries.push(sql);
            if (sql.includes('pg_roles'))
                return { rows: [{ role: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
            if (sql.includes('lock_reply_barrier'))
                return { rows: [{ revision: '0' }] };
            if (sql.includes('advance_reply_barrier'))
                return { rows: [{ revision: '1' }] };
            if (sql.includes('physical_valid'))
                return { rows: [{ physical_valid: true }] };
            if (sql.includes('JOIN communications.access_grants'))
                return { rows: [{ valid: true }] };
            if (sql.includes('grant_valid'))
                return { rows: [{ grant_valid: true }] };
            if (sql.includes('INSERT INTO communications.history_refreshes')) {
                tokenHash = values![8] as string;
                return { rows: [{ started_at: startedAt }] };
            }
            if (sql.includes('SELECT token_hash'))
                return { rows: [{ token_hash: tokenHash!, required_since: new Date(Date.parse(startedAt) - 60000).toISOString(), capture_revision: '0', started_at: startedAt, alive: true, observed_valid: true }] };
            return { rows: [], rowCount: 1 };
        }) };
    const runtime = { store: { resolve: async () => ({ binding, owner, status: 'connected', active: true, isDefault: true }) }, resolveCurrent: async () => record, dispatchOptions: async () => ({ integrationId: 'integration', providerConfigurationReference: 'config', codec: new JournalCodec({ activeVersion: 'j', keys: [{ version: 'j', encryptionKey: Buffer.alloc(32, 61), digestKey: Buffer.alloc(32, 62) }] }), recipientDigest: { keyVersion: 'j', digest: () => 'a'.repeat(64) } }), providerAccountDigests: async () => ['a'.repeat(64)] } as unknown as ConfiguredUnipileV1Runtime;
    const fetch = vi.fn(async (input: URL | RequestInfo, request?: RequestInit) => {
        expect(request?.method).toBe('GET');
        const url = new URL(String(input));
        if (url.pathname.endsWith('/accounts/provider'))
            return new Response(JSON.stringify({ object: 'Account', id: 'provider', type: 'GOOGLE_OAUTH', connection_params: { mail: { id: 'opaque-owner' } }, sources: [{ id: 'mail', status: 'OK' }] }));
        if (url.pathname.endsWith('/users/me'))
            return new Response(JSON.stringify({ object: 'AccountOwnerProfile', provider: 'GMAIL', email: 'owner@example.com', aliases: [] }));
        if (url.pathname.endsWith('/emails'))
            return new Response(JSON.stringify({ object: 'EmailList', items: [], cursor: null }));
        throw Error('Unexpected HTTP');
    });
    const factory = await createConfiguredUnipileV1History({ binding, runtime, pool: { connect: async () => client as never }, provider: { apiVersion: 'v1', baseUrl: 'https://fixture.invalid/api/v1', apiKey: 'synthetic', fetch }, integrationId: 'integration', providerConfigurationReference: 'config', subscriberId: 'subscriber', codec: new HistoryCheckpointCodec({ activeVersion: 'h', keys: [{ version: 'h', encryptionKey: Buffer.alloc(32, 63), digestKey: Buffer.alloc(32, 64) }] }), eventCodec: new EventCodec({ activeVersion: 'e', keys: [{ version: 'e', encryptionKey: Buffer.alloc(32, 65), digestKey: Buffer.alloc(32, 66) }] }), captureCodec: new WebhookCodec({ activeVersion: 'w', keys: [{ version: 'w', encryptionKey: Buffer.alloc(32, 67), digestKey: Buffer.alloc(32, 68) }] }) });
    expect(await factory.refresh({ binding, scope: 'all-replies', since: new Date(Date.parse(startedAt) - 60000).toISOString(), cursor: null, refresh: true })).toMatchObject({ status: 'complete', coverage: { initialSyncComplete: true, complete: true } });
    expect(queries.filter(q => q === 'COMMIT')).toHaveLength(2);
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('/users/me')).length).toBeGreaterThan(1);
});

it.each([true,false])('preserves only authenticated competing-refresh busy without reading provider history (authorized=%s)', async (authorized) => {
    const binding: ConnectionBinding = { ...b, channel: 'email', platform: 'gmail' }, canonicalIdentity = { kind: 'email' as const, value: 'owner@example.com' }, owner = { platform: 'gmail' as const, providerAccountId: 'provider', sourceId: 'mail', providerOwner: { namespace: 'unipile.v1.google.mail.id', value: 'opaque-owner' }, physicalOwner: { namespace: 'mailbox_address' as const, value: 'owner@example.com' }, canonicalIdentity, aliases: [canonicalIdentity], status: 'connected' as const, capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false } } }, record = { binding, providerAccountId: 'provider', sourceId: 'mail', ownerIdentity: owner.providerOwner }, startedAt = new Date().toISOString();
    let tokenHash: string;
    const queries: string[] = [];
    const client = { release: vi.fn(), query: vi.fn(async (sql: string, values?: unknown[]) => {
            queries.push(sql);
            if (sql.includes('pg_roles'))
                return { rows: [{ role: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
            if (sql.includes('lock_reply_barrier'))
                return { rows: [{ revision: '0' }] };
            if (sql.includes('advance_reply_barrier'))
                return { rows: [{ revision: '1' }] };
            if (sql.includes('physical_valid'))
                return { rows: [{ physical_valid: true }] };
            if (sql.includes('JOIN communications.access_grants'))
                return { rows: [{ valid: authorized }] };
            if (sql.includes('grant_valid'))
                return { rows: [{ grant_valid: authorized }] };
            if (sql.includes('INSERT INTO communications.history_refreshes')) {
                tokenHash = values![8] as string;
                return { rows: [] };
            }
            if (sql.includes('SELECT token_hash'))
                return { rows: [{ token_hash: tokenHash!, required_since: new Date(Date.parse(startedAt) - 60000).toISOString(), capture_revision: '0', started_at: startedAt, alive: true, observed_valid: true }] };
            return { rows: [], rowCount: 1 };
        }) };
    const runtime = { store: { resolve: async () => ({ binding, owner, status: 'connected', active: true, isDefault: true }) }, resolveCurrent: async () => record, dispatchOptions: async () => ({ integrationId: 'integration', providerConfigurationReference: 'config', codec: new JournalCodec({ activeVersion: 'j', keys: [{ version: 'j', encryptionKey: Buffer.alloc(32, 61), digestKey: Buffer.alloc(32, 62) }] }), recipientDigest: { keyVersion: 'j', digest: () => 'a'.repeat(64) } }), providerAccountDigests: async () => ['a'.repeat(64)] } as unknown as ConfiguredUnipileV1Runtime;
    const fetch = vi.fn(async (input: URL | RequestInfo, request?: RequestInit) => {
        expect(request?.method).toBe('GET');
        const url = new URL(String(input));
        if (url.pathname.endsWith('/accounts/provider'))
            return new Response(JSON.stringify({ object: 'Account', id: 'provider', type: 'GOOGLE_OAUTH', connection_params: { mail: { id: 'opaque-owner' } }, sources: [{ id: 'mail', status: 'OK' }] }));
        if (url.pathname.endsWith('/users/me'))
            return new Response(JSON.stringify({ object: 'AccountOwnerProfile', provider: 'GMAIL', email: 'owner@example.com', aliases: [] }));
        if (url.pathname.endsWith('/emails'))
            return new Response(JSON.stringify({ object: 'EmailList', items: [], cursor: null }));
        throw Error('Unexpected HTTP');
    });
    const factory = await createConfiguredUnipileV1History({ binding, runtime, pool: { connect: async () => client as never }, provider: { apiVersion: 'v1', baseUrl: 'https://fixture.invalid/api/v1', apiKey: 'synthetic', fetch }, integrationId: 'integration', providerConfigurationReference: 'config', subscriberId: 'subscriber', codec: new HistoryCheckpointCodec({ activeVersion: 'h', keys: [{ version: 'h', encryptionKey: Buffer.alloc(32, 63), digestKey: Buffer.alloc(32, 64) }] }), eventCodec: new EventCodec({ activeVersion: 'e', keys: [{ version: 'e', encryptionKey: Buffer.alloc(32, 65), digestKey: Buffer.alloc(32, 66) }] }), captureCodec: new WebhookCodec({ activeVersion: 'w', keys: [{ version: 'w', encryptionKey: Buffer.alloc(32, 67), digestKey: Buffer.alloc(32, 68) }] }) });
    await expect(factory.readAgentConversation({recipient:'lead@example.com',since:new Date(Date.parse(startedAt)-60000).toISOString()})).rejects.toMatchObject({name:authorized?'HistoryRefreshBusyError':'Error'});
    expect(fetch).not.toHaveBeenCalled();
});
