import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { AgentEvent } from './agent-store';
import { reviewItemSchema } from '@/domain/agent-authority';

export const dispatchRunLimits = {
  version: 2,
  kind: 'reviewed_dispatch',
  maxToolSteps: 32,
  maxDurationMs: 90000,
  operationLeaseMs: 60000,
  eventLeaseMs: 120000,
} as const;
export const legacyRunLimits = { version: 1, maxToolSteps: 32, maxDurationMs: 45000 } as const;
const names = new Set([
  'email.initial', 'email.reply', 'email.follow_up',
  'whatsapp.initial', 'whatsapp.reply', 'whatsapp.follow_up',
  'linkedin.initial', 'linkedin.reply', 'linkedin.follow_up', 'linkedin.invitation',
]);
const manifestSchema = z.array(reviewItemSchema).min(1).max(50)
  .refine(items => new Set(items.map(item => item.operationId)).size === items.length);

/** Read only persisted, owned approval. Payload budget flags are never inputs.
 * Partial/legacy event projections cannot qualify for the extended policy. */
export async function approvedDispatchEvent(
  client: Pick<PoolClient, 'query'>,
  event: AgentEvent & { organization_id?: string; owner_user_id?: string },
) {
  if (event.kind !== 'review.approved' || !event.organization_id || !event.owner_user_id) return false;
  const parsed = z.object({ reviewBatchId: z.string().uuid() }).safeParse(event.payload);
  if (!parsed.success) return false;
  const batch = (await client.query(
    `SELECT manifest FROM agent_review_batches
     WHERE id=$1 AND thread_id=$2 AND organization_id=$3 AND mandate_id=$4
       AND owner_user_id=$5 AND state='approved'`,
    [parsed.data.reviewBatchId, event.thread_id, event.organization_id, event.mandate_id, event.owner_user_id],
  )).rows[0];
  const manifest = manifestSchema.safeParse(batch?.manifest);
  if (!manifest.success) return false;
  const rows = (await client.query(
    `SELECT o.id,o.name,o.state,o.revision,o.input_digest,o.input,o.workflow_execution_id,c.delivery_mode
     FROM agent_operations o JOIN agent_conversations c ON c.id=o.conversation_id AND c.thread_id=o.thread_id
     WHERE o.id=ANY($1::uuid[]) AND o.thread_id=$2 AND o.organization_id=$3 AND o.mandate_id=$4
       AND o.owner_user_id=$5 AND c.organization_id=o.organization_id AND c.owner_user_id=o.owner_user_id
       AND c.mandate_id=o.mandate_id AND c.workflow_execution_id IS NOT DISTINCT FROM o.workflow_execution_id`,
    [manifest.data.map(item => item.operationId), event.thread_id, event.organization_id, event.mandate_id, event.owner_user_id],
  )).rows;
  return rows.length === manifest.data.length && rows.every(row => {
    const item = manifest.data.find(candidate => candidate.operationId === row.id);
    return item && names.has(row.name) && row.state === 'approved' && row.delivery_mode === 'communications'
      && row.revision === item.revision && row.input_digest === item.digest
      && row.input?.contextRevision === item.contextRevision
      && (row.workflow_execution_id ?? null) === (event.workflow_execution_id ?? null);
  });
}

export function runDurationMs(value: unknown) {
  return value && typeof value === 'object'
    && Object.keys(value).length === Object.keys(dispatchRunLimits).length
    && Object.entries(dispatchRunLimits).every(([key, expected]) => Object.getOwnPropertyDescriptor(value, key)?.value === expected)
    ? 90000 : 45000;
}

/** SQL and JS accept the same frozen policy; malformed/legacy runs keep45s.
 * Even a malformed saved policy cannot extend model or reconciliation events. */
export function dispatchRunSql(alias: string) {
  if (!/^[a-z]+$/.test(alias)) throw Error('Invalid run SQL alias');
  return `(${alias}.model_config->'nativeLimits'='${JSON.stringify(dispatchRunLimits)}'::jsonb
    AND EXISTS(SELECT 1 FROM agent_events budget_event
      WHERE budget_event.id=${alias}.trigger_event_id AND budget_event.thread_id=${alias}.thread_id
        AND budget_event.kind='review.approved'))`;
}
export function runDurationSql(alias: string) {
  return `(CASE WHEN ${dispatchRunSql(alias)} THEN 90000 ELSE 45000 END * interval '1 millisecond')`;
}
