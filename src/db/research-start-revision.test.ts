import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
vi.mock('./client',()=>({requireDb:vi.fn()}));
import { ResearchRepository } from './research-repository';
import type { ResearchConfig } from '@/domain/research';
const id='00000000-0000-4000-8000-000000000001',mandateId='00000000-0000-4000-8000-000000000002';
const config={approved:true,workflow:'business',discover:true,searchTerms:['Refrigeration'],geography:'Australia',seeds:['https://company.example.com/'],budget:{maxPages:5,maxModelCalls:5,maxDomains:5,maxMinutes:10}} as ResearchConfig;
beforeEach(()=>vi.clearAllMocks());
function fixture(matches:boolean,existing=true,controlMatches=true){
 const inserted=vi.fn(async()=>{}),values=vi.fn(()=>({onConflictDoNothing:inserted})),execute=vi.fn(async(query:SQL)=>{void query;return {rows:[{revision_matches:matches,responsibility_matches:controlMatches}]};});
 const db={execute,insert:vi.fn(()=>({values}))};const repo=new ResearchRepository('org-owned',db as never);
 const get=vi.spyOn(repo,'get').mockResolvedValue((existing?{id,mandateId,createdBy:'actor-owned',status:'queued',config}:undefined) as never);
 return {repo,db,execute,values,inserted,get};
}
it('rejects an edited submitted brief at the same atomic boundary as job insertion',async()=>{
 const f=fixture(false,false);
 await expect(f.repo.create(id,mandateId,'actor-owned',config,{expectedMandateRevision:'17'})).rejects.toThrow('The mandate changed before research started');
 expect(f.db.insert).not.toHaveBeenCalled();
});
it('locks the owned mandate and inserts only its expected revision in one parameterized statement',async()=>{
 const f=fixture(true);
 expect((await f.repo.create(id,mandateId,'actor-owned',config,{expectedMandateRevision:'17'})).id).toBe(id);
 expect(f.execute).toHaveBeenCalledOnce();expect(f.db.insert).not.toHaveBeenCalled();
 const query=new PgDialect().sqlToQuery(f.execute.mock.calls[0][0]);
 expect(query.sql).toContain('FOR SHARE');expect(query.sql).toContain('xmin::text');expect(query.sql).toContain('INSERT INTO');expect(query.sql).toContain('ON CONFLICT DO NOTHING');
 expect(query.sql).toContain('WHERE revision =');expect(query.params).toContain('17');expect(query.params).toContain(mandateId);expect(query.params).toContain('org-owned');expect(query.params).toContain('actor-owned');
 expect(query.sql).not.toContain('org-owned');expect(query.sql).not.toContain(mandateId);
});
it('preserves an already saved same-ID job rather than replacing its config after a changed brief',async()=>{
 const f=fixture(false);const prior=await f.repo.get(id);
 expect(await f.repo.create(id,mandateId,'actor-owned',config,{expectedMandateRevision:'17'})).toBe(prior);
 expect(f.values).not.toHaveBeenCalled();
});
it('leaves the original no-options insert and idempotency path unchanged',async()=>{
 const f=fixture(true);
 expect((await f.repo.create(id,mandateId,'actor-owned',config)).id).toBe(id);
 expect(f.execute).not.toHaveBeenCalled();expect(f.inserted).toHaveBeenCalledOnce();
 expect(f.values).toHaveBeenCalledWith(expect.objectContaining({id,mandateId,organizationId:'org-owned',createdBy:'actor-owned',seeds:['https://company.example.com/']}));
});

const responsibility={id:'00000000-0000-4000-8000-000000000003',threadId:'00000000-0000-4000-8000-000000000004',revision:7};
it('prevents a pause or responsibility revision change before insertion from creating a new root',async()=>{
 const f=fixture(true,false,false);
 await expect(f.repo.create(id,mandateId,'actor-owned',config,{expectedMandateRevision:'17',initialResponsibility:responsibility})).rejects.toThrow('Agent supervision changed before research started');
 expect(f.db.insert).not.toHaveBeenCalled();
});
it('binds and locks the exact responsibility, thread, owner, mandate and current revision at admission',async()=>{
 const f=fixture(true);
 await f.repo.create(id,mandateId,'actor-owned',config,{expectedMandateRevision:'17',initialResponsibility:responsibility});
 const query=new PgDialect().sqlToQuery(f.execute.mock.calls[0][0]);
 expect(query.sql).toContain('FOR SHARE OF r, t');expect(query.sql).toContain("r.state IN ('ready', 'waiting')");
 expect(query.sql).toContain('r.owner_user_id =');expect(query.sql).toContain('r.mandate_revision = owned.revision');expect(query.sql).toContain('t.owner_user_id = r.owner_user_id');
 expect(query.sql).toContain('AND EXISTS (SELECT 1 FROM owned_responsibility)');
 expect(query.params).toContain(responsibility.id);expect(query.params).toContain(responsibility.threadId);expect(query.params).toContain(responsibility.revision);
});
it('never returns another creator’s same-ID job from the submission-fenced path',async()=>{
 const f=fixture(true);f.get.mockResolvedValue({id,mandateId,createdBy:'foreign-actor',status:'queued',config} as never);
 await expect(f.repo.create(id,mandateId,'actor-owned',config,{expectedMandateRevision:'17'})).rejects.toThrow();
});
