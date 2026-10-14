import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createConnectionSetupCoordinator } from '../../communications/packages/core/src/connection-setup';
import { UnipileV1HostedAuth } from '../../communications/packages/adapter-unipile/src/v1-hosted-auth';
import { createPostgresAuthStateRepository, type AuthStateSnapshot } from '../../communications/packages/storage-postgres/src/auth-state-repository';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { SqlClient } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationsLocalFixture } from './communications-local-test-support';
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
/** Approved001 PostgreSQL characterization with synthetic provider fetch and mandatory fixture
 * authentication/owner ports. No migration, real provider operation, live owner claim or UI routing. */
describe.skipIf(!enabled)('isolated PostgreSQL hosted connection setup composition', () => {
    const local = createCommunicationsLocalFixture(), createdConnections = new Set<string>();
    beforeAll(() => local.preflight());
    afterAll(async () => {
        try {
            for (const id of createdConnections)
                await local.pool.query('UPDATE communications.connections SET active=false WHERE id=$1', [id]);
        }
        finally {
            await local.close();
        }
    });
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    interface SyntheticNotification {
        headers: {
            authorization: string;
        };
        body: {
            status: string;
            name: string;
            account_id: string;
            ownerId?: string;
        };
    }
    async function fixture(channel: 'email' | 'whatsapp' | 'linkedin' = 'whatsapp', options: {
        lostResponse?: boolean;
        ttlSeconds?: number;
    } = {}) {
        const f = await local.fixture(channel), scope = {
            applicationId: f.binding.applicationId, tenantId: f.binding.tenantId, ownerId: f.binding.ownerId
        }, providerAccountId = `synthetic-provider-${randomUUID()}`;
        const requests: Record<string, unknown>[] = [], verifiedAccounts = new Map([[providerAccountId, {
                    ...scope, channel, platform: f.binding.platform
                }]]);
        const authenticate = vi.fn(async ({ nonce, notification }: {
            nonce: string;
            notification: unknown;
        }) => {
            const envelope = notification as SyntheticNotification;
            return envelope?.headers?.authorization === 'Bearer fixture-notification-auth' && envelope.body?.name === nonce && ['CREATION_SUCCESS', 'RECONNECTED'].includes(envelope.body?.status);
        });
        const verifyOwner = vi.fn(async (accountId: string) => {
            const verified = verifiedAccounts.get(accountId);
            if (!verified || verified.applicationId !== scope.applicationId || verified.tenantId !== scope.tenantId || verified.ownerId !== scope.ownerId || verified.channel !== channel || verified.platform !== f.binding.platform)
                throw Error('Synthetic account owner verification denied');
        });
        const bind = vi.fn(async (client: SqlClient, state: Readonly<AuthStateSnapshot>, notification: unknown): Promise<ConnectionBinding> => {
            const envelope = notification as SyntheticNotification;
            await verifyOwner(envelope.body.account_id);
            const accountId = state.reconnectBinding?.accountId ?? `composition-account-${randomUUID()}`, binding: ConnectionBinding = {
                ...state.scope, connectionId: state.expectedConnectionId, accountId, generation: state.expectedGeneration, channel: state.channel, platform: state.platform, backend: 'unipile'
            };
            if (!state.reconnectBinding) {
                await client.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'composition_fixture',$3,'fixture-v1',clock_timestamp())", [accountId, state.channel, hash(accountId)]);
                await client.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, binding.channel, binding.platform]);
            }
            await client.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,provider_account_digest,encrypted_provider_account_id,provider_account_key_version,authority,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'unipile','composition-integration','v1','composition-settings',$9,'synthetic-encrypted-provider-id','composition-key','service','{}')", [binding.connectionId, binding.generation, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, binding.channel, binding.platform, hash(providerAccountId)]);
            if (state.reconnectBinding)
                await client.query('UPDATE communications.connections SET current_generation=$2 WHERE id=$1', [binding.connectionId, binding.generation]);
            // A genuinely independent connection observes neither new generation nor nonce consumption yet.
            const { rows: visible } = await local.pool.query('SELECT generation FROM communications.connection_generations WHERE connection_id=$1 AND generation=$2', [binding.connectionId, binding.generation]);
            expect(visible).toHaveLength(0);
            const { rows: [pending] } = await local.pool.query('SELECT consumed_at FROM communications.auth_states WHERE application_id=$1 AND state_digest=$2', [scope.applicationId, hash(envelope.body.name)]);
            expect(pending.consumed_at).toBeNull();
            createdConnections.add(binding.connectionId);
            return binding;
        });
        const states = createPostgresAuthStateRepository({
            pool: local.driver, scope, channel, platform: f.binding.platform, backend: 'unipile', redirectOrigin: 'https://app.example.test', ttlSeconds: options.ttlSeconds, authenticateNotification: authenticate, bindNotification: bind
        });
        const fetch = vi.fn<typeof globalThis.fetch>(async (url, request) => {
            expect(String(url)).toBe('https://synthetic.unipile.invalid/api/v1/hosted/accounts/link');
            expect(request?.method).toBe('POST');
            expect(request?.headers).toMatchObject({
                'X-API-KEY': 'synthetic-hosted-key'
            });
            const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
            requests.push(body);
            if (body.type === 'create')
                expect(body.providers).toEqual([channel === 'email' ? 'GOOGLE' : channel.toUpperCase()]);
            const { rows } = await local.pool.query('SELECT state_digest,consumed_at,application_id,tenant_id,owner_id FROM communications.auth_states WHERE state_digest=$1', [hash(String(body.name))]);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                application_id: scope.applicationId, tenant_id: scope.tenantId, owner_id: scope.ownerId, consumed_at: null
            });
            expect(JSON.stringify(rows)).not.toContain(body.name);
            if (options.lostResponse)
                throw Error('Synthetic accepted POST with lost response');
            return Response.json({
                object: 'HostedAuthURL', url: 'https://account.unipile.com/synthetic-opaque-link'
            });
        });
        const hostedAuth = new UnipileV1HostedAuth({
            apiVersion: 'v1', baseUrl: 'https://synthetic.unipile.invalid/api/v1', apiKey: 'synthetic-hosted-key', redirectOrigins: ['https://app.example.test'], notifyOrigins: ['https://service.example.test'], fetch
        });
        const resolveReconnect = vi.fn(async (original: ConnectionBinding) => {
            const { rows: [row] } = await local.pool.query('SELECT c.current_generation,g.account_id,g.application_id,g.tenant_id,g.owner_id,g.provider_account_digest FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation WHERE c.id=$1', [original.connectionId]);
            if (!row || row.current_generation !== original.generation || row.account_id !== original.accountId || row.application_id !== scope.applicationId || row.tenant_id !== scope.tenantId || row.owner_id !== scope.ownerId || row.provider_account_digest !== hash(providerAccountId))
                throw Error('Synthetic original reconnect provenance changed');
            return {
                binding: structuredClone(original), providerAccountId
            };
        });
        const coordinator = createConnectionSetupCoordinator({
            scope, channel, platform: f.binding.platform, backend: 'unipile', redirectOrigin: 'https://app.example.test', successPath: '/settings?connected=1', failurePath: '/settings?failed=1', notifyUrl: 'https://service.example.test/notify', states, hostedAuth, resolveReconnect
        });
        const nonce = () => String(requests.at(-1)?.name);
        const notification = (change: Partial<SyntheticNotification['body']> = {}): SyntheticNotification => ({
            headers: {
                authorization: 'Bearer fixture-notification-auth'
            }, body: {
                status: requests.at(-1)?.type === 'reconnect' ? 'RECONNECTED' : 'CREATION_SUCCESS', name: nonce(), account_id: providerAccountId, ...change
            }
        });
        const rows = () => local.pool.query('SELECT * FROM communications.auth_states WHERE application_id=$1 ORDER BY created_at', [scope.applicationId]);
        return {
            ...f, scope, states, hostedAuth, coordinator, requests, fetch, bind, verifyOwner, resolveReconnect, nonce, notification, rows
        };
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('commits durable %s state before provider POST and persists authenticated binding before replay', async (channel) => {
        const f = await fixture(channel);
        expect(await f.coordinator.begin()).toMatchObject({
            status: 'redirect', action: {
                type: 'redirect', url: 'https://account.unipile.com/synthetic-opaque-link'
            }
        });
        expect(f.fetch).toHaveBeenCalledOnce();
        expect(f.bind).not.toHaveBeenCalled();
        expect((await f.rows()).rows[0].consumed_at).toBeNull();
        const result = await f.coordinator.complete({
            nonce: f.nonce(), notification: f.notification({
                ownerId: 'ignored-callback-owner'
            })
        });
        expect(result.status).toBe('recorded');
        if (result.status !== 'recorded')
            throw Error('Expected recorded fixture');
        expect(result.binding).toMatchObject({
            ...f.scope, channel, generation: 1
        });
        const { rows: stored } = await local.pool.query('SELECT current_generation FROM communications.connections WHERE id=$1', [result.binding.connectionId]);
        expect(stored).toEqual([{
                current_generation: 1
            }]);
        expect((await f.rows()).rows[0].consumed_at).not.toBeNull();
        expect(await f.coordinator.complete({
            nonce: f.nonce(), notification: f.notification()
        })).toEqual({
            status: 'duplicate', binding: result.binding
        });
        expect(f.bind).toHaveBeenCalledOnce();
        expect(f.verifyOwner).toHaveBeenCalledOnce();
    });
    it('retains state and returns unknown after lost POST response without retry or binding', async () => {
        const f = await fixture('whatsapp', {
            lostResponse: true
        });
        expect(await f.coordinator.begin()).toEqual({
            status: 'unknown'
        });
        expect(f.fetch).toHaveBeenCalledOnce();
        expect(f.bind).not.toHaveBeenCalled();
        const states = await f.rows();
        expect(states.rows).toHaveLength(1);
        expect(states.rows[0].consumed_at).toBeNull();
        expect((await local.pool.query('SELECT id FROM communications.connections WHERE application_id=$1', [f.scope.applicationId])).rows).toHaveLength(1);
    });
    it('never binds browser redirects, cancellation or mismatched nonce correlation', async () => {
        const f = await fixture();
        await f.coordinator.begin();
        expect(await f.coordinator.complete({
            nonce: f.nonce(), success: true, accountId: 'caller-account'
        } as never)).toEqual({
            status: 'rejected', code: 'invalid'
        });
        for (const body of [{
                status: 'CANCELED'
            }, {
                name: 'uncorrelated-state'
            }])
            expect(await f.coordinator.complete({
                nonce: f.nonce(), notification: f.notification(body)
            })).toEqual({
                status: 'rejected', code: 'unauthenticated'
            });
        expect(f.bind).not.toHaveBeenCalled();
        expect((await f.rows()).rows[0].consumed_at).toBeNull();
    });
    it('does not bind an authenticated callback account lacking current-owner proof', async () => {
        const f = await fixture();
        await f.coordinator.begin();
        expect(await f.coordinator.complete({
            nonce: f.nonce(), notification: f.notification({
                account_id: 'unowned-provider-account'
            })
        })).toEqual({
            status: 'unknown'
        });
        expect(f.verifyOwner).toHaveBeenCalledOnce();
        expect((await f.rows()).rows[0].consumed_at).toBeNull();
        expect((await local.pool.query('SELECT id FROM communications.connections WHERE application_id=$1', [f.scope.applicationId])).rows).toHaveLength(1);
    });
    it('rejects an expired authenticated callback without binding', async () => {
        const f = await fixture('email', {
            ttlSeconds: 1
        });
        expect((await f.coordinator.begin()).status).toBe('redirect');
        await new Promise(resolve => setTimeout(resolve, 1200));
        expect(await f.coordinator.complete({
            nonce: f.nonce(), notification: f.notification()
        })).toEqual({
            status: 'rejected', code: 'expired'
        });
        expect(f.bind).not.toHaveBeenCalled();
        expect((await f.rows()).rows[0].consumed_at).toBeNull();
    });
    it('reconnects only the recorded physical account and retains exact historical replay', async () => {
        const f = await fixture('linkedin');
        await f.coordinator.begin();
        const connected = await f.coordinator.complete({
            nonce: f.nonce(), notification: f.notification()
        });
        if (connected.status !== 'recorded')
            throw Error('Expected connected fixture');
        const original = connected.binding;
        expect((await f.coordinator.begin({
            reconnectBinding: original
        })).status).toBe('redirect');
        expect(f.requests.at(-1)).toMatchObject({
            type: 'reconnect'
        });
        expect(f.requests.at(-1)).not.toHaveProperty('providers');
        const reconnectNonce = f.nonce(), reconnected = await f.coordinator.complete({
            nonce: reconnectNonce, notification: f.notification()
        });
        expect(reconnected).toEqual({
            status: 'recorded', binding: {
                ...original, generation: 2
            }
        });
        if (reconnected.status !== 'recorded')
            throw Error('Expected reconnected fixture');
        const notifications = f.notification();
        expect((await f.coordinator.begin({
            reconnectBinding: reconnected.binding
        })).status).toBe('redirect');
        const third = await f.coordinator.complete({
            nonce: f.nonce(), notification: f.notification()
        });
        expect(third).toEqual({
            status: 'recorded', binding: {
                ...original, generation: 3
            }
        });
        expect(await f.coordinator.complete({
            nonce: reconnectNonce, notification: notifications
        })).toEqual({
            status: 'duplicate', binding: {
                ...original, generation: 2
            }
        });
        const before = f.fetch.mock.calls.length;
        expect(await f.coordinator.begin({
            reconnectBinding: original
        })).toEqual({
            status: 'unavailable'
        });
        expect(f.fetch.mock.calls.length).toBe(before);
    });
});
