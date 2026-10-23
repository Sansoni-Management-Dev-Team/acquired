import type {PoolClient} from 'pg';
import type {AgentThread} from './agent-store';

/** Shared shape for the ordered feature validators, independent of the store
 * inheritance chain. Each feature still validates its own saved input schema. */
export type AgentReviewContextOperation = {
  name: string;
  input?: {
    nativeResearchPlanVersion?: unknown;
    mandateRevision?: unknown;
    [key: string]: unknown;
  };
};

/** Read inside the caller's review transaction before research-specific checks.
 * This function neither acquires authority nor writes or opens a transaction. */
export async function checkAgentResearchMandateReviewContext(
  client: PoolClient,
  thread: AgentThread,
  operation: AgentReviewContextOperation,
) {
  if (operation.name === 'research.start' && operation.input?.nativeResearchPlanVersion === 1) {
    const mandate = (await client.query(
      'SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',
      [thread.mandate_id, thread.organization_id],
    )).rows[0];
    if (mandate?.revision !== operation.input.mandateRevision) {
      throw new Error('Mandate changed; review the current research plan');
    }
  }
}
