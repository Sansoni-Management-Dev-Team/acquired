import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {agentActorSchema,agentRecordDigest,type AgentActor} from './agent-store';
import type {AgentDemoPreparation,AgentDemoProvisioningPort} from '@/lib/agent-demo-provisioning';
import type {AgentDemoParticipantsRequest,AgentDemoParticipantsResult} from '@/lib/agent-demo-client';

const uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
export type AgentDemoRunSelection={runId:string;integrationId:string;configurationReference:string};
export class AgentDemoProvisioningError extends Error{constructor(message:string,readonly status=409){super(message);}}
type Run={id:string;run_id:string;integration_id:string;configuration_ref:string;senders:AgentDemoPreparation['run']['senders']};
/** Privileged application writer, never exposed as a model tool accepting
 * identities. SQL independently checks canonical source CAS and registry scope.
 * No transaction includes network I/O or mutates a real company/contact row. */
export class AgentDemoProvisioningStore implements AgentDemoProvisioningPort{
 private actor:AgentActor;
 constructor(private pool:Pool,actor:AgentActor,private selection:AgentDemoRunSelection){this.actor=agentActorSchema.parse(actor);}
 private async transaction<T>(work:(c:PoolClient)=>Promise<T>){
  const c=await this.pool.connect();try{
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');
   await c.query('SELECT public.communications_lock_send_gate($1)',[this.actor.organizationId]);
   await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[this.actor.organizationId,this.actor.userId]);
   if(!(await c.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[this.actor.organizationId,this.actor.userId])).rowCount)throw new AgentDemoProvisioningError('Current organisation membership required.',403);
   const result=await work(c);await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 private async ownedDemo(c:PoolClient,mandateId:string){
  const m=(await c.query('SELECT m.id,x.mode,x.demo_id,x.created_by FROM mandates m LEFT JOIN agent_mandate_execution_modes x ON x.mandate_id=m.id AND x.organization_id=m.organization_id WHERE m.id=$1 AND m.organization_id=$2 FOR SHARE OF m',[uuid.parse(mandateId),this.actor.organizationId])).rows[0];
  if(!m)throw new AgentDemoProvisioningError('Mandate unavailable.',404);
  if(m.mode!=='demo'||m.demo_id!==m.id)throw new AgentDemoProvisioningError('Real mandates do not use demo contacts.');
  if(m.created_by!==this.actor.userId)throw new AgentDemoProvisioningError('Only the demo owner can prepare its simulated contacts.',403);
 }
 private async run(c:PoolClient,id?:string):Promise<Run>{
  const rows=(await c.query('SELECT * FROM agent_demo_runs WHERE organization_id=$1 AND owner_user_id=$2 AND run_id=$3 AND integration_id=$4 AND configuration_ref=$5 AND ($6::uuid IS NULL OR id=$6::uuid) FOR SHARE',[this.actor.organizationId,this.actor.userId,this.selection.runId,this.selection.integrationId,this.selection.configurationReference,id??null])).rows;
  if(rows.length!==1)throw new AgentDemoProvisioningError('Connect and verify the dedicated demo accounts before preparing recipients.',503);
  const run=rows[0] as Run;
  if((await c.query('SELECT public.agent_demo_run_bindings_match($1,$2,$3,$4,$5,$6::jsonb) AS matches',[this.actor.organizationId,this.actor.userId,run.run_id,run.integration_id,run.configuration_ref,JSON.stringify(run.senders)])).rows[0]?.matches!==true)throw new AgentDemoProvisioningError('The recorded demo accounts changed. Review their connections before continuing.');
  return run;
 }
 private async assertSources(c:PoolClient,manifest:AgentDemoParticipantsRequest){
  const sources=(await c.query(`SELECT c.id,c.xmin::text AS revision,public.agent_demo_contact_fingerprint(c.id) AS fingerprint
   FROM contacts c WHERE c.organization_id=$1 AND c.id=ANY($2::uuid[]) AND c.fictionalised=false AND c.firmable_person_id IS NOT NULL
   AND coalesce(c.personal_data->>'doNotContact','false')='false'
   AND (c.mandate_id=$3 OR EXISTS(SELECT 1 FROM mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.mandate_id=$3 AND mt.target_id=c.target_id)) FOR SHARE OF c`,[this.actor.organizationId,manifest.people.map(p=>p.sourcePersonId),manifest.mandateId])).rows;
  if(sources.length!==manifest.people.length||manifest.people.some(p=>!sources.some(c=>c.id===p.sourcePersonId&&c.revision===p.sourceRevision&&c.fingerprint===p.sourceFingerprint)))throw new AgentDemoProvisioningError('The researched person changed or is no longer eligible. Review the current research before continuing.');
 }
 private manifest(value:unknown,mandateId:string,requestKey:string):AgentDemoParticipantsRequest{
  // Persisted metadata is not client authority. Its actor/mode/request scope is
  // checked again on every replay and before writing any mapping receipt.
  const m=value as AgentDemoParticipantsRequest;
  if(!m||m.version!==1||m.demoId!==mandateId||m.mandateId!==mandateId||m.organizationId!==this.actor.organizationId||m.userId!==this.actor.userId||m.requestKey!==requestKey||!Array.isArray(m.people)||!m.people.length||m.people.length>50)throw new AgentDemoProvisioningError('The saved demo request could not be verified.');
  return m;
 }
 async plan(mandateId:string,requestKey:string):Promise<AgentDemoPreparation|{kind:'complete';count:number}>{
  uuid.parse(mandateId);uuid.parse(requestKey);
  return this.transaction(async c=>{
   await this.ownedDemo(c,mandateId);
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['demo-contact-request:'+requestKey]);
   const prior=(await c.query('SELECT * FROM agent_demo_mapping_requests WHERE request_key=$1 FOR SHARE',[requestKey])).rows[0];
   if(prior&&(prior.organization_id!==this.actor.organizationId||prior.created_by!==this.actor.userId||prior.mandate_id!==mandateId))throw new AgentDemoProvisioningError('This request conflicts with another saved request.');
   const run=await this.run(c,prior?.demo_run_id);
   let manifest:AgentDemoParticipantsRequest;
   if(prior){manifest=this.manifest(prior.manifest,mandateId,requestKey);if(prior.input_digest!==agentRecordDigest(manifest))throw new AgentDemoProvisioningError('The saved demo request changed.');}
   else{
    const people=(await c.query(`SELECT c.id AS "sourcePersonId",c.xmin::text AS "sourceRevision",public.agent_demo_contact_fingerprint(c.id) AS "sourceFingerprint"
     FROM contacts c WHERE c.organization_id=$1 AND c.fictionalised=false AND c.firmable_person_id IS NOT NULL AND coalesce(c.personal_data->>'doNotContact','false')='false'
     AND (c.mandate_id=$2 OR EXISTS(SELECT 1 FROM mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.mandate_id=$2 AND mt.target_id=c.target_id))
     AND NOT EXISTS(SELECT 1 FROM agent_demo_contact_mappings d WHERE d.demo_id=$2 AND d.contact_id=c.id)
     ORDER BY c.id LIMIT 50 FOR SHARE OF c`,[this.actor.organizationId,mandateId])).rows as AgentDemoParticipantsRequest['people'];
    if(!people.length)throw new AgentDemoProvisioningError('No new researched contacts are ready. Complete people enrichment or review the existing demo contacts first.');
    manifest={version:1,demoId:mandateId,organizationId:this.actor.organizationId,userId:this.actor.userId,mandateId,requestKey,people};
    await c.query('INSERT INTO agent_demo_mapping_requests(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id,manifest,input_digest) VALUES($1,$2,$3,$3,$4,$5,$6,$7)',[requestKey,this.actor.organizationId,mandateId,this.actor.userId,run.id,JSON.stringify(manifest),agentRecordDigest(manifest)]);
   }
   await this.assertSources(c,manifest);
   const receipt=(await c.query('SELECT result FROM agent_demo_mapping_receipts WHERE request_key=$1',[requestKey])).rows[0];
   if(receipt)return {kind:'complete',count:receipt.result.mappings.length};
   return {kind:'prepared',manifest,run:{id:run.id,runId:run.run_id,senders:run.senders}};
  });
 }
 async commit(prepared:AgentDemoPreparation,result:AgentDemoParticipantsResult):Promise<number>{
  const manifest=this.manifest(prepared.manifest,prepared.manifest.mandateId,prepared.manifest.requestKey);
  return this.transaction(async c=>{
   await this.ownedDemo(c,manifest.mandateId);
   const request=(await c.query('SELECT * FROM agent_demo_mapping_requests WHERE request_key=$1 AND organization_id=$2 AND created_by=$3 AND mandate_id=$4 FOR UPDATE',[manifest.requestKey,this.actor.organizationId,this.actor.userId,manifest.mandateId])).rows[0];
   if(!request||request.demo_run_id!==prepared.run.id||request.input_digest!==agentRecordDigest(manifest)||agentRecordDigest(request.manifest)!==agentRecordDigest(manifest))throw new AgentDemoProvisioningError('The original demo preparation changed.');
   const run=await this.run(c,request.demo_run_id);await this.assertSources(c,manifest);
   if(result.runId!==run.run_id||result.demoId!==manifest.demoId||result.mappings.length!==manifest.people.length)throw new AgentDemoProvisioningError('The demo mapping response differs from its original request.');
   const prior=(await c.query('SELECT result FROM agent_demo_mapping_receipts WHERE request_key=$1',[manifest.requestKey])).rows[0];
   if(prior){if(prior.result.mappingDigest!==result.mappingDigest||agentRecordDigest(prior.result.mappings)!==agentRecordDigest(result.mappings))throw new AgentDemoProvisioningError('The original demo mapping receipt differs.');return prior.result.mappings.length;}
   await c.query('INSERT INTO agent_demo_mapping_receipts(request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id,result,result_digest) VALUES($1,$2,$3,$3,$4,$5,$6,$7)',[manifest.requestKey,this.actor.organizationId,manifest.mandateId,this.actor.userId,run.id,JSON.stringify(result),agentRecordDigest(result)]);
   // Keep the same transaction, row triggers and immutable conflict checks.
   // One insert/read pair avoids 100 network round trips for fifty people.
   await c.query(`INSERT INTO agent_demo_contact_mappings(organization_id,mandate_id,demo_id,created_by,contact_id,source_revision,source_fingerprint,demo_run_id,request_key,wire,mapping_digest)
    SELECT $1,$2,$2,$3,(entry.wire->>'sourcePersonId')::uuid,entry.wire->>'sourceRevision',entry.wire->>'sourceFingerprint',$4,$5,entry.wire,$7
    FROM jsonb_array_elements($6::jsonb) WITH ORDINALITY AS entry(wire,position) ORDER BY entry.position
    ON CONFLICT(demo_id,contact_id) DO NOTHING`,[this.actor.organizationId,manifest.mandateId,this.actor.userId,run.id,manifest.requestKey,JSON.stringify(result.mappings),result.mappingDigest]);
   const recorded=(await c.query('SELECT contact_id,demo_run_id,wire FROM agent_demo_contact_mappings WHERE demo_id=$1 AND contact_id=ANY($2::uuid[])',[manifest.demoId,result.mappings.map(wire=>wire.sourcePersonId)])).rows;
   if(recorded.length!==result.mappings.length||new Set(result.mappings.map(wire=>wire.sourcePersonId)).size!==result.mappings.length)throw new AgentDemoProvisioningError('The complete immutable demo identity set could not be verified.');
   for(const wire of result.mappings){
    const current=recorded.find(row=>row.contact_id===wire.sourcePersonId);
    if(current?.demo_run_id!==run.id||agentRecordDigest(current?.wire)!==agentRecordDigest(wire))throw new AgentDemoProvisioningError('A different immutable demo identity is already recorded.');
   }
   const content={text:`Prepared ${result.mappings.length} simulated contacts for this demo. The company and person research stays real. This preparation does not approve or send messages.`,details:{demoRunId:run.id,requestKey:manifest.requestKey,count:result.mappings.length,outreachReady:false}};
   await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
    SELECT id,organization_id,mandate_id,owner_user_id,$4,'assistant',$5,$6 FROM agent_threads
    WHERE mandate_id=$1 AND organization_id=$2 AND owner_user_id=$3 ON CONFLICT(thread_id,request_key) DO NOTHING`,[manifest.mandateId,this.actor.organizationId,this.actor.userId,'demo-contacts:'+manifest.requestKey,JSON.stringify(content),agentRecordDigest({role:'assistant',content})]);
   return result.mappings.length;
  });
 }
}
