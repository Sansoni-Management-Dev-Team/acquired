import{z}from'zod';
import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
const text=z.string().min(1).max(200),uuid=z.string().uuid();
const facts=z.object({role:text.optional(),sector:text.optional(),region:text.optional(),headcount:text.optional(),companySize:text.optional(),establishedYear:text.optional(),description:z.string().min(1).max(2000).optional()}).strict();
const projection=z.object({scope:z.object({runId:text,organizationId:text,userId:text}).strict(),personId:uuid,companyId:uuid.nullable(),mandateId:uuid,mappingId:uuid,sourceRevision:text,sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),name:text,company:text,facts,aliases:z.object({email:z.string().max(320),phone:z.string().max(32),linkedin:z.string().max(500),providerId:text}).strict()}).strict();
const query=z.object({accountId:text,channel:z.enum(['email','whatsapp','linkedin']),kind:z.enum(['email','phone','linkedin_profile','provider_id']),value:z.string().min(1).max(300),operationKey:z.string().min(1).max(255).optional()}).strict();
export type HostedRecipientQuery=z.infer<typeof query>;
export type HostedRecipientProjection=z.infer<typeof projection>;
export function parseHostedRecipientRequest(raw:unknown,descriptor:HostedDemoCommunicationsDescriptor){
 const scope={runId:descriptor.runId,organizationId:descriptor.actor.tenantId,userId:descriptor.actor.ownerId};
 const request=z.object({version:z.literal(1),kind:z.literal('recipient.resolve'),scope:z.object({runId:text,organizationId:text,userId:text}).strict(),query}).strict().parse(raw);
 if(Object.entries(scope).some(([key,value])=>request.scope[key as keyof typeof scope]!==value)||request.query.accountId!==`sim-${scope.runId}-${request.query.channel}`||!descriptor.bindings.some(b=>b.channel===request.query.channel)||request.query.channel==='email'&&request.query.kind!=='email'||request.query.channel==='whatsapp'&&request.query.kind!=='phone'||request.query.channel==='linkedin'&&!['linkedin_profile','provider_id'].includes(request.query.kind))throw Error('Hosted recipient unavailable');
 return request.query;
}
/** The server loader supplies the original current mapping proof. The outgoing
 * projection has a fixed whitelist, never a source row, profile or provider ID. */
export function parseHostedRecipientProjection(raw:unknown,descriptor:HostedDemoCommunicationsDescriptor,request:HostedRecipientQuery){
 const value=projection.parse(raw),scope={runId:descriptor.runId,organizationId:descriptor.actor.tenantId,userId:descriptor.actor.ownerId};
 if(Object.entries(scope).some(([key,expected])=>value.scope[key as keyof typeof scope]!==expected))throw Error('Hosted recipient unavailable');
 const escaped=descriptor.runId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),aliases=value.aliases;
 if(!new RegExp(`^lead-\\d{3}@${escaped}\\.leads\\.acquire\\.test$`).test(aliases.email)||!/^\+999\d{12}$/.test(aliases.phone)||!new RegExp(`^https://www\\.linkedin\\.com/in/sim-${escaped}-lead-\\d{3}$`).test(aliases.linkedin)||!new RegExp(`^ACo_sim_${escaped}_lead-\\d{3}$`).test(aliases.providerId))throw Error('Hosted recipient unavailable');
 let received=request.value;
 const expected=request.channel==='email'?aliases.email:request.channel==='whatsapp'?aliases.phone:request.kind==='provider_id'||received.startsWith('ACo_sim_')?aliases.providerId:aliases.linkedin;
 if(request.channel==='email')received=received.toLowerCase();
 if(request.channel==='whatsapp'){received=received.replace(/@s\.whatsapp\.net$/,'');if(/^999\d{12}$/.test(received))received='+'+received;}
 if(request.channel==='linkedin'&&received.startsWith('sim-'))received='https://www.linkedin.com/in/'+received;
 if(received!==expected||Object.values(value.facts).some(v=>/@|\+\d{7,}|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)))throw Error('Hosted recipient unavailable');
 return value;
}
