import {z} from 'zod';
export const manualFeedbackInputSchema=z.object({
 source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('target_review'),targetId:z.string().uuid(),revision:z.number().int().positive()}).strict(),
  z.object({kind:z.literal('sequence_draft'),sequenceId:z.string().uuid(),revision:z.string().regex(/^[0-9]{1,10}$/)}).strict(),
 ]),
 reason:z.string().trim().min(5).max(2000),preference:z.string().trim().min(5).max(2000),category:z.enum(['qualification','tone','buyer_context','follow_up']),
}).strict();
export type AgentManualFeedbackInput=z.infer<typeof manualFeedbackInputSchema>;
