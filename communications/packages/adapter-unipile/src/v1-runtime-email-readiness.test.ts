import { expect, it, vi } from 'vitest';
import { createRuntimeEmail } from './v1-runtime-email';
import { projectV1CanonicalOwner, UnipileV1OwnerReader } from './v1-owner';
import { UnipileV1Transport } from './v1-http';
import { AccountRuntimeVault } from '../../storage-postgres/src/account-vault';
import type { AccountRuntimeRepository } from '../../storage-postgres/src/account-runtime';
import type { AccessScope, ConnectionBinding } from '../../contracts/src';
it('email readiness supplies exact access scope before and after canonical owner verification', async () => {
    const scope: AccessScope = { applicationId: 'fixture', tenantId: 'tenant', ownerId: 'owner' };
    const binding: ConnectionBinding = { ...scope, connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
    const account = { object: 'Account', id: 'provider', type: 'GOOGLE_OAUTH', connection_params: { mail: { id: 'provider-owner' } }, sources: [{ id: 'mail', status: 'OK' }] };
    const profile = { object: 'AccountOwnerProfile', provider: 'GMAIL', email: 'owner@example.test', aliases: [] };
    const proof = projectV1CanonicalOwner(account, profile, { platform: 'gmail', providerAccountId: 'provider' });
    if (proof.kind !== 'verified')
        throw Error('Invalid synthetic canonical owner');
    const requireGrant = vi.fn(async (input: AccessScope) => {
        // Match the real repository's exact-shape contract, rather than an accepting stub.
        if (Object.keys(input).sort().join(',') !== 'applicationId,ownerId,tenantId')
            throw Error('Invalid access scope');
        expect(input).toEqual(scope);
    });
    const fetchFixture: typeof fetch = async (input, init) => {
        expect(init?.method).toBe('GET');
        const url = new URL(String(input));
        if (url.pathname === '/api/v1/accounts/provider')
            return Response.json(account);
        if (url.pathname === '/api/v1/users/me') {
            expect(url.searchParams.get('account_id')).toBe('provider');
            return Response.json(profile);
        }
        throw Error('Unexpected synthetic read; no provider fallback');
    };
    const config = { apiVersion: 'v1' as const, baseUrl: 'https://synthetic.example.test/api/v1', apiKey: 'synthetic-only', fetch: fetchFixture };
    const vault = new AccountRuntimeVault({ activeVersion: 'fixture', keys: [{ version: 'fixture', encryptionKey: Buffer.alloc(32, 1), digestKey: Buffer.alloc(32, 2) }], identityKey: Buffer.alloc(32, 3), identityKeyVersion: 'identity' });
    const runtime = createRuntimeEmail({ pool: { async connect() { throw Error('No SQL expected in this strict-port characterization'); } }, connection: { binding, owner: proof.owner, status: 'connected', active: true, isDefault: false }, vault, store: { requireGrant } as unknown as AccountRuntimeRepository, integrationId: 'integration', providerConfigurationReference: 'configuration', transport: new UnipileV1Transport(config), ownerReader: new UnipileV1OwnerReader(config), authenticate: () => false });
    expect(await runtime.provider.ready(binding)).toEqual({ status: 'ready' });
    expect(requireGrant).toHaveBeenCalledTimes(2);
});
