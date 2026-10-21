import type { PoolClient } from "pg";
import type { AgentThread } from "./agent-store";
import {
  assertAgentGuidanceSnapshot,
  type AgentGuidanceSnapshot,
} from "@/lib/agent-guidance-snapshot";

export type AgentSequenceDraftReviewContext = {
  mandateRevision: string;
  responsibilityId: string;
  responsibilityRevision: number;
  sequenceId: string;
  mode: "create" | "update";
  baseRevision: string | null;
  generationGuidance?: AgentGuidanceSnapshot;
};

/** Preserve guidance, supervision/mandate, then saved-draft validation order.
 * The caller retains feature dispatch, its existing transaction and locks. */
export async function checkAgentSequenceDraftReviewContext(
  c: PoolClient,
  t: AgentThread,
  plan: AgentSequenceDraftReviewContext,
) {
  if (plan.generationGuidance)
    await assertAgentGuidanceSnapshot(c, t, plan.generationGuidance);
  const r = (
      await c.query(
        "SELECT * FROM agent_responsibilities WHERE id=$1 AND thread_id=$2",
        [plan.responsibilityId, t.id],
      )
    ).rows[0],
    m = (
      await c.query(
        "SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2",
        [t.mandate_id, t.organization_id],
      )
    ).rows[0];
  if (
    !r ||
    !["ready", "waiting"].includes(r.state) ||
    r.revision !== plan.responsibilityRevision ||
    r.mandate_revision !== plan.mandateRevision ||
    m?.revision !== plan.mandateRevision
  )
    throw new Error("Sequence goal or supervision changed");
  const row = (
    await c.query(
      "SELECT mandate_id,xmin::text AS revision FROM campaign_sequences WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3",
      [plan.sequenceId, t.organization_id, t.owner_user_id],
    )
  ).rows[0];
  if (
    plan.mode === "create"
      ? Boolean(row)
      : !row ||
        row.mandate_id !== t.mandate_id ||
        row.revision !== plan.baseRevision
  )
    throw new Error(
      "Sequence draft changed; preserve and review the saved version",
    );
}
