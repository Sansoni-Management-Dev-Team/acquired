import type {SendGateClient} from './campaign-send-gate';
/** Called under the existing held organisation gate. Missing native schema is
 * compatible only with unmanaged legacy work. A boolean check does not replace
 * recipient, history, suppression, budget or communications-service admission. */
export async function agentDriverAllowed(client:SendGateClient,actor:{organizationId:string;userId:string},source:{contactId:string;address:string|null;kind:'campaign'|'draft'|'agent';sourceRef:string;epoch?:number}):Promise<boolean>{
 const installed=await client.query("SELECT to_regprocedure('public.agent_driver_allows(text,text,uuid,text,text,uuid,bigint)') IS NOT NULL AS installed");
 if(!Array.isArray(installed.rows)||installed.rows.length!==1||typeof installed.rows[0]?.installed!=='boolean')return false;
 if(!installed.rows[0].installed)return source.kind!=='agent';
 const proof=await client.query('SELECT public.agent_driver_allows($1,$2,$3::uuid,$4,$5,$6::uuid,$7::bigint) AS allowed',[actor.organizationId,actor.userId,source.contactId,source.address,source.kind,source.sourceRef,source.epoch??null]);
 return Array.isArray(proof.rows)&&proof.rows.length===1&&proof.rows[0]?.allowed===true;
}
