import {afterEach,expect,it,vi} from 'vitest';
import {businessNow,businessSql} from './business-clock';
afterEach(()=>vi.restoreAllMocks());
it('defaults to real time and a fixed real SQL expression',()=>{vi.spyOn(Date,'now').mockReturnValue(1792300000123);expect(businessNow()).toBe(1792300000123);expect(businessSql()).toBe('clock_timestamp()');});
it('reads an explicit business clock without changing real time or accepting SQL text',()=>{const wall=Date.now(),clock={now:()=>Date.parse('2030-01-07T00:00:00.000Z')};expect(businessNow(clock)).toBe(Date.parse('2030-01-07T00:00:00.000Z'));expect(businessSql(clock)).toBe('public.local_simulator_business_now()');expect(Date.now()).toBeGreaterThanOrEqual(wall);});
it.each([NaN,Infinity,-Infinity,1.25,Number.MAX_SAFE_INTEGER,8640000000000001,'2030-01-07'])('refuses an invalid business instant %j',value=>{expect(()=>businessNow({now:()=>value} as never)).toThrow('Invalid business clock');});
