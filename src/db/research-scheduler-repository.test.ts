import {beforeEach,expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {SQL} from 'drizzle-orm';
const m=vi.hoisted(()=>({set:vi.fn(),where:vi.fn(),returning:vi.fn()}));
vi.mock('./client',()=>({requireDb:()=>({update:()=>({set:m.set})})}));
import {requestSchedulingLease,finishSchedulingPass} from './research-scheduler-repository';
beforeEach(()=>{vi.resetAllMocks();m.set.mockReturnValue({where:m.where});m.where.mockReturnValue({returning:m.returning});});
const rendered=(s:SQL)=>new PgDialect().sqlToQuery(s);
it('requests an organization-scoped atomic event generation and only takes an expired lease',async()=>{
 m.returning.mockResolvedValue([{config:{scheduling:{owner:'mine',generation:3}}}]);
 expect(await requestSchedulingLease('org','root','mine')).toEqual({acquired:true,generation:3});
 const mutation=rendered(m.set.mock.calls[0][0].config); const guard=rendered(m.where.mock.calls[0][0]);
 expect(mutation.sql).toContain("'generation'");expect(mutation.sql).toContain(' + 1');expect(mutation.sql).toContain('clock_timestamp()');
 expect(guard.params).toEqual(['org','root']);
 expect(m.set.mock.calls[0][0]).not.toHaveProperty('updatedAt');
 expect(rendered(m.returning.mock.calls[0][0].config).sql).toContain("jsonb_build_object('scheduling'");
});
it('a competing owner records pending work without claiming ownership',async()=>{
 m.returning.mockResolvedValue([{config:{scheduling:{owner:'other',generation:4}}}]);
 expect(await requestSchedulingLease('org','root','mine')).toEqual({acquired:false,generation:4});
});
it('recovery polling skips a held/recent lease and does not increase generations',async()=>{
 m.returning.mockResolvedValue([]);
 expect(await requestSchedulingLease('org','root','mine',true)).toEqual({acquired:false,generation:0});
 expect(rendered(m.set.mock.calls[0][0].config).sql).not.toContain(' + 1');
 expect(rendered(m.where.mock.calls[0][0]).sql).toContain("'lastPassAt'");
});
it('conditional release checks both ownership and expiry atomically',async()=>{
 m.returning.mockResolvedValue([]);
 expect(await finishSchedulingPass('org','root','stale-owner',3)).toEqual({again:false,generation:3});
 const guard=rendered(m.where.mock.calls[0][0]);
 expect(guard.sql).toContain("->>'owner' =");expect(guard.sql).toContain('clock_timestamp()');expect(guard.params).toContain('stale-owner');
});
it('an event arriving during a pass retains the owner and requests another snapshot',async()=>{
 m.returning.mockResolvedValue([{config:{scheduling:{owner:'mine',generation:5}}}]);
 expect(await finishSchedulingPass('org','root','mine',4)).toEqual({again:true,generation:5});
});

// These SELECT-only checks exercise PostgreSQL's parameter typing and JSON
// expressions without creating fixtures, changing rows, or applying migrations.
it.skipIf(process.env.RUN_RESEARCH_SCHEDULER_SQL_TESTS !== 'true')('evaluates lease ownership, expiry, pending generations and release in PostgreSQL', async () => {
 const {Client}=await import('pg');
 const client=new Client({connectionString:'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire'});
 await client.connect();
 const evaluate=async (expression:SQL, scheduling:Record<string,unknown>)=>{
  const query=rendered(expression);const params=[...query.params,JSON.stringify({scheduling})];
  const sql=query.sql.replaceAll('"research_jobs"."config"',`$${params.length}::jsonb`).replaceAll('"research_jobs"."organization_id"', "'org'").replaceAll('"research_jobs"."id"', "'root'");
  const {rows}=await client.query(`SELECT ${sql} AS value`,params);return typeof rows[0].value === 'boolean' ? rows[0].value : rows[0].value.scheduling;
 };
 try {
  m.returning.mockResolvedValue([]);
  await requestSchedulingLease('org','root','mine');
  const request=m.set.mock.calls.at(-1)![0].config;
  const future=Date.now()+300000;
  expect(await evaluate(request,{owner:'other',expiresAt:future,generation:2})).toMatchObject({owner:'other',expiresAt:future,generation:3});
  expect(await evaluate(request,{owner:'crashed',expiresAt:0,generation:2})).toMatchObject({owner:'mine',generation:3});
  await finishSchedulingPass('org','root','mine',3);
  const finish=m.set.mock.calls.at(-1)![0].config;
  const releaseGuard=m.where.mock.calls.at(-1)![0];
  expect(await evaluate(releaseGuard,{owner:'mine',expiresAt:future,generation:4})).toBe(true);
  expect(await evaluate(releaseGuard,{owner:'new-owner',expiresAt:future,generation:4})).toBe(false);
  expect(await evaluate(releaseGuard,{owner:'mine',expiresAt:0,generation:4})).toBe(false);
  expect(await evaluate(finish,{owner:'mine',expiresAt:future,generation:4})).toMatchObject({owner:'mine',generation:4,completedGeneration:3});
  expect(await evaluate(finish,{owner:'mine',expiresAt:future,generation:3})).toMatchObject({owner:null,expiresAt:0,completedGeneration:3});
 } finally {await client.end();}
});
