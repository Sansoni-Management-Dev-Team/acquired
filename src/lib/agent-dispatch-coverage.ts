import 'server-only';
import type {Pool} from 'pg';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
/** Scheduling hints only. These rows cannot grant sending permission: the
 * service revalidates the exact scope and final admission retains its held
 * coverage barrier, encrypted intent, membership, source and reply checks. */
export async function readAgentDispatchCoverage(actor:CampaignActor,routes:Array<{bindingId:string;historyObservedAt:string}>,subscriberId:string,now=Date.now(),options?:{pool:Pick<Pool,'connect'>}):Promise<{scopes:Array<{bindingId:string;scopeDigest:string}>;pendingBindingId:string|null}>{
 const fail=():never=>{throw Error('Original dispatch coverage checkpoints unavailable');};
 if(!Number.isFinite(now)||!subscriberId||routes.length<1||routes.length>3||new Set(routes.map(r=>r.bindingId)).size!==routes.length)fail();
 const latestHistory=Math.max(...routes.map(r=>Date.parse(r.historyObservedAt)));
 if(!Number.isFinite(latestHistory)||latestHistory>now)fail();
 const records=await withCampaignDb(actor,async c=>(await c.query(`SELECT m.binding_id,m.scope_digest,m.observed_at,m.coverage_through,p.observed_service_revision::text AS revision,p.updated_at
 FROM public.communication_reply_monitors m JOIN public.communication_consumer_checkpoints p
 ON p.binding_id=m.binding_id AND p.scope_digest=m.scope_digest AND p.organization_id=m.organization_id AND p.owner_user_id=m.owner_user_id
 WHERE m.organization_id=$1 AND m.owner_user_id=$2 AND m.binding_id=ANY($3::uuid[]) AND p.subscriber_id=$4
 AND m.complete AND m.initial_sync_complete AND NOT m.invalidated AND m.coverage_from<='1970-01-01T00:00:00.000Z'::timestamptz`,[actor.organizationId,actor.userId,routes.map(r=>r.bindingId),subscriberId])).rows,{...options,readOnly:true});
 if(records.length!==routes.length)fail();
 const selected=routes.map(route=>{
  const matches=records.filter(r=>r.binding_id===route.bindingId);if(matches.length!==1)fail();const row=matches[0];
  const observed=new Date(row.observed_at).getTime(),through=new Date(row.coverage_through).getTime(),updated=new Date(row.updated_at).getTime();
  if(!/^[a-f0-9]{64}$/.test(row.scope_digest)||!/^(0|[1-9]\d{0,18})$/.test(row.revision)||![observed,through,updated].every(Number.isFinite)||through>observed||observed>now||updated>now||observed<now-255000||through<now-255000)fail();
  return {bindingId:route.bindingId,scopeDigest:row.scope_digest as string,revision:BigInt(row.revision),updated};
 });
 const maximum=selected.reduce((value,row)=>row.revision>value?row.revision:value,BigInt(0));
 return {scopes:selected.map(({bindingId,scopeDigest})=>({bindingId,scopeDigest})),pendingBindingId:selected.find(row=>row.revision!==maximum||row.updated<latestHistory)?.bindingId??null};
}
