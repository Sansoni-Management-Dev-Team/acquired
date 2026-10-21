import type { PoolClient } from "pg";
import type { AgentThread } from "./agent-store";

/** The existing root operation shape shared explicitly across feature validators.
 * Each feature retains its own schema validation and ordered virtual calls. */
export type AgentReviewContextOperation = {
  name: string;
  input?: {
    nativeResearchPlanVersion?: unknown;
    mandateRevision?: unknown;
    [key: string]: unknown;
  };
};

/** Read within the caller's existing review transaction before feature checks.
 * No transaction, authority or proposal is created here. */
export async function checkAgentResearchMandateReviewContext(
  c: PoolClient,
  t: AgentThread,
  op: AgentReviewContextOperation,
) {
  if (
    op.name === "research.start" &&
    op.input?.nativeResearchPlanVersion === 1
  ) {
    const mandate = (
      await c.query(
        "SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2",
        [t.mandate_id, t.organization_id],
      )
    ).rows[0];
    if (mandate?.revision !== op.input.mandateRevision)
      throw new Error("Mandate changed; review the current research plan");
  }
}
