import { assertSameBinding, ContractError, type CanonicalIdentity, type Capabilities, type ConnectionRecord, type DeliveryOutcome, type MessagingAdapter, type OperationSnapshot, type ProviderReference, type Readiness } from '../../contracts/src';
import { messageDigest } from '../../core/src/message-digest';
import type { UnipileHttpResult } from './http-core';
import { normalizeV1AccountReadiness, normalizeV1InvitationSent, normalizeV1MessageLookup, normalizeV1MessageSent } from './v1-normalization';

export interface UnipileV1MessagingPort {
  getAccount(id:string):Promise<UnipileHttpResult>;
  getChat(accountId:string,id:string):Promise<UnipileHttpResult>;
  getMessage(id:string):Promise<UnipileHttpResult>;
  sendMessage(accountId:string,chatId:string,payload:{text:string;quote_id?:string}):Promise<UnipileHttpResult>;
  invite?(accountId:string,providerId:string,message?:string):Promise<UnipileHttpResult>;
}
export interface VerifiedV1ChatMapping { providerAccountId:string; conversation:ProviderReference; recipient:CanonicalIdentity }
export interface VerifiedV1InvitationMapping { providerAccountId:string; providerId:string; recipient:CanonicalIdentity }
export interface UnipileV1MessagingAdapterOptions {
  connection:ConnectionRecord;
  providerAccountId:string;
  /** Relevant source ID established by trusted account registration, not guessed from provider name. */
  sourceId:string;
  transport:UnipileV1MessagingPort;
  /** Authoritative immutable direct-chat binding. Lookup must resolve the original recorded chat
   * from snapshot/message, never infer ownership or recipient from an untrusted provider response. */
  verifyChatRecipient(input:{snapshot:OperationSnapshot;recipient:CanonicalIdentity;conversation?:ProviderReference;message?:ProviderReference}):Promise<VerifiedV1ChatMapping|null>;
  verifyInvitationRecipient?(input:{snapshot:OperationSnapshot;recipient:CanonicalIdentity}):Promise<VerifiedV1InvitationMapping|null>;
}
const object=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string' && value.length>0 && value.trim()===value && value.length<=2048 && value!=='.' && value!=='..' && !/[\u0000-\u001f\u007f]/.test(value);
const exact=(value:unknown,fields:string[])=>object(value) && Object.keys(value).every(key=>fields.includes(key));
function recipientValid(channel:string,recipient:CanonicalIdentity):boolean {
  if(!exact(recipient,['kind','value']) || typeof recipient.value!=='string') return false;
  if(channel==='whatsapp') return recipient.kind==='phone' && /^\+[1-9]\d{6,14}$/.test(recipient.value);
  if(recipient.kind!=='linkedin_profile') return false;
  try {const u=new URL(recipient.value);return u.href===recipient.value && u.protocol==='https:' && ['linkedin.com','www.linkedin.com'].includes(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/in\/[^/]+\/?$/.test(u.pathname);} catch {return false;}
}
function safeReadFailure(result:UnipileHttpResult):Exclude<Readiness,{status:'ready'}> {
  if(result.kind==='rejected') {
    if(result.reason==='authentication') return {status:'review',code:'reconnect'};
    if(result.reason==='authorization') return {status:'review',code:'forbidden'};
    if(result.reason==='rate_limited') return {status:'waiting',code:'rate_limited'};
    return {status:'review',code:'protocol'};
  }
  return {status:'waiting',code:'unavailable'};
}
function writeFailure(result:UnipileHttpResult):DeliveryOutcome {
  if(result.kind==='not_submitted') return {status:'waiting',code:'unavailable'};
  if(result.kind!=='rejected') return {status:'unknown'};
  if(result.reason==='authentication') return {status:'review',code:'reconnect'};
  if(result.reason==='authorization') return {status:'review',code:'forbidden'};
  if(result.reason==='rate_limited') return {status:'waiting',code:'rate_limited'};
  if(result.reason==='not_found') return {status:'review',code:'protocol'};
  return {status:'rejected',code:result.reason};
}

/** Raw social adapter. No journal, lease, quota, retries, start-chat or event coverage is supplied.
 * Application composition MUST wrap submits with an authoritative durable dispatch coordinator. */
export function createUnipileV1MessagingAdapter(options:UnipileV1MessagingAdapterOptions):MessagingAdapter & {capabilities:Capabilities} {
  assertSameBinding(options.connection.binding,options.connection.binding);
  if(options.connection.binding.backend!=='unipile' || !['whatsapp','linkedin'].includes(options.connection.binding.channel) ||
      !id(options.providerAccountId) || !id(options.sourceId) || typeof options.verifyChatRecipient!=='function' ||
      (options.connection.providerAccountId!==undefined && options.connection.providerAccountId!==options.providerAccountId)) throw new ContractError('invalid_binding');
  const connection=structuredClone(options.connection);
  const binding=connection.binding;
  const providerAccountId=options.providerAccountId,sourceId=options.sourceId;
  const transport=options.transport;
  const getAccount=transport.getAccount.bind(transport),getChat=transport.getChat.bind(transport),getMessage=transport.getMessage.bind(transport),sendMessage=transport.sendMessage.bind(transport),invite=transport.invite?.bind(transport);
  const verifyChat=options.verifyChatRecipient.bind(options),verifyInvitation=options.verifyInvitationRecipient?.bind(options);
  const canInvite=binding.channel==='linkedin' && connection.capabilities.linkedin?.invitations===true && !!invite && !!verifyInvitation;
  const capabilities:Capabilities={messaging:{send:connection.capabilities.messaging.send,durableIdempotency:false,receiptLookup:connection.capabilities.messaging.receiptLookup},events:{read:false,history:false,realtime:false},...(binding.channel==='linkedin'?{linkedin:{resolveProfile:false,relationships:false,invitations:canInvite}}:{})};
  function snapshotValid(snapshot:OperationSnapshot) {
    assertSameBinding(binding,snapshot.binding);
    if(!exact(snapshot,['binding','key','operation','payloadDigest']) || !id(snapshot.key) || snapshot.key.length>200 || !/^[a-f0-9]{64}$/.test(snapshot.payloadDigest)) throw new ContractError('operation_conflict');
  }
  function referenceValid(reference:ProviderReference) {assertSameBinding(binding,reference.binding);if(!id(reference.id)) throw new ContractError('operation_conflict');}
  function mappingValid(mapping:VerifiedV1ChatMapping|null,recipient:CanonicalIdentity,conversation?:ProviderReference):mapping is VerifiedV1ChatMapping {
    if(!mapping || mapping.providerAccountId!==providerAccountId || !mapping.conversation || !id(mapping.conversation.id) || !mapping.recipient || mapping.recipient.kind!==recipient.kind || mapping.recipient.value!==recipient.value || (conversation && mapping.conversation.id!==conversation.id)) return false;
    try {assertSameBinding(binding,mapping.conversation.binding);return true;} catch{return false;}
  }
  const ready:MessagingAdapter['ready']=async requested=>{
    const captured=structuredClone(requested);assertSameBinding(binding,captured);
    if(!connection.capabilities.messaging.send) return {status:'review',code:'delivery_disabled'};
    if(['connecting','syncing'].includes(connection.status)) return {status:'waiting',code:'incomplete'};
    if(connection.status!=='connected') return {status:'review',code:'reconnect'};
    try {const result=await getAccount(providerAccountId);return result.kind==='success' && result.status===200?normalizeV1AccountReadiness(result.data,{binding,providerAccountId,sourceId}):safeReadFailure(result);} catch{return {status:'waiting',code:'unavailable'};}
  };
  return {capabilities:structuredClone(capabilities),ready,
    async submit(request) {
      const input=structuredClone(request);snapshotValid(input.snapshot);
      if(!recipientValid(binding.channel,input.message.recipient) || typeof input.message.text!=='string' || input.message.text.length>1_000_000) throw new ContractError('operation_conflict');
      if(input.message.conversation) referenceValid(input.message.conversation);
      if(messageDigest(input.snapshot.operation,input.message)!==input.snapshot.payloadDigest) throw new ContractError('operation_conflict');
      const invitation=input.snapshot.operation==='invitation';
      if(!exact(input.message,['recipient','text','conversation']) || (!invitation && input.snapshot.operation!=='message') ||
          (invitation && (!canInvite || input.message.conversation!==undefined || input.message.text.length>300)) ||
          (!invitation && !input.message.conversation)) return {status:'review',code:'unsupported'};
      const readiness=await ready(input.snapshot.binding);if(readiness.status!=='ready') return readiness;
      let invitationMapping:VerifiedV1InvitationMapping|undefined;
      try {
        if(invitation) {
          const mapped=await verifyInvitation!({snapshot:structuredClone(input.snapshot),recipient:{...input.message.recipient}});
          if(!mapped || mapped.providerAccountId!==providerAccountId || !id(mapped.providerId) || mapped.recipient.kind!==input.message.recipient.kind || mapped.recipient.value!==input.message.recipient.value) return {status:'review',code:'protocol'};
          invitationMapping=structuredClone(mapped);
        } else {
          const mapped=await verifyChat({snapshot:structuredClone(input.snapshot),recipient:{...input.message.recipient},conversation:structuredClone(input.message.conversation!)});
          if(!mappingValid(mapped,input.message.recipient,input.message.conversation)) return {status:'review',code:'protocol'};
          const result=await getChat(providerAccountId,input.message.conversation!.id);
          if(result.kind!=='success') return safeReadFailure(result);
          const chat=result.data;
          if(result.status!==200 || !object(chat) || chat.object!=='Chat' || chat.id!==input.message.conversation!.id || chat.account_id!==providerAccountId || chat.type!==0 || chat.read_only!==0) return {status:'review',code:'protocol'};
        }
      } catch{return {status:'waiting',code:'unavailable'};}
      try {
        const result=invitation?await invite!(providerAccountId,invitationMapping!.providerId,input.message.text):await sendMessage(providerAccountId,input.message.conversation!.id,{text:input.message.text});
        if(result.kind!=='success') return writeFailure(result);
        if(invitation) return result.status===200?normalizeV1InvitationSent(result.data,input):{status:'unknown'};
        return result.status===201?normalizeV1MessageSent(result.data,input):{status:'unknown'};
      } catch{return {status:'unknown'};}
    },
    async lookup(request) {
      const input=structuredClone(request);snapshotValid(input.snapshot);
      if(input.message) referenceValid(input.message);
      if(input.expectedRecipient && !recipientValid(binding.channel,input.expectedRecipient)) throw new ContractError('operation_conflict');
      if(input.snapshot.operation!=='message' || !connection.capabilities.messaging.receiptLookup || !input.message || !input.expectedRecipient || input.rfcMessageId!==undefined) return {status:'review',code:'unsupported'};
      try {
        const mapped=await verifyChat({snapshot:structuredClone(input.snapshot),recipient:{...input.expectedRecipient},message:structuredClone(input.message)});
        if(!mappingValid(mapped,input.expectedRecipient)) return {status:'review',code:'protocol'};
        const mapping=structuredClone(mapped);
        const result=await getMessage(input.message.id);
        if(result.kind==='rejected' && result.reason==='not_found') return null;
        if(result.kind!=='success') return safeReadFailure(result);
        return result.status===200?normalizeV1MessageLookup(result.data,{lookup:input,providerAccountId,conversation:mapping.conversation,recipient:mapping.recipient}):{status:'unknown'};
      } catch{return {status:'waiting',code:'unavailable'};}
    },
  };
}
