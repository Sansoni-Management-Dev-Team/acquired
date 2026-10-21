import { describe, expect, it, vi } from 'vitest';
import { createRecordedReplyIdentityResolver } from './communications-reply-identity';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { SqlClient } from '../../communications/packages/storage-postgres/src/webhook-repository';
vi.mock('server-only', () => ({}));
const actor = { organizationId: 'org', userId: 'owner' };
const binding: ConnectionBinding = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' };
const bindingId = '00000000-0000-4000-8000-000000000001';
const sender = { kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/person/' };
function fixture(rows: Record<string, unknown>[] = []) {
    const query = vi.fn(async (_sql:string,_values?:unknown[]) => {void _sql;void _values;return { rows, rowCount: rows.length };});
    const client = { query, release: vi.fn() } as unknown as SqlClient;
    const row = { binding_id: bindingId, application_id: 'acquire', organization_id: 'org', owner_user_id: 'owner', service_connection_id: 'connection', service_account_id: 'account', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile', authority: 'service', identity: 'urn:li:fsd_profile:verifiedPerson', source_identity: sender.value };
    return { query, client, row, input: { actor, binding, sender } };
}
describe('recorded owner-scoped campaign identity bridge', () => {
    it('uses the current transaction and exact recorded URL/URN proof, preserving scope in SQL', async () => {
        const f = fixture();
        f.query.mockResolvedValue({ rows: [f.row], rowCount: 1 });
        const resolve = createRecordedReplyIdentityResolver({ actor, binding, bindingId });
        await expect(resolve(f.client, f.input)).resolves.toEqual({ ...f.input, identity: f.row.identity });
        const [sql, values] = f.query.mock.calls.find(args=>String(args[0]).includes('FROM public.campaign_reply_identities')) as unknown as [
            string,
            unknown[]
        ];
        expect(sql).toContain('FOR SHARE OF i');
        expect(sql).not.toContain('FOR SHARE OF i,b');
        expect(sql).toContain('i.owner_user_id=b.owner_user_id');
        expect(sql).toContain('LIMIT 501');
        expect(values).toEqual([bindingId, 'acquire', 'org', 'owner', 'connection', 'account', 1, 'linkedin', 'linkedin', 'unipile', sender.value]);
    });
    it('does not invent a LinkedIn URN from a URL with no recorded evidence', async () => {
        const f = fixture();
        await expect(createRecordedReplyIdentityResolver({ actor, binding, bindingId })(f.client, f.input)).resolves.toBeNull();
    });
    it('allows multiple contacts only when their recorded identity is identical', async () => {
        const f = fixture();
        f.query.mockResolvedValue({ rows: [f.row, { ...f.row }], rowCount: 2 });
        await expect(createRecordedReplyIdentityResolver({ actor, binding, bindingId })(f.client, f.input)).resolves.toMatchObject({ identity: f.row.identity });
    });
    it('reviews conflicting URL-to-URN evidence', async () => {
        const f = fixture();
        f.query.mockResolvedValue({ rows: [f.row, { ...f.row, identity: 'urn:li:fsd_profile:other' }], rowCount: 2 });
        await expect(createRecordedReplyIdentityResolver({ actor, binding, bindingId })(f.client, f.input)).resolves.toBeNull();
    });
    for (const [field, value] of Object.entries({ binding_id: 'other', application_id: 'other', organization_id: 'foreign', owner_user_id: 'foreign', service_connection_id: 'other', service_account_id: 'other', generation: 2, channel: 'email', platform: 'gmail', backend: 'browser', authority: 'legacy_port', source_identity: 'https://www.linkedin.com/in/other/', identity: 'personName' })) {
        it(`rejects contradictory recorded ${field}`, async () => {
            const f = fixture();
            f.query.mockResolvedValue({ rows: [{ ...f.row, [field]: value }], rowCount: 1 });
            await expect(createRecordedReplyIdentityResolver({ actor, binding, bindingId })(f.client, f.input)).resolves.toBeNull();
        });
    }
    it('does not query a changed binding or owner', async () => {
        const f = fixture(), resolve = createRecordedReplyIdentityResolver({ actor, binding, bindingId });
        await expect(resolve(f.client, { ...f.input, binding: { ...binding, generation: 2 } })).resolves.toBeNull();
        await expect(resolve(f.client, { ...f.input, actor: { ...actor, userId: 'foreign' } })).resolves.toBeNull();
        expect(f.query).not.toHaveBeenCalled();
    });
    for (const channel of ['email', 'whatsapp'] as const) {
        it(`checks recorded ${channel} identity equals the canonical sender`, async () => {
            const f = fixture(), b = { ...binding, channel, platform: channel === 'email' ? 'gmail' as const : 'whatsapp' as const };
            const s = channel === 'email' ? { kind: 'email' as const, value: 'person@example.test' } : { kind: 'phone' as const, value: '+61412345678' };
            const identity = channel === 'email' ? s.value : '61412345678@s.whatsapp.net';
            f.query.mockResolvedValue({ rows: [{ ...f.row, channel, platform: b.platform, source_identity: s.value, identity }], rowCount: 1 });
            const resolve = createRecordedReplyIdentityResolver({ actor, binding: b, bindingId });
            await expect(resolve(f.client, { actor, binding: b, sender: s })).resolves.toMatchObject({ identity });
            f.query.mockResolvedValue({ rows: [{ ...f.row, channel, platform: b.platform, source_identity: s.value, identity: channel === 'email' ? 'other@example.test' : '61400000000@s.whatsapp.net' }], rowCount: 1 });
            await expect(resolve(f.client, { actor, binding: b, sender: s })).resolves.toBeNull();
        });
    }
    it('detaches configuration and rejects unbounded or executable input', async () => {
        const f = fixture(), b = { ...binding }, a = { ...actor }, resolve = createRecordedReplyIdentityResolver({ actor: a, binding: b, bindingId });
        b.generation = 2;
        a.userId = 'other';
        f.query.mockResolvedValue({ rows: [f.row], rowCount: 1 });
        await expect(resolve(f.client, f.input)).resolves.toMatchObject({ identity: f.row.identity });
        f.query.mockResolvedValue({ rows: Array.from({ length: 501 }, () => f.row), rowCount: 501 });
        await expect(resolve(f.client, f.input)).resolves.toBeNull();
        const getter = vi.fn(() => sender.value);
        const s = { kind: 'linkedin_profile' as const, get value() { return getter(); } };
        await expect(resolve(f.client, { ...f.input, sender: s })).resolves.toBeNull();
        expect(getter).not.toHaveBeenCalled();
    });
});

it('accepts an explicitly recorded canonical service URL without inventing a legacy provider URN',async()=>{const f=fixture();f.query.mockResolvedValue({rows:[{...f.row,identity:sender.value}],rowCount:1});expect(await createRecordedReplyIdentityResolver({actor,binding,bindingId})(f.client,f.input)).toEqual({...f.input,identity:sender.value,identityAuthority:'canonical_service'});});

it('resolves immutable demo route namespace without registering a global real-person alias',async()=>{const scope={kind:'demo',id:'11111111-1111-4111-8111-111111111111'},query=vi.fn(async(sql:string)=>({rows:sql.includes('to_regprocedure')?[{installed:true}]:sql.includes('agent_recorded_reply_execution_scope')?[{context:{registered:true,scope}}]:[],rowCount:1}));const resolve=createRecordedReplyIdentityResolver({actor,binding,bindingId});expect(await resolve({query,release:vi.fn()}as never,{actor,binding,sender:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/mapped'}})).toEqual({actor,binding,sender:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/mapped'},identity:'https://www.linkedin.com/in/mapped',identityAuthority:'canonical_service',identityScope:scope});expect(query.mock.calls.some(([sql])=>sql.includes('FROM public.campaign_reply_identities'))).toBe(false);});
it('registered demo binding with missing or ambiguous route fails without falling back to global aliases',async()=>{const query=vi.fn(async(sql:string)=>({rows:sql.includes('to_regprocedure')?[{installed:true}]:sql.includes('agent_recorded_reply_execution_scope')?[{context:{registered:true,scope:null}}]:[{identity:'urn:li:fsd_profile:mustNotUse'}],rowCount:1}));expect(await createRecordedReplyIdentityResolver({actor,binding,bindingId})({query,release:vi.fn()}as never,{actor,binding,sender})).toBeNull();expect(query.mock.calls.some(([sql])=>sql.includes('FROM public.campaign_reply_identities'))).toBe(false);});
