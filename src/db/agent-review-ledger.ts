import type { PoolClient } from "pg";
import type { AgentThread } from "./agent-store";
import type { AgentReviewItem } from "@/domain/agent-authority";
import { agentRecordDigest as digest } from "@/lib/agent-record-digest";

export type AgentReviewDecisionPersistence = {
  batchId: string;
  manifest: AgentReviewItem[];
  decision: "approved" | "rejected";
};

/** Ledger writes only. The caller owns the transaction, thread/batch locks
 * and exact-manifest/current-operation validation. Dispatch still requires
 * fresh admission; this collaborator does not grant authority. */
export async function insertAgentReviewBatch(
  client: PoolClient,
  thread: AgentThread,
  request: string,
  manifest: AgentReviewItem[],
) {
  return (
    await client.query(
      `INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        thread.id,
        thread.organization_id,
        thread.mandate_id,
        thread.owner_user_id,
        request,
        JSON.stringify(manifest),
        digest(manifest),
      ],
    )
  ).rows[0];
}

/** Persist operation state, batch decision, outbox event and user message in
 * this order on the caller's same client; its transaction handles rollback. */
export async function persistAgentReviewDecision(
  client: PoolClient,
  thread: AgentThread,
  actorUserId: string,
  input: AgentReviewDecisionPersistence,
) {
  const { batchId, manifest, decision } = input;
  await client.query(
    "UPDATE agent_operations SET state=$2,updated_at=now() WHERE id=ANY($1::uuid[])",
    [manifest.map((item) => item.operationId), decision],
  );
  const updated = (
    await client.query(
      "UPDATE agent_review_batches SET state=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$1 RETURNING *",
      [batchId, decision, actorUserId],
    )
  ).rows[0];
  const payload = { reviewBatchId: batchId, decision, items: manifest };
  await client.query(
    `INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      thread.id,
      thread.organization_id,
      thread.mandate_id,
      thread.owner_user_id,
      "review:" + batchId + ":" + decision,
      "review." + decision,
      JSON.stringify(payload),
      digest(payload),
    ],
  );
  const content = {
    text:
      decision === "approved"
        ? "You approved the displayed proposals. Execution will recheck current permissions and conversation state."
        : "You rejected the displayed proposals.",
    ...payload,
  };
  await client.query(
    `INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
       VALUES($1,$2,$3,$4,$5,'user',$6,$7)`,
    [
      thread.id,
      thread.organization_id,
      thread.mandate_id,
      thread.owner_user_id,
      "review:" + batchId + ":" + decision,
      JSON.stringify(content),
      digest({ role: "user", content }),
    ],
  );
  return updated;
}
