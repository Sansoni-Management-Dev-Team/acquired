/** Business policy time only. Auth, leases, spend windows and deadlines stay real. */
export interface BusinessClock {now():number}
export function businessNow(clock?:BusinessClock):number{
 const instant=clock?clock.now():Date.now();
 if(!Number.isSafeInteger(instant)||!Number.isFinite(new Date(instant).getTime()))throw Error('Invalid business clock');
 return instant;
}
/** Fixed optional port. Its local SQL function must be installed and its transaction
 * context attached before a composition selects it; this helper executes no SQL. */
export function businessSql(clock?:BusinessClock):string{return clock?'public.local_simulator_business_now()':'clock_timestamp()';}
