import type {Pool} from 'pg';
import {z} from 'zod';
import type {AgentActor} from '@/db/agent-store';
import {createNativeAgentMandate,NativeMandateCreateError} from './agent-native-create';
import {selectCachedDemoResearch,cachedDemoResearchSelectionSchema} from './cached-demo-research';
import {ensureInitialMandateResearch} from './agent-initial-research';
export const cachedDemoCreateSchema=z.object({requestId:z.string().uuid(),sourceMandateId:z.string().uuid().optional()}).strict();
/** Both UI entry points share the same saved-data-only demo command. Missing
 * or changed cache never falls back to a research/provider call. */
export async function createCachedDemo(pool:Pool,actor:AgentActor,raw:unknown,presentation:'agent'|'workspace'){
 const input=cachedDemoCreateSchema.parse(raw);
 const previous=(await pool.query(`SELECT metadata FROM audit_events WHERE id=$1 AND organization_id=$2 AND actor_id=$3 AND action='agent.mandate_created' AND entity_type='mandate' AND entity_id=$1::text`,[input.requestId,actor.organizationId,actor.userId])).rows[0];
 const saved=previous?.metadata?.initialResearch?.source==='cached'?cachedDemoResearchSelectionSchema.safeParse(previous.metadata.initialResearch.cachedDemo?.selection):undefined;
 if(previous&&!saved?.success)throw new NativeMandateCreateError('This request belongs to an existing mandate. Start a new saved-data demo.',409);
 if(previous&&(previous.metadata.initialResearch.presentation??'agent')!==presentation)throw new NativeMandateCreateError('This demo request belongs to a different workspace flow. Retry its original request.',409);
 const selection=saved?.success?saved.data:await selectCachedDemoResearch(pool,actor,{...(input.sourceMandateId?{sourceMandateId:input.sourceMandateId}:{})});
 if(!selection)throw new NativeMandateCreateError('No saved company and people dataset is available for a demo yet. No live research was started.',409);
 if(input.sourceMandateId&&input.sourceMandateId!==selection.sourceMandateId)throw new NativeMandateCreateError('The selected saved dataset changed. Reload the demo selection.',409);
 const created=await createNativeAgentMandate(pool,actor,{requestId:input.requestId,brief:selection.brief,executionMode:'demo',demoSourceMandateId:selection.sourceMandateId},{startResearch:true,cachedDemo:selection,presentation});
 const initialResearch=await ensureInitialMandateResearch(pool,actor,created.id);
 if(!initialResearch||initialResearch.source!=='cached')throw new NativeMandateCreateError('Could not confirm the saved demo dataset. Retry the same request.',409);
 return {...created,brief:selection.brief,initialResearch};
}
