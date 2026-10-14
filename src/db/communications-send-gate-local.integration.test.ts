import { createAcquireSendAdmission } from '../lib/campaign-send-admission';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createCommunicationsLocalFixture } from './communications-local-test-support';
// PREPARED/UNEXECUTED: exact proposed application004 approval/application required.
// Synthetic policy writer transactions only; no service/provider admission claimed.
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1' && process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK === '1' && process.env.COMMUNICATIONS_SEND_ADMISSION_AUDIT === '1';
describe.skipIf(!enabled)('Acquire held send gate SQL (prepared)', () => {
    const local = createCommunicationsLocalFixture(), suffix = randomUUID(), org = `gate-${suffix}`, owner = `gate-owner-${suffix}`, contact = randomUUID(), target = randomUUID(), bindingId = randomUUID();
    beforeAll(async () => { await local.preflight(); const prerequisites = await local.pool.query("SELECT to_regprocedure('public.communications_lock_send_gate(text)') IS NOT NULL AS installed,to_regclass('public.communication_dispatch_permits') IS NOT NULL AS permits"); expect(prerequisites.rows[0]).toEqual({ installed: true, permits: true }); const c = await local.pool.connect(); try {
        await c.query('BEGIN');
        await c.query('INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$1,$2,false,now(),now())', [owner, `${owner}@example.test`]);
        await c.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)', [org]);
        await c.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')", [randomUUID(), org, owner]);
        await c.query("INSERT INTO public.targets(id,organization_id,company_name,firmographics) VALUES($1,$2,'Synthetic gate','{}')", [target, org]);
        await c.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,fictionalised,personal_data,provenance) VALUES($1,$2,$3,'Synthetic gate',false,'{}','{}')", [contact, org, target]);
        await c.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,'email','gmail','unipile','service')", [bindingId, org, owner, `gate-connection-${suffix}`, `gate-account-${suffix}`]);
        await c.query('COMMIT');
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    } });
    afterAll(async () => { try {
        await local.pool.query('DELETE FROM public.member WHERE organization_id=$1', [org]);
    }
    finally {
        await local.close();
    } });
    async function session() { const c = await local.pool.connect(); await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='3000ms'"); await c.query("SET LOCAL lock_timeout='100ms'"); await c.query('SET LOCAL ROLE acquire_campaign_user'); await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [org, owner]); return c; }
    it('registered critical writers without the first organization gate are rejected', async () => { const c = await session(); try {
        await expect(c.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,fictionalised,personal_data,provenance) VALUES($1,$2,$3,'Unregistered order',false,'{}','{}')", [randomUUID(), org, target])).rejects.toThrow();
    }
    finally {
        await c.query('ROLLBACK');
        c.release();
    } });
    it('a correctly scoped first gate permits mutation and advances its durable revision', async () => { const c = await session(); try {
        const before = (await c.query('SELECT public.communications_lock_send_gate($1)::text AS revision', [org])).rows[0].revision;
        await c.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,fictionalised,personal_data,provenance) VALUES($1,$2,$3,'Registered order',false,'{}','{}')", [randomUUID(), org, target]);
        const after = (await c.query('SELECT public.communications_lock_send_gate($1)::text AS revision', [org])).rows[0].revision;
        expect(BigInt(after)).toBe(BigInt(before) + BigInt(1));
        await c.query('ROLLBACK');
    }
    finally {
        c.release();
    } });
    it('held application authority blocks privileged contact refresh before target row locking', async () => { const held = await session(), writer = await local.pool.connect(); try {
        await held.query('SELECT public.communications_lock_send_gate($1)', [org]);
        await writer.query('BEGIN');
        await writer.query("SET LOCAL lock_timeout='50ms'");
        await expect(writer.query("UPDATE public.contacts SET display_name='Racing source refresh' WHERE id=$1", [contact])).rejects.toMatchObject({ code: '55P03' });
        await writer.query('ROLLBACK');
    }
    finally {
        await held.query('ROLLBACK');
        held.release();
        writer.release();
    } });
    it('held application authority blocks BetterAuth member removal at the before-statement fence', async () => { const held = await session(), writer = await local.pool.connect(); try {
        await held.query('SELECT public.communications_lock_send_gate($1)', [org]);
        await writer.query('BEGIN');
        await writer.query("SET LOCAL lock_timeout='50ms'");
        await expect(writer.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2', [org, owner])).rejects.toMatchObject({ code: '55P03' });
        await writer.query('ROLLBACK');
    }
    finally {
        await held.query('ROLLBACK');
        held.release();
        writer.release();
    } });
    it('a current-member lock cannot be obtained from a caller-set organization GUC alone', async () => { const c = await session(); try {
        await expect(c.query('SELECT public.communications_lock_send_member($1,$2)', [org, owner])).rejects.toThrow();
    }
    finally {
        await c.query('ROLLBACK');
        c.release();
    } });
    async function intent(c: Awaited<ReturnType<typeof session>>, id = randomUUID(), sourceId = randomUUID(), epoch = 1, prior: string | null = null) { await c.query("INSERT INTO public.communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes,predecessor_id) VALUES($1,$2,$3,$4,'campaign',$5,$6,$7,$8,'message',$9,$9,'synthetic-schema-envelope','fixture',$9,clock_timestamp(),'[{}]',$10)", [id, org, owner, bindingId, sourceId, epoch, contact, `schema:${id}`, 'a'.repeat(64), prior]); return { id, sourceId }; }
    // These child rows characterize SQL organization inference/immutability only;
    // placeholder ciphertext is NOT claimed to satisfy the production AEAD codec.
    it('resolution child routing uses its immutable parent organization and permits an append-only retry', async () => { const c = await session(); try {
        await c.query('SELECT public.communications_lock_send_gate($1)', [org]);
        const first = await intent(c);
        await c.query("INSERT INTO public.communication_intent_resolutions(intent_id,encrypted_proof,proof_key_version,proof_digest) VALUES($1,'synthetic-schema-proof','fixture',$2)", [first.id, 'b'.repeat(64)]);
        await intent(c, randomUUID(), first.sourceId, 2, first.id);
        await c.query('ROLLBACK');
    }
    finally {
        c.release();
    } });
    it('permit child routing uses its immutable parent organization and blocks later epoch creation', async () => { const c = await session(); try {
        await c.query('SELECT public.communications_lock_send_gate($1)', [org]);
        const first = await intent(c);
        await c.query("INSERT INTO public.communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES($1,$2,$3,$4,'synthetic-schema-receipt','fixture',$5)", [randomUUID(), first.id, `synthetic-admission-${first.id}`, `synthetic-journal-${first.id}`, 'c'.repeat(64)]);
        await c.query("INSERT INTO public.communication_intent_resolutions(intent_id,encrypted_proof,proof_key_version,proof_digest) VALUES($1,'synthetic-schema-proof','fixture',$2)", [first.id, 'b'.repeat(64)]);
        await c.query('SAVEPOINT forbidden_epoch');
        await expect(intent(c, randomUUID(), first.sourceId, 2, first.id)).rejects.toThrow();
        await c.query('ROLLBACK TO SAVEPOINT forbidden_epoch');
        await c.query('ROLLBACK');
    }
    finally {
        c.release();
    } });
    it('an admitted draft rejects edits/revocation but permits unchanged-byte sent materialization', async () => { const c = await local.pool.connect(), sequence = randomUUID(), enrollment = randomUUID(), message = randomUUID(), intentId = randomUUID(); try {
        await c.query('BEGIN');
        await c.query("INSERT INTO public.sequences(id,organization_id,name,steps,created_by) VALUES($1,$2,'Synthetic draft','[]',$3)", [sequence, org, owner]);
        await c.query("INSERT INTO public.sequence_enrolments(id,organization_id,sequence_id,target_id,contact_id,state) VALUES($1,$2,$3,$4,$5,'draft')", [enrollment, org, sequence, target, contact]);
        await c.query("INSERT INTO public.messages(id,organization_id,enrolment_id,step_number,purpose,subject,body,state,approved_by,approved_at) VALUES($1,$2,$3,1,'synthetic','Original subject','Original body','approved',$4,clock_timestamp())", [message, org, enrollment, owner]);
        await c.query("INSERT INTO public.communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes) VALUES($1,$2,$3,$4,'draft',$5,1,$6,$7,'message',$8,$8,'synthetic-schema-envelope','fixture',$8,clock_timestamp(),'[{}]')", [intentId, org, owner, bindingId, message, contact, `schema-draft:${intentId}`, 'a'.repeat(64)]);
        await c.query("INSERT INTO public.communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES($1,$2,$3,$4,'synthetic-schema-receipt','fixture',$5)", [randomUUID(), intentId, `synthetic-admission-${intentId}`, `synthetic-journal-${intentId}`, 'c'.repeat(64)]);
        for (const text of ["UPDATE public.messages SET body='Changed' WHERE id=$1", "UPDATE public.messages SET state='draft',approved_at=NULL WHERE id=$1", "DELETE FROM public.messages WHERE id=$1"]) {
            await c.query('SAVEPOINT blocked_draft');
            await expect(c.query(text, [message])).rejects.toThrow();
            await c.query('ROLLBACK TO SAVEPOINT blocked_draft');
        }
        expect((await c.query("UPDATE public.messages SET state='sent',provider_message_id='synthetic-verified-receipt',sent_at=clock_timestamp() WHERE id=$1", [message])).rowCount).toBe(1);
        await c.query('ROLLBACK');
    }
    finally {
        c.release();
    } });
    it('the actual intent repository refuses legacy reviewed booleans and retains the explicit DB-clock cutoff', async () => { const c = await local.pool.connect(), mandate = randomUUID(), sequence = randomUUID(), version = randomUUID(), enrollment = randomUUID(), attempt = randomUUID(), step = randomUUID(), source = { kind: 'campaign' as const, attemptId: attempt, enrolmentId: enrollment, versionId: version, stepId: step, stepIndex: 0, runtime: 'legacy' as const }; try {
        await c.query('BEGIN');
        await c.query("INSERT INTO public.mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic cutoff','{}','{}',$3)", [mandate, org, owner]);
        await c.query("INSERT INTO public.campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Synthetic cutoff','{}')", [sequence, org, owner, mandate]);
        await c.query("INSERT INTO public.campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition) VALUES($1,$2,$3,$4,1,$5)", [version, org, owner, sequence, JSON.stringify({ schemaVersion: 1, steps: [{ id: step, kind: 'email', title: 'Intro', subject: 'Hello', body: 'Hello' }] })]);
        await c.query('UPDATE public.contacts SET personal_data=$2::jsonb WHERE id=$1', [contact, JSON.stringify({ email: 'person@example.test' })]);
        await c.query("INSERT INTO public.campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,recipient_email,state,initial_conversation_reviewed,next_step_at) VALUES($1,$2,$3,$4,$5,$6,$7,'person@example.test','active',true,clock_timestamp()-interval '1 second')", [enrollment, org, owner, sequence, version, mandate, contact]);
        await c.query("INSERT INTO public.campaign_send_attempts(id,organization_id,owner_user_id,enrolment_id,step_index,rfc_message_id) VALUES($1,$2,$3,$4,0,'<synthetic-cutoff@example.test>')", [attempt, org, owner, enrollment]);
        await c.query("INSERT INTO public.campaign_contact_assignments(organization_id,owner_user_id,contact_id,email) VALUES($1,$2,$3,'person@example.test') ON CONFLICT DO NOTHING", [org, owner, contact]);
        await c.query("INSERT INTO public.campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id) VALUES($1,$2,$3,'email',$4)", [enrollment, org, owner, bindingId]);
        await c.query('COMMIT');
        const binding = { applicationId: 'acquire', tenantId: org, ownerId: owner, connectionId: `gate-connection-${suffix}`, accountId: `gate-account-${suffix}`, generation: 1, channel: 'email' as const, platform: 'gmail' as const, backend: 'unipile' as const }, repo = createAcquireSendAdmission({ pool: local.driver, binding, bindingId, codec: new JournalCodec({ activeVersion: 'gate-fixture', keys: [{ version: 'gate-fixture', encryptionKey: Buffer.alloc(32, 51), digestKey: Buffer.alloc(32, 52) }] }), verifyServiceAdmission: async () => false }), request = { source, message: { recipient: { kind: 'email' as const, value: 'person@example.test' }, subject: 'Hello', text: 'Hello' }, coverageScopes: [{ bindingId, scopeDigest: 'a'.repeat(64) }] };
        await expect(repo.prepare(request)).rejects.toThrow('Send authority unavailable');
        expect((await local.pool.query('SELECT count(*)::integer AS n FROM public.communication_dispatch_intents WHERE source_id=$1', [attempt])).rows[0].n).toBe(0);
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE acquire_campaign_user');
        await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [org, owner]);
        await c.query('SELECT public.communications_lock_send_gate($1)', [org]);
        const updated = await c.query('UPDATE public.campaign_enrolments SET communication_initial_reviewed_at=clock_timestamp() WHERE id=$1 RETURNING communication_initial_reviewed_at', [enrollment]);
        await c.query('COMMIT');
        const prepared = await repo.prepare(request);
        const recorded = (await local.pool.query('SELECT required_since FROM public.communication_dispatch_intents WHERE id=$1', [prepared.intentId])).rows[0];
        expect(recorded.required_since.toISOString()).toBe(updated.rows[0].communication_initial_reviewed_at.toISOString());
    }
    finally {
        await c.query('ROLLBACK');
        c.release();
    } });
});
