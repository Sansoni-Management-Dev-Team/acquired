import { describe,it,expect,vi,beforeEach } from 'vitest';
const projectionPublisher=vi.hoisted(()=>vi.fn().mockResolvedValue({published:true}));
vi.mock('./company-membership-projection-store',()=>({publishCompanyMembershipProjection:projectionPublisher}));
beforeEach(()=>{projectionPublisher.mockReset().mockResolvedValue({published:true});});
import { companyIdentityObservationInputSchema } from './company-identity-store';
const id='11111111-1111-4111-8111-111111111111';
const input={requestKey:id,jobId:id,companyName:'Example',domain:'example.test',firmableId:'f1',observedAt:'2026-10-18T00:00:00.000Z',sourceUrl:'https://example.test',sourceFacts:{firmographics:{sector:'Water',revenue:1},identifiers:{},firmableCompanyId:'f1'}};
describe('trusted company observation input',()=>{
 it('accepts company facts but never incoming buyer decisions',()=>{
 expect(companyIdentityObservationInputSchema.safeParse(input).success).toBe(true);
 for(const key of ['screening','scores','band','qualification','status','fitScore','financeability','scoreExplanation'])expect(companyIdentityObservationInputSchema.safeParse({...input,sourceFacts:{...input.sourceFacts,firmographics:{[key]:'excluded'}}}).success).toBe(false);
 });
 it('rejects a different provider identity and caller-supplied actor or mandate',()=>{
 expect(companyIdentityObservationInputSchema.safeParse({...input,sourceFacts:{...input.sourceFacts,firmableCompanyId:'other'}}).success).toBe(false);
 expect(companyIdentityObservationInputSchema.safeParse({...input,mandateId:id}).success).toBe(false);
 });
});

import {PgDialect} from 'drizzle-orm/pg-core';
import {companyIdentityDrizzleClient} from './company-identity-store';
it('binds source text through the existing Drizzle transaction instead of interpolating it',async()=>{
 const captured:{sql:string;params:unknown[]}[]=[];
 const client=companyIdentityDrizzleClient({execute:async query=>{captured.push(new PgDialect().sqlToQuery(query));return {rows:[{id:'saved'}],rowCount:1};}});
 const value="unsafe'); DELETE FROM targets; --";
 const result=await client.query('SELECT id FROM targets WHERE organization_id=$1 AND domain=$2 OR domain=$2',['org',value]);
 expect(result.rows).toEqual([{id:'saved'}]);expect(captured[0].sql).toBe('SELECT id FROM targets WHERE organization_id=$1 AND domain=$2 OR domain=$3');expect(captured[0].params).toEqual(['org',value,value]);expect(captured[0].sql).not.toContain(value);
});

it('rejects missing or invalid numbered SQL parameters before touching the transaction',async()=>{
 let calls=0;const client=companyIdentityDrizzleClient({execute:async()=>{calls++;return {rows:[]};}});
 await expect(client.query('SELECT $2',['only-one'])).rejects.toThrow('parameter');
 await expect(client.query('SELECT $0',['one'])).rejects.toThrow('parameter');
 await expect(client.query('SELECT $1',[undefined])).rejects.toThrow('parameter');
 expect(calls).toBe(0);
});

