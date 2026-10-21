import type{Pool,PoolClient}from'pg';import type{AgentBusinessTimeScope}from'../../src/lib/agent-business-time';
async function readOnly<T>(pool:Pick<Pool,'connect'>,work:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN READ ONLY');const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
/** Frozen-admission observer only: a literal READ ONLY transaction, exact actor
 * and mandate filters, no generic store/effectful callbacks and no clock pin.
 * The controller owns the freeze; this function never acquires authority. */
export async function readCompletionSchedule(input:{pool:Pick<Pool,'connect'>;servicePool:Pick<Pool,'connect'>;integrationId:string;scope:AgentBusinessTimeScope;mandateId:string;now:number}){
 if(!Number.isSafeInteger(input.now)||!Number.isFinite(new Date(input.now).getTime()))throw Error('Completion observation instant unavailable');
 const observed=await readOnly(input.pool,async c=>{const row=(await c.query(`SELECT
  min(e.available_at) FILTER(WHERE (e.state='pending' OR e.lease_until<=clock_timestamp()) AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp())) AS next_at,
  count(*) FILTER(WHERE (e.state='pending' OR e.lease_until<=clock_timestamp()) AND e.available_at<=$4::timestamptz AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()))::integer AS due,
  count(*) FILTER(WHERE e.state='leased' AND e.lease_until>clock_timestamp())::integer AS active
  FROM agent_events e JOIN agent_threads t ON t.id=e.thread_id JOIN agent_responsibilities r ON r.thread_id=t.id
  JOIN member m ON m.organization_id=t.organization_id AND m.user_id=t.owner_user_id
  JOIN local_simulator_business_runs b ON b.organization_id=t.organization_id AND b.owner_user_id=t.owner_user_id AND b.run_id=$5
  WHERE t.organization_id=$1 AND t.owner_user_id=$2 AND t.mandate_id=$3 AND r.state IN('ready','waiting') AND e.state IN('pending','leased')`,[input.scope.organizationId,input.scope.userId,input.mandateId,new Date(input.now).toISOString(),input.scope.runId])).rows[0];const native=(await c.query("SELECT (SELECT count(*) FROM agent_runs WHERE organization_id=$1 AND owner_user_id=$2 AND mandate_id=$3 AND state='running' AND lease_until>clock_timestamp())+(SELECT count(*) FROM agent_operations WHERE organization_id=$1 AND owner_user_id=$2 AND mandate_id=$3 AND state='running' AND lease_until>clock_timestamp())+(SELECT count(*) FROM agent_events WHERE organization_id=$1 AND owner_user_id=$2 AND mandate_id=$3 AND state='leased' AND lease_until>clock_timestamp()) AS active",[input.scope.organizationId,input.scope.userId,input.mandateId])).rows[0];return{nextAt:row?.next_at?new Date(row.next_at).toISOString():null,due:Number(row?.due??0),active:Number(native?.active??0)};});
 const live=await readOnly(input.servicePool,async service=>Number((await service.query(`SELECT
   (SELECT count(*) FROM communications.operation_journal WHERE application_id='acquire' AND tenant_id=$1 AND owner_id=$2 AND state IN('claimed','dispatching') AND claim_until>clock_timestamp())+
   (SELECT count(*) FROM communications.event_cursors WHERE application_id='acquire' AND tenant_id=$1 AND owner_id=$2 AND lease_until>clock_timestamp())+
   (SELECT count(*) FROM communications.event_outbox WHERE application_id='acquire' AND tenant_id=$1 AND owner_id=$2 AND state='delivering' AND lease_until>clock_timestamp())+
   (SELECT count(*) FROM communications.webhook_inbox WHERE integration_id=$3 AND state='processing' AND lease_until>clock_timestamp())+
   (SELECT count(*) FROM communications.account_leases l WHERE l.expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM communications.connections b WHERE b.account_id=l.account_id AND b.application_id='acquire' AND b.tenant_id=$1 AND b.owner_id=$2)) AS active`,[input.scope.organizationId,input.scope.userId,input.integrationId])).rows[0]?.active??0));
 return{...observed,active:observed.active+live};
}
