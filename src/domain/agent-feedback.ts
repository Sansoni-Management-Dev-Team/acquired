import {z} from 'zod';
export const agentFeedbackOperationNames=['research.start','research.people','target.select','email.initial','email.reply','email.follow_up','email.manual_link','sequence.prepare','sequence.publish','sequence.enrol'] as const;
export const agentFeedbackSchema=z.object({
 source:z.object({kind:z.enum(['operation','handoff']),id:z.string().uuid(),revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().refine(value=>value.kind!=='handoff'||Boolean(value.contextRevision),'Current handoff context required'),
 reason:z.string().trim().min(5).max(2000),
 preference:z.string().trim().min(5).max(2000),
 category:z.enum(['qualification','tone','buyer_context','follow_up']),
}).strict();
export type AgentFeedbackInput=z.infer<typeof agentFeedbackSchema>;
