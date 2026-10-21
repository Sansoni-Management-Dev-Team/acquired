import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {buildAgentResearchPlan} from '@/lib/agent-research-plan';
import {emptyBrief} from '@/domain/acquisition';
const sql=readFileSync('ops/agent-mode/migrations/0089-agent-automatic-basic-people.sql','utf8');
it('keeps SQL exact V5 pricing/discovery literals equal to the reviewed application plan',()=>{
 const brief=emptyBrief();for(const[key,value]of[['subsectors','Laundry'],['geography','National']])Object.assign(brief.criteria.find(c=>c.key===key)!,{state:'specified',value,confirmed:true});
 const plan=buildAgentResearchPlan({productionPipeline:'hybrid-firmable-v1',discoveryPolicyVersion:5,brief,researchJobId:'00000000-0000-4000-8000-000000000001',responsibilityId:'00000000-0000-4000-8000-000000000002',responsibilityRevision:1,mandateRevision:'1'});
 expect(JSON.parse(sql.match(/p_input->'providerPolicy'='([^']+)'::jsonb/)![1])).toEqual(plan.providerPolicy);
 expect(JSON.parse(sql.match(/p_input->'config'->'companyDiscoveryPolicy'='([^']+)'::jsonb/)![1])).toEqual(plan.config.companyDiscoveryPolicy);
 expect(JSON.parse(sql.match(/p_input->'execution'='([^']+)'::jsonb/)![1])).toEqual(plan.execution);
});
it('keeps the old V4 recognizers byte-identical while adding independent V5 branches',()=>{
 const old=readFileSync('ops/agent-mode/migrations/0086-agent-company-only-funding.sql','utf8');
 const recognizers=(value:string)=>[...value.matchAll(/company_v4:=coalesce\([\s\S]*?false\);/g)].map(match=>match[0]);
 expect(recognizers(sql)).toEqual(recognizers(old));expect(recognizers(sql)).toHaveLength(3);
 expect(sql).not.toMatch(/CREATE TABLE|GRANT SELECT|ALTER TABLE/);
});
it('prepares only scoped definer ports with no PUBLIC execute or phone authority',()=>{
 for(const [name,args]of [['agent_automatic_people_context','uuid,uuid,text'],['agent_assert_automatic_people_target','uuid,uuid'],['agent_record_automatic_people_candidates','uuid,uuid,jsonb'],['agent_save_automatic_people_profile','uuid,uuid,jsonb']]){
  expect(sql).toContain(`CREATE FUNCTION public.${name}(`);
  expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC;`);
  expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO acquire_agent_user;`);
 }
 expect(sql).toContain("coalesce(child.input->>'requestClass','') NOT IN('company_search','company_profile','auth','people_search','person_profile')");
 expect(sql).toContain("x.cap-x.spent-x.reserved<amount");
 expect(sql).toContain("provenance->>'nativeAutomaticPeopleOperationId' IS DISTINCT FROM o.id::text");
 expect(sql).toContain("'phoneLookupStatus','not_requested'");
});

it('keeps automatic People tied to exact accepted members without derived scoring admission',()=>{
 const context=sql.slice(sql.indexOf('CREATE FUNCTION public.agent_automatic_people_context'),sql.indexOf('CREATE FUNCTION public.agent_assert_automatic_people_target'));
 expect(context).toContain('public.agent_fields_current_source(org,o.mandate_id,target)');
 expect(context).not.toMatch(/agent_people_company_snapshot|qualification|fit_score|LIMIT 50/);
 expect(context).toContain("assessment->>'stage' IN('excluded','parked') AND assessment->>'decisionOrigin' IS DISTINCT FROM 'automatic'");
 expect(context).toContain("sourceRevision' IS DISTINCT FROM item->>'sourceRevision'");
 expect(context).toContain('public.agent_contact_identity_batch');
 expect(context).toContain('public.agent_aliases_have_unresolved_sends');
 const save=sql.slice(sql.indexOf('CREATE FUNCTION public.agent_save_automatic_people_profile'));
 expect(save).not.toContain('THEN RETURN NULL');
 expect(save).toContain("IF scope->'outcomes' ? pid THEN RETURN");
 expect(save).toContain("scope->'candidates' @> jsonb_build_array(pid)");
});

it('routes only historical V1 plans into legacy launcher validation, excluding V4 and V5',()=>{
 const prepare=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.agent_prepare_hybrid_native_research'),sql.indexOf('CREATE OR REPLACE FUNCTION public.agent_reserve_research_phase'));
 const guard=prepare.match(/IF ([A-Z_ a-z0-9()]+) THEN IF o\.id IS NULL/)!;
 expect(guard).not.toBeNull();
 const expression=guard[1];expect(expression.replace(/company_v4|company_v5|NOT|AND|OR|[()\s]/g,'')).toBe('');
 const evaluate=new Function('company_v4','company_v5','return '+expression.replace(/NOT/g,'!').replace(/AND/g,'&&').replace(/OR/g,'||')) as (v4:boolean,v5:boolean)=>boolean;
 expect([[false,false],[true,false],[false,true],[true,true]].map(([v4,v5])=>evaluate(v4,v5))).toEqual([true,false,false,false]);
});

it('parenthesizes the scalar CASE used inside PLpgSQL physical-attempt IF comparison',()=>{
 expect(sql).toContain(")>(CASE WHEN child.input->>'requestClass'='people_search' THEN 2 ELSE 6 END) THEN");
 expect(sql).not.toContain(")>CASE WHEN");
});

it('forward context fix renames only the ambiguous local variable, retaining qualified columns and domain JSON key',()=>{
 const forward=readFileSync('ops/agent-mode/migrations/0090-agent-automatic-people-context-domain.sql','utf8');
 const original=sql.slice(sql.indexOf('CREATE FUNCTION public.agent_automatic_people_context('),sql.indexOf('CREATE FUNCTION public.agent_assert_automatic_people_target(')).trim();
 const fixed=forward.slice(forward.indexOf('CREATE OR REPLACE FUNCTION')).trim();
 const expected=original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('domain text;','company_domain text;').replace(' domain:=',' company_domain:=').replaceAll('coalesce(domain,','coalesce(company_domain,').replaceAll('regexp_replace(domain,','regexp_replace(company_domain,');
 expect(fixed).toBe(expected);expect(fixed).toContain("projection->'target'->>'domain'");expect(fixed).toContain('g.domain');expect(fixed).toContain('suppression.domain');
 expect(fixed).not.toMatch(/(?<![.\w'])domain(?: text;|:=|,)/);
});
