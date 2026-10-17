import {it,expect,vi} from 'vitest';
import {readUnipileAgentEmailHistory} from './v1-agent-email-history';
import {createUnipileV1HistoryOutboundNormalizer} from './v1-history-outbound';
import {createUnipileV1ReplyEnricher} from './v1-reply-enrichment';
import type {V1ReplyReadTransport} from './v1-reply-enrichment';
import type {RecordedLifecycleConnection} from '../../core/src/connection-lifecycle';
const record:RecordedLifecycleConnection={binding:{applicationId:'a',tenantId:'t',ownerId:'o',connectionId:'c',accountId:'p',generation:1,channel:'email',platform:'gmail',backend:'unipile'},providerAccountId:'provider',sourceId:'source',ownerIdentity:{namespace:'unipile.v1.google.mail.id',value:'mail-owner'}},at='2026-10-14T09:00:00.000Z',now='2026-10-14T10:00:00.000Z',person=(identifier:string)=>({identifier,identifier_type:'EMAIL_ADDRESS'});
const mail=(id:string,from='peer@example.com',to='owner@example.com')=>({object:'Email',kind:'2_full',id,account_id:'provider',date:at,role:from==='owner@example.com'?'sent':'inbox',from_attendee:person(from),to_attendees:[person(to)],cc_attendees:[],bcc_attendees:[],headers:[{name:'Message-ID',value:'<'+id+'@fixture.invalid>'},{name:'Auto-Submitted',value:'no'}],subject:'Synthetic subject',body:'Synthetic body '+id});
function fixture(items=[mail('incoming'),mail('outgoing','owner@example.com','peer@example.com'),mail('other','other@example.com')]){
 const account={object:'Account',id:'provider',type:'GOOGLE_OAUTH',connection_params:{mail:{id:'mail-owner'}},sources:[{id:'source',status:'OK'}]},transport={getAccount:vi.fn(async()=>({kind:'success' as const,status:200,data:account})),getEmail:vi.fn(async(_account:string,id:string)=>({kind:'success' as const,status:200,data:items.find(m=>m.id===id)})),getChat:vi.fn(),getChatAttendees:vi.fn(),getMessage:vi.fn()} as V1ReplyReadTransport;
 const source={record,transport:{getAccount:transport.getAccount,list:vi.fn(async()=>({kind:'success' as const,status:200,data:{object:'EmailList',items,cursor:null}}))},resolveCurrent:vi.fn(async()=>record),initialSync:async()=>null,now:()=>Date.parse(now)};
 return {items,transport,source,read:(readAndCommit?:Parameters<typeof readUnipileAgentEmailHistory>[0]['readAndCommit'])=>readUnipileAgentEmailHistory({source,readAndCommit,transport,recipient:'peer@example.com',since:at,normalize:t=>{const enricher=createUnipileV1ReplyEnricher({binding:record.binding,providerAccountId:'provider',sourceId:'source',eventsFrom:at,transport:t,channel:'email',ownerAddresses:['owner@example.com'],verifyOwner:async()=>true,resolveAlias:async()=>null,historyAllFolders:true,now:()=>Date.parse(now)});return (raw,b)=>enricher.normalize(raw,b);},normalizeOutbound:t=>{const normalizer=createUnipileV1HistoryOutboundNormalizer({record,transport:t,ownerAddresses:['owner@example.com'],product:'classic',resolveAlias:async()=>null});return (raw,b,s)=>normalizer.normalize(raw,b,s);}})};
}
it('hydrates verified inbound and actual owner-sent history across threads, excluding other peers',async()=>{const f=fixture(),result=await f.read();expect(result.complete).toBe(true);expect(result.messages).toEqual([{id:'incoming',direction:'inbound',at,subject:'Synthetic subject',text:'Synthetic body incoming'},{id:'outgoing',direction:'outbound',at,subject:'Synthetic subject',text:'Synthetic body outgoing'}]);expect(JSON.stringify(result.messages)).not.toContain('other');});
it('does not silently truncate oversized full messages',async()=>{const message=mail('oversized');message.body='x'.repeat(6001);const result=await fixture([message]).read();expect(result).toMatchObject({complete:false,messages:[]});});
it('does not certify a different account or changed current generation',async()=>{const f=fixture();f.source.resolveCurrent.mockResolvedValue({...record,binding:{...record.binding,generation:2}});await expect(f.read()).rejects.toThrow();});
it('requires complete full message bodies rather than treating metadata as an empty reply',async()=>{const message=mail('metadata');delete (message as Partial<typeof message>).body;const result=await fixture([message]).read();expect(result).toMatchObject({complete:false,messages:[]});});
it('requires human review above the 200-message conversation bound',async()=>{const result=await fixture(Array.from({length:201},(_,i)=>mail('mail-'+i))).read();expect(result).toMatchObject({complete:false,messages:[]});});