import type {Pool} from 'pg';
import {CompanyIdentityStore} from './company-identity-store';
it('locks source and parent cancellation fences before candidate target locks during adoption',async()=>{
 const jobId='22222222-2222-4222-8222-222222222222',parentId='33333333-3333-4333-8333-333333333333',observationId='44444444-4444-4444-8444-444444444444';
 const source={companyName:'Example',domain:'example.test',observedAt:'2026-10-18T00:00:00.000Z',sourceUrl:'https://example.test'};
 let write=false,sourceLocked=false,parentLocked=false,decisionSaved=false;
 projectionPublisher.mockImplementation(async()=>{expect(decisionSaved,'accepted decision must be visible before publication').toBe(true);return{published:true};});
 const query=async(text:string)=>{
 if(text.includes('INSERT INTO company_identity_decisions'))decisionSaved=true;
 if(text==='BEGIN')write=true;
 if(text.includes('READ ONLY'))write=false;
 let rows:Record<string,unknown>[]=[];
 if(text.includes('SELECT id FROM member')||text.includes('SELECT id FROM mandates'))rows=[{id}];
 else if(text.includes('SELECT id FROM company_identity_reviews'))rows=[{id}];
 else if(text.includes('JOIN company_identity_observations'))rows=[{id:observationId,job_id:jobId,mandate_id:id,created_by:'user',revision:1,state:'pending',source}];
 else if(text.includes('FROM research_jobs')){
 if(text.includes('SELECT status,organization_id')){sourceLocked=text.includes('FOR SHARE');rows=[{status:'complete',organization_id:'org',mandate_id:id,created_by:'user',config:{parentJobId:parentId}}];}
 else{parentLocked=text.includes('FOR SHARE');rows=[{status:'complete'}];}
 }
 else if(text.includes('FROM targets t WHERE')){
 if(write){expect(sourceLocked,'source must block concurrent cancellation before target locks').toBe(true);expect(parentLocked,'parent must block cancellation before target locks').toBe(true);}
 rows=[{targetId:id,sourceRevision:'1',companyName:'Example',domain:'example.test',savedPeopleCount:0,mandateCount:0},{targetId:jobId,sourceRevision:'1',companyName:'Example',domain:'example.test',savedPeopleCount:0,mandateCount:0}];
 }
 else if(text.includes('SELECT id FROM targets'))rows=[{id}];
 else if(text.includes('INSERT INTO company_identity_claims'))rows=[{target_id:id}];
 return{rows,rowCount:rows.length};
 };
 const store=new CompanyIdentityStore({connect:async()=>({query,release(){}})} as unknown as Pool,{organizationId:'org',userId:'user'});
 const [review]=await store.list(id);
 await expect(store.decide(id,{requestKey:id,reviewId:id,expectedRevision:1,previewDigest:review.previewDigest,decision:'adopt',selectedTargetId:id})).resolves.toEqual({reviewId:id,status:'adopted',targetId:id});
 expect(sourceLocked&&parentLocked).toBe(true);expect(projectionPublisher).toHaveBeenCalledOnce();expect(projectionPublisher.mock.calls[0][2]).toEqual({mandateId:id,targetId:id});
});

it('honours an audited domain claim when a later observation adds FID, and makes older pending choices skip-only',async()=>{
 const jobId='22222222-2222-4222-8222-222222222222',observationId='44444444-4444-4444-8444-444444444444';
 const source={companyName:'Example',domain:'example.test',observedAt:input.observedAt,sourceUrl:input.sourceUrl};
 let established=false;const insertedKeys:string[]=[];
 const query=async(text:string,args:unknown[]=[])=>{
 let rows:Record<string,unknown>[]=[];
 if(text.includes('SELECT id FROM member')||text.includes('SELECT id FROM mandates')||text.includes('SELECT id FROM targets'))rows=[{id}];
 else if(text.includes('SELECT id FROM company_identity_reviews'))rows=[{id}];
 else if(text.includes('JOIN company_identity_observations'))rows=[{id:observationId,job_id:jobId,mandate_id:id,created_by:'user',revision:1,state:'pending',source}];
 else if(text.includes('FROM research_jobs'))rows=[{status:'complete',organization_id:'org',mandate_id:id,created_by:'user',organizationId:'org',mandateId:id,createdBy:'user',config:{}}];
 else if(text.includes('FROM targets t WHERE'))rows=[{targetId:id,sourceRevision:'1',companyName:'Example',domain:'example.test',savedPeopleCount:0,mandateCount:0},{targetId:jobId,sourceRevision:'1',companyName:'Example',domain:'example.test',savedPeopleCount:0,mandateCount:0}];
 else if(text.includes('FROM company_identity_claims'))rows=established?[{identity_key:'domain:example.test',target_id:id}]:[];
 else if(text.includes('INSERT INTO mandate_targets')){expect(args[3]).toEqual(initialAssessment);}
 else if(text.includes('INSERT INTO company_identity_claims')){insertedKeys.push(String(args[1]));rows=[{target_id:id}];}
 return{rows,rowCount:rows.length};
 };
 const store=new CompanyIdentityStore({connect:async()=>({query,release(){}})} as unknown as Pool,{organizationId:'org',userId:'user'});
 expect((await store.list(id))[0].reason).toBe('consistent_existing_duplicates');
 established=true;
 expect((await store.list(id))[0].reason).toBe('source_changed');
 const result=await store.persist({...input,jobId,sourceFacts:{firmographics:{},identifiers:{},firmableCompanyId:'f1'}});
 expect(result).toMatchObject({status:'persisted',targetId:id});
 expect(insertedKeys.sort()).toEqual(['domain:example.test','firmable:f1']);expect(projectionPublisher).toHaveBeenCalledOnce();
});

