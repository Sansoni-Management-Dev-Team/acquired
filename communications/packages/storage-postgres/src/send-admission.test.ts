import { expect, it, vi } from 'vitest';
import { reserveDispatchQuotas } from './send-admission';
import type { SqlClient, SqlResult } from './webhook-repository';
const policy = { account: { hour: 10, day: 30 }, application: { hour: 20, day: 100 } };
it('charges account and application hour/day once inside the same savepoint', async () => { const query = vi.fn(async (sql: string): Promise<SqlResult> => ({ rows: sql.includes('RETURNING used') ? [{ used: 1 }] : [] })); expect(await reserveDispatchQuotas({ query, release() { } } as SqlClient, 'account', 'app', policy)).toBe(true); expect(query.mock.calls.filter(c => c[0].startsWith('INSERT INTO communications.quota_buckets'))).toHaveLength(4); });
it('rolls every partial charge back when one allowance is exhausted', async () => { let inserts = 0; const query = vi.fn(async (sql: string): Promise<SqlResult> => ({ rows: sql.includes('RETURNING used') ? (++inserts === 3 ? [] : [{ used: 1 }]) : [] })); expect(await reserveDispatchQuotas({ query, release() { } } as SqlClient, 'account', 'app', policy)).toBe(false); expect(query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT communication_admission_quota'); });
it('never accepts caller-corrupted negative limits', async () => { const query = vi.fn(); await expect(reserveDispatchQuotas({ query, release() { } } as SqlClient, 'account', 'app', { ...policy, account: { hour: -1, day: 30 } })).rejects.toThrow('Dispatch journal unavailable'); expect(query).not.toHaveBeenCalled(); });

it('selects calendar send quotas from explicit business time while preserving real default SQL',async()=>{
 const calls:string[]=[];const query=vi.fn(async(sql:string):Promise<SqlResult>=>{calls.push(sql);return {rows:sql.includes('RETURNING used')?[{used:1}]:[]};});
 await reserveDispatchQuotas({query,release(){}} as SqlClient,'account','app',policy,{now:()=>Date.parse('2031-01-01T00:00:00.000Z')});
 expect(calls.filter(q=>q.startsWith('INSERT INTO communications.quota_buckets'))).toHaveLength(4);
 expect(calls.filter(q=>q.startsWith('INSERT INTO communications.quota_buckets')).every(q=>q.includes('date_trunc($4::text,public.local_simulator_business_now())'))).toBe(true);
 calls.length=0;await reserveDispatchQuotas({query,release(){}} as SqlClient,'account','app',policy);
 expect(calls.filter(q=>q.startsWith('INSERT INTO communications.quota_buckets')).every(q=>q.includes('date_trunc($4::text,clock_timestamp())'))).toBe(true);
});
