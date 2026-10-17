import {z} from 'zod';
export const agentEventOutcomeSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('complete')}).strict(),
 z.object({kind:z.literal('defer'),wakeAt:z.string().datetime({offset:true}),reason:z.string().trim().min(1).max(2000)}).strict(),
 z.object({kind:z.literal('review'),stopReason:z.enum(['run_step_limit','run_duration_limit']).optional(),message:z.string().trim().min(1).max(2000)}).strict(),
]);
export type AgentEventOutcome=z.infer<typeof agentEventOutcomeSchema>;

export class AgentRunLimitError extends Error{constructor(readonly stopReason:'run_step_limit'|'run_duration_limit'){super(stopReason==='run_step_limit'?'Native run step limit reached':'Native run duration limit reached');}}
