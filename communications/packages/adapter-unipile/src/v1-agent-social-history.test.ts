import {expect,it,vi} from 'vitest';
import {readUnipileAgentSocialHistory} from './v1-agent-social-history';
import {createUnipileV1ReplyEnricher,type V1ReplyReadTransport,type VerifiedReplyAlias} from './v1-reply-enrichment';
import {createUnipileV1HistoryOutboundNormalizer} from './v1-history-outbound';
import type {RecordedLifecycleConnection} from '../../core/src/connection-lifecycle';

const at='2026-10-14T09:00:00.000Z',now='2026-10-14T10:00:00.000Z';
function fixture(channel:'whatsapp'|'linkedin'='whatsapp'){
 const owner='owner-provider',recipient=channel==='whatsapp'?{kind:'phone' as const,value:'+61400000002'}:{kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/peer'};
 const binding={applicationId:'a',tenantId:'t',ownerId:'o',connectionId:'c',accountId:'p',generation:1,channel,platform:channel,backend:'unipile' as const},product=channel==='whatsapp'?'whatsapp' as const:'classic' as const;
 const record:RecordedLifecycleConnection={binding,providerAccountId:'provider',sourceId:'source',ownerIdentity:{namespace:channel==='whatsapp'?'unipile.v1.whatsapp.im.phone_number':'unipile.v1.linkedin.im.id',value:channel==='whatsapp'?'+61400000001':owner}};
 const account={object:'Account',id:'provider',type:channel.toUpperCase(),connection_params:{im:{id:owner,phone_number:'+61400000001'}},sources:[{id:'source',status:'OK'}]};
 const chat={object:'Chat',id:'chat',account_id:'provider',account_type:channel.toUpperCase(),type:0,read_only:0};
 const attendees={object:'ChatAttendeeList',cursor:null,items:[{object:'ChatAttendee',id:'self',account_id:'provider',provider_id:owner,is_self:1},{object:'ChatAttendee',id:'peer',account_id:'provider',provider_id:'peer-provider',is_self:0}]};
 const message=(id:string,out=false)=>({object:'Message',id,account_id:'provider',chat_id:'chat',sender_id:out?owner:'peer-provider',sender_attendee_id:out?'self':'peer',is_sender:out?1:0,is_event:0,hidden:0,deleted:0,timestamp:at,message_type:'MESSAGE',text:'Verified body '+id});
 const items=[message('incoming'),message('outgoing',true)];
 const transport={getAccount:vi.fn(async()=>({kind:'success' as const,status:200,data:account})),getChat:vi.fn(async()=>({kind:'success' as const,status:200,data:chat})),getChatAttendees:vi.fn(async()=>({kind:'success' as const,status:200,data:attendees})),getMessage:vi.fn(async(id:string)=>({kind:'success' as const,status:200,data:items.find(m=>m.id===id)})),getEmail:vi.fn()} satisfies V1ReplyReadTransport;
 const source={record,transport:{getAccount:transport.getAccount,list:vi.fn(async()=>({kind:'success' as const,status:200,data:{object:'MessageList',items,cursor:null}}))},eventAccountInfo:{ownerProviderId:owner,product},resolveCurrent:vi.fn(async()=>record),initialSync:vi.fn(async()=>({kind:'provider_sync_success' as const,record,completedAt:'2026-10-14T08:00:00.000Z',evidenceId:'verified-sync'})),now:()=>Date.parse(now)};
 const resolveAlias=vi.fn(async():Promise<VerifiedReplyAlias>=>({binding,providerAccountId:'provider',sourceId:'source',providerId:'peer-provider',product,identity:recipient}));
 const read=(readAndCommit?:Parameters<typeof readUnipileAgentSocialHistory>[0]['readAndCommit'])=>readUnipileAgentSocialHistory({source,transport,recipient,since:at,readAndCommit,normalize:t=>{const e=createUnipileV1ReplyEnricher({binding,providerAccountId:'provider',sourceId:'source',eventsFrom:at,transport:t,channel,ownerProviderId:owner,product,verifyOwner:async()=>true,resolveAlias,now:()=>Date.parse(now)});return(raw,b)=>e.normalize(raw,b);},normalizeOutbound:t=>{const n=createUnipileV1HistoryOutboundNormalizer({record,transport:t,ownerProviderId:owner,product,resolveAlias});return(raw,b,s)=>n.normalize(raw,b,s);}});
 return {record,items,transport,source,resolveAlias,read,chat};
}

it.each(['whatsapp','linkedin'] as const)('reads bounded verified full %s conversation bodies using the shared identity normalizers',async channel=>{
 const f=fixture(channel),result=await f.read();expect(result.complete).toBe(true);expect(result.messages).toEqual([{id:'incoming',direction:'inbound',at,text:'Verified body incoming',providerConversationId:'chat'},{id:'outgoing',direction:'outbound',at,text:'Verified body outgoing',providerConversationId:'chat'}]);
});
it('withholds completeness for missing/oversized full body text, including a metadata-only list',async()=>{
 for(const text of [undefined,'x'.repeat(6001)]){const f=fixture();Object.assign(f.items[0],{text});expect(await f.read()).toMatchObject({complete:false,messages:[]});}
});
it('does not borrow a different peer or group conversation as this person history',async()=>{
 const f=fixture();f.resolveAlias.mockResolvedValue({...await f.resolveAlias(),identity:{kind:'phone',value:'+61400000003'}});expect(await f.read()).toMatchObject({complete:true,messages:[]});
 const group=fixture();group.chat.type=1;expect((await group.read()).messages).toEqual([]);
});
it('requires original source sync and current account generation rather than a connected status alone',async()=>{
 const f=fixture();f.source.initialSync.mockResolvedValue(null as never);expect(await f.read()).toMatchObject({complete:false,messages:[]});
 const changed=fixture();changed.source.resolveCurrent.mockResolvedValue({...changed.record,binding:{...changed.record.binding,generation:2}});await expect(changed.read()).rejects.toThrow();
});
it('withholds full bodies if the durable history checkpoint did not commit',async()=>{
 const f=fixture(),commit=vi.fn(async(source,query)=>{await source.read(query);throw Error('checkpoint commit unknown');});await expect(f.read(commit)).rejects.toThrow('checkpoint commit unknown');expect(commit).toHaveBeenCalledOnce();
});
it('rejects a changed authenticated full body instead of silently using a later observation',async()=>{
 const f=fixture();f.transport.getMessage.mockResolvedValueOnce({kind:'success',status:200,data:{...f.items[0],text:'Conflicting body'}});f.items.push({...f.items[0]});expect(await f.read()).toMatchObject({complete:false,messages:[]});
});
