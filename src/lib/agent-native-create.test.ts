import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {emptyBrief} from '@/domain/acquisition';
import {agentRecordDigest} from '@/db/agent-store';
import {createNativeAgentMandate} from './agent-native-create';
const id='00000000-0000-4000-8000-000000000001',actor={organizationId:'org',userId:'actor'};
function fixture(replayInput?:unknown){
 const query=vi.fn(async(sql:string,values?:unknown[])=>{
  if(sql.startsWith('SELECT id FROM member'))return {rows:[{id:'membership'}],rowCount:1};
  if(sql.startsWith('SELECT * FROM audit_events'))return {rows:replayInput?[{organization_id:'org',actor_id:'actor',action:'agent.mandate_created',entity_type:'mandate',entity_id:id,metadata:{inputDigest:agentRecordDigest(replayInput),creationRevision:'123',executionMode:'demo'}}]:[],rowCount:replayInput?1:0};
  if(sql.startsWith('SELECT id,created_by FROM mandates'))return {rows:[{id,created_by:'actor'}],rowCount:1};
  if(sql.startsWith('SELECT mode,demo_id'))return {rows:[{mode:'demo',demo_id:id}],rowCount:1};
  if(sql.startsWith('INSERT INTO mandates'))return {rows:[{id,revision:'123'}],rowCount:1};
  void values;return {rows:[],rowCount:0};
 });
 const release=vi.fn(),pool={connect:vi.fn(async()=>({query,release}))}as unknown as Pool;return{pool,query,release};
}
it('stamps each new demo mandate with its own fictional buyer matched to the exact saved search',async()=>{
 const brief=emptyBrief();Object.assign(brief.criteria.find(row=>row.key==='subsectors')!,{state:'specified',value:'Commercial refrigeration'});Object.assign(brief.criteria.find(row=>row.key==='geography')!,{state:'specified',value:'QLD'});const f=fixture();
 const result=await createNativeAgentMandate(f.pool,actor,{requestId:id,brief,executionMode:'demo'},{startResearch:true});
 const insert=f.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO mandates'))!,provenance=JSON.parse(String(insert[1]![5]));
 expect(provenance.demoBuyerProfile).toMatchObject({version:1,mandateId:id,profile:{senderName:'Alex Morgan',signature:'Alex Morgan\nExample Acquisition Group',publicProfileApproved:true}});
 expect(provenance.demoBuyerProfile.profile.about).toContain('Commercial refrigeration');expect(provenance.demoBuyerProfile.profile.about).toContain('QLD');expect(provenance.demoBuyerProfile.profile.about).toContain('TEST DATA');expect(result.revision).toBe('123');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('keeps real-mode creation provenance unchanged',async()=>{
 const input={requestId:id,brief:emptyBrief(),executionMode:'real'},f=fixture();await createNativeAgentMandate(f.pool,actor,input);const insert=f.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO mandates'))!;
 expect(JSON.parse(String(insert[1]![5]))).toEqual({source:'Reviewed native agent brief',inputDigest:agentRecordDigest(input)});
});
it('replays the original creation revision without rewriting or regenerating a demo profile',async()=>{
 const input={requestId:id,brief:emptyBrief(),executionMode:'demo'},f=fixture(input),result=await createNativeAgentMandate(f.pool,actor,input);
 expect(result).toMatchObject({id,revision:'123',executionMode:'demo',replayed:true});expect(f.query.mock.calls.some(([sql])=>/^(INSERT|UPDATE)/.test(sql))).toBe(false);expect(f.release).toHaveBeenCalledOnce();
});

it('records the chat Start gate only on new immutable creation receipts',async()=>{
 const f=fixture();await createNativeAgentMandate(f.pool,actor,{requestId:id,brief:emptyBrief()},{startResearch:true,startOn:'chat'});
 const args=f.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO audit_events'))![1]!;expect(JSON.parse(String(args[3])).initialResearch).toMatchObject({requestId:id,startOn:'chat'});
});
