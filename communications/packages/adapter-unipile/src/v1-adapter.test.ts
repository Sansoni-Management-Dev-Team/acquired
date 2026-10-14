import { describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord, MessageSubmission, ReceiptLookup } from '../../contracts/src';
import { messageDigest } from '../../core/src/message-digest';
import { createUnipileV1MessagingAdapter } from './v1-adapter';

function fixture(linkedin = false, status: ConnectionRecord['status'] = 'connected') {
  const binding = { applicationId:'app',tenantId:'tenant',ownerId:'owner',connectionId:'conn',accountId:'service-account',generation:1,backend:'unipile' as const,
    channel:linkedin?'linkedin' as const:'whatsapp' as const,platform:linkedin?'linkedin' as const:'whatsapp' as const };
  const recipient = linkedin ? {kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/synthetic'} : {kind:'phone' as const,value:'+61400000000'};
  const conversation = {binding,id:'recorded-chat'};
  const connection:ConnectionRecord={binding,status,providerAccountId:'provider-account',capabilities:{messaging:{send:true,durableIdempotency:true,receiptLookup:true},events:{read:true,history:true,realtime:true},...(linkedin?{linkedin:{resolveProfile:true,relationships:true,invitations:true}}:{})}};
  const message={recipient,text:'Synthetic only',conversation};
  const input:MessageSubmission={snapshot:{binding,key:'synthetic-key',operation:'message',payloadDigest:messageDigest('message',message)},message};
  const lookup:ReceiptLookup={snapshot:input.snapshot,message:{binding,id:'recorded-message'},expectedRecipient:recipient};
  const account={object:'Account',id:'provider-account',type:linkedin?'LINKEDIN':'WHATSAPP',connection_params:{im:{}},sources:[{id:'source',status:'OK'}]};
  const rawMessage={object:'Message',id:'recorded-message',account_id:'provider-account',chat_id:conversation.id,is_sender:1,is_event:0,hidden:0,deleted:0,timestamp:'2026-10-12T09:30:00.000Z'};
  const transport={getAccount:vi.fn(async()=>({kind:'success' as const,status:200,data:account})),getChat:vi.fn(async()=>({kind:'success' as const,status:200,data:{object:'Chat',id:conversation.id,account_id:'provider-account',type:0,read_only:0}})),getMessage:vi.fn(async()=>({kind:'success' as const,status:200,data:rawMessage})),sendMessage:vi.fn(async()=>({kind:'success' as const,status:201,data:{object:'MessageSent',message_id:'new-message'}})),invite:vi.fn(async()=>({kind:'success' as const,status:200,data:{object:'UserInvitationSent',invitation_id:'invitation'}}))};
  const verifyChatRecipient=vi.fn(async()=>({providerAccountId:'provider-account',conversation,recipient}));
  const verifyInvitationRecipient=vi.fn(async()=>({providerAccountId:'provider-account',providerId:'ACoSynthetic',recipient}));
  const options={connection,providerAccountId:'provider-account',sourceId:'source',transport,verifyChatRecipient,verifyInvitationRecipient};
  return {binding,recipient,conversation,connection,input,lookup,account,rawMessage,transport,verifyChatRecipient,verifyInvitationRecipient,options};
}
describe('v1 existing-chat adapter',()=>{
  it('sends through exact account/direct chat mapping and returns a message receipt',async()=>{
    const f=fixture(); const adapter=createUnipileV1MessagingAdapter(f.options);
    expect(await adapter.submit(f.input)).toMatchObject({status:'submitted',receipt:{message:{binding:f.binding,id:'new-message'},conversation:f.conversation,recipient:f.recipient}});
    expect(f.transport.sendMessage).toHaveBeenCalledExactlyOnceWith('provider-account','recorded-chat',{text:'Synthetic only'});
    expect(f.verifyChatRecipient).toHaveBeenCalledExactlyOnceWith({snapshot:f.input.snapshot,recipient:f.recipient,conversation:f.conversation});
    expect(adapter.capabilities).toEqual({messaging:{send:true,durableIdempotency:false,receiptLookup:true},events:{read:false,history:false,realtime:false}});
  });
  it('rejects a changed binding or digest before any provider access',async()=>{
    const f=fixture();const adapter=createUnipileV1MessagingAdapter(f.options);
    await expect(adapter.submit({...f.input,snapshot:{...f.input.snapshot,binding:{...f.binding,generation:2}}})).rejects.toThrow('binding_changed');
    await expect(adapter.submit({...f.input,message:{...f.input.message,text:'changed'}})).rejects.toThrow('operation_conflict');
    expect(f.transport.getAccount).not.toHaveBeenCalled();expect(f.verifyChatRecipient).not.toHaveBeenCalled();
  });
  it.each(['subject','replyTo','rfcMessageId','extra'])('refuses ignored social field %s before I/O',async field=>{
    const f=fixture();const message={...f.input.message,[field]:'unsupported'};
    const input={...f.input,message,snapshot:{...f.input.snapshot,payloadDigest:messageDigest('message',message)}};
    expect(await createUnipileV1MessagingAdapter(f.options).submit(input)).toEqual({status:'review',code:'unsupported'});
    expect(f.transport.getAccount).not.toHaveBeenCalled();
  });
  it('does not start a chat when the original conversation is absent',async()=>{
    const f=fixture();const message={...f.input.message,conversation:undefined};
    expect(await createUnipileV1MessagingAdapter(f.options).submit({...f.input,message,snapshot:{...f.input.snapshot,payloadDigest:messageDigest('message',message)}})).toEqual({status:'review',code:'unsupported'});
    expect(f.transport.getAccount).not.toHaveBeenCalled();expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it.each([{account_id:'another'}, {type:1}, {read_only:1}, {id:'another'}, {object:'Message'}])('blocks invalid chat before dispatch (%#)',async patch=>{
    const f=fixture();f.transport.getChat.mockResolvedValueOnce({kind:'success',status:200,data:{object:'Chat',id:'recorded-chat',account_id:'provider-account',type:0,read_only:0,...patch}});
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'review',code:'protocol'});
    expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it('blocks a missing or changed trusted mapping',async()=>{
    const f=fixture();f.verifyChatRecipient.mockResolvedValueOnce({...await f.verifyChatRecipient(),providerAccountId:'another'});
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'review',code:'protocol'});
    expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it('checks exact product readiness without exposing account configuration',async()=>{
    const f=fixture();f.account.sources[0].status='CREDENTIALS';
    expect(await createUnipileV1MessagingAdapter(f.options).ready(f.binding)).toEqual({status:'review',code:'reconnect'});
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'review',code:'reconnect'});
    expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it('preserves uncertain writes and never retries',async()=>{
    const f=fixture();f.transport.sendMessage.mockRejectedValueOnce(new Error('accepted then lost'));
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'unknown'});
    expect(f.transport.sendMessage).toHaveBeenCalledTimes(1);
  });
  it('does not invent a receipt from a null send ID',async()=>{
    const f=fixture();f.transport.sendMessage.mockResolvedValueOnce({kind:'success',status:201,data:{object:'MessageSent',message_id:null}} as never);
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'unknown'});
  });
  it('captures caller input, connection and methods before awaiting',async()=>{
    const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
    const authoritativeMapping=structuredClone({providerAccountId:'provider-account',conversation:f.conversation,recipient:f.recipient});
    f.verifyChatRecipient.mockResolvedValue(authoritativeMapping);
    f.transport.getAccount.mockImplementationOnce(async()=>{await gate;return {kind:'success',status:200,data:f.account};});
    const adapter=createUnipileV1MessagingAdapter(f.options);const pending=adapter.submit(f.input);
    f.input.message.text='changed';f.connection.binding.ownerId='changed';
    const oldSend=f.transport.sendMessage;f.transport.sendMessage=vi.fn();release();
    expect(await pending).toMatchObject({status:'submitted',receipt:{recipient:f.recipient}});
    expect(oldSend).toHaveBeenCalledExactlyOnceWith('provider-account','recorded-chat',{text:'Synthetic only'});
    expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it('recovers the exact recorded message after disconnect without readiness or sends',async()=>{
    const f=fixture(false,'disconnected');const adapter=createUnipileV1MessagingAdapter(f.options);
    expect(await adapter.lookup(f.lookup)).toMatchObject({status:'submitted',receipt:{message:f.lookup.message,conversation:f.conversation}});
    expect(f.verifyChatRecipient).toHaveBeenCalledExactlyOnceWith({snapshot:f.lookup.snapshot,recipient:f.recipient,message:f.lookup.message});
    expect(f.transport.getAccount).not.toHaveBeenCalled();expect(f.transport.getChat).not.toHaveBeenCalled();expect(f.transport.sendMessage).not.toHaveBeenCalled();
    expect(await adapter.submit(f.input)).toEqual({status:'review',code:'reconnect'});
  });
  it.each([{id:'another'}, {account_id:'another'}, {chat_id:'another'}, {is_sender:0}])('cannot settle a mismatched lookup (%#)',async patch=>{
    const f=fixture();f.transport.getMessage.mockResolvedValueOnce({kind:'success',status:200,data:{...f.rawMessage,...patch}});
    expect(await createUnipileV1MessagingAdapter(f.options).lookup(f.lookup)).toEqual({status:'unknown'});
    expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it('requires original message and recipient without blind recovery search',async()=>{
    const f=fixture();expect(await createUnipileV1MessagingAdapter(f.options).lookup({...f.lookup,message:undefined})).toEqual({status:'review',code:'unsupported'});
    expect(f.transport.getMessage).not.toHaveBeenCalled();
  });
  it('rejects noncanonical identities before I/O',async()=>{
    const f=fixture();const message={...f.input.message,recipient:{kind:'phone' as const,value:'61400000000'}};
    await expect(createUnipileV1MessagingAdapter(f.options).submit({...f.input,message,snapshot:{...f.input.snapshot,payloadDigest:messageDigest('message',message)}})).rejects.toThrow('operation_conflict');
    expect(f.transport.getAccount).not.toHaveBeenCalled();
  });
  it('requires the trusted mapping port and unipile social binding at construction',()=>{
    const f=fixture();expect(()=>createUnipileV1MessagingAdapter({...f.options,verifyChatRecipient:undefined} as never)).toThrow();
    expect(()=>createUnipileV1MessagingAdapter({...f.options,connection:{...f.connection,binding:{...f.binding,backend:'baileys'}}})).toThrow();
  });
  it('waits safely when predispatch verification throws',async()=>{
    const f=fixture();f.verifyChatRecipient.mockRejectedValueOnce(new Error('unavailable'));
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'waiting',code:'unavailable'});expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it.each([{conversation:{id:'other'}},{recipient:{kind:'phone',value:'+61400000001'}}])('refuses changed immutable mapping (%#)',async patch=>{
    const f=fixture();f.verifyChatRecipient.mockResolvedValueOnce({...await f.verifyChatRecipient(),...patch} as never);
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'review',code:'protocol'});expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
  it.each(['authentication','authorization','rate_limited','invalid_request','provider_rejection'] as const)('maps a definite %s write rejection without retry',async reason=>{
    const f=fixture();f.transport.sendMessage.mockResolvedValueOnce({kind:'rejected',status:reason==='authentication'?401:reason==='rate_limited'?429:422,reason} as never);
    const expected=reason==='authentication'?{status:'review',code:'reconnect'}:reason==='authorization'?{status:'review',code:'forbidden'}:reason==='rate_limited'?{status:'waiting',code:'rate_limited'}:{status:'rejected',code:reason};
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual(expected);expect(f.transport.sendMessage).toHaveBeenCalledTimes(1);
  });
  it('does not infer rejection from uncertain transport result',async()=>{
    const f=fixture();f.transport.sendMessage.mockResolvedValueOnce({kind:'unknown',reason:'provider_failure',status:500} as never);
    expect(await createUnipileV1MessagingAdapter(f.options).submit(f.input)).toEqual({status:'unknown'});
  });
  it('honors recorded disabled capabilities despite publicly mutated capability object',async()=>{
    const f=fixture();f.connection.capabilities.messaging.send=false;const adapter=createUnipileV1MessagingAdapter(f.options);adapter.capabilities.messaging.send=true;
    expect(await adapter.submit(f.input)).toEqual({status:'review',code:'delivery_disabled'});expect(f.transport.getAccount).not.toHaveBeenCalled();
  });
  it('captures verifier callbacks before an asynchronous readiness check',async()=>{
    const f=fixture();const original=f.verifyChatRecipient;const adapter=createUnipileV1MessagingAdapter(f.options);f.options.verifyChatRecipient=vi.fn();
    expect(await adapter.submit(f.input)).toMatchObject({status:'submitted'});expect(original).toHaveBeenCalledTimes(1);expect(f.options.verifyChatRecipient).not.toHaveBeenCalled();
  });
  it('keeps lookup unavailable and absent outcomes distinct from a submitted receipt',async()=>{
    const f=fixture();const adapter=createUnipileV1MessagingAdapter(f.options);
    f.transport.getMessage.mockRejectedValueOnce(new Error('unavailable'));
    expect(await adapter.lookup(f.lookup)).toEqual({status:'waiting',code:'unavailable'});
    f.transport.getMessage.mockResolvedValueOnce({kind:'rejected',status:404,reason:'not_found'} as never);
    expect(await adapter.lookup(f.lookup)).toBeNull();expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });
});
describe('v1 LinkedIn invitation actions',()=>{
  function invitation(f:ReturnType<typeof fixture>) {const message={recipient:f.recipient,text:'Synthetic invitation'};return {snapshot:{...f.input.snapshot,operation:'invitation' as const,payloadDigest:messageDigest('invitation',message)},message};}
  it('uses verified provider identity and returns an action receipt',async()=>{
    const f=fixture(true);const adapter=createUnipileV1MessagingAdapter(f.options);
    expect(await adapter.submit(invitation(f))).toMatchObject({status:'submitted',receipt:{operation:{binding:f.binding,id:'invitation'},recipient:f.recipient}});
    expect(f.transport.invite).toHaveBeenCalledExactlyOnceWith('provider-account','ACoSynthetic','Synthetic invitation');
    expect(f.transport.sendMessage).not.toHaveBeenCalled();expect(f.transport.getChat).not.toHaveBeenCalled();
    expect(adapter.capabilities.linkedin).toEqual({resolveProfile:false,relationships:false,invitations:true});
  });
  it('does not claim invitation capability without trusted profile mapping',async()=>{
    const f=fixture(true);const adapter=createUnipileV1MessagingAdapter({...f.options,verifyInvitationRecipient:undefined});
    expect(adapter.capabilities.linkedin?.invitations).toBe(false);
    expect(await adapter.submit(invitation(f))).toEqual({status:'review',code:'unsupported'});expect(f.transport.getAccount).not.toHaveBeenCalled();
  });
  it('does not use a message lookup endpoint for an invitation ID',async()=>{
    const f=fixture(true);expect(await createUnipileV1MessagingAdapter(f.options).lookup({...f.lookup,snapshot:invitation(f).snapshot})).toEqual({status:'review',code:'unsupported'});
    expect(f.transport.getMessage).not.toHaveBeenCalled();
  });
  it('rejects notes over 300 characters before dispatch',async()=>{
    const f=fixture(true);const input=invitation(f);input.message.text='x'.repeat(301);input.snapshot.payloadDigest=messageDigest('invitation',input.message);
    expect(await createUnipileV1MessagingAdapter(f.options).submit(input)).toEqual({status:'review',code:'unsupported'});expect(f.transport.getAccount).not.toHaveBeenCalled();
  });
});
