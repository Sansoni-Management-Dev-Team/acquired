import {businessNow,type BusinessClock} from '../../communications/packages/core/src/business-clock';
import type {Pool} from 'pg';
import type {CommunicationsClient} from '../../communications/packages/sdk/src';
import type {createAcquireCommunicationsRuntime} from './communications-runtime';
import 'server-only';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import type {ReplyContact} from './campaign-reply-monitor';
import {replyIdentity,type ReplyChannel} from '@/domain/campaign-replies';
import {communicationReplyIdentity} from '@/domain/communication-reply-identity';
import {contactPhone,contactLinkedin} from '@/domain/contact-record';
import {configuredAcquireCommunicationsForBinding} from './communications-configuration';
import {actorCommunicationsClient} from './communications-client';
import {saveReplyIdentity} from './campaign-reply-store';
import {ReplyCheckReview} from './campaign-reply-status';
import {assertManagementBinding} from '../../communications/packages/contracts/src/management';
import type {ConnectionBinding} from '../../communications/packages/contracts/src';
export type ConfiguredMonitorPorts={businessClock?:BusinessClock;applicationPool?:Pick<Pool,'connect'>;client?:Pick<CommunicationsClient,'connectionStatus'>;hostForBinding?:(binding:ConnectionBinding)=>Promise<Pick<ReturnType<typeof createAcquireCommunicationsRuntime>,'refreshAndConsume'>>};
const dbOptions=(ports?:ConfiguredMonitorPorts)=>ports?.applicationPool?{pool:ports.applicationPool}:undefined;
async function saveIdentity(actor:CampaignActor,input:Parameters<typeof saveReplyIdentity>[1],ports?:ConfiguredMonitorPorts){
 if(ports?.applicationPool)return saveReplyIdentity(actor,input,{pool:ports.applicationPool});
 return saveReplyIdentity(actor,input);
}
type RecordedRow=Record<string,unknown>;
function recorded(actor:CampaignActor,r:RecordedRow,clock?:BusinessClock){
 if(r.authority!=='service'||r.backend!=='unipile')throw new ReplyCheckReview('account_changed',r.channel as ReplyChannel);
 const b:ConnectionBinding={applicationId:r.application_id as string,tenantId:r.organization_id as string,ownerId:r.owner_user_id as string,connectionId:r.service_connection_id as string,accountId:r.service_account_id as string,generation:r.generation as number,channel:r.channel as ReplyChannel,platform:r.platform as ConnectionBinding['platform'],backend:'unipile'};
 assertManagementBinding(b,{applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId});
 const since=r.required_since instanceof Date?r.required_since.toISOString():typeof r.required_since==='string'?new Date(r.required_since).toISOString():null;
 if(!since||Date.parse(since)>businessNow(clock))throw new ReplyCheckReview('protocol',b.channel);
 return {binding:b,since};
}
async function refresh(actor:CampaignActor,rows:RecordedRow[],ports?:ConfiguredMonitorPorts){
 if(rows.length>100)throw new ReplyCheckReview('protocol');
 const scopes=new Map<string,ReturnType<typeof recorded>>();for(const row of rows){const r=recorded(actor,row,ports?.businessClock),key=JSON.stringify(r.binding),previous=scopes.get(key);if(!previous||r.since<previous.since)scopes.set(key,r);}
 const client=ports?.client??await actorCommunicationsClient(actor);
 for(const {binding,since} of scopes.values()){await client.connectionStatus(binding);const host=ports?.hostForBinding?await ports.hostForBinding(binding):(await configuredAcquireCommunicationsForBinding(actor,binding)).host;await host.refreshAndConsume({binding,scope:'account',since,cursor:null,refresh:true});}
 return {complete:scopes.size>0,...(scopes.size?{}:{skipped:true})};
}
export async function refreshConfiguredDraft(actor:CampaignActor,id:string,ports?:ConfiguredMonitorPorts):Promise<void>{
 const rows=await withCampaignDb(actor,async c=>(await c.query(`SELECT b.*,b.id AS binding_id,m.approved_at AS required_since,e.contact_id,c.personal_data FROM public.outreach_draft_bindings w JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id JOIN public.messages m ON m.id=w.message_id AND m.organization_id=w.organization_id JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id JOIN public.contacts c ON c.id=e.contact_id AND c.organization_id=m.organization_id WHERE w.message_id=$1 AND w.organization_id=$2 AND w.owner_user_id=$3 AND NOT w.recovery_only AND m.state='approved'`,[id,actor.organizationId,actor.userId])).rows,dbOptions(ports));
 if(rows.length!==1)throw new ReplyCheckReview('account_changed','email');const row=rows[0],proof=recorded(actor,row,ports?.businessClock),data=row.personal_data as Record<string,unknown>|undefined,identity=typeof data?.email==='string'?replyIdentity('email',data.email):null;
 if(typeof row.contact_id!=='string'||!identity)throw new ReplyCheckReview('protocol','email');
 await saveIdentity(actor,{contactId:row.contact_id,email:identity,channel:'email',identity,sourceIdentity:identity,since:new Date(proof.since),authority:'service'},ports);await refresh(actor,rows,ports);
}
export async function refreshConfiguredContact(actor:CampaignActor,contact:ReplyContact,ports?:ConfiguredMonitorPorts):Promise<{complete:boolean;skipped?:boolean}>{
 const rows=await withCampaignDb(actor,async c=>(await c.query(`SELECT b.*,b.id AS binding_id,e.started_at AS required_since FROM public.campaign_channel_bindings w JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id JOIN public.campaign_enrolments e ON e.id=w.enrolment_id AND e.organization_id=w.organization_id AND e.owner_user_id=w.owner_user_id WHERE e.contact_id=$1 AND e.organization_id=$2 AND e.owner_user_id=$3 AND e.state IN('active','paused','needs_review') LIMIT 101`,[contact.id,actor.organizationId,actor.userId])).rows,dbOptions(ports));
 if(!rows.length)throw new ReplyCheckReview('account_changed');
 for(const row of rows)recorded(actor,row,ports?.businessClock);
 const channels=new Set(rows.map(r=>r.channel as ReplyChannel));
 for(const channel of channels){const raw=channel==='email'?contact.email?.trim().toLowerCase():channel==='whatsapp'?contactPhone(contact.data.phone):contactLinkedin(contact.data.linkedinUrl??contact.data.linkedin??contact.data.linkedin_url);const identity=raw?(channel==='linkedin'?communicationReplyIdentity(channel,raw):replyIdentity(channel,raw)):null;if(!identity)throw new ReplyCheckReview('protocol',channel);await saveIdentity(actor,{contactId:contact.id,email:contact.email,channel,identity,sourceIdentity:raw!,since:contact.since,authority:'service'},ports);}
 return refresh(actor,rows,ports);
}
export async function scanConfiguredChannel(actor:CampaignActor,channel:ReplyChannel,options:{maxPages?:number;refresh?:boolean}={},ports?:ConfiguredMonitorPorts):Promise<{complete:boolean;skipped?:boolean}>{
 void options;
 const rows=await withCampaignDb(actor,async c=>(await c.query(`SELECT b.*,b.id AS binding_id,e.started_at AS required_since FROM public.campaign_channel_bindings w JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=w.organization_id AND b.owner_user_id=w.owner_user_id JOIN public.campaign_enrolments e ON e.id=w.enrolment_id AND e.organization_id=w.organization_id AND e.owner_user_id=w.owner_user_id WHERE w.organization_id=$1 AND w.owner_user_id=$2 AND w.channel=$3 AND e.state IN('active','paused','needs_review') LIMIT 101`,[actor.organizationId,actor.userId,channel])).rows,dbOptions(ports));
 if(!rows.length)return {complete:false,skipped:true};return refresh(actor,rows,ports);
}
