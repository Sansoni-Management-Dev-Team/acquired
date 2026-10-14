import 'server-only';
import type {requireDb} from '@/db/client';
import {sql} from 'drizzle-orm';
function rows(value:unknown):Record<string,unknown>[]{if(!value||typeof value!=='object'||!('rows'in value)||!Array.isArray(value.rows))throw Error('Original draft binding unavailable');return value.rows;}
/** Called inside the gated approval transaction. Approval stores a choice and never sends. */
export async function snapshotApprovedDraftBinding(tx:ReturnType<typeof requireDb>,actor:{organizationId:string;userId:string},draft:{id:string;providerMessageId:string|null}):Promise<void>{
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')return;
 if(draft.providerMessageId)throw Error('Historical provider draft requires review');
 const original=rows(await tx.execute(sql`SELECT w.owner_user_id,w.recovery_only,b.backend,b.authority FROM public.outreach_draft_bindings w JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id WHERE w.message_id=${draft.id} AND w.organization_id=${actor.organizationId}`));
 if(original.length){const r=original[0];if(original.length!==1||r.owner_user_id!==actor.userId||r.recovery_only!==false||r.backend!=='unipile'||r.authority!=='service')throw Error('Original draft binding unavailable');return;}
 const defaults=rows(await tx.execute(sql`SELECT d.binding_id FROM public.communication_defaults d JOIN public.communication_bindings b ON b.id=d.binding_id AND b.organization_id=d.organization_id AND b.owner_user_id=d.owner_user_id AND b.channel=d.channel WHERE d.organization_id=${actor.organizationId} AND d.owner_user_id=${actor.userId} AND d.channel='email' AND b.application_id='acquire' AND b.backend='unipile' AND b.authority='service'`));
 if(defaults.length!==1||typeof defaults[0].binding_id!=='string')throw Error('Select an email connection before approval');
 const inserted=rows(await tx.execute(sql`INSERT INTO public.outreach_draft_bindings(message_id,organization_id,owner_user_id,channel,binding_id,operation_key_prefix,recovery_only) VALUES(${draft.id},${actor.organizationId},${actor.userId},'email',${defaults[0].binding_id},${'acquire:draft:'+draft.id},false) RETURNING message_id`));
 if(inserted.length!==1||inserted[0].message_id!==draft.id)throw Error('Original draft binding unavailable');
}
