import {agentStore,durableAgentEnabled,savedAgentConversation,answerSavedAgentConversation,AgentTurnError} from '@/lib/agent-runtime';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { acquireCommands } from '@/lib/acquire-commands';
import { AcquireCommandError } from '@/domain/acquire-commands';
import { guardBrowserMutation } from '@/lib/browser-mutation';
import { answerAgentQuestion } from '@/lib/agent-conversation';

export const maxDuration = 60;

const noStore = { 'Cache-Control': 'private, no-store' };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: noStore });
type Context = { params: Promise<{ id: string }> };
// Only bounded user/assistant text becomes model context. Client state, tools,
// system messages and forwarded props never select authority or tenant.
const runSchema = z.object({
  threadId: z.string().min(1).max(200), runId: z.string().min(1).max(200),
  messages: z.array(z.object({ id: z.string().max(200), role: z.string(), content: z.unknown().optional() })).min(1).max(100),
});
async function snapshot(request: Request, context: Context) {
  if (process.env.AGENT_MODE_EXPLORATION_ENABLED !== 'true') return error('Agent exploration is unavailable.', 404);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return error('Sign in and select an organisation.', 401);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return error('Invalid mandate.', 400);
  const org = session.session.activeOrganizationId;
  try {
    const result = await acquireCommands.execute({ organizationId: org, userId: session.user.id }, { name: 'research.status', input: { mandateId: id } });
    if (result.name !== 'research.status') throw new Error('Unexpected command result');
    return { data: result.value, actor: { organizationId: org, userId: session.user.id } };
  } catch (cause) {
    if (cause instanceof AcquireCommandError) return error(cause.message, cause.status);
    throw cause;
  }
}
export async function GET(request: Request, context: Context) {
  try {
    const data = await snapshot(request, context);
    if(data instanceof Response)return data;
    const conversation=durableAgentEnabled()?await savedAgentConversation(agentStore(data.actor),data.data.mandate.id):undefined;
    return Response.json({...data.data,...(conversation?{conversation}:{})}, {headers:noStore});
  } catch { return error('Could not read agent status. Please try again.', 503); }
}
export async function POST(request: Request, context: Context) {
  const denied = guardBrowserMutation(request);
  if (denied) return denied;
  if (process.env.AGENT_MODE_EXPLORATION_ENABLED !== 'true') return error('Agent exploration is unavailable.', 404);
  // Bound before parsing; never reflect arbitrary transcript state to the client.
  const body = await request.text();
  if (body.length > 64_000) return error('Conversation is too large. Start a new conversation.', 413);
  let json: unknown;
  try { json = JSON.parse(body); } catch { return error('Invalid agent request.', 400); }
  const parsed = runSchema.safeParse(json);
  if (!parsed.success) return error('Invalid agent request.', 400);
  const last = parsed.data.messages.at(-1)!;
  if (last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim() || last.content.length > 5000)
    return error('Send a text question of up to 5,000 characters.', 400);
  try {
    const data = await snapshot(request, context);
    if (data instanceof Response) return data;
    const { threadId, runId } = parsed.data;
    const answer=durableAgentEnabled()
      ? await answerSavedAgentConversation(agentStore(data.actor),data.data.mandate.id,parsed.data.runId,last.content as string,data.data)
      : {messageId:crypto.randomUUID(),text:await answerAgentQuestion(parsed.data.messages,data.data)};
    const messageId = answer.messageId;
    const events = [
      { type: 'RUN_STARTED', threadId, runId },
      { type: 'STATE_SNAPSHOT', snapshot: data.data },
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: answer.text },
      { type: 'TEXT_MESSAGE_END', messageId },
      { type: 'RUN_FINISHED', threadId, runId },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { ...noStore, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' },
    });
  } catch (cause) { if(cause instanceof AgentTurnError)return error(cause.message,cause.status); return error('The research assistant is temporarily unavailable. Please try again. No action was taken.', 503); }
}

/** Cancel saved read-only model work. This does not roll back committed work. */
export async function DELETE(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!durableAgentEnabled())return error('Saved conversations are unavailable.',404);
 const body=await request.text();if(body.length>1000)return error('Invalid stop request.',400);
 let value:unknown;try{value=JSON.parse(body);}catch{return error('Invalid stop request.',400);}
 const parsed=z.object({runId:z.string().trim().min(1).max(200)}).strict().safeParse(value);
 if(!parsed.success)return error('Invalid stop request.',400);
 try{
  const data=await snapshot(request,context);if(data instanceof Response)return data;
  const store=agentStore(data.actor),thread=await store.findThread(data.data.mandate.id);
  if(!thread)return error('Turn has not started. Refresh before retrying.',409);
  const state=await store.cancelConversationTurn(thread.id,parsed.data.runId);
  if(state==='missing')return error('Turn has not started. Refresh before retrying.',409);
  return Response.json({state},{headers:noStore});
 }catch{return error('Could not stop this turn. Refresh to check its saved state.',503);}
}
