import type { PoolClient } from 'pg';
import { rows, type CampaignActor } from '@/db/campaign-client';

/** The creation receipt survives pauses and reloads. Opening agent chat alone
 * does not transfer a manually created mandate to the agent. Workspace demos
 * explicitly record their separate presentation at creation. No agent-table
 * grants or provider calls are needed for this projection. */
export async function mandateOutreachOwner(client: PoolClient, actor: CampaignActor, mandateId: string): Promise<'agent' | 'sequences'> {
  const [result] = await rows<{ agent_managed: boolean }>(client, `/* mandate-outreach-owner */ SELECT EXISTS (
    SELECT 1 FROM mandates m JOIN audit_events a
      ON a.id=m.id AND a.entity_id=m.id::text AND a.entity_type='mandate'
      AND a.organization_id=m.organization_id AND a.actor_id=m.created_by
      AND a.action='agent.mandate_created'
    WHERE m.id=$1 AND m.organization_id=$2
      AND (coalesce(a.metadata->'initialResearch'->>'source','live')<>'cached'
        OR coalesce(a.metadata->'initialResearch'->>'presentation','agent')<>'workspace')
  ) AS agent_managed`, [mandateId, actor.organizationId]);
  return result?.agent_managed === true ? 'agent' : 'sequences';
}
