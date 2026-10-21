import { afterEach, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { AgentStore, agentRecordDigest, type AgentThread } from "./agent-store";
import type { AgentReviewContextOperation } from "./agent-review-context";
import type { AgentReviewItem } from "@/domain/agent-authority";

const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const thread: AgentThread = {
  id,
  organization_id: "org",
  owner_user_id: "owner",
  mandate_id: id,
  revision: 1,
};
const manifest: AgentReviewItem[] = [
  {
    operationId: id,
    revision: 1,
    digest: "a".repeat(64),
    contextRevision: "history-1",
  },
];
afterEach(() => vi.unstubAllEnvs());

type Options = {
  prior?: Record<string, unknown>;
  batch?: Record<string, unknown> | null;
  operations?: Record<string, unknown>[];
  mode?: string;
  member?: boolean;
  featureError?: boolean;
  contextRevision?: string;
  failWrite?: number;
};
function fixture(options: Options = {}) {
  vi.stubEnv("AGENT_WORKER_SCOPE_MODE", "unrestricted");
  const trace: string[] = [],
    writes: Array<[string, unknown[] | undefined]> = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      trace.push(sql);
      return { rows: [] };
    }
    if (
      sql.startsWith("SET LOCAL ROLE") ||
      sql.startsWith("SELECT set_config(")
    )
      return { rows: [] };
    if (sql.startsWith("SELECT current_user"))
      return {
        rows: [
          { name: "acquire_agent_user", rolsuper: false, rolbypassrls: false },
        ],
      };
    if (
      sql.startsWith("SELECT to_regprocedure('public.agent_lock_send_gate()')")
    )
      return { rows: [{ installed: true }] };
    if (sql === "SELECT public.agent_lock_send_gate()") {
      trace.push("send gate");
      return { rows: [] };
    }
    if (sql === "SELECT agent_lock_member() AS allowed") {
      trace.push("membership");
      return { rows: [{ allowed: options.member !== false }] };
    }
    if (sql === "SELECT * FROM agent_threads WHERE id=$1") {
      trace.push("owned thread");
      return { rows: [thread] };
    }
    if (sql === "SELECT id FROM agent_threads WHERE id=$1 FOR UPDATE") {
      trace.push("thread lock");
      return { rows: [{ id }] };
    }
    if (
      sql ===
      "SELECT * FROM agent_review_batches WHERE thread_id=$1 AND request_key=$2"
    ) {
      trace.push("prior review");
      return { rows: options.prior ? [options.prior] : [] };
    }
    if (sql.startsWith("SELECT mode FROM agent_mandate_execution_modes")) {
      trace.push("demo mode");
      return { rows: [{ mode: options.mode ?? "demo" }] };
    }
    if (
      sql ===
      "SELECT * FROM agent_review_batches WHERE id=$1 AND thread_id=$2 FOR UPDATE"
    ) {
      trace.push("batch lock");
      return {
        rows:
          options.batch === null
            ? []
            : [
                options.batch ?? {
                  id,
                  revision: 1,
                  state: "pending",
                  manifest,
                },
              ],
      };
    }
    if (
      sql.startsWith(
        "SELECT * FROM agent_operations WHERE thread_id=$1 AND id=ANY",
      )
    ) {
      trace.push("operation locks");
      return {
        rows:
          options.operations ??
          manifest.map((item) => ({
            id: item.operationId,
            name: "email.reply",
            revision: item.revision,
            state: "proposed",
            input_digest: item.digest,
            input: { contextRevision: item.contextRevision },
            conversation_id: id,
          })),
      };
    }
    if (sql === "SELECT agent_context_revision($1::uuid) AS revision") {
      trace.push("conversation context");
      return { rows: [{ revision: options.contextRevision ?? "history-1" }] };
    }
    if (/^UPDATE|INSERT/.test(sql)) {
      writes.push([sql, values]);
      trace.push("write " + writes.length);
      if (writes.length === options.failWrite)
        throw Error("Injected ledger write failure");
      if (sql.startsWith("INSERT INTO agent_review_batches"))
        return {
          rows: [
            {
              id,
              revision: 1,
              state: "pending",
              manifest: JSON.parse(String(values?.[5])),
            },
          ],
        };
      if (sql.startsWith("UPDATE agent_review_batches"))
        return { rows: [{ id, revision: 1, state: values?.[1], manifest }] };
      return { rows: [] };
    }
    throw Error("Unexpected fixture query: " + sql);
  });
  const release = vi.fn(() => trace.push("release")),
    client = { query, release } as unknown as PoolClient;
  const connect = vi.fn().mockResolvedValue(client);
  class Harness extends AgentStore {
    protected override async checkReviewContext(
      c: PoolClient,
      t: AgentThread,
      operation: AgentReviewContextOperation,
    ) {
      trace.push("feature context");
      if (options.featureError) throw Error("Feature context changed");
      await super.checkReviewContext(c, t, operation);
    }
  }
  return {
    trace,
    writes,
    query,
    release,
    connect,
    store: new Harness({ connect } as Pick<Pool, "connect">, {
      organizationId: "org",
      userId: "owner",
    }),
  };
}
const prefix = [
  "BEGIN",
  "send gate",
  "membership",
  "owned thread",
  "thread lock",
];

