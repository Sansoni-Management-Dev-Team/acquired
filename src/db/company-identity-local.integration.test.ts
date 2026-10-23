import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {CompanyIdentityStore,persistResearchedCompany,getRecordedCompanyPersistence,type CompanyIdentityObservationInput} from './company-identity-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:1});
let c:PoolClient,org:string,user:string,mandate:string,job:string,store:CompanyIdentityStore;
const observation=():CompanyIdentityObservationInput=>({requestKey:randomUUID(),jobId:job,companyName:'Synthetic Company',domain:'canonical-company.invalid',observedAt:'2026-10-18T00:00:00.000Z',sourceUrl:'https://canonical-company.invalid',sourceFacts:{firmographics:{description:'New provider company fact'},identifiers:{}}});
async function target(domain='canonical-company.invalid',fid?:string){const id=randomUUID();await c.query("INSERT INTO targets(id,organization_id,company_name,domain,identifiers,firmographics,status,qualification,fit_score) VALUES($1,$2,'Existing Company',$3,$4,'{\"description\":\"Prior fact\"}','enriched','excluded',7)",[id,org,domain,fid?{firmableId:fid}:{}]);return id;}
describe.runIf(enabled)('AG26 canonical company persistence and explicit identity adoption; rollback-only/no providers',()=>{
 beforeAll(async()=>{const identity=(await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0];expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});expect((await pool.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id).toBe('7697400069962248225');});
 beforeEach(async()=>{c=await pool.connect();await c.query('BEGIN');org=randomUUID();user=randomUUID();mandate=randomUUID();job=randomUUID();
 await c.query('INSERT INTO public."user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query("INSERT INTO mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES($1,$2,$3,'Synthetic canonical identity fixture','{}','{}')",[mandate,org,user]);await c.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,'complete','{}')",[job,org,mandate,user]);
 const nestedPool={connect:async()=>({query:async(text:string,args?:unknown[])=>{if(text==='BEGIN'||text==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')return c.query('SAVEPOINT identity_command');if(text==='COMMIT')return c.query('RELEASE SAVEPOINT identity_command');if(text==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT identity_command');return c.query('RELEASE SAVEPOINT identity_command');}return c.query(text,args);},release(){}}as unknown as PoolClient)}as unknown as Pool;
 store=new CompanyIdentityStore(nestedPool,{organizationId:org,userId:user});
 });
 afterEach(async()=>{await c.query('ROLLBACK');c.release();});afterAll(async()=>{await pool.end();});
 async function legacyDuplicateReview(fid='f1'){
 const reviewId=randomUUID(),observationId=randomUUID(),input=observation(),source={companyName:input.companyName,domain:input.domain,firmableId:fid,observedAt:input.observedAt,sourceUrl:input.sourceUrl};
 await c.query('INSERT INTO company_identity_observations(id,request_key,organization_id,mandate_id,job_id,created_by,source,source_facts,input_digest,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[observationId,input.requestKey,org,mandate,job,user,source,input.sourceFacts,'a'.repeat(64),input.observedAt]);
 await c.query('INSERT INTO company_identity_reviews(id,observation_id,organization_id,mandate_id) VALUES($1,$2,$3,$4)',[reviewId,observationId,org,mandate]);
 await c.query('INSERT INTO company_identity_resolutions(observation_id,organization_id,review_id) VALUES($1,$2,$3)',[observationId,org,reviewId]);return{reviewId,observationId};
 }
 it('automatically resolves old exact-FID duplicates once without moving historical contacts or changing original evidence',async()=>{
 const a=await target('canonical-company.invalid','f1'),b=await target('canonical-company.invalid','f1'),contact=randomUUID();
 await c.query("INSERT INTO contacts(id,organization_id,target_id,display_name,provenance)VALUES($1,$2,$3,'Original Person','{}')",[contact,org,b]);
 const old=await legacyDuplicateReview(),before=(await c.query('SELECT * FROM company_identity_observations WHERE id=$1',[old.observationId])).rows[0];
 expect(await store.reconcileDuplicates(mandate)).toEqual({resolved:1});expect(await store.reconcileDuplicates(mandate)).toEqual({resolved:0});
 expect(await store.list(mandate)).toEqual([]);
 const canonical=[a,b].sort()[0];expect((await c.query('SELECT target_id FROM mandate_targets WHERE mandate_id=$1',[mandate])).rows).toEqual([{target_id:canonical}]);
 expect((await c.query('SELECT * FROM company_identity_observations WHERE id=$1',[old.observationId])).rows[0]).toEqual(before);
 expect((await c.query('SELECT target_id FROM contacts WHERE id=$1',[contact])).rows[0].target_id).toBe(b);
 expect((await c.query('SELECT count(*)::int n FROM targets WHERE organization_id=$1',[org])).rows[0].n).toBe(2);
 const decision=(await c.query('SELECT preview,receipt FROM company_identity_decisions WHERE review_id=$1',[old.reviewId])).rows[0];expect(decision.preview.automaticResolution).toBe('exact_firmable_id_v1');expect(decision.receipt).toMatchObject({status:'adopted',targetId:canonical});
 });
 it.each(['domain','abn','cancelled'] as const)('does not automatically resolve %s conflicts or cancelled research',async conflict=>{
 await target('canonical-company.invalid','f1');const b=await target(conflict==='domain'?'other-company.invalid':'canonical-company.invalid','f1');
 if(conflict==='abn')await c.query('UPDATE targets SET identifiers=identifiers||$2::jsonb WHERE id=$1',[b,JSON.stringify({abn:'99999999999'})]);
 if(conflict==='abn'){const a=await target('canonical-company.invalid','f1');await c.query('UPDATE targets SET identifiers=identifiers||$2::jsonb WHERE id=$1',[a,JSON.stringify({abn:'12345678901'})]);}
 await legacyDuplicateReview();if(conflict==='cancelled')await c.query("UPDATE research_jobs SET status='cancelled' WHERE id=$1",[job]);
 expect(await store.reconcileDuplicates(mandate)).toEqual({resolved:0});expect((await store.list(mandate)).length).toBe(1);
 expect((await c.query('SELECT count(*)::int n FROM company_identity_decisions WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
 });
 it('reuses the unique org company and original people without overwriting buyer decisions or prior facts',async()=>{
 const id=await target(),contact=randomUUID();await c.query("INSERT INTO contacts(id,organization_id,target_id,display_name,provenance) VALUES($1,$2,$3,'Saved Person','{}')",[contact,org,id]);
 const before=(await c.query('SELECT xmin::text revision,* FROM targets WHERE id=$1',[id])).rows[0];const input=observation();
 expect(await store.persist(input)).toMatchObject({status:'persisted',targetId:id});expect(await store.persist(input)).toMatchObject({status:'persisted',targetId:id});
 expect((await c.query('SELECT xmin::text revision,* FROM targets WHERE id=$1',[id])).rows[0]).toEqual(before);
 expect((await c.query('SELECT id,target_id FROM contacts WHERE id=$1',[contact])).rows[0]).toEqual({id:contact,target_id:id});
 expect((await c.query('SELECT count(*)::int n FROM mandate_targets WHERE mandate_id=$1 AND target_id=$2',[mandate,id])).rows[0].n).toBe(1);
 expect((await c.query('SELECT count(*)::int n FROM company_identity_observations WHERE organization_id=$1',[org])).rows[0].n).toBe(1);
 });
 it('requires an explicit reviewed duplicate choice, preserves all target/contact histories and replays only the exact decision',async()=>{
 const a=await target(),b=await target(),input=observation(),result=await store.persist(input);expect(result.status).toBe('review_required');
 const [review]=await store.list(mandate);expect(review.reason).toBe('consistent_existing_duplicates');expect(review.candidates.map(x=>x.targetId).sort()).toEqual([a,b].sort());
 const command={requestKey:randomUUID(),reviewId:review.reviewId,expectedRevision:review.revision,previewDigest:review.previewDigest,decision:'adopt',selectedTargetId:b};
 expect(await store.decide(mandate,command)).toEqual({reviewId:review.reviewId,status:'adopted',targetId:b});expect(await store.decide(mandate,command)).toEqual({reviewId:review.reviewId,status:'adopted',targetId:b});
 await expect(store.decide(mandate,{...command,selectedTargetId:a})).rejects.toThrow('conflicts');
 expect((await c.query('SELECT target_id FROM mandate_targets WHERE mandate_id=$1',[mandate])).rows).toEqual([{target_id:b}]);expect((await c.query('SELECT count(*)::int n FROM targets WHERE organization_id=$1',[org])).rows[0].n).toBe(2);
 expect(await getRecordedCompanyPersistence(c,{organizationId:org,userId:user},{jobId:job,requestKey:input.requestKey})).toMatchObject({status:'persisted',targetId:b});
 expect(await store.persist(input)).toMatchObject({status:'persisted',targetId:b});
 expect(await store.persist({...input,requestKey:randomUUID()})).toMatchObject({status:'persisted',targetId:b});
 });
 it('rejects stale candidate CAS and conflicting identities; skip writes no membership or claim',async()=>{
 await target();await target();await store.persist(observation());
 const [review]=await store.list(mandate);expect(review.reason).toBe('consistent_existing_duplicates');
 // A new source has a provider identity; existing contradictory FIDs cannot be adopted.
 await target('canonical-company.invalid','f2');const conflictingInput={...observation(),firmableId:'f1'};await store.persist(conflictingInput);const conflicting=(await store.list(mandate)).find(r=>r.reason==='conflicting_identifiers')!;expect(conflicting).toBeDefined();
 const command={requestKey:randomUUID(),reviewId:conflicting.reviewId,expectedRevision:conflicting.revision,previewDigest:conflicting.previewDigest,decision:'adopt',selectedTargetId:conflicting.candidates[0].targetId};await expect(store.decide(mandate,command)).rejects.toThrow('cannot be adopted');
 await c.query("UPDATE targets SET company_name='Changed after preview' WHERE id=$1",[review.candidates[0].targetId]);await expect(store.decide(mandate,{...command,reviewId:review.reviewId,previewDigest:review.previewDigest})).rejects.toThrow('changed');
 const fresh=(await store.list(mandate)).find(r=>r.reviewId===conflicting.reviewId)!;await store.decide(mandate,{requestKey:randomUUID(),reviewId:fresh.reviewId,expectedRevision:fresh.revision,previewDigest:fresh.previewDigest,decision:'skip'});
 expect(await store.persist(conflictingInput)).toMatchObject({status:'skipped',reviewId:fresh.reviewId});
 expect((await c.query('SELECT count(*)::int n FROM mandate_targets WHERE mandate_id=$1',[mandate])).rows[0].n).toBe(0);expect((await c.query('SELECT count(*)::int n FROM company_identity_claims WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
 });
 it('denies cancelled parent, foreign actor and changed request source before canonical attachment',async()=>{
 const input=observation();await target();expect(await getRecordedCompanyPersistence(c,{organizationId:org,userId:user},{jobId:job,requestKey:input.requestKey})).toBeNull();await store.persist(input);await expect(store.persist({...input,companyName:'Changed source'})).rejects.toThrow('conflicts');
 const parent=randomUUID();await c.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,'cancelled','{}')",[parent,org,mandate,user]);await c.query('UPDATE research_jobs SET config=$2 WHERE id=$1',[job,{parentJobId:parent}]);await expect(store.persist(observation())).rejects.toThrow('no longer eligible');
 await c.query('SAVEPOINT wrong_actor');await expect(persistResearchedCompany(c,{organizationId:org,userId:randomUUID()},observation())).rejects.toThrow('membership');await c.query('ROLLBACK TO SAVEPOINT wrong_actor');
 });
 it('creates one future canonical claim with no buyer decisions and exposes only accepted company observations',async()=>{
 const input=observation(),result=await store.persist(input);expect(result.status).toBe('persisted');if(result.status!=='persisted')throw Error('Expected a persisted source');
 const saved=(await c.query('SELECT fit_score,qualification,band,firmographics FROM targets WHERE id=$1',[result.targetId])).rows[0];expect(saved).toEqual({fit_score:null,qualification:null,band:null,firmographics:input.sourceFacts.firmographics});
 const next=await store.persist({...input,requestKey:randomUUID(),sourceFacts:{...input.sourceFacts,firmographics:{description:'Fresh fact'}}});expect(next).toMatchObject({status:'persisted',targetId:result.targetId});
 expect((await c.query('SELECT count(*)::int n FROM targets WHERE organization_id=$1',[org])).rows[0].n).toBe(1);
 expect((await c.query('SELECT count(*)::int n FROM company_identity_accepted_observations WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3',[org,mandate,result.targetId])).rows[0].n).toBe(2);
 expect((await c.query('SELECT firmographics FROM targets WHERE id=$1',[result.targetId])).rows[0].firmographics).toEqual(input.sourceFacts.firmographics);
 });
 it('does not infer identity from another organisation or permit a foreign review',async()=>{
 const other=randomUUID();await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[other]);await c.query("INSERT INTO targets(id,organization_id,company_name,domain,firmographics) VALUES($1,$2,'Other company','canonical-company.invalid','{}')",[randomUUID(),other]);
 expect(await store.persist(observation())).toMatchObject({status:'persisted'});
 await expect(store.list(randomUUID())).rejects.toThrow('Mandate unavailable');
 await expect(store.decide(mandate,{requestKey:randomUUID(),reviewId:randomUUID(),expectedRevision:1,previewDigest:'a'.repeat(64),decision:'skip'})).rejects.toThrow('review unavailable');
 });
 it('retains current native authority and denies source persistence after its responsibility CAS changes',async()=>{
 await c.query('UPDATE research_jobs SET config=$2 WHERE id=$1',[job,{nativeAgent:{responsibilityId:randomUUID(),threadId:randomUUID(),responsibilityRevision:1,mandateRevision:'123'}}]);
 await expect(store.persist(observation())).rejects.toThrow('Native research context changed');
 expect((await c.query('SELECT count(*)::int n FROM company_identity_observations WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
 });

 it('preserves a domain adoption when stronger FID evidence arrives and denies stale pending choices',async()=>{
 const a=await target(),b=await target(),first=observation(),pending=observation();await store.persist(first);await store.persist(pending);
 const previews=await store.list(mandate),chosen=previews.find(r=>r.source.observationId!==undefined&&r.reviewId!==undefined)!;
 const original=previews[0],other=previews[1];
 await store.decide(mandate,{requestKey:randomUUID(),reviewId:original.reviewId,expectedRevision:original.revision,previewDigest:original.previewDigest,decision:'adopt',selectedTargetId:a});
 const current=(await store.list(mandate)).find(r=>r.reviewId===other.reviewId)!;expect(current.reason).toBe('source_changed');
 await expect(store.decide(mandate,{requestKey:randomUUID(),reviewId:other.reviewId,expectedRevision:other.revision,previewDigest:other.previewDigest,decision:'adopt',selectedTargetId:b})).rejects.toThrow('changed');
 expect(await store.persist({...observation(),firmableId:'f123'})).toMatchObject({status:'persisted',targetId:a});
 expect((await c.query('SELECT identity_key,target_id FROM company_identity_claims WHERE organization_id=$1 ORDER BY identity_key',[org])).rows).toEqual([{identity_key:'domain:canonical-company.invalid',target_id:a},{identity_key:'firmable:f123',target_id:a}]);
 expect((await store.persist({...observation(),firmableId:'f124'})).status).toBe('review_required');
 expect(chosen.candidates).toHaveLength(2);
 });

});
