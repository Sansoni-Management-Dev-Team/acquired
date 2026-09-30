import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from "vitest";
vi.mock("./client", () => ({ requireDb: vi.fn() }));
import { saveResearchContact } from "./research-contacts";

function fixture(existing: unknown[] = []) {
  const insert = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  const where = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockReturnValue({ where });
  const database = {
    select: () => ({ from: () => ({ where: async () => existing }) }),
    insert: () => ({ values: insert }),
    update: () => ({ set: update }),
  };
  const args = {
    database: database as unknown as Parameters<typeof saveResearchContact>[0]["database"],
    organizationId: "org", targetId: "target", sourceUrl: "https://company.example/team",
    observedAt: new Date("2026-09-30T00:00:00Z"),
    evidence: { kind: "person" as const, name: "Alex Owner", value: "Director", quote: "Alex Owner, Director, alex@company.example", website: "https://company.example/team", relevance: "unclear" as const, email: "alex@company.example" },
  };
  return { args, insert, update, where };
}

describe("research contacts", () => {
  it("automatically saves a person with a published email and source attribution", async () => {
    const { args, insert } = fixture();
    await saveResearchContact(args);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org", targetId: "target", displayName: "Alex Owner",
      personalData: { email: "alex@company.example", emailStatus: "published-unverified", doNotContact: false },
      provenance: expect.objectContaining({ sourceUrl: args.sourceUrl, quote: args.evidence.quote }),
    }));
  });
  it.each([undefined, "", "invalid"])("keeps email %s as evidence only", async email => {
    const { args, insert, update } = fixture();
    await saveResearchContact({ ...args, evidence: { ...args.evidence, email } });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("fills an incomplete contact's email while retaining do-not-contact", async () => {
    const { args, insert, update } = fixture([{ id: "existing", displayName: " Alex   Owner ", personalData: { doNotContact: true, phone: "123" }, fictionalised: false }]);
    await saveResearchContact(args);
    expect(insert).not.toHaveBeenCalled();
    const patch = new PgDialect().sqlToQuery(update.mock.calls[0][0].personalData);
    expect(patch.sql).toContain('"contacts"."personal_data"');
    expect(patch.params).toEqual([JSON.stringify({ email: 'alex@company.example', emailStatus: 'published-unverified' })]);
  });
  it.each([
    { personalData: { email: "enriched@company.example" } },
    { firmablePersonId: "firmable-id", personalData: {} },
    { fictionalised: true, personalData: {} },
  ])("preserves enriched or fictionalised contacts: %j", async fields => {
    const { args, insert, update } = fixture([{ id: "existing", displayName: "Alex Owner", ...fields }]);
    await saveResearchContact(args);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
it('coalesces simultaneous new-contact saves using the existing primary key',async()=>{
 const {args}=fixture();const saved=new Map<string,unknown>();
 const conflict=vi.fn();const insert=vi.fn((value:{id:string})=>({onConflictDoNothing:async()=>{conflict(value.id);if(!saved.has(value.id)) saved.set(value.id,value);}}));
 const database={select:()=>({from:()=>({where:async()=>[]})}),insert:()=>({values:insert})};
 await Promise.all([saveResearchContact({...args,database:database as never}),saveResearchContact({...args,database:database as never,evidence:{...args.evidence,name:' Alex  Owner '}})]);
 expect(conflict).toHaveBeenCalledTimes(2);expect(saved.size).toBe(1);
});

it('guards stale email updates against concurrently enriched or fictionalised contacts',async()=>{
 const {args,update,where}=fixture([{id:'existing',displayName:'Alex Owner',personalData:{doNotContact:true},fictionalised:false}]);
 await saveResearchContact(args);
 const guard=new PgDialect().sqlToQuery(where.mock.calls[0][0]);
 expect(guard.sql).toContain('"firmable_person_id" is null');
 expect(guard.sql).toContain('"fictionalised" =');
 expect(guard.sql).toContain('"personal_data"->');
 expect(guard.params).toContain('null');
 expect(new PgDialect().sqlToQuery(update.mock.calls[0][0].personalData).sql).toContain("||");
});
it.skipIf(process.env.RUN_RESEARCH_SCHEDULER_SQL_TESTS!=='true')('preserves live preferences and rejects stale enrichment updates using SELECT-only PostgreSQL expressions',async()=>{
 const {Client}=await import('pg');const client=new Client({connectionString:'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire'});await client.connect();
 const {args,update,where}=fixture([{id:'existing',displayName:'Alex Owner',personalData:{doNotContact:false},fictionalised:false}]);
 await saveResearchContact(args);
 const evaluate=async(expression:unknown,personal:Record<string,unknown>,firmable:string|null=null,fictionalised=false)=>{
  const q=new PgDialect().sqlToQuery(expression as never);const params=[...q.params,JSON.stringify(personal),firmable,fictionalised];
  const statement=q.sql.replaceAll('"contacts"."personal_data"',`$${q.params.length+1}::jsonb`).replaceAll('"contacts"."firmable_person_id"',`$${q.params.length+2}::text`).replaceAll('"contacts"."fictionalised"',`$${q.params.length+3}::boolean`).replaceAll('"contacts"."id"',"'existing'").replaceAll('"contacts"."organization_id"',"'org'");
  // PostgreSQL requires referenced parameter numbers; the expressions do not
  // all use every field, so explicitly consume the tail arguments in the SELECT.
  return (await client.query(`SELECT ${statement} AS value, $${q.params.length+1}::jsonb, $${q.params.length+2}::text, $${q.params.length+3}::boolean`,params)).rows[0].value;
 };
 try {
  expect(await evaluate(update.mock.calls[0][0].personalData,{doNotContact:true,phone:'123'})).toEqual({doNotContact:true,phone:'123',email:'alex@company.example',emailStatus:'published-unverified'});
  const guard=where.mock.calls[0][0];
  expect(await evaluate(guard,{doNotContact:true})).toBe(true);
  expect(await evaluate(guard,{email:'stronger@example.com'})).toBe(false);
  expect(await evaluate(guard,{},'firmable-id')).toBe(false);
  expect(await evaluate(guard,{},null,true)).toBe(false);
 } finally {await client.end();}
});
