import {z} from 'zod';
const id=z.string().trim().min(1).max(300);
export function containsAgentOutboundLink(text:string){return /(?:https?:\/\/|www\.|calendly\b|\bcal\.com\b|(?:^|[\s(])(?:[a-z\d-]+\.)+[a-z]{2,}\/\S+)/iu.test(text);}
export function explicitAgentOptOut(text:string){return /\b(?:unsubscribe|do not (?:contact|email|message)|don['’]t (?:contact|email|message)|stop (?:contacting|emailing|messaging)|remove me|no further (?:emails|messages|contact))\b/iu.test(text);}
const nativeDraftFields={
 intent:z.enum(['initial','no_reply','interest','question','objection','wrong_person','not_now']),
 body:z.string().trim().min(1).max(6000).refine(text=>!containsAgentOutboundLink(text),'Links require a human handoff'),
 rationale:z.string().trim().min(1).max(2000),sourceIds:z.array(id).max(20),
};
export const nativeEmailDraftSchema=z.object({
 ...nativeDraftFields,kind:z.enum(['initial_email','reply_email','follow_up_email']),routeId:z.string().uuid().optional(),
 subject:z.string().trim().min(1).max(300).refine(text=>!containsAgentOutboundLink(text),'Links require a human handoff'),
}).strict().refine(value=>value.kind!=='initial_email'||value.intent==='initial','Initial email intent required');
export type NativeEmailDraft=z.infer<typeof nativeEmailDraftSchema>;
export const nativeSocialDraftSchema=z.object({
 ...nativeDraftFields,kind:z.enum(['initial_whatsapp','reply_whatsapp','follow_up_whatsapp','initial_linkedin','reply_linkedin','follow_up_linkedin']),
 routeId:z.string().uuid(),subject:z.literal(''),
}).strict().refine(value=>!value.kind.startsWith('initial_')||value.intent==='initial','Initial message intent required');
export const nativeLinkedinInvitationDraftSchema=z.object({
 ...nativeDraftFields,kind:z.literal('invitation_linkedin'),intent:z.literal('initial'),routeId:z.string().uuid(),subject:z.literal(''),
 body:z.string().trim().min(1).max(300).refine(text=>!containsAgentOutboundLink(text),'Links require a human handoff'),
}).strict();
export const nativeOutboundDraftSchema=z.union([nativeEmailDraftSchema,nativeSocialDraftSchema,nativeLinkedinInvitationDraftSchema]);
export type NativeOutboundDraft=z.infer<typeof nativeOutboundDraftSchema>;
export const nativeHistoryMessageSchema=z.object({id,direction:z.enum(['inbound','outbound']),text:z.string().max(6000),subject:z.string().max(300).optional(),at:z.string().datetime({offset:true}),routeId:z.string().uuid().optional(),channel:z.enum(['email','whatsapp','linkedin']).optional(),providerMessageId:id.optional(),providerConversationId:id.optional(),bindingDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export const nativeHistorySchema=z.object({
 source:z.enum(['local_fixture','communications']),observedAt:z.string().datetime({offset:true}),complete:z.boolean(),messages:z.array(nativeHistoryMessageSchema).max(200),deliveryFailures:z.array(z.object({id,at:z.string().datetime({offset:true})}).strict()).min(1).max(200).optional(),
}).strict().refine(value=>new Set(value.messages.map(item=>item.id)).size===value.messages.length,'Duplicate history message').refine(value=>new TextEncoder().encode(JSON.stringify(value.messages)).length<=1400000,'History exceeds the bounded context limit');
export type NativeHistory=z.infer<typeof nativeHistorySchema>;
export const nativeReminderSchema=z.object({wakeAt:z.string().datetime({offset:true}),timeZone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en-AU',{timeZone:value}).format(0);return true;}catch{return false;}},'Valid IANA timezone required'),reason:z.string().trim().min(1).max(2000)}).strict();
export const nativeControlReceiptSchema=z.object({id:z.string().uuid(),revision:z.number().int().positive(),status:z.string().min(1).max(100),epoch:z.number().int().positive().optional(),reviewBatchId:z.string().uuid().optional()}).strict();
export type NativeControlReceipt=z.infer<typeof nativeControlReceiptSchema>;
