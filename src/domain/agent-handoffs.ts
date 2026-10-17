import {z} from 'zod';
import {nativeReminderSchema} from './agent-execution';
const uuid=z.string().uuid();
const base={taskId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/)};
const evidence=z.object({note:z.string().trim().min(5).max(2000),externalReference:z.string().trim().min(3).max(1000),occurredAt:z.string().datetime({offset:true})}).strict();
export const agentHandoffActionSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('acknowledge')}).strict(),
 z.object({...base,action:z.literal('remind'),reminder:nativeReminderSchema}).strict(),
 z.object({...base,action:z.literal('reassign'),assigneeUserId:z.string().trim().min(1).max(200)}).strict(),
 z.object({...base,action:z.literal('dismiss'),reason:z.string().trim().min(5).max(2000)}).strict(),
 z.object({...base,action:z.literal('link_sent'),evidence}).strict(),
 z.object({...base,action:z.literal('meeting_confirmed'),evidence}).strict(),
]);
export type AgentHandoffAction=z.infer<typeof agentHandoffActionSchema>;
export type AgentHandoffTask={id:string;revision:number;state:'pending'|'acknowledged'|'link_sent'|'meeting_confirmed'|'dismissed';assignee_user_id:string;owner_user_id:string;context_revision:string;context:{reason?:string;summary?:string;recipient?:string;contactId?:string};human_evidence:unknown;can_reassign:boolean};
export type AgentHandoffInbox={observedAt?:string;tasks:AgentHandoffTask[];members:{id:string;name:string}[]};
