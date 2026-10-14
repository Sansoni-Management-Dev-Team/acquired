import {sql} from 'drizzle-orm';
import type {requireDb} from '../db/client';
type Database=ReturnType<typeof requireDb>;
function returnedRow(result:unknown):Record<string,unknown> {
 if(!result||typeof result!=='object'||!('rows' in result)||!Array.isArray(result.rows)||result.rows.length!==1||!result.rows[0]||typeof result.rows[0]!=='object')throw Error('Outreach send authority unavailable');
 return result.rows[0];
}
export async function prepareOutreachSendTransaction(tx:Database,actor:{organizationId:string;userId:string}) {
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')return;
 if(!actor.organizationId||!actor.userId||typeof tx.execute!=='function')throw Error('Outreach transaction unavailable');
 await tx.execute(sql`SET LOCAL ROLE acquire_communications_writer`);
 await tx.execute(sql`SELECT set_config('app.acquire_org',${actor.organizationId},true),set_config('app.acquire_user',${actor.userId},true)`);
 const gate=returnedRow(await tx.execute(sql`SELECT public.communications_lock_send_gate(${actor.organizationId})::text AS revision`));
 if(typeof gate.revision!=='string'||!/^(0|[1-9]\d{0,18})$/.test(gate.revision)||BigInt(gate.revision)>BigInt('9223372036854775807'))throw Error('Outreach send authority unavailable');
 const membership=returnedRow(await tx.execute(sql`SELECT public.communications_lock_send_member(${actor.organizationId},${actor.userId}) AS allowed`));
 if(membership.allowed!==true)throw Error('Outreach connection access unavailable');
}
/** New runtime writers hold the organization/member gate through the same commit as
 * saved draft/enrolment/audit changes. Neon HTTP cannot substitute separate statements. */
export async function withOutreachSendTransaction<T>(database:Database,actor:{organizationId:string;userId:string},work:(tx:Database)=>Promise<T>):Promise<T>{
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')return work(database);
 if(!actor.organizationId||!actor.userId||typeof database.transaction!=='function')throw Error('Outreach transaction unavailable');
 return database.transaction(async tx=>{
  await prepareOutreachSendTransaction(tx,actor);
  return work(tx);
 });
}
