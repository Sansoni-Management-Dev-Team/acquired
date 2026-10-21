import type {PoolClient} from 'pg';
import type {AgentThread} from './agent-store';
import {assertAgentGuidanceSnapshot,type AgentGuidanceSnapshot} from '@/lib/agent-guidance-snapshot';

export type AgentSequenceDraftReviewContext = {
  mandateRevision: string;
  responsibilityId: string;
  responsibilityRevision: number;
  sequenceId: string;
  mode: 'create' | 'update';
  baseRevision: string | null;
  generationGuidance?: AgentGuidanceSnapshot;
};

/** Preserve guidance → supervision/mandate → saved draft validation order.
 * The caller retains feature dispatch, the existing transaction and its locks. */
export async function checkAgentSequenceDraftReviewContext(
  client: PoolClient,
  thread: AgentThread,
  plan: AgentSequenceDraftReviewContext,
) {
  if (plan.generationGuidance) {
    await assertAgentGuidanceSnapshot(client, thread, plan.generationGuidance);
  }
  const responsibility = (await client.query(
    'SELECT * FROM agent_responsibilities WHERE id=$1 AND thread_id=$2',
    [plan.responsibilityId, thread.id],
  )).rows[0];
  const mandate = (await client.query(
    'SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',
    [thread.mandate_id, thread.organization_id],
  )).rows[0];
  if (
    !responsibility ||
    !['ready', 'waiting'].includes(responsibility.state) ||
    responsibility.revision !== plan.responsibilityRevision ||
    responsibility.mandate_revision !== plan.mandateRevision ||
    mandate?.revision !== plan.mandateRevision
  ) {
    throw new Error('Sequence goal or supervision changed');
  }
  const sequence = (await client.query(
    'SELECT mandate_id,xmin::text AS revision FROM campaign_sequences WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',
    [plan.sequenceId, thread.organization_id, thread.owner_user_id],
  )).rows[0];
  if (plan.mode === 'create' ? Boolean(sequence) :
    !sequence || sequence.mandate_id !== thread.mandate_id || sequence.revision !== plan.baseRevision) {
    throw new Error('Sequence draft changed; preserve and review the saved version');
  }
}