it('uses the normal supplied database transaction with bounded readonly review queries',async()=>{
 const statements:string[]=[];let transactions=0;
 const database={execute:async()=>({rows:[]}),transaction:async<T>(work:(tx:{execute:(query:import('drizzle-orm').SQL)=>Promise<unknown>})=>Promise<T>)=>{transactions++;return work({execute:async query=>{const text=new PgDialect().sqlToQuery(query).sql;statements.push(text);return{rows:text.includes('SELECT id FROM member')||text.includes('SELECT id FROM mandates')?[{id}]:[],rowCount:1};}});}};
 expect(await CompanyIdentityStore.usingDrizzle(database,{organizationId:'org',userId:'user'}).list(id)).toEqual([]);
 expect(transactions).toBe(1);expect(statements[0]).toBe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 expect(statements).toContain("SET LOCAL lock_timeout='5s'");expect(statements).toContain("SET LOCAL statement_timeout='15s'");
});

import {companyIdentityDigest} from './company-identity-store';
import {initialAssessment} from '../domain/acquisition';
it('replays original persistence and adopted decision receipts without republishing new authority',async()=>{
 const target='22222222-2222-4222-8222-222222222222',command={requestKey:id,reviewId:id,expectedRevision:1,previewDigest:'a'.repeat(64),decision:'adopt',selectedTargetId:target};
 const query=async(text:string)=>{
 let rows:Record<string,unknown>[]=[];
 if(text.includes('FROM member')||text.includes('FROM mandates'))rows=[{id}];
 else if(text.includes('FROM research_jobs'))rows=[{mandate_id:id}];
 else if(text.includes('FROM company_identity_observations'))rows=[{id,organization_id:'org',created_by:'user',job_id:id,mandate_id:id,input_digest:companyIdentityDigest(input)}];
 else if(text.includes('FROM company_identity_resolutions'))rows=[{target_id:target}];
 else if(text.includes('FROM company_identity_decisions'))rows=[{organization_id:'org',mandate_id:id,decided_by:'user',input_digest:companyIdentityDigest(command),receipt:{reviewId:id,status:'adopted',targetId:target}}];
 return {rows,rowCount:rows.length};
 };
 const store=new CompanyIdentityStore({connect:async()=>({query,release(){}})} as unknown as Pool,{organizationId:'org',userId:'user'});
 expect(await store.persist(input)).toMatchObject({status:'persisted',targetId:target});expect(await store.decide(id,command)).toEqual({reviewId:id,status:'adopted',targetId:target});expect(projectionPublisher).not.toHaveBeenCalled();
});
it('binds arrays and JSON as scalar PostgreSQL parameters through the normal Drizzle port',async()=>{
 const captured:{sql:string;params:unknown[]}[]=[];const client=companyIdentityDrizzleClient({execute:async query=>{captured.push(new PgDialect().sqlToQuery(query));return {rows:[]};}});
 const keys=['domain:example.test','firmable:f1'],facts={description:'Company facts'};
 await client.query('SELECT 1 WHERE $1::text[] IS NOT NULL AND $2::jsonb IS NOT NULL',[keys,facts]);
 expect(captured[0].sql).toBe('SELECT 1 WHERE $1::text[] IS NOT NULL AND $2::jsonb IS NOT NULL');expect(captured[0].params).toEqual([keys,facts]);
});
