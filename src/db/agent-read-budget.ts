import type {PoolClient} from 'pg';
export type AgentTransactionPreset='people_readiness';
type ReadLimits={statement:number;lock:number};
export class AgentReadinessUnavailableError extends Error{
 constructor(cause:unknown){super('Company readiness is temporarily unavailable; no eligibility or send permission was inferred.',{cause});this.name='AgentReadinessUnavailableError';}
}
export function isAgentReadBudgetFailure(error:unknown){return typeof error==='object'&&error!==null&&'code'in error&&(error.code==='57014'||error.code==='55P03');}
async function settings(c:PoolClient):Promise<ReadLimits>{
 const row=(await c.query("SELECT (SELECT setting::integer FROM pg_settings WHERE name='statement_timeout') AS statement_ms,(SELECT setting::integer FROM pg_settings WHERE name='lock_timeout') AS lock_ms")).rows[0];
 if(!row||![row.statement_ms,row.lock_ms].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Agent read timeout state is unavailable');
 return{statement:row.statement_ms,lock:row.lock_ms};
}
async function apply(c:PoolClient,value:ReadLimits){await c.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",[String(value.statement),String(value.lock)]);}
/** Server-owned preset, applied before any gate. Preserve stricter configured limits. */
export async function installAgentReadBudget(c:PoolClient,preset:AgentTransactionPreset){
 if(preset!=='people_readiness')throw new Error('Unknown protected agent transaction preset');
 const before=await settings(c);await apply(c,{statement:before.statement===0?3000:Math.min(before.statement,3000),lock:before.lock===0?1000:Math.min(before.lock,1000)});return before;
}
/** On SQL/JS error the owning transaction must roll back. Do not issue restore
 * SQL into an aborted transaction and replace the original failure. */
export async function withAgentReadBudget<T>(c:PoolClient,work:()=>Promise<T>):Promise<T>{
 const before=await installAgentReadBudget(c,'people_readiness');const result=await work();await apply(c,before);return result;
}
