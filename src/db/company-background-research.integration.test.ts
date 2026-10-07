import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { Client } from 'pg';
import { drizzle,type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
vi.mock('./client',()=>({requireDb:vi.fn()}));
import { parseAccreditationContact } from '@/adapters/accreditation-register';
import { queueCompanyBackgroundResearch,persistCompanyBackgroundResult,type CompanyBackgroundResearchResult } from '@/lib/company-background-research';
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import type { CompanyMissingFieldResearchResult } from '@/adapters/company-missing-field-research';
import * as schema from './schema';
import { targetRecordToRankedTarget } from './target-record-mapper';
import { researchContactId } from './research-persistence-id';
const filters={sectors:['Industrial cleaning'],states:['VIC'],revenue:{min:0,max:null},ebitda:{min:0,max:null}};
const result:CompanyMissingFieldResearchResult={facts:[{field:'company_emails',value:'office@operator.example.com',sourceUrl:'https://operator.example.com/contact',quote:'Corporate email office@operator.example.com',capturedAt:'2026-10-08T00:00:00Z',scope:'company',evidenceType:'published',reader:'fixture'}],fields:{company_emails:{status:'reported'},company_phones:{status:'not_disclosed'},revenue:{status:'research_incomplete',reason:'Public accounts timed out'}},attempts:[{kind:'page',url:'https://operator.example.com/contact',status:'succeeded',startedAt:'2026-10-08T00:00:00Z',elapsedMs:2}],registryContacts:[]};
describe.skipIf(process.env.RUN_FIRMABLE_DB_INTEGRATION!=='true')('Independent company missing-field persistence',()=>{
 let client:Client,database:NodePgDatabase<typeof schema>,organizationId:string,actorId:string,mandateId:string,root:typeof schema.researchJobs.$inferSelect;
 beforeAll(async()=>{
  const url=process.env.FIRMABLE_INTEGRATION_DATABASE_URL;if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Explicit local PostgreSQL URL required');
  client=new Client({connectionString:url});await client.connect();await client.query('BEGIN');database=drizzle({client,schema});
  organizationId=`company-background-${crypto.randomUUID()}`;actorId=`background-reviewer-${crypto.randomUUID()}`;
  await database.insert(schema.organization).values({id:organizationId,name:'Synthetic independent jobs',slug:organizationId});await database.insert(schema.user).values({id:actorId,name:'Synthetic reviewer',email:`${actorId}@example.test`});
  const [mandate]=await database.insert(schema.mandates).values({organizationId,createdBy:actorId,naturalLanguage:'Synthetic company public field test',filters,provenance:{source:'Synthetic fixture'}}).returning();mandateId=mandate.id;
  [root]=await database.insert(schema.researchJobs).values({id:crypto.randomUUID(),organizationId,mandateId,createdBy:actorId,status:'complete',config:{workflow:'business',mode:'automatic',geography:'VIC',searchTerms:['Industrial cleaning'],researchScope:'services',seeds:[],budget:{maxPages:1,maxDomains:1,maxModelCalls:0,maxMinutes:1},automaticDeadline:Date.now()-1000},message:'Profile discovery already settled'}).returning();
 });
 afterAll(async()=>{if(!client)return;try{await client.query('ROLLBACK');expect((await client.query('SELECT count(*)::int AS n FROM organization WHERE id=$1',[organizationId])).rows[0].n).toBe(0);}finally{await client.end();}});
 async function createTarget(suffix:string){const raw={id:`provider-${suffix}`,name:`Synthetic Company ${suffix}`,website:'https://operator.example.com',employee_count:100,revenue:'$50M - $100M',region:{AU:{employee_count:25,address:{state:'VIC',suburb:'Melbourne'},revenue:{10:'No data available'}}}};const candidate=mapFirmableProfile(raw,filters,organizationId);const [saved]=await database.insert(schema.targets).values({organizationId,mandateId,companyName:candidate.companyName,domain:candidate.domain,firmographics:{state:candidate.state,suburb:candidate.suburb,headcount:candidate.headcount,revenue:candidate.revenue,firmable:candidate.sourceData?.firmable},identifiers:{abn:'24160241789',identityEvidence:{source:'Manual registry review',sourceUrl:'https://abr.business.gov.au'}}}).returning();return{candidate:{...candidate,id:saved.id},raw,saved};}
 it('finished discovery queues fresh independent job idempotently; partial public field result retains paid provider data and company/person separation',async()=>{
  const {candidate,raw}=await createTarget('a');const queued=await queueCompanyBackgroundResearch(root,candidate,database);expect(queued.created).toBe(true);expect(queued.jobId).toBeTruthy();expect(await queueCompanyBackgroundResearch(root,candidate,database)).toMatchObject({created:false,jobId:queued.jobId});
  const [job]=await database.select().from(schema.researchJobs).where(eq(schema.researchJobs.id,queued.jobId!));expect(job.status).toBe('queued');expect((job.config as {automaticDeadline:number}).automaticDeadline).toBeGreaterThan(Date.now());expect((job.config as {companyBackgroundResearch:{verifyAbn:boolean}}).companyBackgroundResearch.verifyAbn).toBe(true);
  const settled=await persistCompanyBackgroundResult({organizationId,jobId:job.id,result},database);expect(settled).toMatchObject({accepted:true,status:'partial',written:1,registryContacts:0});
  const [target]=await database.select().from(schema.targets).where(eq(schema.targets.id,candidate.id));expect((target.firmographics as {firmable:{rawResponse:unknown}}).firmable.rawResponse).toEqual(raw);expect(target.identifiers).toMatchObject({abn:'24160241789',identityEvidence:{source:'Manual registry review'}});
  expect(target.firmographics).toMatchObject({backgroundResearch:{fields:{company_emails:{status:'reported',observations:[{value:'office@operator.example.com',scope:'company'}]},company_phones:{status:'unavailable'},revenue:{status:'failed'}}}});
  expect(targetRecordToRankedTarget(target,[]).sourceData?.firmable?.companyEmails).toEqual(['office@operator.example.com']);
  expect(await database.select().from(schema.contacts).where(eq(schema.contacts.targetId,candidate.id))).toHaveLength(0);expect(await database.select().from(schema.researchFindings).where(eq(schema.researchFindings.jobId,job.id))).toHaveLength(1);
  expect(await persistCompanyBackgroundResult({organizationId,jobId:job.id,result},database)).toMatchObject({accepted:false,status:'partial',written:0});
  const [parent]=await database.select().from(schema.researchJobs).where(eq(schema.researchJobs.id,root.id));expect(parent.status).toBe('complete');
 });
 it('public register contacts keep their published role while background ABN cannot replace an existing reviewed identity',async()=>{
  const {candidate}=await createTarget('registry');const queued=await queueCompanyBackgroundResearch(root,candidate,database);
  const contact=parseAccreditationContact('<p>Accreditation No. 12345 Site No. 67890</p><a href="https://operator.example.com/">Website</a><p>Contact Ms Avery Morgan P: +61 0400 000 999</p>','https://nata.com.au/accredited-organisation/synthetic-12345-67890/','operator.example.com')!;expect(contact).toBeTruthy();
  const abnLookup={status:'matched',abn:'56663118241',record:{entityName:'Other Synthetic Company',quote:'Active synthetic registry record'},operationalStatus:'complete',missingReason:'',errors:[]} as unknown as CompanyBackgroundResearchResult['abnLookup'];
  expect(await persistCompanyBackgroundResult({organizationId,jobId:queued.jobId!,result:{...result,facts:[...result.facts,{field:'accreditation_contacts',value:contact,sourceUrl:contact.sourceUrl,quote:'Published NATA accreditation contact',capturedAt:contact.capturedAt,evidenceType:'published',reader:'fixture'}],fields:{...result.fields,accreditation_contacts:{status:'reported'}},registryContacts:[contact],abnLookup}},database)).toMatchObject({accepted:true,registryContacts:1});
  const [target]=await database.select().from(schema.targets).where(eq(schema.targets.id,candidate.id));expect(target.identifiers).toMatchObject({abn:'24160241789',identityEvidence:{source:'Manual registry review'}});
  const [saved]=await database.select().from(schema.contacts).where(eq(schema.contacts.targetId,candidate.id));expect(saved).toMatchObject({displayName:'Avery Morgan',role:'Accreditation contact',firmablePersonId:null});expect(saved.provenance).toMatchObject({sourceUrl:contact.sourceUrl,roleStatus:'published-register-contact'});
  expect((await database.select().from(schema.researchFindings).where(eq(schema.researchFindings.jobId,queued.jobId!))).some(f=>f.evidenceKey==='company-background:verified-abn')).toBe(false);
 });
 it('published staff and accreditations persist with source evidence, no inferred role, and existing preferences retained',async()=>{
  const {candidate}=await createTarget('staff');const queued=await queueCompanyBackgroundResearch(root,candidate,database);
  const member={name:'Casey Sample',role:null,sourceUrl:'https://operator.example.com/team',quote:'Our team: Casey Sample',capturedAt:'2026-10-08T00:00:00Z',reader:'fixture',employmentStatus:'published_team_member' as const};
  const existing={...member,name:'Taylor Existing',role:'Published laboratory technician'};
  const contactId=researchContactId(organizationId,candidate.id,`published-team:${existing.name}`);
  await database.insert(schema.contacts).values({id:contactId,organizationId,targetId:candidate.id,displayName:existing.name,role:'Reviewed role',personalData:{doNotContact:true,email:'reviewed@example.test'},provenance:{source:'Manual review'}});
  const accreditation={registry:'NATA' as const,accreditationNumber:'12345',siteNumber:'67890',standard:'ISO/IEC 17025',sourceUrl:'https://nata.com.au/accredited-organisation/synthetic-12345-67890/',quote:'Accreditation No. 12345 Site No. 67890 ISO/IEC 17025',capturedAt:member.capturedAt};
  const teamFacts=[member,existing].map(value=>({...result.facts[0],field:'team_members' as const,value,sourceUrl:value.sourceUrl,quote:value.quote}));
  const accreditationFact={...result.facts[0],field:'accreditations' as const,value:accreditation,sourceUrl:accreditation.sourceUrl,quote:accreditation.quote};
  expect(await persistCompanyBackgroundResult({organizationId,jobId:queued.jobId!,result:{...result,facts:[...teamFacts,accreditationFact],fields:{team_members:{status:'reported'},accreditations:{status:'reported'}},teamMembers:[member,existing],accreditations:[accreditation]}},database)).toMatchObject({accepted:true,written:3});
  const savedContacts=await database.select().from(schema.contacts).where(eq(schema.contacts.targetId,candidate.id));expect(savedContacts).toHaveLength(2);expect(savedContacts.find(c=>c.id===contactId)).toMatchObject({role:'Reviewed role',personalData:{doNotContact:true,email:'reviewed@example.test'}});expect(savedContacts.find(c=>c.displayName===member.name)).toMatchObject({role:null,firmablePersonId:null,provenance:{employmentStatus:'published_team_member',sourceUrl:member.sourceUrl}});
  const [target]=await database.select().from(schema.targets).where(eq(schema.targets.id,candidate.id));const projected=targetRecordToRankedTarget(target,[]);expect(projected.sourceData?.publishedTeamMembers).toEqual([member,existing]);expect(projected.accreditations).toMatchObject([{issuer:'NATA',identifier:'12345',status:'unverified',sourceUrl:accreditation.sourceUrl}]);expect((target.firmographics as {firmable:{rawResponse:unknown}}).firmable.rawResponse).toEqual(candidate.sourceData?.firmable?.rawResponse);
 });
 it('accepted provider ABN paths suppress redundant public identity verification',async()=>{
  const {candidate}=await createTarget('provider-abn');
  candidate.sourceData!.firmable!.rawResponse={...candidate.sourceData!.firmable!.rawResponse,industry_codes:{abn:'24160241789'}};
  const queued=await queueCompanyBackgroundResearch(root,candidate,database);
  const [job]=await database.select().from(schema.researchJobs).where(eq(schema.researchJobs.id,queued.jobId!));
  expect((job.config as {companyBackgroundResearch:{verifyAbn:boolean}}).companyBackgroundResearch.verifyAbn).toBe(false);
 });
 it('registry operational errors remain partial even when a public company field was successfully read',async()=>{
  const {candidate}=await createTarget('abn-partial');const queued=await queueCompanyBackgroundResearch(root,candidate,database);
  const abnLookup={status:'not_found',operationalStatus:'partial',missingReason:'Registry reader timed out',errors:['Registry reader timed out']} as unknown as CompanyBackgroundResearchResult['abnLookup'];
  const fields=Object.fromEntries(queued.fields.map(field=>[field,{status:field==='company_emails'?'reported':'not_disclosed'}])) as CompanyMissingFieldResearchResult['fields'];
  expect(await persistCompanyBackgroundResult({organizationId,jobId:queued.jobId!,result:{...result,fields,abnLookup}},database)).toMatchObject({accepted:true,status:'partial',written:1});
 });
 it('root cancellation rejects late data and organization mismatch cannot acquire another company job',async()=>{
  const {candidate}=await createTarget('cancel');const queued=await queueCompanyBackgroundResearch(root,candidate,database);await database.update(schema.researchJobs).set({status:'cancelled'}).where(eq(schema.researchJobs.id,root.id));
  expect(await persistCompanyBackgroundResult({organizationId:'other-org',jobId:queued.jobId!,result},database)).toMatchObject({accepted:false,status:'missing'});
  expect(await persistCompanyBackgroundResult({organizationId,jobId:queued.jobId!,result},database)).toMatchObject({accepted:false,status:'cancelled',written:0});expect(await database.select().from(schema.researchFindings).where(eq(schema.researchFindings.jobId,queued.jobId!))).toHaveLength(0);
  expect(await queueCompanyBackgroundResearch(root,candidate,database)).toMatchObject({jobId:null,created:false});await database.update(schema.researchJobs).set({status:'complete'}).where(eq(schema.researchJobs.id,root.id));
 });
});
