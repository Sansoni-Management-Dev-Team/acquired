import {beforeEach,expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
const m=vi.hoisted(()=>({get:vi.fn(),select:vi.fn(),where:vi.fn(),members:vi.fn()}));
vi.mock('@/db/client',()=>({requireDb:()=>({select:m.select})}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class {memberships=m.members;}}));
// Keep the repository projections real so this test checks their SQL shape.
vi.mock('@/db/research-repository',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/db/research-repository')>();
 return {...actual,ResearchRepository:class {get=m.get;getExecution=m.get;}};
});
import {loadResearchSchedulingSnapshot} from './research-scheduling-snapshot';
beforeEach(()=>{
 vi.resetAllMocks();m.get.mockResolvedValue({id:'root',mandateId:'mandate',status:'crawling'});
 m.select.mockReturnValue({from:()=>({where:m.where})});m.where.mockResolvedValue([]);m.members.mockResolvedValue([]);
});
it('projects job config without span/lease blobs and scopes active jobs to the mandate',async()=>{
 await loadResearchSchedulingSnapshot('org','root');
 const projection=m.select.mock.calls[0][0];
 const dialect=new PgDialect();
 expect(dialect.sqlToQuery(projection.config).sql).toContain("- 'pipelineTiming' - 'scheduling'");
 const condition=dialect.sqlToQuery(m.where.mock.calls[0][0]);
 expect(condition.params).toEqual(['org','root','root','mandate']);
 expect(m.members).toHaveBeenCalledWith('mandate');
});
it('loads only planner evidence fields, scoped to organization and member IDs',async()=>{
 m.members.mockResolvedValue([{target:{id:'target'}}]);
 await loadResearchSchedulingSnapshot('org','root');
 expect(Object.keys(m.select.mock.calls[1][0]).sort()).toEqual(['evidence','jobId','observedAt','sourceUrl','targetId']);
 expect(new PgDialect().sqlToQuery(m.where.mock.calls[1][0]).params).toEqual(['org','target']);
});
it('does not scan run data after root cancellation',async()=>{
 m.get.mockResolvedValue({id:'root',status:'cancelled'});
 expect(await loadResearchSchedulingSnapshot('org','root')).toBeNull();expect(m.select).not.toHaveBeenCalled();
});
