import {expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {SQL} from 'drizzle-orm';
import {emptyBrief} from '@/domain/acquisition';
import {defaultCompanyListQuery} from '@/domain/company-list';
import {CompanyListRepository} from './company-list-repository';
const mandateId='00000000-0000-4000-8000-000000000001';
vi.mock('./client',()=>({requireDb:()=>{throw Error('No implicit database');}}));
vi.mock('./acquisition-repository',()=>({AcquisitionRepository:class{async getMandate(){return{id:mandateId,brief:emptyBrief(),createdAt:'2026-10-18'};}async memberships(){return[];}}}));
vi.mock('./firmable-read-model',()=>({loadWorkspaceContacts:async()=>[]}));
it('invalidates unchanged Companies polls when accepted current-mandate observations change, without publishing or transferring source facts',async()=>{
 let observationDigest='old';const compiled:{sql:string;params:unknown[]}[]=[];
 const db={select:()=>{const chain={from:()=>chain,where:()=>chain,orderBy:async()=>[]};return chain;},execute:vi.fn(async(query:SQL)=>{const q=new PgDialect().sqlToQuery(query);compiled.push(q);if(q.sql.includes('to_regclass'))return[{installed:true}];if(q.sql.includes('AS revision FROM dependencies'))return[{revision:q.sql.includes('company_identity_accepted_observations')?'canonical-'+observationDigest:'legacy-only'}];return[];})};
 const repo=new CompanyListRepository('org',db as never);const first=await repo.load(mandateId,defaultCompanyListQuery);if(!first)throw Error('Missing fixture');observationDigest='new';const second=await repo.load(mandateId,defaultCompanyListQuery,first.revision);expect(second).not.toHaveProperty('unchanged');expect(second!.revision).not.toBe(first.revision);
 const dependency=compiled.find(q=>q.sql.includes('company_identity_accepted_observations')&&!q.sql.includes('to_regclass'))!;expect(dependency.params).toContain('org');expect(dependency.params).toContain(mandateId);expect(dependency.sql).toContain('input_digest');expect(dependency.sql).not.toContain('source_facts');expect(compiled.every(q=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql))).toBe(true);
});
it('does not reference an absent optional schema for ordinary legacy Companies',async()=>{const queries:string[]=[];const db={select:()=>{const chain={from:()=>chain,where:()=>chain,orderBy:async()=>[]};return chain;},execute:async(query:SQL)=>{const q=new PgDialect().sqlToQuery(query);queries.push(q.sql);return q.sql.includes('to_regclass')?[{installed:false}]:q.sql.includes('AS revision FROM dependencies')?[{revision:'legacy-only'}]:[];}};const repo=new CompanyListRepository('org',db as never),first=await repo.load(mandateId,defaultCompanyListQuery);expect(await repo.load(mandateId,defaultCompanyListQuery,first!.revision)).toMatchObject({unchanged:true});expect(queries.filter(q=>q.includes('company_identity_accepted_observations')&&!q.includes('to_regclass'))).toHaveLength(0);});
it('keeps Companies polling while independent background data is queued, even before dispatch renews its budget',async()=>{
 const queued={id:'queued',status:'queued',updatedAt:new Date('2026-01-01'),config:{mode:'automatic',purpose:'firmographics',automaticDeadline:1,companyBackgroundResearch:{version:1}},seeds:[]};
 const db={select:()=>{const chain={from:()=>chain,where:()=>chain,orderBy:async()=>[queued]};return chain;},execute:async(query:SQL)=>{const q=new PgDialect().sqlToQuery(query);return q.sql.includes('to_regclass')?[{installed:false}]:q.sql.includes('AS revision FROM dependencies')?[{revision:'legacy'}]:[];}};
 expect(await new CompanyListRepository('org',db as never).load(mandateId,defaultCompanyListQuery)).toMatchObject({active:true});
});
