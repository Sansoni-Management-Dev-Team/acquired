import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { createConfiguredUnipileV1Runtime } from '../../communications/packages/adapter-unipile/src/v1-runtime';
/** PREPARED/UNEXECUTED until exact proposed003/004/006 approvals and explicit application.
 * Synthetic service DML only; fake provider/account data, no setup/write to any live provider.
 * No DDL/bootstrap. Existing fixture helper attests exact loopback5446/system ID/owned OrbStack.
 */
const enabled = process.env.COMMUNICATIONS_STANDALONE_AUDIT === '1' && process.env.COMMUNICATIONS_ACCOUNT_RUNTIME_AUDIT === '1';
describe.skipIf(!enabled)('standalone canonical account runtime actual PostgreSQL (prepared)', () => {
    const local = createCommunicationsStandaloneFixture(), run = randomUUID(), scope = { applicationId: 'account-runtime-fixture', tenantId: `tenant-${run}`, ownerId: `owner-${run}` };
    const account = `provider-${run}`, mailbox = `owner-${run}@example.test`, providerOwner = `provider-owner-${run}`;
    let callback: {
        nonce: string;
        capability: string;
    }, providerPosts = 0, providerReads = 0;
    const runtime = createConfiguredUnipileV1Runtime({ pool: local.driver, provider: { apiVersion: 'v1', baseUrl: 'https://synthetic.unipile.example:20255/api/v1', apiKey: 'synthetic-fixture-only', fetch: async (input, init) => {
                const url = new URL(String(input));
                if (init?.method === 'POST') {
                    providerPosts++;
                    const payload = JSON.parse(init.body as string);
                    callback = { nonce: payload.name, capability: new URL(payload.notify_url).searchParams.get('capability')! };
                    return Response.json({ object: 'HostedAuthURL', url: 'https://account.unipile.com/hosted/synthetic' });
                }
                providerReads++;
                if (url.pathname.endsWith('/users/me'))
                    return Response.json({ object: 'AccountOwnerProfile', provider: 'GMAIL', email: mailbox, aliases: [] });
                return Response.json({ object: 'Account', id: account, type: 'GOOGLE_OAUTH', name: 'Untrusted fixture display name', connection_params: { mail: { id: providerOwner, username: 'opaque fixture login' } }, sources: [{ id: 'mail', status: 'OK' }] });
            } }, applicationId: scope.applicationId, integrationId: 'account-runtime-fixture-integration', providerConfigurationReference: 'fixture-v1', vault: { activeVersion: 'fixture-key', keys: [{ version: 'fixture-key', encryptionKey: Buffer.alloc(32, 91), digestKey: Buffer.alloc(32, 92) }], identityKey: Buffer.alloc(32, 93), identityKeyVersion: 'fixture-identity' }, callbackKey: Buffer.alloc(32, 94), webhookSecret: 'synthetic-fixture-webhook-secret', redirectOrigin: 'https://app.example.test', successPath: '/settings?setup=returned', failurePath: '/settings?setup=failed', notifyUrl: 'https://service.example.test/v1/setup/notify' });
    const notify = () => runtime.completeSetupNotification({ rawBody: Buffer.from(JSON.stringify({ status: 'CREATION_SUCCESS', name: callback.nonce, account_id: account })), capability: callback.capability });
    beforeAll(async () => { await local.preflight(['communications.account_runtime_metadata', 'communications.connection_defaults', 'communications.setup_notification_inbox', 'communications.provider_webhook_spool', 'communications.connection_retirements', 'communications.email_tracking_acknowledgements', 'communications.email_tracking_associations']); });
    afterAll(async () => {
        try {
            const client = await local.pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('SET LOCAL ROLE communications_control');
                await client.query('SELECT communications.lock_reply_barrier($1,$2)', [scope.applicationId, scope.tenantId]);
                await client.query('UPDATE communications.connections SET active=false WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [scope.applicationId, scope.tenantId, scope.ownerId]);
                await client.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [scope.applicationId, scope.tenantId, scope.ownerId]);
                await client.query('COMMIT');
            }
            finally {
                client.release();
            }
        }
        finally {
            await local.close();
        }
    });
    it('fresh signed scope issues state before hosted POST; queued callback has no provider reads', async () => { expect(await runtime.authorizeSignedScope(scope, { expiresAt: new Date(Date.now() + 55000).toISOString() })).toBe(true); expect((await runtime.setup(scope, { channel: 'email', platform: 'gmail' })).status).toBe('redirect'); expect(providerPosts).toBe(1); const reads = providerReads; expect(await notify()).toEqual({ status: 'queued' }); expect(providerReads).toBe(reads); });
    it('identical concurrent callback delivery preserves one encrypted immutable inbox receipt', async () => {
        expect(await Promise.all([notify(), notify()])).toEqual([{ status: 'queued' }, { status: 'queued' }]);
        const c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            const r = await c.query('SELECT encrypted_notification FROM communications.setup_notification_inbox n JOIN communications.auth_states a USING(state_digest) WHERE a.application_id=$1 AND a.tenant_id=$2 AND a.owner_id=$3', [scope.applicationId, scope.tenantId, scope.ownerId]);
            expect(r.rows).toHaveLength(1);
            expect(r.rows[0].encrypted_notification).not.toContain(account);
            expect(r.rows[0].encrypted_notification).not.toContain(callback.nonce);
            await c.query('ROLLBACK');
        }
        finally {
            c.release();
        }
    });
    it('owner poll commits exactly verified canonical owner, source and generation; defaults never rebind history', async () => { expect(await runtime.authorizeSignedScope(scope, { expiresAt: new Date(Date.now() + 55000).toISOString() })).toBe(true); const snapshot = await runtime.list(scope); expect(snapshot.connections).toHaveLength(1); const connection = snapshot.connections[0]; expect(connection.label).toBe(mailbox); expect(connection.readiness).toEqual({ status: 'waiting', code: 'incomplete' }); expect((await runtime.setDefault(scope, connection.binding)).isDefault).toBe(true); expect((await runtime.list(scope)).connections[0].binding).toEqual(connection.binding); expect(providerPosts).toBe(1); });
    it('auth state and canonical owner metadata retain encrypted data only, with service/scoped roles lacking DELETE', async () => {
        const c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            const r = await c.query('SELECT m.encrypted_metadata,g.encrypted_provider_account_id FROM communications.account_runtime_metadata m JOIN communications.connection_generations g USING(connection_id,generation) WHERE g.application_id=$1 AND g.tenant_id=$2 AND g.owner_id=$3', [scope.applicationId, scope.tenantId, scope.ownerId]);
            expect(r.rows).toHaveLength(1);
            expect(JSON.stringify(r.rows)).not.toContain(mailbox);
            expect(JSON.stringify(r.rows)).not.toContain(account);
            const privileges = await c.query("SELECT has_table_privilege('communications_control','communications.account_runtime_metadata','DELETE') AS control_delete,has_table_privilege('communications_scoped','communications.setup_notification_inbox','SELECT') AS scoped_notification_read,has_table_privilege('communications_scoped','communications.provider_webhook_spool','SELECT') AS scoped_spool_read");
            expect(privileges.rows[0]).toEqual({ control_delete: false, scoped_notification_read: false, scoped_spool_read: false });
            await c.query('ROLLBACK');
        }
        finally {
            c.release();
        }
    });
});