it("creates a canonically ordered manifest only after locks, virtual feature checks and current conversation context", async () => {
  const items = [{ ...manifest[0], operationId: other }, manifest[0]],
    f = fixture({
      operations: items.map((item) => ({
        id: item.operationId,
        name: "email.reply",
        revision: 1,
        state: "proposed",
        input_digest: item.digest,
        input: { contextRevision: "history-1" },
        conversation_id: id,
      })),
    });
  const result = await f.store.createReviewBatch(id, "  create  ", items);
  expect(result.manifest).toEqual([...items].reverse());
  expect(items[0].operationId).toBe(other);
  expect(f.trace).toEqual([
    ...prefix,
    "prior review",
    "operation locks",
    "feature context",
    "conversation context",
    "feature context",
    "conversation context",
    "write 1",
    "COMMIT",
    "release",
  ]);
  expect(f.writes[0][1]).toEqual([
    id,
    "org",
    id,
    "owner",
    "create",
    JSON.stringify(result.manifest),
    agentRecordDigest(result.manifest),
  ]);
  expect(f.connect).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
});
it("replays an exact prior creation before touching changed operations and refuses a changed idempotent manifest", async () => {
  const prior = { id, revision: 1, state: "approved", manifest },
    f = fixture({ prior, featureError: true });
  expect(await f.store.createReviewBatch(id, "same", manifest)).toBe(prior);
  expect(f.trace).toEqual([...prefix, "prior review", "COMMIT", "release"]);
  expect(f.writes).toHaveLength(0);
  const changed = fixture({ prior });
  await expect(
    changed.store.createReviewBatch(id, "same", [
      { ...manifest[0], revision: 2 },
    ]),
  ).rejects.toThrow("Review batch changed");
  expect(changed.trace).toEqual([
    ...prefix,
    "prior review",
    "ROLLBACK",
    "release",
  ]);
});
it("leaves every decision write after exact operation, virtual feature and current conversation validation", async () => {
  const f = fixture();
  expect(
    await f.store.decideReviewBatch(id, id, 1, manifest, "approved"),
  ).toMatchObject({ state: "approved" });
  expect(f.trace).toEqual([
    ...prefix,
    "batch lock",
    "operation locks",
    "feature context",
    "conversation context",
    "write 1",
    "write 2",
    "write 3",
    "write 4",
    "COMMIT",
    "release",
  ]);
  expect(
    f.writes.map(([sql]) => sql.match(/^(?:UPDATE|INSERT INTO) (\w+)/)?.[1]),
  ).toEqual([
    "agent_operations",
    "agent_review_batches",
    "agent_events",
    "agent_messages",
  ]);
  expect(f.writes[0][1]).toEqual([[id], "approved"]);
  expect(f.writes[1][1]).toEqual([id, "approved", "owner"]);
  const payload = { reviewBatchId: id, decision: "approved", items: manifest };
  expect(f.writes[2][1]).toEqual([
    id,
    "org",
    id,
    "owner",
    "review:" + id + ":approved",
    "review.approved",
    JSON.stringify(payload),
    agentRecordDigest(payload),
  ]);
  const content = {
    text: "You approved the displayed proposals. Execution will recheck current permissions and conversation state.",
    ...payload,
  };
  expect(f.writes[3][1]).toEqual([
    id,
    "org",
    id,
    "owner",
    "review:" + id + ":approved",
    "user",
    JSON.stringify(content),
    agentRecordDigest({ role: "user", content }),
  ]);
});
it.each(["approved", "rejected"] as const)(
  "replays the same %s decision after locking the original batch, without operation checks or duplicate audit",
  async (decision) => {
    const batch = { id, revision: 1, state: decision, manifest },
      f = fixture({ batch, featureError: true });
    expect(await f.store.decideReviewBatch(id, id, 1, manifest, decision)).toBe(
      batch,
    );
    expect(f.trace).toEqual([...prefix, "batch lock", "COMMIT", "release"]);
    expect(f.writes).toHaveLength(0);
  },
);
it.each([
  { batch: null, message: "Review batch not found" },
  {
    batch: { id, revision: 2, state: "approved", manifest },
    message: "Review batch changed",
  },
  {
    batch: { id, revision: 1, state: "rejected", manifest },
    message: "already decided or invalidated",
  },
  {
    batch: { id, revision: 1, state: "invalidated", manifest },
    message: "already decided or invalidated",
  },
])(
  "refuses unavailable/stale/opposite decisions before checking operations or writing (%s)",
  async ({ batch, message }) => {
    const f = fixture({ batch });
    await expect(
      f.store.decideReviewBatch(id, id, 1, manifest, "approved"),
    ).rejects.toThrow(message);
    expect(f.trace).toEqual([...prefix, "batch lock", "ROLLBACK", "release"]);
    expect(f.writes).toHaveLength(0);
  },
);
it("checks exact presented items before accepting even an already decided replay", async () => {
  const f = fixture({
    batch: { id, revision: 1, state: "approved", manifest },
  });
  await expect(
    f.store.decideReviewBatch(
      id,
      id,
      1,
      [{ ...manifest[0], digest: "c".repeat(64) }],
      "approved",
    ),
  ).rejects.toThrow("Review batch changed");
  expect(f.writes).toHaveLength(0);
});
it.each([
  { options: { operations: [] }, error: "Review operation not found" },
  { options: { featureError: true }, error: "Feature context changed" },
  { options: { contextRevision: "history-2" }, error: "Conversation changed" },
  {
    options: {
      operations: [
        {
          id,
          name: "email.reply",
          state: "approved",
          revision: 1,
          input_digest: manifest[0].digest,
          input: { contextRevision: "history-1" },
        },
      ],
    },
    error: "Operation changed",
  },
])(
  "rejects stale or missing live context without durable review changes (%s)",
  async ({ options, error }) => {
    const f = fixture(options);
    await expect(
      f.store.decideReviewBatch(id, id, 1, manifest, "approved"),
    ).rejects.toThrow(error);
    expect(f.writes).toHaveLength(0);
    expect(f.trace.slice(-2)).toEqual(["ROLLBACK", "release"]);
  },
);
it("keeps demo attribution gated before batch lookup and records automatic approvals with assistant audit", async () => {
  const bad = fixture({ mode: "real" });
  await expect(
    bad.store.decideReviewBatch(
      id,
      id,
      1,
      manifest,
      "approved",
      "automatic_demo",
    ),
  ).rejects.toThrow("approved demo");
  expect(bad.trace).toEqual([...prefix, "demo mode", "ROLLBACK", "release"]);
  expect(bad.writes).toHaveLength(0);
  const rejected = fixture();
  await expect(
    rejected.store.decideReviewBatch(
      id,
      id,
      1,
      manifest,
      "rejected",
      "automatic_demo",
    ),
  ).rejects.toThrow("approved demo");
  expect(rejected.writes).toHaveLength(0);
  const f = fixture();
  await f.store.decideReviewBatch(
    id,
    id,
    1,
    manifest,
    "approved",
    "automatic_demo",
  );
  expect(f.trace).toEqual([
    ...prefix,
    "demo mode",
    "batch lock",
    "operation locks",
    "feature context",
    "conversation context",
    "write 1",
    "write 2",
    "write 3",
    "write 4",
    "COMMIT",
    "release",
  ]);
  const event = JSON.parse(String(f.writes[2][1]?.[6])),
    message = JSON.parse(String(f.writes[3][1]?.[6]));
  expect(event).toEqual({
    reviewBatchId: id,
    decision: "approved",
    items: manifest,
    approvalSource: "automatic_demo",
  });
  expect(f.writes[3][1]?.[5]).toBe("assistant");
  expect(message).toEqual({
    text: "Automatically approved these demo items. I’ll check that everything is ready before continuing.",
    ...event,
  });
  expect(f.writes[3][1]?.[7]).toBe(
    agentRecordDigest({ role: "assistant", content: message }),
  );
});
it("records human rejection through the same four writes with rejected event and unchanged user attribution", async () => {
  const f = fixture();
  await f.store.decideReviewBatch(id, id, 1, manifest, "rejected");
  expect(f.writes[0][1]).toEqual([[id], "rejected"]);
  expect(f.writes[2][1]?.[5]).toBe("review.rejected");
  expect(f.writes[3][1]?.[5]).toBe("user");
  expect(JSON.parse(String(f.writes[3][1]?.[6])).text).toBe(
    "You rejected the displayed proposals.",
  );
});
it.each([1, 2, 3, 4])(
  "rolls back and releases the same caller transaction after ledger write %s fails",
  async (failWrite) => {
    const f = fixture({ failWrite });
    await expect(
      f.store.decideReviewBatch(id, id, 1, manifest, "approved"),
    ).rejects.toThrow("Injected ledger write failure");
    expect(f.writes).toHaveLength(failWrite);
    expect(f.trace.slice(-2)).toEqual(["ROLLBACK", "release"]);
    expect(f.trace).not.toContain("COMMIT");
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
  },
);
it("rolls back failed creation and rejects lost membership before thread access", async () => {
  const f = fixture({ failWrite: 1 });
  await expect(
    f.store.createReviewBatch(id, "create", manifest),
  ).rejects.toThrow("Injected ledger write failure");
  expect(f.trace.slice(-2)).toEqual(["ROLLBACK", "release"]);
  const denied = fixture({ member: false });
  await expect(
    denied.store.decideReviewBatch(id, id, 1, manifest, "approved"),
  ).rejects.toThrow("no longer a member");
  expect(denied.trace).toEqual([
    "BEGIN",
    "send gate",
    "membership",
    "ROLLBACK",
    "release",
  ]);
  expect(denied.writes).toHaveLength(0);
});

