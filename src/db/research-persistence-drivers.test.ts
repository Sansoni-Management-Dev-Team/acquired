import {expect,it,vi} from 'vitest';
import {drizzle as postgres} from 'drizzle-orm/node-postgres';
import {drizzle as neon} from 'drizzle-orm/neon-http';
import {sql} from 'drizzle-orm';
vi.mock('./client',()=>({requireDb:vi.fn()}));
vi.mock('./firmable-history-repository',()=>({FirmableHistoryRepository:class {findCompany=async()=>undefined;}}));
import {OrganizationRepository} from './repositories';
import {saveResearchContact} from './research-contacts';
import {researchTargetId} from './research-persistence-id';
import {rankTarget} from '@/domain/scoring';
import {seedTargets,defaultMandate} from '@/test/fixtures/scoring-targets';
function driver(kind:'postgres'|'neon') {
 const rows=new Map<string,string>();const calls:{text:string;params:unknown[]}[]=[];
 const execute=async(text:string,params:unknown[]=[])=>{
  calls.push({text,params});
  if(text.startsWith('insert into "targets"')) {
   const id=params[0] as string;
   if(rows.has(id)) return {rows:[]};rows.set(id,'targets');return {rows:[[id]]};
  }
  if(text.startsWith('insert into "contacts"')) {rows.set(params[0] as string,'contacts');return {rows:[]};}
  if(text.startsWith('select "id" from "targets"')) return {rows:[...[...rows].filter(([,table])=>table==='targets').map(([id])=>[id])]};
  return {rows:[]};
 };
 const client={query:async(config:{text:string},params:unknown[])=>execute(config.text,params)};
 const neonQuery=Object.assign(async(text:string,params:unknown[])=>execute(text,params),{query:async(text:string,params:unknown[])=>execute(text,params)});
 return {db:kind==='postgres'?postgres({client:client as never}):neon(neonQuery as never),calls,rows};
}
it.each(['postgres','neon'] as const)('uses PK conflict protection for competing company/contact saves through actual %s SQL builders',async kind=>{
 const f=driver(kind);const repo=new OrganizationRepository(f.db as never,'org');vi.spyOn(repo,'appendAudit').mockResolvedValue(undefined as never);
 const target=rankTarget({...seedTargets[0],sourceData:{manufacturingDirectory:{recordId:'site',name:'Company',categories:[],keywords:[],capabilities:[],sourceRecords:[]}}},defaultMandate);
 const input={target,mandateId:'00000000-0000-4000-8000-000000000001',actorId:'actor',creationId:researchTargetId('org',target.domain)};
 const result=await Promise.all([repo.upsertEnrichedTarget(input),repo.upsertEnrichedTarget(input)]);
 expect(result.map(row=>row?.id)).toEqual([input.creationId,input.creationId]);
 const args={database:f.db as never,organizationId:'org',targetId:input.creationId,sourceUrl:'https://example.com/team',observedAt:new Date(),evidence:{kind:'person' as const,name:'Alex Owner',value:'Director',quote:'Alex Owner Director alex@example.com',website:'https://example.com',email:'alex@example.com'}};
 await Promise.all([saveResearchContact(args),saveResearchContact(args)]);
 expect([...f.rows.values()].filter(table=>table==='targets')).toHaveLength(1);
 expect([...f.rows.values()].filter(table=>table==='contacts')).toHaveLength(1);
 const inserts=f.calls.filter(call=>call.text.startsWith('insert'));
 expect(inserts).toHaveLength(4);expect(inserts.every(call=>call.text.includes('on conflict ("id") do nothing'))).toBe(true);
 expect(f.calls.some(call=>/^begin|commit|rollback$/i.test(call.text))).toBe(false);
});
it('documents installed driver transaction differences without opening a connection',async()=>{
 const http=driver('neon');await expect(http.db.transaction(async()=>{})).rejects.toThrow('No transactions support in neon-http driver');
 const pg=driver('postgres');await pg.db.transaction(async tx=>{await tx.execute(sql`SELECT 1`);});
 expect(pg.calls.map(call=>call.text)).toEqual(['begin','SELECT 1','commit']);
});
