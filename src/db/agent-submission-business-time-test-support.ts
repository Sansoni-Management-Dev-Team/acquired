import{createHash}from'node:crypto';
import type{Pool}from'pg';
import{expect}from'vitest';
import type{AgentBusinessTimeScope}from'@/lib/agent-business-time';
/** SQL component probes reuse a receipt minted by the genuine configured
 * SDK/webhook/ledger path. BEFORE INSERT runs even for its idempotent conflict;
 * no new receipt, intent, permit, approval or effect is seeded by these probes.
 * Registration removal below is this fixture only, inside a rolled-back
 * savepoint, to characterize the existing unregistered wall-clock lane. */
export async function assertSubmissionBusinessTimeGuards(pool:Pick<Pool,'connect'>,input:{scope:AgentBusinessTimeScope;runtimeId:string;intentId:string;businessAt:string}){
 const c=await pool.connect(),results:{scenario:string;result:'accepted_idempotent'|'refused'}[]=[],hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 try{
  await c.query('BEGIN');
  await c.query('SELECT public.communications_lock_send_gate($1)',[input.scope.organizationId]);
  const read=()=>c.query('SELECT to_jsonb(r) AS row FROM public.communication_submission_receipts r WHERE intent_id=$1 AND organization_id=$2 AND owner_user_id=$3',[input.intentId,input.scope.organizationId,input.scope.userId]),before=(await read()).rows;
  expect(before).toHaveLength(1);const originalHash=hash(before),row=before[0].row;expect(new Date(row.submitted_at).toISOString()).toBe(input.businessAt);
  const insert="INSERT INTO public.communication_submission_receipts SELECT (jsonb_populate_record(NULL::public.communication_submission_receipts,to_jsonb(r)||$2::jsonb)).* FROM public.communication_submission_receipts r WHERE r.intent_id=$1 ON CONFLICT(intent_id) DO NOTHING";
  const probe=async(scenario:string,patch:Record<string,unknown>,expected:RegExp|null,setup?:()=>Promise<unknown>)=>{
   await c.query('SAVEPOINT communication_admission_quota');
   try{await setup?.();if(expected)await expect(c.query(insert,[input.intentId,JSON.stringify(patch)])).rejects.toThrow(expected);else expect((await c.query(insert,[input.intentId,JSON.stringify(patch)])).rowCount).toBe(0);results.push({scenario,result:expected?'refused':'accepted_idempotent'});}
   finally{await c.query('ROLLBACK TO SAVEPOINT communication_admission_quota');await c.query('RELEASE SAVEPOINT communication_admission_quota');}
   expect(hash((await read()).rows)).toBe(originalHash);
   expect((await c.query('SELECT public.local_simulator_business_now() AS now')).rows[0].now.toISOString()).toBe(input.businessAt);
  };
  await probe('exact_authenticated_original_selected_clock',{},null);
  await probe('future_business_plus_one_millisecond',{submitted_at:new Date(Date.parse(input.businessAt)+1).toISOString()},/Exact authenticated original submission receipt required/);
  await probe('different_original_payload_digest',{payload_digest:'0'.repeat(64)},/Exact authenticated original submission receipt required/);
  await probe('different_original_intent_digest',{original_intent_digest:'0'.repeat(64)},/Exact authenticated original submission receipt required/);
  await probe('foreign_registered_run',{},/Exact registered business clock scope required/,()=>c.query("SELECT set_config('acquire.simulator_business_run',$1,true)",['sim28-foreign-unregistered-run']));
  await probe('missing_registered_context',{},/Configured local clock context missing/,()=>c.query("SELECT set_config('acquire.simulator_business_run','',true),set_config('acquire.simulator_business_time','',true)"));
  await probe('missing_registered_runtime',{},/Exact registered business clock scope required/,()=>c.query("SELECT set_config('app.acquire_runtime_id','',true)"));
  await probe('unregistered_default_still_refuses_future_wall_receipt',{},/Exact authenticated original submission receipt required/,async()=>{
   const removed=await c.query('DELETE FROM public.local_simulator_business_runs WHERE run_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND runtime_id=$4 RETURNING run_id',[input.scope.runId,input.scope.organizationId,input.scope.userId,input.runtimeId]);expect(removed.rowCount).toBe(1);
   await c.query("SELECT set_config('acquire.simulator_business_run','',true),set_config('acquire.simulator_business_time','',true),set_config('app.acquire_runtime_id','',true)");const start=Date.now(),wall=(await c.query('SELECT public.local_simulator_business_now() AS now')).rows[0].now.getTime();expect(wall).toBeGreaterThanOrEqual(start);expect(wall).toBeLessThanOrEqual(Date.now());
  });
  await c.query('ROLLBACK');return{originalReceiptHash:originalHash,receiptUnchanged:true,registrationRestored:true,results};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
