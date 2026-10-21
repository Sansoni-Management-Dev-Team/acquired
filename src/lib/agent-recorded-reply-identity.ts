import{installAgentBusinessTimeSql,type AgentBusinessDbOptions}from'./agent-business-time-sql';
import 'server-only';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import {saveReplyIdentity} from './campaign-reply-store';
export type NativeRecordedReplyIdentity={threadId:string;conversationId:string;routeId?:string;bindingId:string;identity:Parameters<typeof saveReplyIdentity>[1]};
/** Registers organization identities through the unchanged writer. A scoped
 * demo route is already its immutable identity registry: no global alias write. */
export async function registerNativeReplyIdentity(actor:CampaignActor,input:NativeRecordedReplyIdentity,options?:AgentBusinessDbOptions){
 const identity=input.identity;
 const scope=await withCampaignDb(actor,async c=>{if(options?.businessTime)await installAgentBusinessTimeSql(c,options.businessTime,actor);const rows=(await c.query('SELECT public.agent_recorded_reply_identity_registration($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::uuid) AS scope',[input.threadId,input.conversationId,input.routeId??null,input.bindingId,identity.channel,identity.identity,identity.contactId])).rows;if(rows.length!==1||!['organization','demo'].includes(rows[0].scope))throw Error('Exact recorded person identity required');return rows[0].scope;},options?.pool?{pool:options.pool}:undefined);
 if(scope==='organization')await (options?.pool?saveReplyIdentity(actor,identity,{pool:options.pool}):saveReplyIdentity(actor,identity));
}
