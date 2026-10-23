import {z} from 'zod';
import {AgentGuidanceStore} from './agent-guidance-store';
const uuid=z.string().uuid(),units=z.string().regex(/^(0|[1-9]\d{0,11})$/);
const reservationSchema=z.object({id:uuid,operation_id:uuid,account_id:uuid,amount:z.string().regex(/^[1-9]\d{0,11}$/),actual:units.nullable(),state:z.enum(['reserved','settled','uncertain','released'])});
export const budgetConfigurationSchema=z.object({scopeKey:z.string().trim().min(1).max(200),unit:z.enum(['usd_micro','calls','sends']),windowStart:z.string().datetime({offset:true}),windowEnd:z.string().datetime({offset:true}),cap:units,expectedRevision:z.number().int().nonnegative()}).strict();
export class AgentBudgetStore extends AgentGuidanceStore{
 async budgetSettings(mandateId:string){
  uuid.parse(mandateId);return this.transaction(async c=>{
   if(!(await c.query('SELECT 1 FROM mandates WHERE id=$1 AND organization_id=$2',[mandateId,this.actor.organizationId])).rowCount)throw new Error('Mandate unavailable');
   const membership=(await c.query('SELECT role FROM member WHERE organization_id=$1 AND user_id=$2',[this.actor.organizationId,this.actor.userId])).rows[0];
   const keys=['organization','user:'+this.actor.userId,'mandate:'+mandateId].flatMap(scope=>['calls','usd_micro','sends'].map(unit=>scope+':'+unit));
   const accounts=(await c.query(`SELECT id,scope_key,unit,to_char(window_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS window_start,to_char(window_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS window_end,cap::text,spent::text,reserved::text,revision FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key=ANY($2::text[]) ORDER BY agent_budget_accounts.window_start DESC,id LIMIT 100`,[this.actor.organizationId,keys])).rows;
   return {canConfigure:!!membership&&['owner','admin'].includes(membership.role),accounts};
  });
 }
 async configureBudget(raw:unknown){
  const value=budgetConfigurationSchema.parse(raw);
  return this.transaction(async c=>(await c.query('SELECT public.agent_configure_budget($1,$2,$3::timestamptz,$4::timestamptz,$5::bigint,$6::integer) AS account',[value.scopeKey,value.unit,value.windowStart,value.windowEnd,value.cap,value.expectedRevision])).rows[0].account);
 }
 async reserveBudget(operationId:string,raw:unknown){
  uuid.parse(operationId);const requests=z.array(z.object({accountId:uuid,amount:z.string().regex(/^[1-9]\d{0,11}$/)}).strict()).min(1).max(10).parse(raw);
  return this.transaction(async c=>z.array(reservationSchema).parse((await c.query('SELECT public.agent_reserve_budget($1::uuid,$2::jsonb) AS reservations',[operationId,JSON.stringify(requests)])).rows[0].reservations));
 }
 async settleBudget(operationId:string,raw:unknown){
  uuid.parse(operationId);const actuals=z.array(z.object({accountId:uuid,actual:units.nullable()}).strict()).min(1).max(10).parse(raw);
  return this.transaction(async c=>z.array(reservationSchema).parse((await c.query('SELECT public.agent_settle_budget($1::uuid,$2::jsonb) AS reservations',[operationId,JSON.stringify(actuals)])).rows[0].reservations));
 }
 async listBudgetAccounts(){
  return this.transaction(async c=>(await c.query('SELECT id,scope_key,unit,window_start,window_end,cap::text,spent::text,reserved::text,revision,approved_by,approved_at FROM agent_budget_accounts WHERE organization_id=$1 ORDER BY window_start DESC,id LIMIT 100',[this.actor.organizationId])).rows);
 }
}
