import {expect,it,vi} from 'vitest';
import {AgentDemoProvisioningStore} from './agent-demo-provisioning-store';
import {agentRecordDigest} from './agent-store';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(conflict=false,missing=false){
 const actor={organizationId:'org',userId:'owner'},runId=id(3),mandateId=id(1),requestKey=id(2);
 const mappings=Array.from({length:50},(_,i)=>({sourcePersonId:id(i+10),sourceRevision:'42',sourceFingerprint:'a'.repeat(64),simulatorLeadId:`lead-${i+100}`,email:`lead-${i+100}@demo.leads.acquire.test`,phone:`+999000000000${i+100}`,linkedin:`https://www.linkedin.com/in/sim-demo-lead-${i+100}`,providerId:`provider-${i}`}));
 const manifest={version:1 as const,demoId:mandateId,organizationId:'org',userId:'owner',mandateId,requestKey,people:mappings.map(({sourcePersonId,sourceRevision,sourceFingerprint})=>({sourcePersonId,sourceRevision,sourceFingerprint}))};
 const run={id:runId,run_id:'demo-run',integration_id:'sim',configuration_ref:'sim-v1',senders:[]};
 const result={runId:'demo-run',demoId:mandateId,mappingDigest:'b'.repeat(64),mappings} as never;
 const query=vi.fn(async(sql:string,values?:unknown[])=>{
  if(sql.includes('FROM member'))return {rows:[{id:'member'}],rowCount:1};
  if(sql.startsWith('SELECT m.id'))return {rows:[{id:mandateId,mode:'demo',demo_id:mandateId,created_by:'owner'}]};
  if(sql.startsWith('SELECT * FROM agent_demo_runs'))return {rows:[run]};
  if(sql.includes('agent_demo_run_bindings_match'))return {rows:[{matches:true}]};
  if(sql.startsWith('SELECT * FROM agent_demo_mapping_requests'))return {rows:[{demo_run_id:runId,input_digest:agentRecordDigest(manifest),manifest}]};
  if(sql.startsWith('SELECT c.id'))return {rows:mappings.map(w=>({id:w.sourcePersonId,revision:w.sourceRevision,fingerprint:w.sourceFingerprint}))};
  if(sql.startsWith('SELECT result FROM agent_demo_mapping_receipts'))return {rows:[]};
  if(sql.includes('FROM agent_demo_contact_mappings')){
   const selected=(Array.isArray(values?.[1])?mappings:mappings.filter(w=>w.sourcePersonId===values?.[1])).slice(missing?1:0);
   return {rows:selected.map((w,i)=>({contact_id:w.sourcePersonId,demo_run_id:runId,wire:conflict&&i===0?{...w,providerId:'different'}:w}))};
  }
  return {rows:[]};
 });
 const release=vi.fn(),pool={connect:vi.fn(async()=>({query,release}))};
 const store=new AgentDemoProvisioningStore(pool as never,actor,{runId:'demo-run',integrationId:'sim',configurationReference:'sim-v1'});
 return {query,mappings,manifest,run,result,store,release,commit:()=>store.commit({kind:'prepared',manifest,run:{id:runId,runId:'demo-run',senders:[]}},result)};
}
it('persists fifty exact mappings and verifies every immutable wire in two database calls',async()=>{
 const f=fixture();expect(await f.commit()).toBe(50);
 const writes=f.query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO agent_demo_contact_mappings'));
 const reads=f.query.mock.calls.filter(([sql])=>sql.includes('FROM agent_demo_contact_mappings'));
 expect(writes).toHaveLength(1);expect(reads).toHaveLength(1);
 expect(writes[0][0]).toContain('ON CONFLICT(demo_id,contact_id) DO NOTHING');
 expect(writes[0][1]).toContain(JSON.stringify(f.mappings));expect(reads[0][1]).toContainEqual(f.mappings.map(w=>w.sourcePersonId));
 expect(f.query.mock.calls.map(([sql])=>sql)).toContain('COMMIT');expect(f.release).toHaveBeenCalledOnce();
});
it('rolls back all preparation when one immutable saved mapping differs',async()=>{const f=fixture(true);await expect(f.commit()).rejects.toThrow('different immutable');expect(f.query.mock.calls.map(([sql])=>sql)).toContain('ROLLBACK');expect(f.query.mock.calls.map(([sql])=>sql)).not.toContain('COMMIT');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO agent_messages'))).toBe(false);});

it('rolls back an incomplete mapping set before reporting success',async()=>{const f=fixture(false,true);await expect(f.commit()).rejects.toThrow('complete immutable');expect(f.query.mock.calls.map(([sql])=>sql)).toContain('ROLLBACK');expect(f.query.mock.calls.map(([sql])=>sql)).not.toContain('COMMIT');});
