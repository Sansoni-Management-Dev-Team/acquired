import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createCommunicationsLocalFixture } from './communications-local-test-support';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { createConfiguredUnipileV1Runtime, type ConfiguredUnipileV1RuntimeOptions } from '../../communications/packages/adapter-unipile/src/v1-runtime';
import { createAcquireCommunicationsRuntime } from '../lib/communications-runtime';
import { createAcquireCommunicationsService } from '../lib/communications-service';
import { CommunicationsClient } from '../../communications/packages/sdk/src';
import { createScopedServiceAuth } from '../../communications/packages/core/src/scoped-service-auth';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import type { ConnectionBinding, DeliveryOutcome, MessageSubmission } from '../../communications/packages/contracts/src';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
vi.mock('server-only', () => ({}));
// PREPARED/UNEXECUTED. Requires specifically approved/apply-final-stage application004
// on5445 AND standalone003..007 on5446. These tests never create schema, start containers
// or call a real provider. Missing prerequisites are not a TDD RED.
// Actual native HTTP SDK + full Acquire host + two real PostgreSQL transactions are
// exercised; only Unipile fetch responses/accounts and test key material are synthetic.
const enabled = ['COMMUNICATIONS_RUNTIME_HOST_AUDIT', 'COMMUNICATIONS_AUDIT_LOCAL_DB', 'CAMPAIGN_ISOLATED_CHANNEL_STACK', 'COMMUNICATIONS_STANDALONE_AUDIT'].every(name => process.env[name] === '1');
describe.skipIf(!enabled)('two-database configured Acquire communications host (prepared)', () => {
    let app: ReturnType<typeof createCommunicationsLocalFixture>;
    let service: ReturnType<typeof createCommunicationsStandaloneFixture>;
    const fixtures: Array<{
        scope: {
            applicationId: string;
            tenantId: string;
            ownerId: string;
        };
        close(): Promise<void>;
    }> = [];
    const keys = [{ version: 'host-fixture', encryptionKey: Buffer.alloc(32, 71), digestKey: Buffer.alloc(32, 72) }];
    // All cases model one configured service deployment, with distinct owners/accounts.
    const deployment = randomUUID();
    const scopedAuthKey = Buffer.alloc(32, 74), webhookSecret = 'synthetic-host-webhook-secret';
    const appCodec = new JournalCodec({ activeVersion: 'host-app', keys: [{ version: 'host-app', encryptionKey: Buffer.alloc(32, 81), digestKey: Buffer.alloc(32, 82) }] });
    beforeAll(async () => {
        app = createCommunicationsLocalFixture();
        service = createCommunicationsStandaloneFixture();
        await app.preflight();
        const prerequisites = await app.pool.query(`SELECT to_regclass('public.communication_dispatch_intents') IS NOT NULL AS intents,
      to_regclass('public.communication_dispatch_permits') IS NOT NULL AS permits,
      to_regprocedure('public.communications_lock_send_gate(text)') IS NOT NULL AS gate,
      to_regprocedure('public.communications_lock_send_member(text,text)') IS NOT NULL AS membership`);
        expect(prerequisites.rows[0], 'Final approved application004 prerequisites required; no bootstrap').toEqual({ intents: true, permits: true, gate: true, membership: true });
        await service.preflight(['communications.connection_retirements', 'communications.email_tracking_acknowledgements', 'communications.email_tracking_associations', 'communications.dispatch_admissions', 'communications.application_quota_buckets', 'communications.account_runtime_metadata', 'communications.connection_defaults', 'communications.setup_notification_inbox', 'communications.provider_webhook_spool', 'communications.history_initial_sync', 'communications.history_refreshes']);
        vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED', 'true');
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'enforce');
    });
    afterAll(async () => {
        try {
            for (const f of fixtures) {
                await f.close();
                // Unknown sends prohibit retirement. Retain journal/intent/receipt/alias history
                // and remove authority instead of deleting/rebinding any historical work.
                await service.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [f.scope.applicationId, f.scope.tenantId, f.scope.ownerId]);
                await app.pool.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2', [f.scope.tenantId, f.scope.ownerId]);
            }
        }
        finally {
            vi.unstubAllEnvs();
            await Promise.all([app?.close(), service?.close()]);
        }
    });
    async function fixture(loseResponse = false, crashBeforeCompletion = false) {
        const run = randomUUID(), scope = { applicationId: 'acquire', tenantId: `runtime-host-${run}`, ownerId: `runtime-host-owner-${run}` };
        const target = randomUUID(), contact = randomUUID(), sequence = randomUUID(), enrolment = randomUUID(), draft = randomUUID(), bindingId = randomUUID();
        const providerAccount = `provider-${run}`, providerOwner = `mail-owner-${run}`, ownerEmail = `owner-${run}@example.test`, recipient = `recipient-${run}@example.test`;
        const trackingId = `tracking-${run}`, emailId = `actual-email-${run}`, threadId = `thread-${run}`, rfcMessageId = `<actual-${run}@example.test>`;
        const subject = 'Synthetic approved local draft', body = 'Synthetic full-host admission fixture';
        let callback: {
            nonce: string;
            capability: string;
        } | undefined, emailPosts = 0, observedBeforePost = false, sentAt: string | undefined;
        const c = await app.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$1,$2,false,now(),now())', [scope.ownerId, ownerEmail]);
            await c.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)', [scope.tenantId]);
            await c.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')", [randomUUID(), scope.tenantId, scope.ownerId]);
            await c.query("INSERT INTO public.targets(id,organization_id,company_name,firmographics) VALUES($1,$2,'Synthetic host fixture','{}')", [target, scope.tenantId]);
            await c.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,fictionalised,personal_data,provenance) VALUES($1,$2,$3,'Synthetic host recipient',false,$4::jsonb,'{}')", [contact, scope.tenantId, target, JSON.stringify({ email: recipient })]);
            await c.query("INSERT INTO public.sequences(id,organization_id,name,steps,created_by) VALUES($1,$2,'Synthetic host draft','[]',$3)", [sequence, scope.tenantId, scope.ownerId]);
            await c.query("INSERT INTO public.sequence_enrolments(id,organization_id,sequence_id,target_id,contact_id,state) VALUES($1,$2,$3,$4,$5,'draft')", [enrolment, scope.tenantId, sequence, target, contact]);
            await c.query("INSERT INTO public.messages(id,organization_id,enrolment_id,step_number,purpose,subject,body,state,approved_by,approved_at) VALUES($1,$2,$3,1,'synthetic',$4,$5,'approved',$6,clock_timestamp())", [draft, scope.tenantId, enrolment, subject, body, scope.ownerId]);
            await c.query('COMMIT');
        }
        catch (error) {
            await c.query('ROLLBACK');
            throw error;
        }
        finally {
            c.release();
        }
        const fullEmail = () => ({ object: 'Email', kind: '2_full', type: 'GOOGLE_OAUTH', account_id: providerAccount, id: emailId, message_id: rfcMessageId, thread_id: threadId, date: sentAt!, role: 'sent', subject, from_attendee: { identifier: ownerEmail }, to_attendees: [{ identifier: recipient }], cc_attendees: [], bcc_attendees: [], headers: [{ name: 'Message-ID', value: rfcMessageId }] });
        const providerFetch: typeof fetch = async (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            if (url.origin !== 'https://synthetic.unipile.example:20255')
                throw Error('Only injected synthetic provider is permitted');
            const method = init?.method ?? 'GET';
            if (method === 'POST' && url.pathname === '/api/v1/hosted/accounts/link') {
                const payload = JSON.parse(init!.body as string);
                callback = { nonce: payload.name, capability: new URL(payload.notify_url).searchParams.get('capability')! };
                return Response.json({ object: 'HostedAuthURL', url: 'https://account.unipile.com/hosted/synthetic-host' });
            }
            if (method === 'POST' && url.pathname === '/api/v1/emails') {
                emailPosts++;
                expect(submission).toBeDefined();
                // These independent pooled sessions can see only COMMITTED data. A merely
                // pending application/service transaction cannot satisfy either assertion.
                const key = submission!.snapshot.key;
                const appReceipt = await app.pool.query(`SELECT p.service_admission_id,p.service_journal_id FROM public.communication_dispatch_permits p JOIN public.communication_dispatch_intents i ON i.id=p.intent_id WHERE i.organization_id=$1 AND i.owner_user_id=$2 AND i.operation_key=$3`, [scope.tenantId, scope.ownerId, key]);
                const serviceReceipt = await service.pool.query(`SELECT a.id,a.journal_id,j.state,j.quota_reserved FROM communications.dispatch_admissions a JOIN communications.operation_journal j ON j.id=a.journal_id WHERE j.application_id=$1 AND j.tenant_id=$2 AND j.owner_id=$3 AND j.operation_key=$4`, [scope.applicationId, scope.tenantId, scope.ownerId, key]);
                expect(appReceipt.rows).toHaveLength(1);
                expect(serviceReceipt.rows).toHaveLength(1);
                expect(serviceReceipt.rows[0]).toMatchObject({ id: appReceipt.rows[0].service_admission_id, journal_id: appReceipt.rows[0].service_journal_id, state: 'dispatching', quota_reserved: true });
                observedBeforePost = true;
                sentAt = new Date().toISOString();
                if (loseResponse)
                    throw Error('Synthetic provider response lost after acceptance');
                return Response.json({ object: 'EmailSent', tracking_id: trackingId }, { status: 201 });
            }
            if (method === 'GET' && url.pathname === `/api/v1/accounts/${providerAccount}`)
                return Response.json({ object: 'Account', id: providerAccount, type: 'GOOGLE_OAUTH', connection_params: { mail: { id: providerOwner, username: 'opaque synthetic login' } }, sources: [{ id: 'mail', status: 'OK' }] });
            if (method === 'GET' && url.pathname === '/api/v1/users/me') {
                expect(url.searchParams.get('account_id')).toBe(providerAccount);
                return Response.json({ object: 'AccountOwnerProfile', provider: 'GMAIL', email: ownerEmail, aliases: [] });
            }
            if (method === 'GET' && url.pathname === '/api/v1/emails') {
                expect(url.searchParams.get('account_id')).toBe(providerAccount);
                return Response.json({ object: 'EmailList', items: [], cursor: null });
            }
            if (method === 'GET' && url.pathname === `/api/v1/emails/${emailId}`) {
                expect(url.searchParams.get('account_id')).toBe(providerAccount);
                return Response.json(fullEmail());
            }
            throw Error('Unexpected synthetic provider request; no live fallback');
        };
        let crashArmed = crashBeforeCompletion;
        const driver: SqlPool = { async connect() {
                const physical = await service.driver.connect();
                return { async query<Row>(sql: string, values?: unknown[]) {
                        if (crashArmed && sql.startsWith('UPDATE communications.operation_journal SET state=$5,outcome_status') && values?.[4] === 'unknown') {
                            crashArmed = false;
                            throw Object.assign(Error('Synthetic connection lost before completion'), { code: 'ECONNRESET' });
                        }
                        return physical.query<Row>(sql, values);
                    }, release(error?: Error) { physical.release(error); } };
            } };
        const options: ConfiguredUnipileV1RuntimeOptions = { pool: driver, provider: { apiVersion: 'v1', baseUrl: 'https://synthetic.unipile.example:20255/api/v1', apiKey: 'synthetic-host-only', fetch: providerFetch }, applicationId: scope.applicationId, integrationId: `host-integration-${deployment}`, providerConfigurationReference: `host-config-${deployment}`, vault: { activeVersion: keys[0].version, keys, identityKey: Buffer.alloc(32, 73), identityKeyVersion: 'host-identity' }, callbackKey: Buffer.alloc(32, 75), webhookSecret, redirectOrigin: 'https://app.example.test', successPath: '/settings?setup=returned', failurePath: '/settings?setup=failed', notifyUrl: 'https://service.example.test/v1/setup/notify' };
        const runtime = createConfiguredUnipileV1Runtime(options);
        const host = createAcquireCommunicationsRuntime({ unipile: runtime, serviceOptions: options, applicationPool: app.driver, applicationCodec: appCodec, scopedAuthKey, subscriberId: `host-subscriber-${run}`, quota: { account: { hour: 10, day: 20 }, application: { hour: 100, day: 200 } } });
        const actualService = await createAcquireCommunicationsService({ host, unipile: runtime, options });
        actualService.server.listen(0, '127.0.0.1');
        await once(actualService.server, 'listening');
        const address = actualService.server.address();
        if (!address || typeof address === 'string')
            throw Error('Expected loopback fixture listener');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        fixtures.push({ scope, close: actualService.close });
        const signer = createScopedServiceAuth({ key: scopedAuthKey, applicationId: 'acquire', audience: 'communications', authorize: async () => true });
        const client = new CommunicationsClient({ baseUrl, contractVersion: '1', apiKey: signer.issue(scope), allowLoopbackHttp: true, timeoutMs: 25000 });
        async function bindAccount(reconnectBinding?: ConnectionBinding) {
            expect((await client.setupConnection(scope, { channel: 'email', platform: 'gmail', ...(reconnectBinding ? { reconnectBinding } : {}) })).status).toBe('redirect');
            expect(callback).toBeDefined();
            const queued = await fetch(`${baseUrl}/v1/setup/notify?capability=${callback!.capability}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: reconnectBinding ? 'RECONNECTED' : 'CREATION_SUCCESS', name: callback!.nonce, account_id: providerAccount }) });
            expect(queued.status).toBe(200);
            expect(await queued.json()).toEqual({ status: 'queued' });
            const connections = await client.connections(scope);
            const current = connections.connections.find(c => c.binding.generation === (reconnectBinding ? reconnectBinding.generation + 1 : 1));
            expect(current).toBeDefined();
            return current!.binding;
        }
        const binding = await bindAccount();
        const seed = await app.pool.connect();
        try {
            await seed.query('BEGIN');
            await seed.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,'email','gmail','unipile','service')", [bindingId, scope.tenantId, scope.ownerId, binding.connectionId, binding.accountId]);
            await seed.query('INSERT INTO public.outreach_draft_bindings(message_id,organization_id,owner_user_id,binding_id,operation_key_prefix) VALUES($1,$2,$3,$4,$5)', [draft, scope.tenantId, scope.ownerId, bindingId, `host-draft:${draft}`]);
            await seed.query('COMMIT');
        }
        catch (error) {
            await seed.query('ROLLBACK');
            throw error;
        }
        finally {
            seed.release();
        }
        const since = (await service.pool.query("SELECT clock_timestamp()-interval '6 minutes' AS since")).rows[0].since.toISOString();
        const query = { binding, scope: 'account', since, cursor: null, refresh: true };
        await host.refreshAndConsume(query);
        const history = await host.history(binding), scopeDigest = history.repository.scopeDigest('account');
        const revision = (await app.pool.query('SELECT updated_at FROM public.messages WHERE id=$1', [draft])).rows[0].updated_at.toISOString();
        const prepared = await (await host.admission(binding)).prepare({ source: { kind: 'draft', messageId: draft, revision }, message: { recipient: { kind: 'email', value: recipient }, subject, text: body }, coverageScopes: [{ bindingId, scopeDigest }] });
        const submission: MessageSubmission = prepared.submission;
        async function sentNotification() {
            const response = await fetch(`${baseUrl}/v1/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Unipile-Auth': webhookSecret }, body: JSON.stringify({ event: 'mail_sent', account_id: providerAccount, tracking_id: trackingId, email_id: emailId, message_id: rfcMessageId, origin: 'unipile', role: 'sent', date: sentAt, to_attendees: [{ identifier: recipient }], cc_attendees: [], bcc_attendees: [] }) });
            expect(response.status).toBe(200);
            await response.arrayBuffer();
            await actualService.tick();
        }
        async function quota() { return (await service.pool.query('SELECT bucket_kind,window_kind,used FROM communications.quota_buckets WHERE account_id=$1 ORDER BY bucket_kind,window_kind', [binding.accountId])).rows; }
        return { scope, binding, submission: prepared.submission, client, runtime, host, bindAccount, sentNotification, quota, emailId, threadId, recipient, get sentAt() { return sentAt; }, get emailPosts() { return emailPosts; }, get observedBeforePost() { return observedBeforePost; } };
    }
    async function accept(f: Awaited<ReturnType<typeof fixture>>) {
        expect(await f.client.submit(f.submission)).toEqual({ status: 'unknown' });
        expect(f.observedBeforePost).toBe(true);
        expect(f.emailPosts).toBe(1);
        await f.sentNotification();
        const recovered = await f.client.lookup({ snapshot: f.submission.snapshot, expectedRecipient: f.submission.message.recipient });
        expect(recovered).toEqual({ status: 'submitted', receipt: { message: { binding: f.binding, id: f.emailId }, conversation: { binding: f.binding, id: f.threadId }, recipient: f.submission.message.recipient, submittedAt: f.sentAt } });
        return recovered as Extract<DeliveryOutcome, {
            status: 'submitted';
        }>;
    }
    it('commits both durable ledgers before the first provider POST, recovers a verified receipt and charges each quota once', async () => {
        const f = await fixture();
        await accept(f);
        const before = await f.quota();
        expect(before).toHaveLength(4);
        expect(before.every(r => r.used === 1)).toBe(true);
        expect((await f.client.submit(f.submission)).status).toBe('submitted');
        expect(f.emailPosts).toBe(1);
        expect(await f.quota()).toEqual(before);
    }, 60000);
    it('a lost provider response remains unknown on the original key and never sends or charges twice', async () => {
        const f = await fixture(true);
        expect(await f.client.submit(f.submission)).toEqual({ status: 'unknown' });
        expect(f.observedBeforePost).toBe(true);
        const before = await f.quota();
        expect(before).toHaveLength(4);
        expect(before.every(r => r.used === 1)).toBe(true);
        expect(await f.client.submit(f.submission)).toEqual({ status: 'unknown' });
        expect(await f.client.lookup({ snapshot: f.submission.snapshot, expectedRecipient: f.submission.message.recipient })).toEqual({ status: 'unknown' });
        expect(f.emailPosts).toBe(1);
        expect(await f.quota()).toEqual(before);
    }, 60000);
    it('a crashed completion retains dispatching plus durable ACK and recovers only through the authenticated original association', async () => {
        const f = await fixture(false, true);
        expect(await f.client.submit(f.submission)).toEqual({ status: 'unknown' });
        expect(f.observedBeforePost).toBe(true);
        const stored = await service.pool.query('SELECT j.state,(SELECT count(*)::integer FROM communications.email_tracking_acknowledgements a WHERE a.journal_id=j.id) AS acknowledgements FROM communications.operation_journal j WHERE j.application_id=$1 AND j.tenant_id=$2 AND j.owner_id=$3 AND j.operation_key=$4', [f.scope.applicationId, f.scope.tenantId, f.scope.ownerId, f.submission.snapshot.key]);
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0]).toEqual({ state: 'dispatching', acknowledgements: 1 });
        const before = await f.quota();
        expect(before).toHaveLength(4);
        expect(before.every(r => r.used === 1)).toBe(true);
        await f.sentNotification();
        const accepted = await f.client.lookup({ snapshot: f.submission.snapshot, expectedRecipient: f.submission.message.recipient });
        expect(accepted).toMatchObject({ status: 'submitted', receipt: { message: { binding: f.binding, id: f.emailId }, submittedAt: f.sentAt } });
        expect(f.emailPosts).toBe(1);
        expect(await f.quota()).toEqual(before);
    }, 60000);
    it('a new generation cannot rebind an accepted original receipt or alter its historical quota', async () => {
        const f = await fixture(), accepted = await accept(f), before = await f.quota(), successor = await f.bindAccount(f.binding);
        expect(successor.connectionId).toBe(f.binding.connectionId);
        expect(successor.accountId).toBe(f.binding.accountId);
        expect(successor.generation).toBe(2);
        const historical = await f.client.connectionStatus(f.binding);
        expect(historical.status).toBe('disconnected');
        expect(await f.client.lookup({ snapshot: f.submission.snapshot, expectedRecipient: f.submission.message.recipient })).toEqual(accepted);
        expect(f.emailPosts).toBe(1);
        expect(await f.quota()).toEqual(before);
    }, 60000);
});