it("edits only the reviewed body, invalidates its old batch and saves the exact next manifest and digest", async () => {
  const f = fixture(),
    body = "Edited reviewed message",
    input = { contextRevision: "history-1", body },
    next = [
      {
        ...manifest[0],
        revision: 2,
        digest: agentRecordDigest({ name: "email.reply", input }),
      },
    ];
  const result = await f.store.editEmailReview(
    id,
    id,
    id,
    1,
    "  " + body + "  ",
  );
  expect(f.trace).toEqual([
    ...prefix,
    "prior review",
    "batch lock",
    "operation locks",
    "feature context",
    "conversation context",
    "write 1",
    "write 2",
    "write 3",
    "COMMIT",
    "release",
  ]);
  expect(f.writes[0][0]).toBe(
    "UPDATE agent_operations SET input=$2,input_digest=$3,revision=revision+1,updated_at=now() WHERE id=$1",
  );
  expect(f.writes[0][1]).toEqual([id, JSON.stringify(input), next[0].digest]);
  expect(f.writes[1]).toEqual([
    "UPDATE agent_review_batches SET state='invalidated' WHERE id=$1",
    [id],
  ]);
  expect(result.manifest).toEqual(next);
  expect(f.writes[2][1]).toEqual([
    id,
    "org",
    id,
    "owner",
    "edit:" + id + ":" + id + ":" + agentRecordDigest({ revision: 1, body }),
    JSON.stringify(next),
    agentRecordDigest(next),
  ]);
});
it("replays the exact saved edit without current-operation checks or another invalidation/manifest write", async () => {
  const prior = {
      id,
      revision: 1,
      state: "pending",
      manifest: [{ ...manifest[0], revision: 2 }],
    },
    f = fixture({ prior, featureError: true });
  expect(
    await f.store.editEmailReview(id, id, id, 1, "Edited reviewed message"),
  ).toBe(prior);
  expect(f.trace).toEqual([...prefix, "prior review", "COMMIT", "release"]);
  expect(f.writes).toHaveLength(0);
});
it("rolls back the edit and invalidation when saving the replacement review batch fails", async () => {
  const f = fixture({ failWrite: 3 });
  await expect(
    f.store.editEmailReview(id, id, id, 1, "Edited reviewed message"),
  ).rejects.toThrow("Injected ledger write failure");
  expect(f.writes).toHaveLength(3);
  expect(f.trace.slice(-2)).toEqual(["ROLLBACK", "release"]);
  expect(f.trace).not.toContain("COMMIT");
});
