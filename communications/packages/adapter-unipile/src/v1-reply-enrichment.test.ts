import {describe,expect,it,vi} from 'vitest';
import {createUnipileV1ReplyEnricher,ReplyEnrichmentReadError,type V1ReplyEnrichmentOptions,type VerifiedReplyAlias} from './v1-reply-enrichment';
import type {ConnectionBinding} from '../../contracts/src';
import type {UnipileHttpResult,UnipileRequestOptions} from './http-core';

const now=Date.parse('2026-10-12T12:00:00.000Z'),at='2026-10-12T11:59:00.000Z';
const base:ConnectionBinding={applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'linkedin',platform:'linkedin',backend:'unipile'};
const ok=(data:unknown):UnipileHttpResult=>({kind:'success',status:200,data});
const review={kind:'review',code:'protocol'};
function fixture(channel:'email'|'whatsapp'|'linkedin'='linkedin'){
 const binding={...base,channel,platform:channel==='email'?'gmail' as const:channel};
 const sender=channel==='whatsapp'?{kind:'phone' as const,value:'+61400000002'}:{kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/peer'};
 const account={object:'Account',id:'provider-account',type:channel==='email'?'GOOGLE_OAUTH':channel.toUpperCase(),connection_params:channel==='email'?{mail:{username:'owner@example.com'}}:{im:{id:'owner-provider',phone_number:'+61400000001'}},sources:[{id:'source',status:'OK'}]};
 const chat={object:'Chat',id:'chat',account_id:'provider-account',account_type:channel.toUpperCase(),type:0,read_only:0};
 const attendees={object:'ChatAttendeeList',cursor:null,items:[{object:'ChatAttendee',id:'own-attendee',account_id:'provider-account',provider_id:'owner-provider',is_self:1},{object:'ChatAttendee',id:'peer-attendee',account_id:'provider-account',provider_id:'peer-provider',is_self:0}]};
 const message={object:'Message',id:'message',account_id:'provider-account',chat_id:'chat',sender_id:'peer-provider',sender_attendee_id:'peer-attendee',is_sender:0,is_event:0,hidden:0,deleted:0,timestamp:at,message_type:'MESSAGE'};
 const mail={object:'Email',kind:'2_full',id:'mail',account_id:'provider-account',date:at,role:'inbox',from_attendee:{identifier:'peer@example.com',identifier_type:'EMAIL_ADDRESS'},to_attendees:[{identifier:'owner@example.com',identifier_type:'EMAIL_ADDRESS'}],cc_attendees:[],bcc_attendees:[],headers:[{name:'Auto-Submitted',value:'no'}]};
 const transport={getAccount:vi.fn<(id:string,options?:UnipileRequestOptions)=>Promise<UnipileHttpResult>>(async()=>ok(account)),getChat:vi.fn<(account:string,id:string,options?:UnipileRequestOptions)=>Promise<UnipileHttpResult>>(async()=>ok(chat)),getChatAttendees:vi.fn<(account:string,id:string,options?:UnipileRequestOptions)=>Promise<UnipileHttpResult>>(async()=>ok(attendees)),getMessage:vi.fn<(id:string,options?:UnipileRequestOptions)=>Promise<UnipileHttpResult>>(async()=>ok(message)),getEmail:vi.fn<(account:string,id:string,options?:UnipileRequestOptions)=>Promise<UnipileHttpResult>>(async()=>ok(mail))};
 const verifyOwner=vi.fn(async()=>true);
 const aliasBinding=structuredClone(binding);
 const resolveAlias=vi.fn<(input?:unknown)=>Promise<VerifiedReplyAlias|null>>(async()=>({binding:structuredClone(aliasBinding),providerAccountId:'provider-account',sourceId:'source',providerId:'peer-provider',product:channel==='whatsapp'?'whatsapp':'classic',identity:sender}));
 const options:V1ReplyEnrichmentOptions={binding,providerAccountId:'provider-account',sourceId:'source',eventsFrom:'2026-10-12T11:00:00.000Z',transport,now:()=>now,verifyOwner,resolveAlias,...(channel==='email'?{channel,ownerAddresses:['owner@example.com']}:{channel,ownerProviderId:'owner-provider',product:channel==='whatsapp'?'whatsapp':'classic'})};
 const raw:Record<string,unknown>=channel==='email'?{event:'mail_received',account_id:'provider-account',email_id:'mail',date:at,is_complete:false}:{event:'message_received',account_id:'provider-account',account_type:channel.toUpperCase(),account_info:{type:channel.toUpperCase(),user_id:'owner-provider',...(channel==='linkedin'?{feature:'classic'}:{})},message_id:'message',chat_id:'chat',timestamp:at,sender:{attendee_id:'peer-attendee',attendee_provider_id:'peer-provider'}};
 return {binding,options,raw,transport,verifyOwner,resolveAlias,account,chat,attendees,message,mail,api:createUnipileV1ReplyEnricher(options)};
}
describe('read-only Unipile reply enrichment',()=>{
 it.each(['organization','invented','whatsapp'])('rejects unsupported runtime LinkedIn product %s',async product=>{const f=fixture();Object.assign(f.options,{product});expect(()=>createUnipileV1ReplyEnricher(f.options)).toThrow('Invalid reply enrichment configuration');expect(f.transport.getAccount).not.toHaveBeenCalled();});
 it('rejects mismatched runtime WhatsApp product',()=>{const f=fixture('whatsapp');Object.assign(f.options,{product:'classic'});expect(()=>createUnipileV1ReplyEnricher(f.options)).toThrow('Invalid reply enrichment configuration');});
 it.each([{addresses:[]},{addresses:['Name <owner@example.com>']},{addresses:['OWNER@example.com']},{addresses:undefined}])('requires canonical recorded owner addresses %#',async({addresses})=>{const f=fixture('email');Object.assign(f.options,{ownerAddresses:addresses});expect(()=>createUnipileV1ReplyEnricher(f.options)).toThrow('Invalid reply enrichment configuration');});
 it.each(['email','whatsapp','linkedin'] as const)('fetches scoped evidence for %s and returns an actual incoming event',async channel=>{
  const f=fixture(channel),r=await f.api.normalize(f.raw,f.binding);expect(r.kind).toBe('event');if(r.kind==='event')expect(r.event).toMatchObject({type:'message',direction:'inbound',reference:{binding:f.binding}});
  expect(f.verifyOwner).toHaveBeenCalledOnce();expect(f.transport.getAccount).toHaveBeenCalledOnce();
  if(channel==='email'){expect(f.transport.getEmail).toHaveBeenCalledWith('provider-account','mail',expect.objectContaining({signal:expect.any(AbortSignal)}));expect(f.resolveAlias).not.toHaveBeenCalled();}
  else {expect(f.transport.getChat).toHaveBeenCalledOnce();expect(f.transport.getChatAttendees).toHaveBeenCalledOnce();expect(f.transport.getMessage).toHaveBeenCalledWith('message',expect.objectContaining({signal:expect.any(AbortSignal)}));expect(f.resolveAlias).toHaveBeenCalledWith(expect.objectContaining({binding:f.binding,providerAccountId:'provider-account',sourceId:'source',providerId:'peer-provider'}));}
 });
 it('does not fetch for nonreply events',async()=>{const f=fixture();expect(await f.api.normalize({...f.raw,event:'message_read'},f.binding)).toEqual({kind:'ignore',reason:'non_reply_event'});expect(f.transport.getAccount).not.toHaveBeenCalled();});
 it('does not fetch foreign bindings/accounts or malformed timestamps',async()=>{
  const f=fixture();expect(await f.api.normalize(f.raw,{...f.binding,generation:2})).toEqual({kind:'review',code:'account_changed'});
  expect(await f.api.normalize({...f.raw,account_id:'wrong'},f.binding)).toEqual({kind:'review',code:'account_changed'});
  expect(await f.api.normalize({...f.raw,timestamp:'2026-02-30T00:00:00.000Z'},f.binding)).toEqual(review);expect(f.transport.getAccount).not.toHaveBeenCalled();
 });
 it('rejects wrong fetched account/owner before chat reads',async()=>{
  const f=fixture();f.account.id='wrong';expect(await f.api.normalize(f.raw,f.binding)).toEqual({kind:'review',code:'account_changed'});expect(f.transport.getChat).not.toHaveBeenCalled();
  f.account.id='provider-account';f.verifyOwner.mockResolvedValueOnce(false);expect(await f.api.normalize(f.raw,f.binding)).toEqual({kind:'review',code:'account_changed'});expect(f.transport.getChat).not.toHaveBeenCalled();
 });
 it('leaves transient source/read failures retryable rather than terminal ignore',async()=>{
  const f=fixture();f.account.sources[0].status='STOPPED';await expect(f.api.normalize(f.raw,f.binding)).rejects.toMatchObject({code:'reconnect'});
  f.account.sources[0].status='OK';f.transport.getChat.mockResolvedValueOnce({kind:'unavailable',reason:'timeout'} as unknown as UnipileHttpResult);
  await expect(f.api.normalize(f.raw,f.binding)).rejects.toBeInstanceOf(ReplyEnrichmentReadError);
 });
 it.each(['wrong_account','wrong_chat','invalid_type','partial_attendees','wrong_attendee','duplicate_attendee','no_self','wrong_self'] as const)('reviews inconsistent social evidence %s',async fault=>{
  const f=fixture();if(fault==='wrong_account')f.chat.account_id='foreign';if(fault==='wrong_chat')f.chat.id='foreign';if(fault==='invalid_type')f.chat.type=99;
  if(fault==='partial_attendees')f.attendees.cursor='next' as never;if(fault==='wrong_attendee')f.attendees.items[1].account_id='foreign';
  if(fault==='duplicate_attendee')f.attendees.items.push({...f.attendees.items[1]});if(fault==='no_self')f.attendees.items[0].is_self=0;if(fault==='wrong_self')f.attendees.items[0].provider_id='foreign';
  expect((await f.api.normalize(f.raw,f.binding)).kind).toBe('review');expect(f.resolveAlias).not.toHaveBeenCalled();
 });
 it('ignores positively identified group chat without alias lookup',async()=>{const f=fixture();f.chat.type=1;expect(await f.api.normalize(f.raw,f.binding)).toEqual({kind:'ignore',reason:'group_message'});expect(f.resolveAlias).not.toHaveBeenCalled();});
 it.each(['wrong_message','wrong_account','wrong_chat','wrong_sender','wrong_attendee','different_time','direction_conflict','invalid_flag','unknown_subtype'] as const)('reviews inconsistent message corroboration %s',async fault=>{
  const f=fixture();if(fault==='wrong_message')f.message.id='foreign';if(fault==='wrong_account')f.message.account_id='foreign';if(fault==='wrong_chat')f.message.chat_id='foreign';
  if(fault==='wrong_sender')f.message.sender_id='foreign';if(fault==='wrong_attendee')f.message.sender_attendee_id='foreign';if(fault==='different_time')f.message.timestamp='2026-10-12T11:59:01.000Z';
  if(fault==='direction_conflict')f.message.is_sender=1;if(fault==='invalid_flag')f.message.is_event=2;if(fault==='unknown_subtype')f.message.message_type='UNSUPPORTED';
  expect((await f.api.normalize(f.raw,f.binding)).kind).toBe('review');expect(f.resolveAlias).not.toHaveBeenCalled();
 });
 it.each(['INVITATION','INMAIL_DECLINE','INMAIL_ACCEPT'])('does not turn LinkedIn %s into a human reply',async subtype=>{const f=fixture();f.message.message_type=subtype;expect(await f.api.normalize(f.raw,f.binding)).toEqual({kind:'ignore',reason:'non_reply_message'});expect(f.resolveAlias).not.toHaveBeenCalled();});
 it('reviews array-valued message subtypes instead of coercing an invitation',async()=>{const f=fixture();f.message.message_type=['INVITATION'] as never;expect(await f.api.normalize(f.raw,f.binding)).toEqual(review);expect(f.resolveAlias).not.toHaveBeenCalled();});
 it.each(['is_event','hidden','deleted'] as const)('excludes explicit message system flag %s',async flag=>{const f=fixture();f.message[flag]=1;expect(await f.api.normalize(f.raw,f.binding)).toEqual({kind:'ignore',reason:'non_reply_message'});expect(f.resolveAlias).not.toHaveBeenCalled();});
 it('reviews unresolved/foreign alias without guessing provider profile URL',async()=>{
  const f=fixture();f.resolveAlias.mockResolvedValueOnce(null as never);expect(await f.api.normalize(f.raw,f.binding)).toEqual({kind:'review',code:'identity_pending'});
  f.resolveAlias.mockResolvedValueOnce({...(await f.resolveAlias())!,sourceId:'foreign'});expect((await f.api.normalize(f.raw,f.binding)).kind).toBe('review');
 });
 it('does not accept partial email or missing/empty header evidence',async()=>{
  for(const override of [{kind:'1_meta'},{headers:undefined},{headers:[]},{account_id:'foreign'}]){const f=fixture('email');Object.assign(f.mail,override);expect((await f.api.normalize(f.raw,f.binding)).kind).toBe('review');}
 });
 it('captures input/configuration across provider awaits',async()=>{
  const f=fixture();f.transport.getAccount.mockImplementationOnce(async()=>{f.raw.chat_id='changed';f.options.binding.ownerId='changed';f.options.resolveAlias=vi.fn();return ok(f.account)});
  expect((await f.api.normalize(f.raw,f.binding)).kind).toBe('event');expect(f.transport.getChat.mock.calls[0][1]).toBe('chat');expect(f.resolveAlias).toHaveBeenCalledOnce();
 });
 it('bounds hanging reads and signals abort without returning a reply',async()=>{
  const f=fixture();f.options.deadlineMs=10;f.transport.getAccount.mockImplementationOnce(()=>new Promise(()=>{}));
  await expect(createUnipileV1ReplyEnricher(f.options).normalize(f.raw,f.binding)).rejects.toMatchObject({code:'timeout'});
  expect(f.transport.getAccount.mock.calls[0][1]?.signal?.aborted).toBe(true);expect(f.resolveAlias).not.toHaveBeenCalled();
 });
});
