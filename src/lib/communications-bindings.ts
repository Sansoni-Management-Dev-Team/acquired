import 'server-only';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import {assertManagedConnection,assertManagementBinding,type ManagedConnection} from '../../communications/packages/contracts/src/management';
import type {Channel,ConnectionBinding} from '../../communications/packages/contracts/src';
import type {PoolClient} from 'pg';
export interface RecordedApplicationConnection { bindingId:string;binding:ConnectionBinding;recoveryOnly:boolean }
export async function resolveRecordedApplicationConnection(actor:CampaignActor,channel:Channel,source:{enrolmentId?:string;draftId?:string}):Promise<RecordedApplicationConnection|null>{
 if(!!source.enrolmentId===!!source.draftId||!['email','whatsapp','linkedin'].includes(channel)||source.draftId&&channel!=='email')throw Error('Invalid recorded work');
 const id=source.enrolmentId??source.draftId;if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid recorded work');
 return withCampaignDb(actor,async client=>{
  const query=source.enrolmentId?`SELECT b.*,false AS recovery_only FROM public.campaign_channel_bindings w JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id AND b.channel=w.channel WHERE w.enrolment_id=$1 AND w.organization_id=$2 AND w.owner_user_id=$3 AND w.channel=$4`:`SELECT b.*,w.recovery_only FROM public.outreach_draft_bindings w JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id AND b.channel=w.channel WHERE w.message_id=$1 AND w.organization_id=$2 AND w.owner_user_id=$3 AND w.channel=$4`;
  const result=await client.query(query,[id,actor.organizationId,actor.userId,channel]);if(!result.rows.length)return null;if(result.rows.length!==1)throw Error('Ambiguous recorded connection');const r=result.rows[0];
  if(r.authority!=='service'||r.backend!=='unipile')return null;
  const binding:ConnectionBinding={applicationId:r.application_id,tenantId:r.organization_id,ownerId:r.owner_user_id,connectionId:r.service_connection_id,accountId:r.service_account_id,generation:r.generation,channel:r.channel,platform:r.platform,backend:r.backend};
  assertManagementBinding(binding,{applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId});if(binding.channel!==channel||typeof r.recovery_only!=='boolean'||typeof r.id!=='string')throw Error('Invalid recorded connection');
  return {bindingId:r.id,binding,recoveryOnly:r.recovery_only};
 });
}
async function recordConnection(client:PoolClient,b:ConnectionBinding):Promise<string>{
  let {rows:[row]}=await client.query<{id:string;service_account_id:string;platform:string;backend:string;authority:string;channel:string}>(`SELECT id,service_account_id,platform,backend,authority,channel FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND generation=$5`,[b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.generation]);
  if(row&&(row.service_account_id!==b.accountId||row.platform!==b.platform||row.backend!==b.backend||row.authority!=='service'||row.channel!==b.channel))throw Error('Original connection binding changed');
  if(!row){const inserted=await client.query(`INSERT INTO public.communication_bindings(application_id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'service') RETURNING id`,[b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend]);row=inserted.rows[0];}
  if(!row?.id)throw Error('Connection binding unavailable');
  return row.id;
}
/** Register a normal SDK-verified connection independently of choosing a
 * default. Multiple runtimes can coexist without moving existing work or the
 * primary new-work selection. The caller obtains input from the server SDK. */
export async function recordManagedConnection(actor:CampaignActor,input:ManagedConnection,options?:Parameters<typeof withCampaignDb>[2]):Promise<string>{
 const connection=structuredClone(input),scope={applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId};assertManagedConnection(connection,scope);
 if(!['connected','syncing'].includes(connection.status))throw Error('Current connection required');
 const work=(client:PoolClient)=>recordConnection(client,connection.binding);return options?withCampaignDb(actor,work,options):withCampaignDb(actor,work);
}
/** This changes NEW-work selection only; enrolment/attempt/draft bindings are immutable. */
export async function saveManagedDefault(actor:CampaignActor,input:ManagedConnection):Promise<void>{
 const connection=structuredClone(input),scope={applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId};assertManagedConnection(connection,scope);
 if(!connection.isDefault||!['connected','syncing'].includes(connection.status))throw Error('Connection cannot be selected');
 const b=connection.binding;
 await withCampaignDb(actor,async client=>{
  const id=await recordConnection(client,b);
  await client.query(`INSERT INTO public.communication_defaults(organization_id,owner_user_id,channel,binding_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,owner_user_id,channel) DO UPDATE SET binding_id=EXCLUDED.binding_id,updated_at=clock_timestamp()`,[b.tenantId,b.ownerId,b.channel,id]);
 });
}
export async function readManagedDefaults(actor:CampaignActor):Promise<Array<{channel:string;connectionId:string;generation:number;accountId:string}>>{
 return withCampaignDb(actor,async client=>{
  const {rows}=await client.query<{channel:string;connection_id:string;generation:number;account_id:string}>(`SELECT b.channel,b.service_connection_id AS connection_id,b.generation,b.service_account_id AS account_id FROM public.communication_defaults d JOIN public.communication_bindings b ON b.id=d.binding_id AND b.organization_id=d.organization_id AND b.owner_user_id=d.owner_user_id AND b.channel=d.channel WHERE d.organization_id=$1 AND d.owner_user_id=$2 AND b.application_id='acquire' AND b.authority='service' AND b.backend='unipile'`,[actor.organizationId,actor.userId]);
  return rows.map(row=>({channel:row.channel,connectionId:row.connection_id,generation:row.generation,accountId:row.account_id}));
 });
}
