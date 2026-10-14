import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AccountRuntimeVault } from './account-vault';
import { WebhookCodec } from '../../core/src/webhook-codec';
import { createPostgresProviderWebhookSpool } from './provider-webhook-spool';
import type { ConnectionBinding } from '../../contracts/src';
import type { SqlClient, SqlResult } from './webhook-repository';
// Real authenticated codecs with a scripted SQL driver; not PostgreSQL evidence.
function fixture(ingestedAt: string, encryptedTime = '2026-10-14T00:00:00.000Z') {
    const keyring = { activeVersion: 'fixture', keys: [{ version: 'fixture', encryptionKey: Buffer.alloc(32, 21), digestKey: Buffer.alloc(32, 22) }] }, vault = new AccountRuntimeVault({ ...keyring, identityKey: Buffer.alloc(32, 23), identityKeyVersion: 'identity' }), codec = new WebhookCodec(keyring);
    const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
    const integrationId = 'integration', providerConfigurationReference = 'configuration', providerAccountId = 'provider', rawBody = Buffer.from(' {"event":"mail_sent","account_id":"provider"} '), receivedAt = '2026-10-14T00:00:00.000Z';
    const id = vault.providerReceiptId({ integrationId, providerConfigurationReference, providerAccountId, rawBody }), scope = { integrationId, providerConfigurationReference, id }, sealed = vault.sealProviderReceipt(scope, { providerAccountId, rawBody, receivedAt });
    const vector = [binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.accountId, binding.generation, binding.channel, binding.platform, binding.backend], key = createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1', vector, createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
    const capture = { binding, key, rawBody, receivedAt: encryptedTime }, envelope = codec.encode(capture);
    const query = vi.fn(async (sql: string): Promise<SqlResult> => {
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
        if (sql.includes('FROM communications.connections c JOIN'))
            return { rows: [{ provider_account_digest: vault.providerAccountDigest(providerAccountId), provider_account_key_version: vault.keyVersion }] };
        if (sql.includes('FROM communications.provider_webhook_spool w WHERE'))
            return { rows: [{ id, integration_id: integrationId, provider_configuration_reference: providerConfigurationReference, encrypted_receipt: sealed.encrypted, key_version: sealed.keyVersion, payload_digest: sealed.digest, received_at: new Date(receivedAt), bound_connection_id: binding.connectionId, bound_generation: binding.generation }] };
        if (sql.includes('FROM communications.webhook_inbox w JOIN'))
            return { rows: [{ encrypted_payload: JSON.stringify(envelope), key_version: envelope.keyVersion, payload_digest: codec.digest({ binding, key }, rawBody, envelope.keyVersion), received_at: new Date(ingestedAt) }] };
        if (sql.startsWith('UPDATE communications.provider_webhook_spool SET state=\'routed\''))
            return { rows: [{ id }] };
        if (sql.startsWith('SELECT true AS allowed'))
            return { rows: [{ allowed: true }] };
        return { rows: [] };
    });
    const repo = createPostgresProviderWebhookSpool({ pool: { connect: async () => ({ query, release() { } } as SqlClient) }, vault, captureCodec: codec, applicationId: 'app', integrationId, providerConfigurationReference, authenticate: () => true });
    return { repo, query, key, claim: { id, token: 'A'.repeat(43), binding, providerAccountId, rawBody, receivedAt } };
}
it('scoped ingestion may be later while encrypted original ingress time and bytes remain exact', async () => { const f = fixture('2026-10-14T00:00:02.000Z'); await expect(f.repo.complete(f.claim, f.key)).resolves.toBeUndefined(); expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT'); });
it('a changed authenticated ingress time cannot be replaced by the scoped ingestion clock', async () => { const f = fixture('2026-10-14T00:00:02.000Z', '2026-10-14T00:00:01.000Z'); await expect(f.repo.complete(f.claim, f.key)).rejects.toThrow('Account runtime unavailable'); expect(f.query.mock.calls.some(c => c[0].startsWith("UPDATE communications.provider_webhook_spool SET state='routed'"))).toBe(false); });
it('a scoped receipt predating the original ingress is rejected', async () => { const f = fixture('2026-10-13T23:59:59.000Z'); await expect(f.repo.complete(f.claim, f.key)).rejects.toThrow('Account runtime unavailable'); });
