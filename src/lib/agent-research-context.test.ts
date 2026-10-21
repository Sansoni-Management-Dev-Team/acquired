import {expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import {assertNativeResearchPersistence} from './agent-research-context';
import {buildAllDiscoveredCompanyPolicy} from '@/domain/research-discovery-policy';
import {buildHybridCompanyContinuationSource} from '@/domain/hybrid-company-continuation';
const sourceRootId='00000000-0000-4000-8000-000000000001',mandateId='00000000-0000-4000-8000-000000000002',operationId='00000000-0000-4000-8000-000000000003';
const native={version:1,operationId,responsibilityId:'00000000-0000-4000-8000-000000000004',threadId:'00000000-0000-4000-8000-000000000005',responsibilityRevision:1,mandateRevision:'12'};
const job=()=>({organizationId:'owned-org',mandateId,createdBy:'owned-actor',config:{nativeAgent:native} as Record<string,unknown>});
function source(){return{id:sourceRootId,status:'partial',config:{pipelineDesign:'hybrid-firmable-v1',researchRunId:sourceRootId,companyIdentityPolicyVersion:1,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),companyOnly:true,includeCompanyPeople:false,includePhones:false,findPeople:false,firmableSearchPages:{'0':{records:[{id:'f123',name:'Original company',website:'https://source.example'}],totalCompany:1}},hybridResult:{discoveryPolicy:buildAllDiscoveredCompanyPolicy(),selection:[{candidateKey:'firmable:f123',firmableId:'f123',domain:'source.example',sources:['firmable'],outcome:'not_started'}]}}};}
async function fixture(){const saved=source(),snapshot=await buildHybridCompanyContinuationSource({sourceRootId:saved.id,status:saved.status,config:saved.config}),review={version:1,sourceRootId,sourceDigest:snapshot.sourceDigest,candidateKeys:['firmable:f123']},current=job();current.config.companyContinuation=review;return{saved,review,current};}
function database(options:{saved?:ReturnType<typeof source>;review?:unknown;member?:boolean;sqlFailure?:Error;arrayRows?:boolean}={}){
 const queries:{sql:string;params:unknown[]}[]=[];const execute=vi.fn(async(query:Parameters<PgDialect['sqlToQuery']>[0])=>{const compiled=new PgDialect().sqlToQuery(query);queries.push(compiled);let rows:unknown[]=[];
  if(compiled.sql.includes('FROM agent_responsibilities'))rows=options.member===false?[]:[{id:native.responsibilityId}];
  if(compiled.sql.includes('FROM research_jobs'))rows=options.saved?[options.saved]:[];
  if(compiled.sql.includes("current_setting('role'"))rows=[{role:'none',organization_id:'prior-org',user_id:'prior-actor'}];
  if(compiled.sql.includes('agent_assert_company_continuation')){if(options.sqlFailure)throw options.sqlFailure;rows=[{continuation:options.review}];}
  return options.arrayRows?rows:{rows};
 });return{execute,queries};
}
it('preserves ordinary lock ordering and the existing native membership fence without continuation queries',async()=>{
 const ordinary=job();ordinary.config={};const legacy=database();await assertNativeResearchPersistence(legacy,ordinary);expect(legacy.queries).toHaveLength(2);expect(legacy.queries[0].sql).toContain('pg_advisory_xact_lock');expect(legacy.queries[1].sql).toContain('communications_lock_send_gate');
 const current=database();await assertNativeResearchPersistence(current,job());expect(current.queries).toHaveLength(3);expect(current.queries[2].sql).toContain('FOR SHARE OF r,m,mem');expect(current.queries[2].params).toEqual([native.responsibilityId,native.threadId,'owned-org','owned-actor',mandateId,1,'12']);
});
it('rejects a changed saved snapshot before any company/source write or SQL continuation admission',async()=>{
 const f=await fixture();f.saved.config.firmableSearchPages['0'].records[0].name='Changed after review';const db=database({saved:f.saved,review:f.review}),write=vi.fn();const persist=async()=>{await assertNativeResearchPersistence(db,f.current);write();};
 await expect(persist()).rejects.toThrow('source changed');expect(write).not.toHaveBeenCalled();expect(db.queries.some(q=>q.sql.includes('set_config')||q.sql.includes('agent_assert_company_continuation'))).toBe(false);
});
it.each([false,true])('checks owned current source and SQL claim in the same transaction, array result=%s',async arrayRows=>{
 const f=await fixture(),db=database({saved:f.saved,review:f.review,arrayRows});await assertNativeResearchPersistence(db,f.current);expect(db.queries).toHaveLength(9);
 const sourceQuery=db.queries[3];expect(sourceQuery.sql).toContain('SELECT id,status,config FROM research_jobs');expect(sourceQuery.sql).toContain('FOR SHARE');expect(sourceQuery.params).toEqual([sourceRootId,'owned-org',mandateId,'owned-actor']);
 expect(db.queries[4].sql).toContain("current_setting('role'");expect(db.queries[5].sql).toContain("set_config('app.acquire_org'");expect(db.queries[5].sql).toContain("set_config('app.acquire_user'");expect(db.queries[5].params).toEqual(['owned-org','owned-actor']);expect(db.queries[6].sql).toContain('SET LOCAL ROLE acquire_agent_user');expect(db.queries[7].params).toEqual([operationId]);expect(db.queries[8].sql).toContain("set_config('role'");expect(db.queries[8].params).toEqual(['none','prior-org','prior-actor']);
});
it('does not load source or authorize continuation after current native membership is revoked',async()=>{
 const f=await fixture(),db=database({saved:f.saved,review:f.review,member:false});await expect(assertNativeResearchPersistence(db,f.current)).rejects.toThrow('context changed');expect(db.queries).toHaveLength(3);
});
it('rejects missing owned source and metadata without native authority',async()=>{
 const f=await fixture(),missing=database();await expect(assertNativeResearchPersistence(missing,f.current)).rejects.toThrow('source');expect(missing.queries).toHaveLength(4);
 delete f.current.config.nativeAgent;const ordinary=database();await expect(assertNativeResearchPersistence(ordinary,f.current)).rejects.toThrow('native');expect(ordinary.queries).toHaveLength(2);
});
it('preserves a SQL claim refusal and rejects another operation metadata before writes',async()=>{
 const f=await fixture(),error=Error('Company continuation candidate already claimed'),denied=database({saved:f.saved,review:f.review,sqlFailure:error});await expect(assertNativeResearchPersistence(denied,f.current)).rejects.toBe(error);
 expect(denied.queries.at(-1)?.sql).toContain('agent_assert_company_continuation');expect(denied.queries.filter(q=>q.sql.includes("set_config('role'"))).toHaveLength(0);
 const mismatch=database({saved:f.saved,review:{...f.review,sourceDigest:'a'.repeat(64)}});await expect(assertNativeResearchPersistence(mismatch,f.current)).rejects.toThrow('continuation');expect(mismatch.queries.at(-1)?.params).toEqual(['none','prior-org','prior-actor']);
});
