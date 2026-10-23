import {contactLinkedin} from './contact-record';
import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(200),channel=z.enum(['email','whatsapp','linkedin']);
export const mandateExecutionOriginInputSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('agent'),operationId:uuid}).strict(),
 z.object({kind:z.literal('campaign'),attemptId:uuid,enrolmentId:uuid}).strict(),
 z.object({kind:z.literal('draft'),messageId:uuid}).strict(),
 z.object({kind:z.literal('agent_target'),threadId:uuid,contactId:uuid}).strict(),
]);
export type MandateExecutionOriginInput=z.infer<typeof mandateExecutionOriginInputSchema>;
export const mandateExecutionContextSchema=z.object({
 version:z.literal(1),origin:z.object({kind:z.enum(['agent','campaign','draft','agent_target']),sourceId:uuid,enrolmentId:uuid.optional(),conversationId:uuid.optional(),mandateId:uuid}).strict(),
 mode:z.enum(['real','demo']),identityScope:z.object({kind:z.enum(['organization','demo']),id:text}).strict(),
 contact:z.object({sourceId:uuid,sourceRevision:text,sourceFingerprint:hash,effectiveRecipients:z.object({email:z.email().optional(),whatsapp:z.string().regex(/^[+][1-9][0-9]{6,14}$/).optional(),linkedin:z.string().refine(value=>contactLinkedin(value)===value,'Canonical LinkedIn person profile required').optional()}).strict()}).strict(),
 mapping:z.object({id:uuid,digest:hash,demoRunId:uuid}).strict().nullable(),allowedBindings:z.array(z.object({id:uuid,digest:hash,generation:z.number().int().positive(),channel}).strict()).min(1).max(3),policyDigest:hash,manifestDigest:hash,
}).strict().superRefine((c,ctx)=>{if((c.mode==='demo')!==(c.mapping!==null)||c.identityScope.kind!==(c.mode==='demo'?'demo':'organization')||c.mode==='demo'&&c.identityScope.id!==c.origin.mandateId||new Set(c.allowedBindings.map(b=>b.channel)).size!==c.allowedBindings.length||new Set(c.allowedBindings.map(b=>b.id)).size!==c.allowedBindings.length)ctx.addIssue({code:'custom',message:'Inconsistent execution identity'});});
export type MandateExecutionContext=z.infer<typeof mandateExecutionContextSchema>;
export const mandateResearchContextSchema=z.object({version:z.literal(1),mandateId:uuid,mode:z.enum(['real','demo']),identityScope:z.object({kind:z.enum(['organization','demo']),id:text}).strict()}).strict().superRefine((c,ctx)=>{if(c.identityScope.kind!==(c.mode==='demo'?'demo':'organization')||c.mode==='demo'&&c.identityScope.id!==c.mandateId)ctx.addIssue({code:'custom',message:'Inconsistent research identity'});});
export type MandateResearchContext=z.infer<typeof mandateResearchContextSchema>;
