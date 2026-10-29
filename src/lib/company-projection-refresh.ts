import {types} from 'node:util';
import {sql} from 'drizzle-orm';
import {AcquireCommandError} from '@/domain/acquire-commands';
import {refreshCompanyMembershipProjectionBatches} from '@/db/company-membership-projection-store';
import {companyIdentityDrizzleClient,type CompanyIdentityDatabase} from '@/db/company-identity-store';
import type {CompanyProjectionRefreshResult} from '@/domain/company-projection-refresh';
import {requireDb} from '@/db/client';
type Actor={organizationId:string;userId:string};
const message='Saved changes are confirmed. Company evidence still needs refresh before agent supervision can continue. Return to the agent and explicitly resume to retry this read-only refresh.';
export async function refreshCompanyProjections(database:CompanyIdentityDatabase,actor:Actor,scope:{mandateId:string;targetIds?:string[]}):Promise<Extract<CompanyProjectionRefreshResult,{status:'current'}>>{
 const raw=await database.execute(sql`SELECT to_regclass('public.company_membership_projections') IS NOT NULL AS installed`),flags=Array.isArray(raw)?raw:(raw as {rows:{installed:boolean}[]}).rows;
 if(flags.length!==1||typeof flags[0].installed!=='boolean')throw Error('Company projection availability could not be verified');
 if(!flags[0].installed)return{status:'current',published:0,examined:0};
 const result=await refreshCompanyMembershipProjectionBatches(work=>database.transaction(async tx=>{const c=companyIdentityDrizzleClient(tx);await c.query("SET LOCAL statement_timeout='3s'");await c.query("SET LOCAL lock_timeout='1s'");return work(c);}),actor,scope);
 return{status:'current',...result};
}
/** A committed ordinary edit remains a confirmed edit even if its derived read
 * model could not be refreshed. The protected reader stays fail-closed. */
export async function refreshCompanyProjectionsAfterChange(database:CompanyIdentityDatabase,actor:Actor,scope:{mandateId:string;targetIds?:string[]}):Promise<CompanyProjectionRefreshResult>{
 try{return await refreshCompanyProjections(database,actor,scope);}catch{return{status:'refresh_needed',message};}
}
/** Run before entering the actor's SHARED control transaction, never from GET. */
export async function refreshCompanyProjectionsBeforeNativeControl(actor:Actor,mandateId:string){
 const started=performance.now();
 try{return await refreshCompanyProjections(requireDb(),actor,{mandateId});}catch(cause){
  const field=(key:string)=>cause&&typeof cause==='object'&&!types.isProxy(cause)?Object.getOwnPropertyDescriptor(cause,key)?.value:undefined;
  const code=field('code'),sqlState=typeof code==='string'&&['57014','55P03','40001','40P01','42501','P0001'].includes(code)?code:undefined;
  const category=field('message')==='Company projection refresh exceeded its bounded transaction; refresh is still required'?'batch_deadline':sqlState==='57014'?'query_cancelled':sqlState==='55P03'?'lock_unavailable':sqlState?'database_error':'unavailable';
  const count=(key:string)=>Number.isSafeInteger(field(key))&&field(key)>=0&&field(key)<=1000?field(key):undefined;
  console.info('company-projection-refresh',{timestamp:new Date().toISOString(),stage:'before_native_control',mandateId:/^[a-f0-9-]{36}$/.test(mandateId)?mandateId:undefined,category,sqlState,sourceCount:count('sourceCount'),examinedCount:count('examinedCount'),durationMs:Math.round(performance.now()-started)});
  throw Object.assign(new AcquireCommandError('Company evidence needs a current refresh before starting or resuming supervision. Your saved changes remain confirmed; refresh and explicitly try again.',409),{cause});
 }
}
