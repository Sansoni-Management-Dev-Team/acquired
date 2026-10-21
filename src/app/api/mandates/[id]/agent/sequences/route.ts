import {z} from 'zod';
import {campaignDraftDefinition} from '@/domain/campaign';
import {previewAgentSequenceDraft} from '@/lib/agent-sequence-tools';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled} from '@/lib/agent-runtime';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('proposePublication'),requestKey:z.string().uuid(),sequenceId:z.string().uuid(),expectedRevision:z.string().regex(/^\d{1,30}$/)}).strict(),
 z.object({action:z.literal('proposeEnrolment'),requestKey:z.string().uuid(),sequenceId:z.string().uuid(),versionId:z.string().uuid(),bindingId:z.string().uuid(),contactIds:z.array(z.string().uuid()).min(1).max(5)}).strict(),
 z.object({action:z.literal('reconcilePublication'),requestKey:z.string().uuid(),operationId:z.string().uuid()}).strict(),
 z.object({action:z.literal('preview'),definition:campaignDraftDefinition}).strict(),
 z.object({action:z.literal('propose'),requestKey:z.string().uuid(),name:z.string().trim().min(1).max(100),definition:campaignDraftDefinition,sequenceId:z.string().uuid().optional(),expectedRevision:z.string().regex(/^\d{1,30}$/).optional()}).strict(),
]);
export async function GET(request:Request,context:Context){try{const data=await scope(request,context);if(data instanceof Response)return data;return Response.json({drafts:data.thread?await data.store.sequenceDrafts(data.thread.id):[],reviewOptions:data.thread&&nativeAgentEnabled()?await data.store.sequenceReviewOptions(data.thread.id):{versions:[],work:[]},capabilities:{preview:true,proposeDraft:nativeAgentEnabled(),proposePublication:nativeAgentEnabled(),proposeEnrolment:nativeAgentEnabled(),publish:false,enrol:false}},{headers});}catch(cause){return failure(cause);}}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 const text=await request.text();if(text.length>60000)return error('Draft request is too large; use the main builder.',413);let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid sequence request.',400);}const parsed=schema.safeParse(raw);if(!parsed.success)return error('Invalid sequence request.',400);if(parsed.data.action!=='preview'&&!nativeAgentEnabled())return error('Native agent execution is unavailable.',404);
 try{const data=await scope(request,context);if(data instanceof Response)return data;if(parsed.data.action==='preview')return Response.json(previewAgentSequenceDraft(parsed.data.definition),{headers});if(!data.thread)return error('Start supervision before proposing a sequence draft.',404);const {action,requestKey,...input}=parsed.data;const result=action==='proposePublication'?await data.store.proposeSequencePublication(data.thread.id,requestKey,input):action==='proposeEnrolment'?await data.store.proposeSequenceEnrolment(data.thread.id,requestKey,input):action==='reconcilePublication'?await data.store.queuePublicationReconciliation(data.thread.id,requestKey,(input as {operationId:string}).operationId):await data.store.proposeSequenceDraft(data.thread.id,requestKey,input);return Response.json({result},{headers});}catch(cause){return failure(cause);}
}
