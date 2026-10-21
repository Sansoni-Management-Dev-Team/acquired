import {businessNow,type BusinessClock} from '../../communications/packages/core/src/business-clock';
import {mandateExecutionContextSchema} from '@/domain/mandate-execution-context';
import {acquireSourceDigest} from './campaign-send-admission';
import {isDeepStrictEqual} from 'node:util';
import {assertSameBinding,assertSubmissionReceiptMatches,type ConnectionBinding,type SubmissionReceipt,type MessageSubmission} from '../../communications/packages/contracts/src';
import {messageDigest} from '../../communications/packages/core/src/message-digest';
import type {SqlPool,SqlClient} from '../../communications/packages/storage-postgres/src/webhook-repository';
import type {JournalCodec} from '../../communications/packages/core/src/journal-codec';
import type {CommunicationsClient} from '../../communications/packages/sdk/src';
import type {AcquireSendAdmission} from './campaign-send-admission';
import type {SubmittedReceiptResult} from '@/domain/communications-submitted';
export type SubmissionLedgerOptions={businessClock?:BusinessClock;pool:SqlPool;codec:JournalCodec;actor:{organizationId:string;userId:string};bindingId:string;binding:ConnectionBinding;admission:Pick<AcquireSendAdmission,'getPreparedIntent'>;client:Pick<CommunicationsClient,'lookup'|'lookupDetails'>};
function fail():never{throw Error('Authenticated original submission evidence required');}
const object=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:fail();
const instant=(x:unknown,clock?:BusinessClock)=>{if(typeof x!=='string'||!Number.isFinite(Date.parse(x))||Date.parse(x)>businessNow(clock))fail();return x as string;};
/** Shared receipt authority, independent of current effect permission and mode.
 * The writer itself calls the ordinary authenticated SDK original lookup. It
 * accepts no caller receipt, asserted success flag, account fallback or new send.
 * Network lookup precedes the privileged, held/member-fenced append transaction. */
