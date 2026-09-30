import { expect,it,vi } from 'vitest';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { writeFileSync } from 'node:fs';
import type { requireDb } from './client';
const state=vi.hoisted(()=>({database:undefined as unknown}));
vi.mock('./client',()=>({requireDb:()=>state.database}));
import { CompanyListRepository } from './company-list-repository';
import { defaultCompanyListQuery } from '@/domain/company-list';
it.skipIf(!process.env.COMPANY_LIST_TEST_URL)('validates local SQL, unchanged polling, pagination and organisation isolation using read-only transactions',async()=>{
  const client=new Client({connectionString:process.env.COMPANY_LIST_TEST_URL});await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');state.database=drizzle(client) as ReturnType<typeof requireDb>;
    const sample=(await client.query('SELECT id,organization_id FROM public.mandates WHERE id=$1',['d867df25-1cad-441d-ae08-92d26da3117e'])).rows[0];expect(sample).toBeDefined();
    const repo=new CompanyListRepository(sample.organization_id,state.database as ReturnType<typeof requireDb>);
    const received=()=>(client as unknown as {connection:{stream:{bytesRead:number}}}).connection.stream.bytesRead;
    const beforeFirst=received();
    const first=await repo.load(sample.id,defaultCompanyListQuery);expect(first).not.toBeNull();if(!first || 'unchanged' in first)throw new Error('Expected initial rows');
    expect(first.rows.length).toBeLessThanOrEqual(25);expect(JSON.stringify(first)).not.toContain('discoveryAttempts');
    const afterFirst=received();
    const second=await repo.load(sample.id,defaultCompanyListQuery,first.revision);expect(second).toEqual({unchanged:true,active:first.active,revision:first.revision});expect(JSON.stringify(second).length).toBeLessThan(200);
    const afterSecond=received();
    expect(await new CompanyListRepository('unrelated-org',state.database as ReturnType<typeof requireDb>).load(sample.id,defaultCompanyListQuery)).toBeNull();
    writeFileSync('/tmp/project-acquire-company-list-validation.json',JSON.stringify({rows:first.rows.length,changedResponseBytes:Buffer.byteLength(JSON.stringify(first)),unchangedResponseBytes:Buffer.byteLength(JSON.stringify(second)),changedDatabaseBytes:afterFirst-beforeFirst,unchangedDatabaseBytes:afterSecond-afterFirst},null,2));
  } finally {await client.query('ROLLBACK');await client.end();}
},30000);