it('lets durable checkpoint commit surround the same single scan, and withholds results after a failed commit',async()=>{
 const successful=fixture(),commit=vi.fn(async(source,query)=>source.read(query));
 expect((await successful.read(commit)).complete).toBe(true);expect(commit).toHaveBeenCalledTimes(1);expect(successful.source.transport.list).toHaveBeenCalledTimes(1);
 const uncertain=fixture();await expect(uncertain.read(async(source,query)=>{await source.read(query);throw Error('Checkpoint commit unknown');})).rejects.toThrow('Checkpoint commit unknown');
});

it('blocks native outreach on a verified machine delivery failure for the exact recorded peer without inventing a human reply',async()=>{
 const bounce=mail('dsn','mailer-daemon@example.net');bounce.headers=[{name:'Return-Path',value:'<>'},{name:'Content-Type',value:'multipart/report; report-type=delivery-status'},{name:'X-Failed-Recipients',value:'peer@example.com'}];
 const result=await fixture([bounce]).read();expect(result).toMatchObject({complete:false,messages:[],deliveryFailures:[{id:'dsn',at}]});
 expect(JSON.stringify(result)).not.toContain('Synthetic body');
});
it('does not classify body text, ordinary lead mail or a different failed recipient as a bounce for this conversation',async()=>{
 const ordinary=mail('ordinary');ordinary.body='mailer-daemon delivery failed peer@example.com';
 const other=mail('other-dsn','mailer-daemon@example.net');other.headers=[{name:'Return-Path',value:'<>'},{name:'Content-Type',value:'multipart/report; report-type=delivery-status'},{name:'X-Failed-Recipients',value:'other@example.com'}];
 const result=await fixture([ordinary,other]).read();expect(result.complete).toBe(true);expect(result.messages.map(m=>m.id)).toEqual(['ordinary']);expect(result).not.toHaveProperty('deliveryFailures');
});
it('requires review for unattributable or contradictory machine bounce recipients rather than silently certifying full lead history',async()=>{
 for(const value of ['', 'peer@example.com, other@example.com', 'Peer <peer@example.com>']){
  const bounce=mail('ambiguous-dsn','mailer-daemon@example.net');bounce.headers=[{name:'Return-Path',value:'<>'},{name:'Content-Type',value:'multipart/report; report-type=delivery-status'},{name:'X-Failed-Recipients',value}];
  expect(await fixture([bounce]).read()).toMatchObject({complete:false,messages:[]});
 }
});
it('never certifies complete history when authenticated full DSN recipient evidence changes between reads',async()=>{
 const bounce=mail('changing-dsn','mailer-daemon@example.net');bounce.headers=[{name:'Return-Path',value:'<>'},{name:'Content-Type',value:'multipart/report; report-type=delivery-status'},{name:'X-Failed-Recipients',value:'peer@example.com'}];const changed=structuredClone(bounce);changed.headers[2].value='other@example.com';const f=fixture([bounce]);vi.mocked(f.transport.getEmail).mockResolvedValueOnce({kind:'success',status:200,data:bounce}).mockResolvedValue({kind:'success',status:200,data:changed});expect(await f.read()).toMatchObject({complete:false,messages:[]});
});