export class CommunicationsSubmissionLedger{
 constructor(private options:SubmissionLedgerOptions){}
 async capture(source:{sourceKind:'draft'|'campaign'|'agent';sourceId:string}):Promise<SubmittedReceiptResult>{
  const {actor,binding,codec,admission,client,bindingId}=this.options;
  if(!['draft','campaign','agent'].includes(source.sourceKind)||typeof source.sourceId!=='string'||!source.sourceId||binding.applicationId!=='acquire'||binding.tenantId!==actor.organizationId||binding.ownerId!==actor.userId)fail();
  const original=await admission.getPreparedIntent(source);if(!original)return {status:'unconfirmed'};
  const submission=structuredClone(original.submission),snapshot=submission.snapshot;
  assertSameBinding(binding,snapshot.binding);
  if(!['message','invitation'].includes(snapshot.operation)||messageDigest(snapshot.operation,submission.message)!==snapshot.payloadDigest)fail();
  const lookup={snapshot,expectedRecipient:submission.message.recipient};
  let result=await client.lookup(lookup);
  if(result?.status==='submitted'&&!result.receipt.submittedAt&&client.lookupDetails)result=await client.lookupDetails({...lookup,...('message'in result.receipt?{message:result.receipt.message}:{})});
  if(result?.status!=='submitted')return {status:'unconfirmed'};
  const receipt=structuredClone(result.receipt);assertSubmissionReceiptMatches(snapshot,submission.message.recipient,receipt);
  if((snapshot.operation==='message')!==('message'in receipt))fail();
  const submittedAt=instant(receipt.submittedAt,this.options.businessClock),providerReference='message'in receipt?receipt.message.id:receipt.operation.id;
  const c=await this.options.pool.connect();
  try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');await c.query('SELECT public.communications_lock_send_gate($1)',[actor.organizationId]);
   await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[actor.organizationId,actor.userId]);
   if((await c.query('SELECT id FROM public.member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[actor.organizationId,actor.userId])).rows.length!==1)fail();
   const rows=await c.query('SELECT * FROM public.communication_dispatch_intents WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[original.intentId,actor.organizationId,actor.userId]);
   if(rows.rows.length!==1)fail();const row=rows.rows[0] as Record<string,unknown>;
   if(row.id!==original.intentId||row.binding_id!==bindingId||row.source_kind!==source.sourceKind||row.source_id!==source.sourceId||row.operation_key!==snapshot.key||row.operation!==snapshot.operation||row.payload_digest!==snapshot.payloadDigest||Number(row.epoch)!==original.epoch||typeof row.encrypted_intent!=='string'||typeof row.intent_key_version!=='string')fail();
   const envelope=JSON.parse(row.encrypted_intent as string),value=object(codec.decode(snapshot,'context',envelope));
   if(envelope.keyVersion!==row.intent_key_version||codec.digest(snapshot,'context',value,envelope.keyVersion)!==row.intent_digest||!['acquire.dispatch-intent.v1','acquire.dispatch-intent.v2'].includes(value.domain as string)||!isDeepStrictEqual(value.submission,submission)||value.sourceDigest!==row.source_digest)fail();
   const savedSource=object(value.source),savedId=savedSource.kind==='draft'?savedSource.messageId:savedSource.kind==='campaign'?savedSource.attemptId:savedSource.operationId;
   if(savedSource.kind!==source.sourceKind||savedId!==source.sourceId)fail();
   // No inferred mandate for old sealed sources. AG21's typed v2 manifest is
   // added by its loader; until then this ledger preserves legacy provenance.
   const manifest=value.executionContext===undefined?null:mandateExecutionContextSchema.parse(value.executionContext);
   if(manifest){const {manifestDigest,...preimage}=manifest;if(acquireSourceDigest(preimage)!==manifestDigest)fail();}
   if(manifest&&(manifest.origin.kind!==source.sourceKind||manifest.origin.sourceId!==source.sourceId))fail();
   if(value.domain==='acquire.dispatch-intent.v1'&&manifest!==null)fail();
   if(value.domain==='acquire.dispatch-intent.v2'&&manifest===null)fail();
   const originStatus=manifest?'sealed':'legacy_unsealed';
   const prior=(await c.query('SELECT * FROM public.communication_submission_receipts WHERE intent_id=$1',[original.intentId])).rows;
   if(prior.length>1)fail();
   if(!prior.length){
    const encoded=codec.encode(snapshot,'receipt',receipt),digest=codec.digest(snapshot,'receipt',receipt,encoded.keyVersion);
    await c.query(`INSERT INTO public.communication_submission_receipts(intent_id,organization_id,owner_user_id,binding_id,source_kind,source_id,operation,operation_key,payload_digest,source_digest,encrypted_receipt,receipt_key_version,receipt_digest,recipient_digest,provider_reference,submitted_at,origin_status,original_intent_digest,origin_mandate_id,source_revision,provider_conversation_reference,origin_enrolment_id,origin_conversation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT(intent_id) DO NOTHING`,[original.intentId,actor.organizationId,actor.userId,bindingId,source.sourceKind,source.sourceId,snapshot.operation,snapshot.key,snapshot.payloadDigest,row.source_digest,JSON.stringify(encoded),encoded.keyVersion,digest,codec.digest(snapshot,'context',{domain:'acquire.submitted-recipient.v1',recipient:receipt.recipient}),providerReference,submittedAt,originStatus,row.intent_digest,manifest?.origin.mandateId??null,savedSource.kind==='draft'?savedSource.revision:null,'conversation'in receipt?receipt.conversation?.id??null:null,manifest?.origin.enrolmentId??null,manifest?.origin.conversationId??null]);
   }
   const accepted=await this.read(c,original.intentId,submission);
   if(!isDeepStrictEqual(accepted,receipt))fail();
   await c.query('COMMIT');
   return {status:'submitted',intentId:original.intentId,effect:snapshot.operation as 'message'|'invitation',providerReference,submittedAt,originStatus,replayed:prior.length===1};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 /** Terminal projection is separate from new-send admission. Unsealed legacy
  * origin retains authoritative receipt but requires human review, not a guess. */
 async materializeDraft(messageId:string):Promise<'materialized'|'review'>{
  const original=await this.options.admission.getPreparedIntent({sourceKind:'draft',sourceId:messageId});if(!original)return 'review';
  const {actor,codec}=this.options,c=await this.options.pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');await c.query('SELECT public.communications_lock_send_gate($1)',[actor.organizationId]);await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[actor.organizationId,actor.userId]);
   if((await c.query('SELECT id FROM public.member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[actor.organizationId,actor.userId])).rows.length!==1)fail();
   const rows=await c.query('SELECT * FROM public.communication_dispatch_intents WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[original.intentId,actor.organizationId,actor.userId]);if(rows.rows.length!==1)fail();const i=rows.rows[0] as Record<string,unknown>;
   const raw=object(codec.decode(original.submission.snapshot,'context',JSON.parse(i.encrypted_intent as string)));
   if(codec.digest(original.submission.snapshot,'context',raw,i.intent_key_version as string)!==i.intent_digest||!isDeepStrictEqual(raw.submission,original.submission)||i.source_kind!=='draft'||i.source_id!==messageId)fail();
   const receipt=await this.read(c,original.intentId,original.submission);if(!('message'in receipt))fail();
   if(!['acquire.dispatch-intent.v1','acquire.dispatch-intent.v2'].includes(raw.domain as string)){await c.query('COMMIT');return 'review';}
   const context=raw.domain==='acquire.dispatch-intent.v2'?mandateExecutionContextSchema.parse(raw.executionContext):null,source=object(raw.source);
   const r=(await c.query(`SELECT m.*,e.id AS original_enrolment_id,e.mandate_id,e.contact_id FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=$1 AND m.organization_id=$2 FOR UPDATE OF m FOR SHARE OF e`,[messageId,actor.organizationId])).rows[0] as Record<string,unknown>|undefined;
   // NULL legacy origin retains the old writer's terminal bookkeeping only.
   // Its ledger remains legacy_unsealed; no mandate/enrolment is invented.
   // The existing admitted-draft trigger freezes message enrolment/content/approval.
   const originMatches=r&&(context?context.origin.kind==='draft'&&context.origin.sourceId===messageId&&context.origin.mandateId===r.mandate_id&&context.origin.enrolmentId===r.original_enrolment_id&&context.contact.sourceId===r.contact_id:r.mandate_id===null&&raw.contactId===r.contact_id);
   const valid=r&&originMatches
    &&source.kind==='draft'&&source.messageId===messageId&&['approved','sent'].includes(r.state as string)&&r.approved_by&&r.approved_at
    &&r.subject===original.submission.message.subject&&r.body===original.submission.message.text
    &&(r.state==='sent'||source.revision===new Date(r.updated_at as string).toISOString())
    &&acquireSourceDigest({source,subject:r.subject,body:r.body,approvedBy:r.approved_by,approvedAt:new Date(r.approved_at as string).toISOString()})===i.source_digest;
   if(!valid){await c.query('COMMIT');return 'review';}
   const sameProvider=r.provider_message_id===receipt.message.id&&(r.provider_thread_id??null)===(receipt.conversation?.id??null)&&r.sent_at&&new Date(r.sent_at as string).getTime()===Date.parse(receipt.submittedAt!);
   if(r.state==='sent'){await c.query('COMMIT');return sameProvider?'materialized':'review';}
   if(r.provider_message_id&&r.provider_message_id!==receipt.message.id||r.provider_thread_id&&(r.provider_thread_id??null)!==(receipt.conversation?.id??null)||r.sent_at&&new Date(r.sent_at as string).getTime()!==Date.parse(receipt.submittedAt!)){await c.query('COMMIT');return 'review';}
   const updated=await c.query("UPDATE public.messages SET state='sent',provider_message_id=$3,provider_thread_id=$4,sent_at=$5::timestamptz,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 RETURNING id",[messageId,actor.organizationId,receipt.message.id,receipt.conversation?.id??null,receipt.submittedAt]);if(updated.rows.length!==1)fail();await c.query('COMMIT');return 'materialized';
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 private async read(c:SqlClient,intentId:string,submission:MessageSubmission):Promise<SubmissionReceipt>{
  const {rows}=await c.query('SELECT * FROM public.communication_submission_receipts WHERE intent_id=$1',[intentId]);if(rows.length!==1)fail();const r=rows[0] as Record<string,unknown>,snapshot=submission.snapshot;
  if(r.intent_id!==intentId||r.organization_id!==this.options.actor.organizationId||r.owner_user_id!==this.options.actor.userId||r.binding_id!==this.options.bindingId||r.operation_key!==snapshot.key||r.payload_digest!==snapshot.payloadDigest||typeof r.encrypted_receipt!=='string'||typeof r.receipt_key_version!=='string')fail();
  const receipt=this.options.codec.decode(snapshot,'receipt',JSON.parse(r.encrypted_receipt as string)) as SubmissionReceipt;
  assertSubmissionReceiptMatches(snapshot,submission.message.recipient,receipt);
  const ref='message'in receipt?receipt.message.id:receipt.operation.id;
  if(this.options.codec.digest(snapshot,'receipt',receipt,r.receipt_key_version as string)!==r.receipt_digest||this.options.codec.digest(snapshot,'context',{domain:'acquire.submitted-recipient.v1',recipient:receipt.recipient},r.receipt_key_version as string)!==r.recipient_digest||ref!==r.provider_reference||('conversation'in receipt?receipt.conversation?.id??null:null)!==(r.provider_conversation_reference??null)||Date.parse(instant(receipt.submittedAt,this.options.businessClock))!==new Date(r.submitted_at as string).getTime())fail();
  return receipt;
 }
}
