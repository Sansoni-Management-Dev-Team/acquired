import {z} from 'zod';
import {AgentOwnershipStore} from './agent-ownership-store';
import {agentRecordDigest as digest} from './agent-store';
import {agentHandoffActionSchema,type AgentHandoffInbox} from '@/domain/agent-handoffs';
import type {AgentExecutionFence} from './agent-execution-store';
import {nativeReminderSchema,nativeControlReceiptSchema} from '@/domain/agent-execution';
/** Assigned task projection deliberately does not reveal the owner's thread or history. */
export class AgentHandoffStore extends AgentOwnershipStore{
 async handoffInbox(mandateId:string):Promise<AgentHandoffInbox>{
  return this.nativeTransaction(async c=>(await c.query('SELECT agent_handoff_inbox($1::uuid) AS inbox',[z.string().uuid().parse(mandateId)])).rows[0].inbox);
 }
 async controlHandoff(mandateId:string,requestKey:string,raw:unknown){
  const input=agentHandoffActionSchema.parse(raw),key=z.string().uuid().parse(requestKey),id=z.string().uuid().parse(mandateId);
  if('evidence' in input&&Date.parse(input.evidence.occurredAt)>Date.now()+60000)throw new Error('Evidence cannot describe a future event');
  return this.nativeTransaction(async c=>nativeControlReceiptSchema.parse((await c.query('SELECT agent_control_handoff($1::uuid,$2::uuid,$3::jsonb,$4) AS receipt',[id,key,JSON.stringify(input),digest(input)])).rows[0].receipt));
 }
 async fireHandoffReminder(threadId:string,requestKey:string,raw:unknown,authority:AgentExecutionFence){
  const input=z.object({taskId:z.string().uuid(),revision:z.number().int().positive(),assigneeUserId:z.string().min(1).max(200),reminder:nativeReminderSchema}).strict().parse(raw);
  return this.command(threadId,requestKey,'human.handoff_reminder',input,async(c,t,commandId)=>{
   const event=(await c.query("SELECT payload,available_at FROM agent_events WHERE id=$1 AND thread_id=$2 AND kind='human.handoff_reminder' AND payload=$3::jsonb",[authority.eventId,t.id,JSON.stringify(input)])).rows[0];
   if(!event||event.available_at.getTime()>Date.now())throw new Error('Internal reminder is not due or its event changed');
   const task=(await c.query('SELECT * FROM agent_handoffs WHERE id=$1 AND thread_id=$2 FOR UPDATE',[input.taskId,t.id])).rows[0];
   if(!task||task.revision!==input.revision||task.assignee_user_id!==input.assigneeUserId||!['pending','acknowledged','link_sent'].includes(task.state))return {id:input.taskId,revision:input.revision,status:'superseded'};
   const member=(await c.query('SELECT agent_handoff_assignee_current($1::uuid) AS current',[task.id])).rows[0]?.current===true;
   if(!member)return {id:input.taskId,revision:input.revision,status:'assignee_unavailable'};
   await this.controlNotice(c,t,'task-reminder:'+commandId,'Human handoff reminder: '+input.reminder.reason+' Automation remains paused. No message was sent to the lead.',{taskId:task.id,assigneeUserId:input.assigneeUserId,taskRevision:task.revision});
   return {id:task.id as string,revision:task.revision as number,status:'notified'};
  },authority);
 }
}
