import {expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {SQL} from 'drizzle-orm';
import {AcquisitionRepository} from './acquisition-repository';
import {emptyBrief} from '@/domain/acquisition';
import {buildDemoBuyerProfile} from '@/lib/agent-demo-buyer-profile';
vi.mock('./client',()=>({requireDb:()=>{throw Error('No implicit database');}}));
vi.mock('@/lib/company-projection-refresh',()=>({refreshCompanyProjectionsAfterChange:vi.fn(async()=>({status:'current',published:0,examined:0}))}));
const id='00000000-0000-4000-8000-000000000001';
function fixture(provenance:unknown,mode='demo',modeTableInstalled=true){
 const queries:{sql:string;params:unknown[]}[]=[],execute=vi.fn(async(query:SQL)=>{const rendered=new PgDialect().sqlToQuery(query);queries.push(rendered);if(rendered.sql.includes('to_regprocedure'))return [{installed:false,demo_modes_installed:modeTableInstalled,mandate_provenance:provenance}];if(rendered.sql.startsWith('SELECT mode,demo_id'))return [{mode,demo_id:id}];return [{id,created_at:'2026-10-18T00:00:00Z',revision:'200'}];});
 return{queries,execute,repository:new AcquisitionRepository('org',{execute}as never)};
}
function savedProvenance(queries:{sql:string;params:unknown[]}[]){const update=queries.find(row=>row.sql.includes('WITH gate'))!;return update.params.flatMap(value=>{if(typeof value!=='string')return [];try{const parsed=JSON.parse(value);return parsed?.source==='Reviewed structured brief'?[parsed]:[];}catch{return [];}})[0];}
it('rebuilds the exact existing demo buyer stamp when the reviewed search changes without exposing other criteria',async()=>{
 const original=emptyBrief();Object.assign(original.criteria.find(row=>row.key==='subsectors')!,{state:'specified',value:'Refrigeration'});const f=fixture({source:'original',demoBuyerProfile:buildDemoBuyerProfile(id,original)}),brief=emptyBrief();Object.assign(brief.criteria.find(row=>row.key==='subsectors')!,{state:'specified',value:'Commercial cleaning'});Object.assign(brief.criteria.find(row=>row.key==='geography')!,{state:'specified',value:'NSW'});brief.naturalLanguage='PRIVATE MANDATE FINANCIAL TERMS';brief.investmentThesis='PRIVATE THESIS';
 const result=await f.repository.updateBrief(brief,'actor',id,'100'),provenance=savedProvenance(f.queries);
 expect(provenance.demoBuyerProfile).toEqual(buildDemoBuyerProfile(id,brief));expect(provenance.demoBuyerProfile.profile.about).toContain('Commercial cleaning in NSW');expect(JSON.stringify(provenance.demoBuyerProfile)).not.toContain('Refrigeration');expect(JSON.stringify(provenance.demoBuyerProfile)).not.toContain('PRIVATE');expect(result.revision).toBe('200');expect(f.queries.find(row=>row.sql.includes('WITH gate'))!.sql).toContain('xmin::text=');
});
it('never adds a profile to ordinary or legacy real edits and never queries their optional mode table',async()=>{
 for(const [provenance,installed]of [[{},false],[{source:'ordinary'},true]]as const){const f=fixture(provenance,'real',installed);await f.repository.updateBrief(emptyBrief(),'actor',id,'100');expect(savedProvenance(f.queries)).not.toHaveProperty('demoBuyerProfile');expect(f.execute).toHaveBeenCalledTimes(2);expect(f.queries.some(row=>row.sql.startsWith('SELECT mode,demo_id'))).toBe(false);}
});
it('refuses to elevate a foreign, unapproved or real-mode stamp during a brief edit',async()=>{
 const stamp=buildDemoBuyerProfile(id,emptyBrief());for(const [stored,mode]of [[{...stamp,mandateId:'00000000-0000-4000-8000-000000000002'},'demo'],[{...stamp,profile:{...stamp.profile,publicProfileApproved:false}},'demo'],[stamp,'real']]as const){const f=fixture({demoBuyerProfile:stored},mode);await f.repository.updateBrief(emptyBrief(),'actor',id,'100');expect(savedProvenance(f.queries)).not.toHaveProperty('demoBuyerProfile');if(mode==='demo')expect(f.queries.some(row=>row.sql.startsWith('SELECT mode,demo_id'))).toBe(false);}
});
