import {expect,it,vi} from 'vitest';
vi.mock('./client',()=>({requireDb:vi.fn()}));
vi.mock('./firmable-history-repository',()=>({FirmableHistoryRepository:class {findCompany=async()=>undefined;}}));
import {OrganizationRepository} from './repositories';
import {researchTargetId} from './research-persistence-id';
import {rankTarget} from '@/domain/scoring';
import {seedTargets,defaultMandate} from '@/test/fixtures/scoring-targets';
it('uses a stable primary key for simultaneous research company inserts and preserves workflow status on conflict',async()=>{
 const saved=new Map<string,unknown>();const conflicts:unknown[]=[];
 const database = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  insert: () => ({ values: (value: {id:string}) => ({
   returning: async () => { const id=value.id || crypto.randomUUID(); saved.set(id,value); return [{id}]; },
   onConflictDoNothing: (options: unknown) => { conflicts.push(options); return { returning: async () => { saved.set(value.id,value); return [{id:value.id}]; } }; },
  }) }),
 };
 const repository=new OrganizationRepository(database as never,'org');vi.spyOn(repository,'appendAudit').mockResolvedValue(undefined as never);
 const target=rankTarget({...seedTargets[0],sourceData:{manufacturingDirectory:{recordId:'site',name:'Company',categories:[],keywords:[],capabilities:[],sourceRecords:[]}}},defaultMandate);
 const input={target,mandateId:'mandate',actorId:'actor',creationId:researchTargetId('org',target.domain)};
 const results=await Promise.all([repository.upsertEnrichedTarget(input),repository.upsertEnrichedTarget(input)]);
 expect(saved.size).toBe(1);expect(results[0]?.id).toBe(input.creationId);expect(results[1]?.id).toBe(input.creationId);
 expect(conflicts).toHaveLength(2);
 expect((conflicts[0] as {target:unknown}).target).toBeDefined();
});
