import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { Client } from 'pg';
import { drizzle,type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and,eq } from 'drizzle-orm';
vi.mock('./client',()=>({requireDb:vi.fn()}));
import { AcquisitionRepository } from './acquisition-repository';
import * as schema from './schema';
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import { assessmentSchema,briefToMandate,criterion,emptyBrief,initialAssessment,worksheet } from '@/domain/acquisition';
import { companyCompleteness } from '@/domain/research-completeness';
import { reviewMandateFit } from '@/domain/mandate-fit';

const brief=emptyBrief();brief.name='Synthetic scoped diligence';brief.naturalLanguage='Synthetic Australian maintenance acquisition';
for(const [key,value] of [['subsectors','Fire protection maintenance'],['geography','VIC'],['headcount','18–90'],['revenue','3500000–12000000'],['ebitda','500000–2100000']] as const)Object.assign(criterion(brief,key),{state:'specified',value});
const filters=briefToMandate(brief);
describe.skipIf(process.env.RUN_FIRMABLE_DB_INTEGRATION!=='true')('Scoped company PostgreSQL persistence proof',()=>{
 let client:Client,database:NodePgDatabase<typeof schema>,repo:AcquisitionRepository,organizationId:string,actorId:string,mandateId:string,targetId:string;
 beforeAll(async()=>{
  const url=process.env.FIRMABLE_INTEGRATION_DATABASE_URL;if(!url || !['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Explicit local PostgreSQL URL required');
  client=new Client({connectionString:url});await client.connect();await client.query('BEGIN');database=drizzle({client,schema});
  organizationId=`scoped-diligence-${crypto.randomUUID()}`;actorId=`scoped-reviewer-${crypto.randomUUID()}`;
  await database.insert(schema.organization).values({id:organizationId,name:'Synthetic diligence proof',slug:organizationId});
  await database.insert(schema.user).values({id:actorId,name:'Synthetic reviewer',email:`${actorId}@example.test`});
  const [mandate]=await database.insert(schema.mandates).values({organizationId,createdBy:actorId,naturalLanguage:brief.naturalLanguage,filters:{...filters,brief},provenance:{source:'Synthetic fixture'}}).returning({id:schema.mandates.id});mandateId=mandate.id;
  const candidate=mapFirmableProfile({id:'synthetic-scope',name:'Synthetic service operator',website:`https://${organizationId}.example.test`,employee_count:150,revenue:'$50M - $100M',industries:['Construction trades and services'],description:'We maintain fire systems.',region:{AU:{employee_count:35,address:{state:'NSW',suburb:'Sydney'},locations:[{name:'Victorian branch, VIC, 3000'}],revenue:{10:'No data available'}}}},filters,organizationId);
  const [target]=await database.insert(schema.targets).values({organizationId,mandateId,companyName:candidate.companyName,domain:candidate.domain,qualification:'excluded',band:'excluded',firmographics:{state:'Unknown',suburb:'Unknown',sector:candidate.sector,revenue:{...candidate.revenue,value:{kind:'band',label:'$50M - $100M'}},headcount:{...candidate.headcount,value:150},ebitda:candidate.ebitda,establishedYear:candidate.establishedYear,firmable:candidate.sourceData?.firmable}}).returning({id:schema.targets.id});targetId=target.id;
  await database.insert(schema.mandateTargets).values({organizationId,mandateId,targetId,assessment:{...initialAssessment,stage:'excluded',reason:'Outside an original mandate range',nextAction:'Verify original mandate criteria'}});
  repo=new AcquisitionRepository(organizationId,database);
 });
 afterAll(async()=>{if(!client)return;await client.query('ROLLBACK');if(organizationId)expect((await client.query('SELECT count(*)::int AS n FROM organization WHERE id=$1',[organizationId])).rows[0].n).toBe(0);await client.end();});
 it('RC-01-integration RC-02-integration RC-03-integration RC-04-integration RC-08-integration: stored profile JSON reload drives scoped eligibility, fit, worksheet and completeness',async()=>{
  const [member]=await repo.memberships(mandateId,[targetId]);expect(member.target.headcount.value).toBe(35);expect(member.target.sourceData?.firmable?.scopedFacts?.headcount.global.value).toBe(150);expect(member.target.state).toBe('NSW');expect(member.target.revenue.value).toBeNull();expect(member.target.scores.qualification).not.toBe('excluded');expect(member.assessment.stage).toBe('identified');
  const fit=reviewMandateFit(brief,member.target,member.assessment);expect(fit.rows.find(r=>r.key==='geography')?.status).toBe('potential');expect(fit.rows.find(r=>r.key==='subsectors')?.status).toBe('potential');expect(fit.rows.find(r=>r.key==='revenue')?.status).toBe('unknown');
  const report=companyCompleteness(member,brief);expect(report.cells.find(c=>c.field==='AU headcount')?.value).toBe(35);expect(report.cells.find(c=>c.field==='Saved EBITDA')?.value).toBeNull();expect(report.cells.find(c=>c.field==='Mandate criterion: ebitda')?.status).toBe('estimated');
  const [raw]=await database.select().from(schema.mandateTargets).where(and(eq(schema.mandateTargets.mandateId,mandateId),eq(schema.mandateTargets.targetId,targetId)));expect((raw.assessment as {stage:string}).stage).toBe('excluded');
 });
 it('RC-05-integration RC-06-integration: real manual save/reload retains provisional distinction, owner evidence and zero finance inputs',async()=>{
  const [before]=await repo.memberships(mandateId,[targetId]);const derived=worksheet(brief,before.target,before.assessment);
  const provisional=assessmentSchema.parse({...before.assessment,decisionOrigin:'manual',evidence:derived});await repo.saveAssessment(mandateId,targetId,provisional,before.version,actorId);
  const [saved]=await repo.memberships(mandateId,[targetId]);expect(saved.assessment.evidence.every(e=>e.reviewState==='provisional')).toBe(true);expect(companyCompleteness(saved,brief).cells.find(c=>c.field==='Mandate criterion: ebitda')?.status).toBe('estimated');
  const answer={...derived.find(e=>e.criterionKey==='management')!,reviewState:'reviewed' as const,kind:'owner-stated' as const,assessment:'supported' as const,value:'Independent operations manager',source:'Synthetic owner interview',sourceUrl:'https://example.test/interview',capturedAt:'2026-01-01T00:00:00Z',confidence:80};
  const financeReview={dscrAtStress:0,customerConcentrationPct:0,recurringRevenuePct:null,addBacksPctOfCashFlow:null,gmInPlace:false,goodwillType:null,source:'Synthetic owner accounts',sourceUrl:'https://example.test/accounts',capturedAt:'2025-01-01T00:00:00Z',confidence:80,structureReviewed:false};
  const manual=assessmentSchema.parse({...saved.assessment,evidence:saved.assessment.evidence.map(e=>e.criterionKey==='management'?answer:e),financeReview});await repo.saveAssessment(mandateId,targetId,manual,saved.version,actorId);
  const [reloaded]=await repo.memberships(mandateId,[targetId]);expect(worksheet(brief,reloaded.target,reloaded.assessment).find(e=>e.criterionKey==='management')).toMatchObject({value:answer.value,reviewState:'reviewed',source:answer.source,capturedAt:answer.capturedAt});expect(reloaded.target.scores.financeability).toBeNull();
  const report=companyCompleteness(reloaded,brief);expect(report.cells.find(c=>c.field==='Mandate criterion: management')).toMatchObject({status:'reviewed',value:answer.value,source:answer.source});expect(report.cells.find(c=>c.field==='Bankability: DSCR at stress')).toMatchObject({value:0,status:'reviewed',source:financeReview.source,observed_at:financeReview.capturedAt});expect(report.cells.find(c=>c.field==='Bankability: Independent GM')).toMatchObject({value:false,status:'reviewed'});expect(report.cells.find(c=>c.field==='Bankability: Recurring revenue %')?.status).toBe('unavailable');
 });
});
