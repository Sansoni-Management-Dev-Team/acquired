import {expect,it,vi} from 'vitest';
import {createV1SocialRuntime} from './v1-social-runtime';
import {projectV1CanonicalOwner,UnipileV1OwnerReader} from './v1-owner';
import type {ConnectionBinding} from '../../contracts/src';
import type {AccountRuntimeRepository} from '../../storage-postgres/src/account-runtime';
import type {BusinessClock} from '../../core/src/business-clock';

const at=Date.parse('2030-01-07T01:00:00.000Z');
function invitationFixture(options:{businessClock?:BusinessClock;date?:string;invitation?:Record<string,unknown>;profile?:Record<string,unknown>;stallGrant?:boolean}={}) {
    const binding:ConnectionBinding={applicationId:'fixture',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'physical',generation:1,channel:'linkedin',platform:'linkedin',backend:'unipile'};
    const recipient={kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/peer/'};
    const account={object:'Account',id:'provider',type:'LINKEDIN',connection_params:{im:{id:'owned-member'}},sources:[{id:'im',status:'OK'}]};
    const ownerProfile={object:'AccountOwnerProfile',provider:'LINKEDIN',provider_id:'owned-member',public_identifier:'owned-member'};
    const proof=projectV1CanonicalOwner(account,ownerProfile,{platform:'linkedin',providerAccountId:'provider'});
    if(proof.kind!=='verified')throw Error('Invalid fixture owner');
    const receipt={operation:{binding,id:'original-invitation'},recipient};
    const fetch=vi.fn<typeof globalThis.fetch>(async(input,init)=>{
        const url=new URL(String(input));
        expect(init?.method??'GET').toBe('GET');
        if(url.pathname==='/api/v1/accounts/provider')return Response.json(account);
        expect(url.searchParams.get('account_id')).toBe('provider');
        if(url.pathname==='/api/v1/users/me')return Response.json(ownerProfile);
        if(url.pathname==='/api/v1/users/peer'){
            expect(url.searchParams.get('notify')).toBe('false');
            return Response.json({object:'UserProfile',provider:'LINKEDIN',provider_id:'peer-id',public_identifier:'peer',public_profile_url:recipient.value,is_self:false,...options.profile});
        }
        if(url.pathname==='/api/v1/users/invite/sent')return Response.json({object:'InvitationList',cursor:null,items:[{object:'InvitationSent',id:'original-invitation',invited_user_id:'peer-id',invited_user_public_id:'peer',inviter:{inviter_id:'owned-member'},parsed_datetime:options.date??new Date(at).toISOString(),...options.invitation}]});
        throw Error('Unexpected fixture request');
    });
    const config={apiVersion:'v1' as const,baseUrl:'https://fixture.example.test/api/v1',apiKey:'synthetic-only',fetch};
    const store={requireGrant:vi.fn(async()=>{if(options.stallGrant)await new Promise(()=>{});}),originalContext:vi.fn(async()=>({recipient})),originalReceipt:vi.fn(async()=>receipt)};
    const adapter=createV1SocialRuntime({...(options.businessClock?{businessClock:options.businessClock}:{}),connection:{binding,owner:proof.owner,status:'connected',active:true,isDefault:false},store:store as unknown as AccountRuntimeRepository,provider:config,ownerReader:new UnipileV1OwnerReader(config),timeoutMs:options.stallGrant?20:20000});
    const lookup={snapshot:{binding,key:'original-key',operation:'invitation' as const,payloadDigest:'a'.repeat(64)},expectedRecipient:recipient};
    return {adapter,lookup,receipt,fetch,store};
}

it('recovers the exact original invitation at selected 2030 time through actual social factory and relationship transport',async()=>{
    const f=invitationFixture({businessClock:{now:()=>at}});
    expect(await f.adapter.lookup(f.lookup)).toEqual({status:'submitted',receipt:{...f.receipt,submittedAt:new Date(at).toISOString()}});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toEqual({status:'submitted',receipt:{...f.receipt,submittedAt:new Date(at).toISOString()}});
    expect(f.fetch.mock.calls.some(([url])=>new URL(String(url)).pathname==='/api/v1/users/invite/sent')).toBe(true);
});
it('reads selected invitation time dynamically instead of capturing the initial clock value',async()=>{
    let now=at-1;
    const f=invitationFixture({businessClock:{now:()=>now}});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toBeNull();
    now=at;
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toEqual({status:'submitted',receipt:{...f.receipt,submittedAt:new Date(at).toISOString()}});
});
it.each(['future','default'] as const)('refuses %s invitation time without inventing an original timestamp',async mode=>{
    const f=invitationFixture(mode==='future'?{businessClock:{now:()=>at},date:new Date(at+1).toISOString()}:{});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toBeNull();
});
it('preserves ordinary unselected wall-time original invitation lookup',async()=>{
    const date='2026-01-01T00:00:00.000Z',f=invitationFixture({date});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toEqual({status:'submitted',receipt:{...f.receipt,submittedAt:date}});
});
it.each([{invited_user_id:'foreign-peer'},{invited_user_public_id:'foreign-public'},{inviter:{inviter_id:'foreign-owner'}},{id:'foreign-invitation'}])('preserves exact original invitation identity guards %j at selected time',async invitation=>{
    const f=invitationFixture({businessClock:{now:()=>at},invitation});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toBeNull();
});
it('preserves canonical peer profile corroboration under selected time',async()=>{
    const f=invitationFixture({businessClock:{now:()=>at},profile:{public_identifier:'foreign-peer'}});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toBeNull();
});
it('preserves original binding generation under selected time',async()=>{
    const f=invitationFixture({businessClock:{now:()=>at}});
    expect(await f.adapter.receiptDetails(f.lookup,{...f.receipt,operation:{...f.receipt.operation,binding:{...f.receipt.operation.binding,generation:2}}})).toBeNull();
});
it('keeps the outer ownership deadline real with a selected clock fixed years ahead',async()=>{
    const f=invitationFixture({businessClock:{now:()=>at},stallGrant:true});
    expect(await f.adapter.receiptDetails(f.lookup,f.receipt)).toBeNull();
    expect(f.fetch).not.toHaveBeenCalled();
});
