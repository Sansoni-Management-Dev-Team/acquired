import {beforeEach,expect,it,vi} from 'vitest';
import {getTableName} from 'drizzle-orm';
import {AcquisitionRepository} from './acquisition-repository';
import {emptyBrief,initialAssessment,type Assessment} from '@/domain/acquisition';
import {targetRecordToRankedTarget} from './target-record-mapper';
import type {AcceptedCompanyObservation} from '@/domain/company-membership-projection';
import {targets,signals} from './schema';
const m=vi.hoisted(()=>({observations:vi.fn(),ranked:vi.fn()}));
vi.mock('./client',()=>({requireDb:()=>{throw Error('No implicit database allowed');}}));
vi.mock('./company-observation-read-model',()=>({loadAcceptedCompanyObservations:m.observations}));
vi.mock('./repositories',()=>({OrganizationRepository:class{listRankedTargets=m.ranked;}}));
const mandateId='00000000-0000-4000-8000-000000000001',targetId='00000000-0000-4000-8000-000000000002';
const raw={id:'f234',name:'Synthetic fire services',website:'https://synthetic.example.invalid',description:'We maintain fire extinguishers and provide fire system maintenance.',region:{AU:{employee_count:35,address:{state:'VIC'}}}};
const record={id:targetId,organizationId:'org',mandateId:'old-buyer',companyName:'Original identity',domain:'synthetic.example.invalid',firmableCompanyId:'f234',identifiers:{},firmographics:{firmable:{rawResponse:{...raw,region:{AU:{employee_count:500,address:{state:'VIC'}}}}}},status:'enriched',band:'excluded',qualification:'excluded',fitScore:0,ripenessScore:100,financeabilityScore:100,confidenceScore:100,createdAt:new Date('2026-01-01Z'),updatedAt:new Date('2026-01-01Z')} as typeof targets.$inferSelect;
const signal={id:'signal',organizationId:'org',targetId,kind:'retirement',value:'Canonical signal',weight:'high',direction:'positive',source:'Saved register',sourceUrl:null,capturedAt:new Date('2026-01-01Z')} as typeof signals.$inferSelect;
const observation:AcceptedCompanyObservation={id:'00000000-0000-4000-8000-000000000003',inputDigest:'a'.repeat(64),observedAt:'2026-10-18T00:00:00.000Z',sourceFacts:{firmographics:{firmable:{rawResponse:raw}},identifiers:{firmableId:'f234'},firmableCompanyId:'f234'}};
function brief(){const b=emptyBrief();for(const[key,value]of[['subsectors','Fire protection maintenance'],['geography','VIC'],['headcount','18–90']])Object.assign(b.criteria.find(c=>c.key===key)!,{value,state:'specified',confirmed:true,importance:'requirement'});return b;}
function fixture(assessment:Assessment={...initialAssessment,decisionOrigin:'automatic' as const}){
 const current={id:'current',organizationId:'org',mandateId,targetId,jobId:null,sourceUrl:'https://source.invalid',observedAt:new Date('2026-01-01Z'),evidence:{kind:'description',value:'Current fact'},confidence:50};
 const foreign={...current,id:'other-buyer',mandateId:'another'};
 const rows:Record<string,unknown[]>={mandates:[{id:mandateId,filters:{brief:brief()},createdAt:new Date('2026-01-01Z'),revision:'10'}],mandate_targets:[{targetId,assessment,version:4}],targets:[record],organization:[{metadata:{}}],research_findings:[{finding:current},{finding:foreign}],signals:[signal]};
 const db={select:()=>({from:(table:Parameters<typeof getTableName>[0])=>{const result=rows[getTableName(table)]??[];const query={where:()=>query,limit:()=>query,orderBy:()=>query,then:(resolve:(r:unknown[])=>unknown)=>Promise.resolve(result).then(resolve)};return query;}})};
 return{repo:new AcquisitionRepository('org',db as never),current,foreign};
}
beforeEach(()=>{vi.clearAllMocks();m.observations.mockResolvedValue(new Map());m.ranked.mockResolvedValue([targetRecordToRankedTarget(record,[signal])]);});
it('uses current accepted mandate facts without the old shared Firmable overlay or other-buyer findings',async()=>{m.observations.mockResolvedValue(new Map([[targetId,observation]]));const{repo}=fixture();const[result]=await repo.memberships(mandateId);expect(result.target.headcount.value).toBe(35);expect(result.target.companyName).toBe('Original identity');expect(result.target.signals[0].value).toBe('Canonical signal');expect(result.target.scores.qualification).not.toBe('excluded');expect(result.assessment.qualificationConfirmed).toBe(false);expect(result.researchFindings?.map(f=>f.id)).toEqual(['current']);expect(m.ranked).not.toHaveBeenCalledWith([targetId]);expect(m.observations).toHaveBeenCalledWith(expect.anything(),'org',mandateId,[targetId]);});
it('keeps an explicit current human exclusion even when accepted company facts fit',async()=>{m.observations.mockResolvedValue(new Map([[targetId,observation]]));const{repo}=fixture({...initialAssessment,decisionOrigin:'manual',stage:'excluded',reason:'Human decision'});const[result]=await repo.memberships(mandateId);expect(result.assessment.stage).toBe('excluded');expect(result.target.scores.qualification).toBe('excluded');});
it('retains the exact legacy no-observation overlay/findings path',async()=>{const{repo}=fixture();const[result]=await repo.memberships(mandateId);expect(result.target.headcount.value).toBe(500);expect(result.researchFindings?.map(f=>f.id)).toEqual(['current','other-buyer']);expect(m.ranked).toHaveBeenCalledWith([targetId]);});
