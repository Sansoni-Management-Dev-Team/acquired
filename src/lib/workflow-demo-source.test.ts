import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {briefToMandate,emptyBrief,initialAssessment,type MembershipView} from '@/domain/acquisition';
import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import {rankTarget} from '@/domain/scoring';
import {selectWorkflowDemoSource} from './workflow-demo-source';
vi.mock('server-only',()=>({}));
const actor={organizationId:'synthetic-org',userId:'synthetic-owner'},first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002',targetId='10000000-0000-4000-8000-000000000003';
const brief={...emptyBrief(),criteria:emptyBrief().criteria.map(c=>['subsectors','geography','headcount'].includes(c.key)?{...c,state:'specified'as const,value:c.key==='subsectors'?'Specialty food production':c.key==='geography'?'NSW, VIC, QLD':'20–60'}:c)};
function member(headcount:number,stage:MembershipView['assessment']['stage']='identified',organizationId=actor.organizationId):MembershipView{
 const filters=briefToMandate(brief),raw={id:'f123',name:'Synthetic Company',website:'https://synthetic.example.test',region:{AU:{employee_count:headcount,address:{state:'NSW'}}},industries:['Food manufacturing'],company_type:'Private company'},target=rankTarget({...mapFirmableProfile(raw,filters,organizationId),id:targetId},filters);
 return {target,assessment:{...initialAssessment,stage},accreditations:[],version:1};
}
function fixture(sources=[{id:first,revision:'7',brief},{id:second,revision:'9',brief}],firstMembers=[member(129)],secondMembers=[member(35)]){
 const query=vi.fn(async(sql:string,values?:unknown[])=>({rows:sql.includes('workflow-demo-sources')?sources:sql.includes('workflow-demo-contact-targets')?[{id:targetId}]:[],rowCount:values?.length?1:0})),memberships=vi.fn(async(id:string)=>id===first?firstMembers:secondMembers);
 return {query,memberships,run:()=>selectWorkflowDemoSource({query}as unknown as PoolClient,actor,{memberships})};
}
it('skips the demonstrated129 versus20–60 mismatch and chooses a saved source with one usable person',async()=>{
 const f=fixture();await expect(f.run()).resolves.toEqual({mandateId:second,mandateRevision:'9'});expect(f.memberships).toHaveBeenCalledTimes(2);expect(f.query.mock.calls.every(([sql])=>/^(?:SELECT|WITH)\b/.test(sql))).toBe(true);expect(f.query.mock.calls[0]?.[0]).toContain('acquisition_workflow_mandate_unused');expect(f.query.mock.calls[0]?.[1]).toEqual([actor.organizationId,actor.userId]);
});
it('does not reinstate arbitrary minimum company or people counts or silently rewrite automatic and human decisions',async()=>{
 const f=fixture(undefined,[member(35)]);await expect(f.run()).resolves.toEqual({mandateId:first,mandateRevision:'7'});expect(f.memberships).toHaveBeenCalledOnce();
 const human=fixture(undefined,[member(35,'excluded')],[member(35,'parked')]);expect(await human.run()).toBeUndefined();
});
it.each([
 ['naturalLanguage','Research only: do not contact anyone.'],
 ['naturalLanguage','We seek an established service business. Research only: do not contact anyone.'],
 ['outreachPositioning','Research only.'],
 ['outreachPositioning','No outreach. Do not contact owners.'],
]as const)('skips an explicitly restricted %s and selects the next usable saved brief',async(field,value)=>{
 const restricted={...brief,[field]:value};
 const f=fixture([{id:first,revision:'7',brief:restricted},{id:second,revision:'9',brief}],[member(35)],[member(35)]);
 await expect(f.run()).resolves.toEqual({mandateId:second,mandateRevision:'9'});
 expect(f.query.mock.calls.some(([sql,values])=>sql.includes('workflow-demo-contact-targets')&&values?.[0]===first)).toBe(false);
 expect(f.memberships).toHaveBeenCalledExactlyOnceWith(second,[targetId]);
 expect(restricted[field]).toBe(value);
});
it('returns no demo source when every saved brief explicitly prohibits outreach',async()=>{
 const f=fixture([
  {id:first,revision:'7',brief:{...brief,naturalLanguage:'Research-only run. Do not contact anyone.'}},
  {id:second,revision:'9',brief:{...brief,outreachPositioning:'No-contact research only.'}},
 ],[member(35)],[member(35)]);
 expect(await f.run()).toBeUndefined();
 expect(f.query).toHaveBeenCalledOnce();
 expect(f.memberships).not.toHaveBeenCalled();
});
it.each([
 'This is not research only. Prepare outreach for review.',
 'No restrictions on outreach. Prepare introductions for review.',
 'No contact restrictions apply. Prepare introductions for review.',
 'No outreach restrictions apply. Prepare introductions for review.',
])('does not turn non-prohibiting wording into a demo restriction: %s',async value=>{
 const f=fixture([{id:first,revision:'7',brief:{...brief,naturalLanguage:value,outreachPositioning:value}}],[member(35)]);
 await expect(f.run()).resolves.toEqual({mandateId:first,mandateRevision:'7'});
});
it('does not confuse shared display-only people with materialized owned contacts',async()=>{
 const f=fixture();f.query.mockImplementation(async(sql:string)=>({rows:sql.includes('workflow-demo-sources')?[{id:first,revision:'7',brief}]:[],rowCount:1}));expect(await f.run()).toBeUndefined();expect(f.memberships).not.toHaveBeenCalled();
});
it('rejects foreign company records, malformed briefs and mismatched target membership',async()=>{
 const f=fixture(undefined,[member(35,'identified','another-org')],[{...member(35),target:{...member(35).target,id:first}}]);expect(await f.run()).toBeUndefined();
 const invalid=fixture([{id:first,revision:'7',brief:null}as never]);expect(await invalid.run()).toBeUndefined();expect(invalid.memberships).not.toHaveBeenCalled();
});
it('returns no selection when all saved candidates are excluded and never changes source data',async()=>{
 const f=fixture(undefined,[member(129)],[member(160)]);expect(await f.run()).toBeUndefined();expect(f.query.mock.calls.every(([sql])=>/^(?:SELECT|WITH)\b/.test(sql))).toBe(true);
});
// Historical workspace reads can overlay a newer global history response. The
// agent's source hint must exercise its canonical/accepted snapshot instead.
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{async memberships(){return[member(35)];}}}));
const observations=vi.hoisted(()=>({current:new Map()}));vi.mock('@/db/company-observation-read-model',()=>({loadAcceptedCompanyObservations:async()=>observations.current}));
function nativeFixture(headcount:number,savedBrief=brief){
 const raw={id:targetId,organizationId:actor.organizationId,companyName:'Synthetic Company',domain:'synthetic.example.test',identifiers:{firmableId:'f123'},firmographics:{firmable:{rawResponse:{id:'f123',region:{AU:{employee_count:headcount,address:{state:'NSW'}}}}}},status:'enriched',band:'cold',qualification:'research'};
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('workflow-demo-sources')?[{id:first,revision:'7',brief:savedBrief}]:sql.includes('workflow-demo-contact-targets')?[{id:targetId}]:sql.includes('workflow-demo-native-facts')?[{target:raw,assessment:initialAssessment,version:1,findings:[]}]:[]}));
 return{query,run:()=>selectWorkflowDemoSource({query}as unknown as PoolClient,actor)};
}
it('does not choose a legacy source based on GUI global-history35 when the native canonical headcount is129',async()=>{
 observations.current.clear();const f=nativeFixture(129);expect(await f.run()).toBeUndefined();expect(f.query.mock.calls.some(([sql])=>sql.includes('workflow-demo-native-facts'))).toBe(true);
});
it('uses native bounded canonical facts and latest20 mandate findings for a usable source',async()=>{
 observations.current.clear();const f=nativeFixture(35);expect(await f.run()).toEqual({mandateId:first,mandateRevision:'7'});
 const query=f.query.mock.calls.find(([sql])=>sql.includes('workflow-demo-native-facts'))?.[0];expect(query).toContain('f.mandate_id=$1');expect(query).toContain('ORDER BY f.observed_at DESC,f.id LIMIT 20');
});
it('uses the existing accepted observation projector without promoting unreviewed accepted criteria',async()=>{
 const current={id:'10000000-0000-4000-8000-000000000004',inputDigest:'a'.repeat(64),observedAt:'2026-10-18T00:00:00.000Z',sourceFacts:{identifiers:{firmableId:'f123'},firmographics:{firmable:{rawResponse:{id:'f123',region:{AU:{employee_count:35,address:{state:'NSW'}}}}}},firmableCompanyId:'f123'}};
 observations.current.set(targetId,current);try{expect(await nativeFixture(129).run()).toBeUndefined();expect(await nativeFixture(129,{...brief,criteria:brief.criteria.map(c=>({...c,confirmed:c.state==='specified'}))}).run()).toEqual({mandateId:first,mandateRevision:'7'});}finally{observations.current.clear();}
});
