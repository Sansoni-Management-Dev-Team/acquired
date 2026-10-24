import {runWithTransportBoundary} from '../../core/src/transport-boundary';
import { describe, it, expect, vi } from 'vitest';
import { createV1SocialRuntime } from './v1-social-runtime';
import { messageDigest } from '../../core/src/message-digest';
import type { ConnectionBinding } from '../../contracts/src';
import {createPostgresAccountRuntime,type AccountRuntimeRepository} from '../../storage-postgres/src/account-runtime';
import {AccountRuntimeVault} from '../../storage-postgres/src/account-vault';
const b: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' }, recipient = { kind: 'phone' as const, value: '+447700900123' };
const own = { platform: 'whatsapp' as const, providerAccountId: 'provider', sourceId: 'im', providerOwner: { namespace: 'unipile.v1.whatsapp.im.phone_number', value: '+447700900999' }, physicalOwner: { namespace: 'e164' as const, value: '+447700900999' }, canonicalIdentity: { kind: 'phone' as const, value: '+447700900999' }, aliases: [], status: 'connected' as const, capabilities: { messaging: { send: true, receiptLookup: true, durableIdempotency: false }, events: { read: false, history: false, realtime: false } } };
function fixture(timeoutMs = 20000) {
    let lost = false, badProfile = false, lookupFailed = false, lookupStalled = false,lid=false;
    const requests: {
        method: string;
        url: URL;
        form?: FormData;
    }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = new URL(String(input)), method = init?.method ?? 'GET';
        requests.push({ method, url, ...(init?.body instanceof FormData ? { form: init.body } : {}) });
        if (method === 'POST') {
            if (lost)
                throw Error('Synthetic lost write response');
            return Response.json({ object: 'ChatStarted', chat_id: 'new-chat', message_id: 'new-message' }, { status: 201 });
        }
        if (url.pathname.includes('/users/'))
            return Response.json({ object: 'UserProfile', provider: 'WHATSAPP', id: badProfile ? 'another@s.whatsapp.net' : lid?'opaque-peer@lid':'447700900123@s.whatsapp.net',...(lid?{phone_number:recipient.value}:{}) });
        if (url.pathname.includes('/messages/')) {
            if (lookupStalled)
                return new Promise(() => { });
            if (lookupFailed)
                throw Error('Synthetic read unavailable');
            return Response.json({ object: 'Message', id: 'new-message', account_id: 'provider', chat_id: 'new-chat', is_sender: 1, is_event: 0, hidden: 0, deleted: 0, timestamp: '2026-01-01T00:00:00.000Z' });
        }
        if (url.pathname.endsWith('/attendees'))
            return Response.json({ object: 'ChatAttendeeList', cursor: null, items: [{ object: 'ChatAttendee', id: 'own', account_id: 'provider', provider_id: '447700900999@s.whatsapp.net', is_self: 1 }, { object: 'ChatAttendee', id: 'peer', account_id: 'provider', provider_id: lid?'opaque-peer@lid':'447700900123@s.whatsapp.net', is_self: 0 }] });
        return Response.json({ object: 'Chat', id: 'new-chat', account_id: 'provider', type: 0, read_only: 0 });
    });
    const strictGrant=createPostgresAccountRuntime({applicationId:b.applicationId,integrationId:'fixture',providerConfigurationReference:'fixture-v1',pool:{connect:async()=>({query:async(sql:string,values?:unknown[])=>sql.startsWith('SELECT current_user')?{rows:[{role_name:'communications_control',rolsuper:false,rolbypassrls:false,rolcanlogin:false}]}:sql.includes('communications.access_grants')?{rows:[{application_id:values![0],tenant_id:values![1],owner_id:values![2]}]}:{rows:[]},release:()=>{}})} as never,vault:new AccountRuntimeVault({activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,1),digestKey:Buffer.alloc(32,2)}],identityKey:Buffer.alloc(32,3),identityKeyVersion:'v1'})});
    const store = { requireGrant: vi.fn(strictGrant.requireGrant.bind(strictGrant)), originalContext: vi.fn(async () => ({ recipient })), originalReceipt: vi.fn(async () => null) } as unknown as AccountRuntimeRepository;
    const reader = { verify: vi.fn(async () => ({ kind: 'verified', owner: own })) };
    const adapter = createV1SocialRuntime({ connection: { binding: b, owner: own, status: 'connected', active: true, isDefault: false }, store, provider: { apiVersion: 'v1', baseUrl: 'https://synthetic.unipile.example:20255/api/v1', apiKey: 'synthetic', fetch }, ownerReader: reader as never, timeoutMs });
    const message = { recipient, text: 'Synthetic first message' }, request = { snapshot: { binding: b, key: 'original-key', operation: 'message' as const, payloadDigest: messageDigest('message', message) }, message };
    return { adapter, request, requests, fetch,store,reader,lid:()=>{lid=true;}, lost: () => { lost = true; }, badProfile: () => { badProfile = true; }, lookupFailed: () => { lookupFailed = true; }, lookupStalled: () => { lookupStalled = true; } };
}
describe('journal-bound social runtime', () => {
    it('passes exact access scope to the real strict account repository before declaring social readiness',async()=>{const f=fixture();expect(await f.adapter.ready(b)).toEqual({status:'ready'});expect(f.store.requireGrant).toHaveBeenCalledWith({applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId});expect(f.reader.verify).toHaveBeenCalled();expect(f.requests).toHaveLength(0);});
    it('uses the same strict original scope for LinkedIn readiness and denies a revoked grant before provider ownership reads',async()=>{
        const f=fixture(),linked={...b,channel:'linkedin' as const,platform:'linkedin' as const},owner={...own,platform:'linkedin' as const,physicalOwner:{namespace:'linkedin_member' as const,value:'ACo_owner'},providerOwner:{namespace:'unipile.v1.linkedin.im.id',value:'ACo_owner'},canonicalIdentity:{kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/synthetic-owner'}},reader={verify:vi.fn(async()=>({kind:'verified',owner}))},adapter=createV1SocialRuntime({connection:{binding:linked,owner,status:'connected',active:true,isDefault:false},store:f.store,provider:{apiVersion:'v1',baseUrl:'https://synthetic.unipile.example:20255/api/v1',apiKey:'synthetic',fetch:f.fetch},ownerReader:reader as never});
        expect(await adapter.ready(linked)).toEqual({status:'ready'});expect(f.store.requireGrant).toHaveBeenCalledWith({applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId});
        reader.verify.mockClear();vi.mocked(f.store.requireGrant).mockRejectedValue(Error('Synthetic current grant revoked'));
        expect(await adapter.ready(linked)).toEqual({status:'waiting',code:'unavailable'});expect(reader.verify).not.toHaveBeenCalled();expect(f.requests).toHaveLength(0);
    });
    it('new conversation sends text atomically once with verified attendee and enriches actual returned receipt time', async () => { const f = fixture(); expect(await f.adapter.submit(f.request)).toMatchObject({ status: 'submitted', receipt: { message: { id: 'new-message', binding: b }, conversation: { id: 'new-chat' }, submittedAt: '2026-01-01T00:00:00.000Z' } }); const writes = f.requests.filter(x => x.method === 'POST'); expect(writes).toHaveLength(1); expect(writes[0].url.pathname).toBe('/api/v1/chats'); expect(writes[0].form?.get('account_id')).toBe('provider'); expect(writes[0].form?.getAll('attendees_ids')).toEqual(['447700900123@s.whatsapp.net']); });
    it('lost first-chat response remains unknown without retry/search/resend', async () => { const f = fixture(); f.lost(); expect(await f.adapter.submit(f.request)).toEqual({ status: 'unknown' }); expect(f.requests.filter(x => x.method === 'POST')).toHaveLength(1); expect(f.requests.filter(x => x.url.pathname.includes('/messages/'))).toHaveLength(0); });
    it('uses an authenticated phone-to-LID mapping without guessing a PN attendee',async()=>{const f=fixture();f.lid();expect(await f.adapter.submit(f.request)).toMatchObject({status:'submitted',receipt:{recipient}});expect(f.requests.filter(x=>x.method==='POST')).toHaveLength(1);expect(f.requests.find(x=>x.method==='POST')?.form?.getAll('attendees_ids')).toEqual(['opaque-peer@lid']);});
    it('mismatched recipient profile prevents all mutating requests', async () => { const f = fixture(); f.badProfile(); expect(await f.adapter.submit(f.request)).toMatchObject({ status: 'review' }); expect(f.requests.filter(x => x.method === 'POST')).toHaveLength(0); });
    it('receipt read failure preserves distinct acknowledged IDs without fabricated timestamp', async () => { const f = fixture(); f.lookupFailed(); expect(await f.adapter.submit(f.request)).toEqual({ status: 'submitted', receipt: { message: { binding: b, id: 'new-message' }, conversation: { binding: b, id: 'new-chat' }, recipient } }); expect(f.requests.filter(x => x.method === 'POST')).toHaveLength(1); });
    it('overall enrichment timeout retains already acknowledged message/chat IDs without a fabricated timestamp', async () => { const f = fixture(20); f.lookupStalled(); expect(await f.adapter.submit(f.request)).toEqual({ status: 'submitted', receipt: { message: { binding: b, id: 'new-message' }, conversation: { binding: b, id: 'new-chat' }, recipient } }); expect(f.requests.filter(x => x.method === 'POST')).toHaveLength(1); });
});

it('refuses a new chat POST when the durable transport boundary fails',async()=>{const f=fixture(),start=vi.fn(async()=>{throw Error('gate closed')});await runWithTransportBoundary(f.request.snapshot,start,()=>f.adapter.submit(f.request));expect(start).toHaveBeenCalledTimes(1);expect(f.requests.filter(r=>r.method==='POST')).toHaveLength(0);});
it('cannot POST after a delayed transport boundary outlives the social budget',async()=>{const f=fixture(15);let release!:()=>void;const gate=new Promise<void>(r=>release=r),start=vi.fn(()=>gate);await runWithTransportBoundary(f.request.snapshot,start,()=>f.adapter.submit(f.request));release();await new Promise(r=>setTimeout(r,5));expect(start).toHaveBeenCalledTimes(1);expect(f.requests.filter(r=>r.method==='POST')).toHaveLength(0);});
it('guards existing-chat messages with the exact original snapshot before POST',async()=>{const f=fixture(),conversation={binding:b,id:'new-chat'},message={...f.request.message,conversation},request={snapshot:{...f.request.snapshot,payloadDigest:messageDigest('message',message)},message};vi.mocked(f.store.originalContext).mockResolvedValue({recipient,conversation});const start=vi.fn(async()=>{throw Error('closed')});await runWithTransportBoundary(request.snapshot,start,()=>f.adapter.submit(request));expect(start).toHaveBeenCalledTimes(1);expect(f.requests.filter(r=>r.method==='POST')).toHaveLength(0);});
it('guards LinkedIn invitation POST independently of message dispatch',async()=>{const f=fixture(),linked={...b,channel:'linkedin' as const,platform:'linkedin' as const},target={kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/synthetic-peer'},owner={...own,platform:'linkedin' as const,physicalOwner:{namespace:'linkedin_member' as const,value:'ACo_owner'},providerOwner:{namespace:'unipile.v1.linkedin.im.id',value:'ACo_owner'},canonicalIdentity:{kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/synthetic-owner'}};vi.mocked(f.store.originalContext).mockResolvedValue({recipient:target});const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({object:'UserProfile',provider:'LINKEDIN',provider_id:'ACo_peer',public_identifier:'synthetic-peer',is_self:false})),adapter=createV1SocialRuntime({connection:{binding:linked,owner,status:'connected',active:true,isDefault:false},store:f.store,provider:{apiVersion:'v1',baseUrl:'https://synthetic.unipile.example:20255/api/v1',apiKey:'synthetic',fetch},ownerReader:{verify:async()=>({kind:'verified',owner})} as never}),message={recipient:target,text:'Synthetic invite'},request={snapshot:{binding:linked,key:'invitation-key',operation:'invitation' as const,payloadDigest:messageDigest('invitation',message)},message},start=vi.fn(async()=>{throw Error('closed')});await runWithTransportBoundary(request.snapshot,start,()=>adapter.submit(request));expect(start).toHaveBeenCalledTimes(1);expect(fetch.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);});
