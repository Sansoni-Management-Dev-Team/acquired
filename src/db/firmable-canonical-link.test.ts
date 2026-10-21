import {it,expect,vi} from 'vitest';
vi.mock('./client',()=>({requireDb:()=>{throw Error('Unexpected database construction');}}));
import {FirmableHistoryRepository} from './firmable-history-repository';
import {firmableCompanies,firmableSyncRuns,targets} from './schema';
import {PgDialect} from 'drizzle-orm/pg-core';
it('never rewrites accepted canonical identity while recording a company response; legacy targets retain their path',async()=>{
 let targetWhere:{sql:string;params:unknown[]}|undefined;
 const database={select:()=>({from:()=>({where:()=>({limit:async()=>[{firmableCompanyId:null,companyStatus:'pending'}]})})}),update:(table:unknown)=>({set:()=>({where:(query:Parameters<PgDialect['sqlToQuery']>[0])=>{
 if(table===targets){targetWhere=new PgDialect().sqlToQuery(query);return Promise.resolve([]);}
 return{returning:async()=>table===firmableCompanies?[{generation:2}]:table===firmableSyncRuns?[{targetId:'target',organizationId:'org'}]:[]};
 }})})};
 await new FirmableHistoryRepository(database as never).linkRunCompany('run','f1','complete');
 expect(targetWhere?.sql).toContain('NOT EXISTS');expect(targetWhere?.sql).toContain('company_identity_accepted_observations');expect(targetWhere?.sql).toContain('organization_id');expect(targetWhere?.params).toContain('target');
});
