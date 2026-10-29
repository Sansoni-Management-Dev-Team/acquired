import {AgentStore} from '../src/db/agent-store';
import {Pool} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AcquisitionWorkflowStore} from '../src/db/acquisition-workflow-store';
import {emptyBrief} from '../src/domain/acquisition';
const pool=new Pool({host:'127.0.0.1',port:5432,user:'postgres',database:'acquire_hosted_demo_rehearsal',max:2});
async function main(){
 const target=await pool.query("SELECT current_database() AS db,system_identifier::text AS id,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker FROM pg_control_system()");
 assert.deepEqual(target.rows[0],{db:'acquire_hosted_demo_rehearsal',id:'7699248227334438947',marker:'acquire-hosted-demo-rehearsal-only'});
 const org=randomUUID(),actor=randomUUID();const c=await pool.connect();
 try{await c.query('BEGIN');await c.query('INSERT INTO communication_member_fence(singleton,writer_xid) VALUES(true,0) ON CONFLICT DO NOTHING');await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[actor,'Workflow store rehearsal',actor+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$2,$1)',[org,'Workflow store rehearsal']);await c.query('INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,$4)',[randomUUID(),org,actor,'member']);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const store=new AcquisitionWorkflowStore(pool,{organizationId:org,userId:actor});
 const request={requestId:randomUUID(),preset:'live-research-test' as const,presentation:'workspace' as const,brief:{...emptyBrief(),name:'Store acceptance',naturalLanguage:'Synthetic workflow store test'}};
 const first=await store.start(request),again=await store.start(request);assert.equal(first.mandateId,request.requestId);assert.equal(first.id,again.id);assert.equal(again.replayed,true);assert.equal(first.state,'accepted');
 await assert.rejects(()=>store.start({...request,brief:{...request.brief,name:'Different brief'}}));
 assert.equal((await store.read(first.id))?.ownerUserId,actor);
 const other=new AcquisitionWorkflowStore(pool,{organizationId:org,userId:randomUUID()});assert.equal(await other.read(first.id),null);
 const cancelled=await store.transition(first.id,first.revision,'cancelled');assert.equal(cancelled.state,'cancelled');
 const counts=await pool.query('SELECT (SELECT count(*) FROM mandates WHERE id=$1) AS mandates,(SELECT count(*) FROM acquisition_workflow_executions WHERE id=$1) AS executions',[request.requestId]);assert.deepEqual(counts.rows[0],{mandates:'1',executions:'1'});
 const source=randomUUID(),company=randomUUID(),person=randomUUID();
 await pool.query('INSERT INTO mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES($1,$2,$3,$4,$5,$6)',[source,org,actor,'Saved synthetic source',JSON.stringify({brief:emptyBrief()}),'{}']);
 await pool.query('INSERT INTO firmable_companies(id) VALUES($1) ON CONFLICT DO NOTHING',['f123456']);
 await pool.query('INSERT INTO firmable_people(id) VALUES($1)',['p-synthetic-'+person]);
 await pool.query('INSERT INTO targets(id,organization_id,company_name,firmographics,firmable_company_id) VALUES($1,$2,$3,$4,$5)',[company,org,'Saved company','{}','f123456']);
 await pool.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id) VALUES($1,$2,$3)',[org,source,company]);
 await pool.query('INSERT INTO contacts(id,organization_id,target_id,display_name,provenance,fictionalised,firmable_person_id) VALUES($1,$2,$3,$4,$5,false,$6)',[person,org,company,'Saved person','{}','p-synthetic-'+person]);
 await pool.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,'complete','{}')",[randomUUID(),org,source,actor]);
 const demoRequest={requestId:randomUUID(),preset:'demo' as const,presentation:'agent' as const};
 const demo=await store.start(demoRequest);assert.equal(demo.mandateId,source);assert.notEqual(demo.id,source);
 assert.equal((await store.start(demoRequest)).id,demo.id);assert.equal((await store.transition(demo.id,demo.revision,'ready')).state,'ready');
 await assert.rejects(()=>store.start({...demoRequest,requestId:randomUUID()}),{code:'02000'});
 const agent=new AgentStore(pool,{organizationId:org,userId:actor});const thread=await agent.openThread(source);
 const event=await agent.enqueueEvent(thread.id,'delivery-test:'+demo.id,'conversation.reminder',{});
 const savedEvent=(await pool.query('SELECT workflow_execution_id FROM agent_events WHERE id=$1',[event.id])).rows[0];assert.equal(savedEvent.workflow_execution_id,demo.id);
 const worker=randomUUID(),claimed=await agent.claimEvent(worker,30000,source);assert.equal(claimed?.workflow_execution_id,demo.id);
 assert.equal(await agent.completeEvent(claimed!.id,worker,claimed!.fence),true);

 const totals=await pool.query('SELECT (SELECT count(*) FROM mandates WHERE organization_id=$1) AS mandates,(SELECT count(*) FROM targets WHERE organization_id=$1) AS companies,(SELECT count(*) FROM contacts WHERE organization_id=$1) AS people',[org]);assert.deepEqual(totals.rows[0],{mandates:'2',companies:'1',people:'1'});
 console.log(JSON.stringify({passed:true,source:'actual workflow and AgentStore against exact isolated PostgreSQL',eventContext:true,originalClaimAndCompletion:true,savedSourceNoCloning:true,oneCompanyOnePerson:true,noSourceNoFallback:true,newMandateReplay:true,conflictingBriefRejected:true,foreignReadHidden:true,lifecycle:true,fixtureRetained:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
