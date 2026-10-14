import {timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertSameBinding,assertSubmissionReceiptMatches,type CanonicalIdentity,type ConnectionBinding,type ProviderReference,type OperationSnapshot,type MessageReceipt} from '../../contracts/src';
import type {SqlClient} from './webhook-repository';
import type {CanonicalRecipientDigest,DispatchJournalCodec} from './dispatch-journal';
export interface JournalOutboundObservation {binding:ConnectionBinding;reference:ProviderReference;conversation?:ProviderReference;recipient:CanonicalIdentity;occurredAt:string}
export interface JournalOutboundVerifierOptions {binding:ConnectionBinding;integrationId:string;providerConfigurationReference:string;providerAccountDigests:readonly string[];codec:DispatchJournalCodec;recipientDigest:CanonicalRecipientDigest;maxRows?:number}
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sameDigest=(a:unknown,b:unknown)=>hex(a)&&hex(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
/** Called inside the history repository's already authenticated transaction. Only a
 * retained, original, quota-reserved submitted receipt can associate an outbound.
 * Unrelated human messages and unavailable/corrupt history never establish that proof. */
export function createJournalOutboundVerifier(options:JournalOutboundVerifierOptions):(client:SqlClient,observation:JournalOutboundObservation)=>Promise<boolean>{
 const binding=structuredClone(options.binding),digests=[...options.providerAccountDigests],integration=options.integrationId,configuration=options.providerConfigurationReference,max=options.maxRows??1000;
 assertSameBinding(binding,binding);if(binding.backend!=='unipile'||!integration||!configuration||!digests.length||digests.length>32||digests.some(x=>!hex(x))||!Number.isSafeInteger(max)||max<1||max>10000)throw Error('Invalid outbound verification configuration');
 const decode=Function.prototype.bind.call(options.codec.decode,options.codec),digest=Function.prototype.bind.call(options.codec.digest,options.codec),recipientDigest=Function.prototype.bind.call(options.recipientDigest.digest,options.recipientDigest);
 return async(client,input)=>{try{
  const observation=structuredClone(input);assertSameBinding(binding,observation.binding);assertSameBinding(binding,observation.reference.binding);if(observation.conversation)assertSameBinding(binding,observation.conversation.binding);
  if(typeof observation.reference.id!=='string'||!observation.reference.id||!Number.isFinite(Date.parse(observation.occurredAt)))return false;
  const {rows}=await client.query<Record<string,unknown>>(`SELECT j.*,g.channel,g.platform,g.backend,g.provider_account_digest FROM communications.operation_journal j JOIN communications.connection_generations g ON g.connection_id=j.connection_id AND g.generation=j.generation AND g.application_id=j.application_id AND g.tenant_id=j.tenant_id AND g.owner_id=j.owner_id AND g.account_id=j.account_id WHERE j.application_id=$1 AND j.tenant_id=$2 AND j.owner_id=$3 AND j.account_id=$4 AND g.integration_id=$5 AND g.provider_configuration_reference=$6 AND g.provider_account_digest=ANY($7::text[]) AND j.operation='message' AND j.state='submitted' AND j.quota_reserved ORDER BY j.created_at DESC LIMIT $8`,[binding.applicationId,binding.tenantId,binding.ownerId,binding.accountId,integration,configuration,digests,max+1]);
  if(rows.length>max)return false;
  for(const row of rows){
   if(row.application_id!==binding.applicationId||row.tenant_id!==binding.tenantId||row.owner_id!==binding.ownerId||row.account_id!==binding.accountId||row.channel!==binding.channel||row.platform!==binding.platform||row.backend!=='unipile'||row.state!=='submitted'||row.quota_reserved!==true||!digests.includes(String(row.provider_account_digest)))return false;
   const original:OperationSnapshot={binding:{...binding,connectionId:row.connection_id as string,generation:row.generation as number},key:row.operation_key as string,operation:'message',payloadDigest:row.payload_digest as string};assertSameBinding(original.binding,original.binding);if(!original.key||!hex(original.payloadDigest))return false;
   const contextEnvelope=JSON.parse(row.encrypted_operation_context as string),receiptEnvelope=JSON.parse(row.encrypted_receipt as string);if(contextEnvelope.keyVersion!==row.operation_context_key_version||receiptEnvelope.keyVersion!==row.receipt_key_version)return false;
   const context=decode(original,'context',contextEnvelope) as {recipient:CanonicalIdentity};
   if(!sameDigest(digest(original,'context',context,row.operation_context_key_version as string),row.operation_context_digest)||!sameDigest(recipientDigest(context.recipient,row.recipient_key_version as string),row.recipient_digest))return false;
   const receipt=decode(original,'receipt',receiptEnvelope) as MessageReceipt;assertSubmissionReceiptMatches(original,context.recipient,receipt);
   if(!receipt.message||receipt.message.id!==observation.reference.id||!isDeepStrictEqual(receipt.recipient,observation.recipient))continue;
   if((receipt.conversation?.id??null)!==(observation.conversation?.id??null))continue;
   if(receipt.submittedAt!==undefined&&Date.parse(receipt.submittedAt)!==Date.parse(observation.occurredAt))continue;
   return true;
  }return false;
 }catch{return false;}};
}
