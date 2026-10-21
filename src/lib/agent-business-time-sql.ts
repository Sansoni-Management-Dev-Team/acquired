import type{Pool,PoolClient}from'pg';
import{businessNow}from'../../communications/packages/core/src/business-clock';
import{assertAgentBusinessTimeScope,type AgentBusinessTimeSelection}from'./agent-business-time';
export type AgentBusinessDbOptions={pool?:Pick<Pool,'connect'>;businessTime?:AgentBusinessTimeSelection};
/** Called only inside the caller's existing restricted transaction, after its
 * protected actor/runtime GUCs. Never begins work, changes role or grants authority. */
export async function installAgentBusinessTimeSql(client:Pick<PoolClient,'query'>,selection:AgentBusinessTimeSelection,actor:{organizationId:string;userId:string}){
 const{context,scope}=selection;
 if(scope.organizationId!==actor.organizationId||scope.userId!==actor.userId)throw Error('Agent business time scope unavailable');
 assertAgentBusinessTimeScope(context,scope);
 const stamp=new Date(businessNow(context)).toISOString();
 await client.query("SELECT set_config('acquire.simulator_business_run',$1,true),set_config('acquire.simulator_business_time',$2,true)",[context.scope.runId,stamp]);
 if((await client.query('SELECT public.local_simulator_business_now()=$1::timestamptz AS coherent',[stamp])).rows[0]?.coherent!==true)throw Error('Agent business time SQL context unavailable');
}
