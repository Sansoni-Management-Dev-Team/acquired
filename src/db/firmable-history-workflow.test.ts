import {expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import {FirmableHistoryRepository} from './firmable-history-repository';
import {acquisitionWorkflowContext} from '@/lib/acquisition-workflow-context';
it.each(['00000000-0000-4000-8000-000000000001',null])('scopes parent reconciliation by organisation and restores original execution %s before updating it',async(execution)=>{
 const root={id:'root',organizationId:'org',createdBy:'owner',workflowExecutionId:execution,config:{companyPeopleRunIds:['run']}};
 const selections=[[{id:'run',organizationId:'org',trigger:'people'}],[],[root],[root],[{id:'run',status:'complete',profilesSaved:1}]];
 const conditions:unknown[]=[],updates:Array<{context:unknown}>=[];
 const chain=(rows:unknown[])=>{const q:{[key:string]:unknown}={};for(const k of ['from','limit','for'])q[k]=()=>q;q.where=(sql:unknown)=>{conditions.push(sql);return q;};q.then=(resolve:(r:unknown[])=>void)=>Promise.resolve(rows).then(resolve);return q;};
 const db={select:()=>chain(selections.shift()??[]),update:()=>({set:()=>({where:()=>{updates.push({context:acquisitionWorkflowContext()});return Promise.resolve([]);}})}),transaction:async(work:(tx:unknown)=>unknown)=>work(db)};
 vi.spyOn(FirmableHistoryRepository.prototype,'searchCandidates').mockResolvedValue({candidates:[]} as never);
 vi.spyOn(FirmableHistoryRepository.prototype,'profileProgress').mockResolvedValue({found:1,saved:1,failed:0,attempted:1,pending:0});
 try{
  await new FirmableHistoryRepository(db as never).reconcileProfileProgress('run');
  expect(updates.at(-1)?.context).toMatchObject({id:execution,organizationId:'org',ownerUserId:'owner'});
  const sql=conditions.map(value=>new PgDialect().sqlToQuery(value as never).sql);
  expect(sql.find(value=>value.includes('companyPeopleRunIds'))).toContain('organization_id');
 }finally{vi.restoreAllMocks();}
});
