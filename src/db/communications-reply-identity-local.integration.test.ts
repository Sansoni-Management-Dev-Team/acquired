import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localCampaignDatabase } from '../../scripts/campaign-integration-support.mjs';
import { createRecordedReplyIdentityResolver } from '../lib/communications-reply-identity';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { SqlClient } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { CanonicalIdentity } from '../../communications/packages/contracts/src';

vi.mock('server-only', () => ({}));
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
describe.skipIf(!enabled)('approved002 recorded reply identity bridge under real owner RLS', () => {
    const client = new pg.Client({ connectionString: localCampaignDatabase, connectionTimeoutMillis: 5000 });
    const sql: SqlClient = {
        async query<Row>(text: string, values?: unknown[]) {
            const result = await client.query(text, values);
            return { rows: result.rows as Row[], rowCount: result.rowCount };
        }, release() { throw Error('Fixture client lifecycle is owned by test'); }
    };
    beforeAll(async () => {
        if (process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK !== '1') throw Error('Requires explicit isolated database opt-in');
        const url = new URL(localCampaignDatabase);
        if (url.hostname !== '127.0.0.1' || url.port !== '5445' || url.pathname !== '/acquire_channels') throw Error('Unexpected database target');
        await client.connect();
        const { rows: [row] } = await client.query("SELECT current_database() AS name,system_identifier::text AS identity,to_regclass('public.communication_bindings') AS bindings,to_regclass('public.campaign_reply_identities') AS identities FROM pg_control_system()");
        if (row.name !== 'acquire_channels' || row.identity !== '7694812678792806433' || !row.bindings || !row.identities)
            throw Error('Approved002 prerequisites missing; this test never applies migrations');
    });
    afterAll(() => client.end());
    async function fixture(channel: 'email' | 'whatsapp' | 'linkedin', run: (f: {
        actor: { organizationId: string; userId: string }; other: string; binding: ConnectionBinding; bindingId: string;
        sender: CanonicalIdentity; identity: string; add(identity?: string, owner?: string, source?: string): Promise<void>;
        resolve(): ReturnType<ReturnType<typeof createRecordedReplyIdentityResolver>>;
    }) => Promise<void>) {
        await client.query('BEGIN');
        try {
            const suffix = randomUUID(), org = `identity-review-org-${suffix}`, user = `identity-review-user-${suffix}`, other = `identity-review-other-${suffix}`;
            const mandate = randomUUID(), target = randomUUID(), bindingId = randomUUID();
            const actor = { organizationId: org, userId: user };
            const binding: ConnectionBinding = { applicationId: 'acquire', tenantId: org, ownerId: user, connectionId: `identity-review-connection-${suffix}`, accountId: `identity-review-account-${suffix}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile' };
            const sender: CanonicalIdentity = channel === 'email' ? { kind: 'email', value: 'person@example.invalid' } : channel === 'whatsapp' ? { kind: 'phone', value: '+61412345678' } : { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/synthetic-person/' };
            const identity = channel === 'email' ? sender.value : channel === 'whatsapp' ? '61412345678@s.whatsapp.net' : 'urn:li:fsd_profile:verifiedSynthetic';
            for (const id of [user, other])
                await client.query('INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$1,$2,false,now(),now())', [id, `${id}@example.invalid`]);
            await client.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)', [org]);
            for (const id of [user, other])
                await client.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'member')", [randomUUID(), org, id]);
            await client.query("INSERT INTO public.mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic identity review','{}','{}',$3)", [mandate, org, user]);
            await client.query("INSERT INTO public.targets(id,organization_id,mandate_id,company_name,firmographics) VALUES($1,$2,$3,'Synthetic','{}')", [target, org, mandate]);
            await client.query("INSERT INTO public.communication_bindings(id,application_id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,'acquire',$2,$3,$4,$5,1,$6,$7,'unipile','service')", [bindingId, org, user, binding.connectionId, binding.accountId, channel, binding.platform]);
            async function owner() {
                await client.query('SET LOCAL ROLE acquire_campaign_user');
                await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [org, user]);
            }
            async function add(mapped = identity, recordedOwner = user, source = sender.value) {
                await client.query('RESET ROLE');
                const contact = randomUUID();
                await client.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,provenance) VALUES($1,$2,$3,'Synthetic','{}')", [contact, org, target]);
                await client.query('INSERT INTO public.campaign_contact_assignments(organization_id,contact_id,owner_user_id,email) VALUES($1,$2,$3,$4)', [org, contact, recordedOwner, `${contact}@example.invalid`]);
                await client.query("INSERT INTO public.campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES($1,$2,$3,$4,$5,$6,$7,'2026-01-01')", [org, recordedOwner, contact, channel, mapped, source, `${contact}@example.invalid`]);
                await owner();
            }
            await add();
            const resolve = createRecordedReplyIdentityResolver({ actor, binding, bindingId });
            await run({ actor, other, binding, bindingId, sender, identity, add, resolve: () => resolve(sql, { actor, binding, sender }) });
        } finally { await client.query('ROLLBACK'); }
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('resolves exact recorded %s identity without broad binding UPDATE privileges', async channel => {
        await fixture(channel, async f => {
            const { rows: [privileges] } = await client.query("SELECT current_user AS role,has_table_privilege(current_user,'public.communication_bindings','UPDATE') AS binding_update");
            expect(privileges).toEqual({ role: 'acquire_campaign_user', binding_update: false });
            expect(await f.resolve()).toEqual({ actor: f.actor, binding: f.binding, sender: f.sender, identity: f.identity });
        });
    });
    it('preserves duplicates only when every recorded LinkedIn identity agrees', async () => fixture('linkedin', async f => {
        await f.add();
        expect(await f.resolve()).toMatchObject({ identity: f.identity });
        await f.add('urn:li:fsd_profile:conflictingSynthetic');
        expect(await f.resolve()).toBeNull();
    }));
    it('does not let foreign-owner evidence contradict or supply the current owner mapping', async () => fixture('linkedin', async f => {
        await f.add('urn:li:fsd_profile:otherOwner', f.other);
        expect(await f.resolve()).toMatchObject({ identity: f.identity });
        await client.query("SELECT set_config('app.acquire_user',$1,true)", [f.other]);
        expect(await f.resolve()).toBeNull();
        await client.query("SELECT set_config('app.acquire_user',$1,true),set_config('app.acquire_org','foreign-organization',true)", [f.actor.userId]);
        expect(await f.resolve()).toBeNull();
    }));
    it.each(['email', 'whatsapp'] as const)('reviews contradictory recorded %s mappings rather than changing the canonical sender', async channel => fixture(channel, async f => {
        await f.add(channel === 'email' ? 'other@example.invalid' : '61400000000@s.whatsapp.net');
        expect(await f.resolve()).toBeNull();
    }));
    it('rejects missing source evidence and a different original account or generation', async () => fixture('linkedin', async f => {
        const resolve = createRecordedReplyIdentityResolver({ actor: f.actor, binding: f.binding, bindingId: f.bindingId });
        expect(await resolve(sql, { actor: f.actor, binding: f.binding, sender: { ...f.sender, value: 'https://www.linkedin.com/in/unrecorded/' } })).toBeNull();
        for (const change of [{ accountId: 'other-account' }, { generation: 2 }]) {
            const changed = { ...f.binding, ...change };
            expect(await createRecordedReplyIdentityResolver({ actor: f.actor, binding: changed, bindingId: f.bindingId })(sql, { actor: f.actor, binding: changed, sender: f.sender })).toBeNull();
        }
    }));
    it('loses binding visibility after current membership revocation without deleting historical identity', async () => fixture('linkedin', async f => {
        await client.query('RESET ROLE');
        await client.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2', [f.actor.organizationId, f.actor.userId]);
        await client.query('SET LOCAL ROLE acquire_campaign_user');
        expect(await f.resolve()).toBeNull();
        await client.query('RESET ROLE');
        expect((await client.query('SELECT count(*)::int AS n FROM public.campaign_reply_identities WHERE organization_id=$1', [f.actor.organizationId])).rows[0].n).toBe(1);
    }));
});
