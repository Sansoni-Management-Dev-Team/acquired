import {z} from 'zod';
import {communicationReplyIdentity} from './communication-reply-identity';
/** Canonical application identities, never provider-specific IDs. A provider
 * reference is resolved by the recorded account adapter after this boundary. */
export const agentPersonChannelRecipientSchema=z.discriminatedUnion('channel',[
 z.object({channel:z.literal('email'),recipient:z.object({kind:z.literal('email'),value:z.string().max(320).refine(v=>communicationReplyIdentity('email',v)===v,'Exact canonical email required')}).strict()}).strict(),
 z.object({channel:z.literal('whatsapp'),recipient:z.object({kind:z.literal('phone'),value:z.string().regex(/^\+[1-9]\d{6,14}$/,'Exact E.164 phone required')}).strict()}).strict(),
 z.object({channel:z.literal('linkedin'),recipient:z.object({kind:z.literal('linkedin_profile'),value:z.string().max(500).refine(v=>v.startsWith('https://www.linkedin.com/in/')&&communicationReplyIdentity('linkedin',v)===v,'Exact canonical LinkedIn profile required')}).strict()}).strict(),
]);
export const agentChannelIdentityProofSchema=z.object({kind:z.literal('recorded_contact'),revision:z.string().regex(/^[1-9]\d{0,9}$/)}).strict();
const context={conversationId:z.string().uuid(),revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),bindingId:z.string().uuid(),identityProof:agentChannelIdentityProofSchema};
export const agentChannelRouteInputSchema=z.discriminatedUnion('channel',[
 agentPersonChannelRecipientSchema.options[0].extend(context),
 agentPersonChannelRecipientSchema.options[1].extend(context),
 agentPersonChannelRecipientSchema.options[2].extend(context),
]);
export type AgentPersonChannelRecipient=z.infer<typeof agentPersonChannelRecipientSchema>;
export type AgentChannelRouteInput=z.infer<typeof agentChannelRouteInputSchema>;
const channel=z.enum(['email','whatsapp','linkedin']);
export const agentChannelPolicyInputSchema=z.object({
 expectedRevision:z.number().int().nonnegative(),channelOrder:z.array(channel).min(1).max(3),delaySeconds:z.number().int().positive().max(366*86400),
 bindings:z.array(z.object({channel,bindingId:z.string().uuid()}).strict()).min(1).max(3),acceleratedSimulation:z.boolean().default(false),
}).strict().superRefine((v,c)=>{
 if(new Set(v.channelOrder).size!==v.channelOrder.length||new Set(v.bindings.map(b=>b.channel)).size!==v.bindings.length||new Set(v.bindings.map(b=>b.bindingId)).size!==v.bindings.length||v.bindings.length!==v.channelOrder.length||v.bindings.some(b=>!v.channelOrder.includes(b.channel)))c.addIssue({code:'custom',message:'One exact account per selected channel and unique channel order required'});
 if(v.acceleratedSimulation?(v.delaySeconds<3||v.delaySeconds>60):v.delaySeconds<86400)c.addIssue({code:'custom',path:['delaySeconds'],message:'Production stagger is at least24hours; accelerated simulation requires3–60seconds and separate server verification'});
});
export type AgentChannelPolicyInput=z.infer<typeof agentChannelPolicyInputSchema>;
export const agentChannelSendingBudgetInputSchema=z.object({bindingId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),windowStart:z.string().datetime({offset:true}),windowEnd:z.string().datetime({offset:true}),cap:z.string().regex(/^(0|[1-9]\d{0,11})$/)}).strict().refine(v=>Date.parse(v.windowEnd)>Date.parse(v.windowStart)&&Date.parse(v.windowEnd)-Date.parse(v.windowStart)<=31*86400000,'A bounded budget window of at most31days is required');
export type AgentChannelSendingBudgetInput=z.infer<typeof agentChannelSendingBudgetInputSchema>;
export function agentChannelOperation(channel:AgentPersonChannelRecipient['channel'],stage:'initial'|'reply'|'follow_up'){
 return z.enum(['email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up']).parse(channel+'.'+stage);
}
