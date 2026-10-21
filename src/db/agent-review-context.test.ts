import { afterEach, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { AgentStore, type AgentThread } from "./agent-store";
import { AgentResearchStore } from "./agent-research-store";
import { AgentTargetStore } from "./agent-target-store";
import { AgentPeopleStore } from "./agent-people-store";
import { AgentSequenceStore } from "./agent-sequence-store";
import { AgentSequenceExecutionStore } from "./agent-sequence-execution-store";
vi.mock("server-only", () => ({}));
const guidance = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/agent-guidance-snapshot", async (original) => ({
  ...(await original<object>()),
  assertAgentGuidanceSnapshot: guidance,
}));

const id = "10000000-0000-4000-8000-000000000001",
  digest = "a".repeat(64),
  contextRevision = "b".repeat(64);
const thread: AgentThread = {
  id,
  organization_id: "org",
  owner_user_id: "user",
  mandate_id: id,
  revision: 1,
};
const manifest = [{ operationId: id, revision: 1, digest, contextRevision }];
const sequence = {
  nativeSequenceDraftVersion: 1,
  mandateRevision: "10",
  responsibilityId: id,
  responsibilityRevision: 4,
  sequenceId: id,
  mode: "update",
  baseRevision: "3",
  contextRevision,
};
const classes = [
  AgentStore,
  AgentResearchStore,
  AgentTargetStore,
  AgentPeopleStore,
  AgentSequenceStore,
  AgentSequenceExecutionStore,
];
afterEach(() => {
  vi.restoreAllMocks();
  guidance.mockReset().mockResolvedValue(undefined);
});

function fixture(
  name: string,
  input: Record<string, unknown>,
  options: {
    mandate?: string | null;
    responsibility?: Record<string, unknown> | null;
    sequence?: Record<string, unknown> | null;
  } = {},
) {
  const trace: string[] = [],
    operation = {
      id,
      name,
      input: { contextRevision, ...input },
      state: "proposed",
      revision: 1,
      input_digest: digest,
    };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM agent_review_batches")) return { rows: [] };
    if (sql.startsWith("SELECT * FROM agent_operations"))
      return { rows: [operation] };
    if (sql.startsWith("SELECT * FROM agent_responsibilities")) {
      trace.push("responsibility");
      return {
        rows:
          options.responsibility === null
            ? []
            : [
                options.responsibility ?? {
                  id,
                  state: "ready",
                  revision: 4,
                  mandate_revision: "10",
                },
              ],
      };
    }
    if (sql.startsWith("SELECT xmin::text AS revision FROM mandates")) {
      trace.push("mandate");
      return {
        rows:
          options.mandate === null
            ? []
            : [{ revision: options.mandate ?? "10" }],
      };
    }
    if (
      sql.startsWith(
        "SELECT mandate_id,xmin::text AS revision FROM campaign_sequences",
      )
    ) {
      trace.push("sequence");
      return {
        rows:
          options.sequence === null
            ? []
            : [options.sequence ?? { mandate_id: id, revision: "3" }],
      };
    }
    if (sql.startsWith("INSERT INTO agent_review_batches")) {
      trace.push("save review");
      return { rows: [{ id, manifest: JSON.parse(String(values?.[5])) }] };
    }
    throw Error("Unexpected fixture SQL: " + sql);
  });
  class Harness extends AgentSequenceExecutionStore {
    protected override async transaction<T>(
      work: (client: PoolClient) => Promise<T>,
    ) {
      trace.push("transaction");
      return work({ query } as unknown as PoolClient);
    }
    protected override async lockThread() {
      trace.push("thread lock");
      return thread;
    }
  }
  return {
    trace,
    query,
    store: new Harness({} as Pick<Pool, "connect">, {
      organizationId: "org",
      userId: "user",
    }),
  };
}

it("keeps inherited review stages ordered and saves only after every feature validator returns", async () => {
  const order: string[] = [];
  for (const Store of classes) {
    const prototype = Store.prototype as unknown as {
      checkReviewContext: (...args: unknown[]) => Promise<void>;
    };
    const original = prototype.checkReviewContext;
    vi.spyOn(prototype, "checkReviewContext").mockImplementation(
      async function (this: unknown, ...args: unknown[]) {
        await original.apply(this, args);
        order.push(Store.name);
      },
    );
  }
  const f = fixture("email.reply", {});
  expect(await f.store.createReviewBatch(id, "review", manifest)).toMatchObject(
    { id, manifest },
  );
  expect(order).toEqual(classes.map((Store) => Store.name));
  expect(f.trace).toEqual(["transaction", "thread lock", "save review"]);
});

it.each([
  AgentStore,
  AgentResearchStore,
  AgentTargetStore,
  AgentPeopleStore,
  AgentSequenceStore,
  AgentSequenceExecutionStore,
])(
  "retains current-root-revision rejection before feature parsing in %s",
  async (Store) => {
    const f = fixture("research.start", {
      nativeResearchPlanVersion: 1,
      mandateRevision: "old",
    });
    Object.setPrototypeOf(f.store, Store.prototype);
    Object.assign(f.store, {
      transaction: async (work: (client: unknown) => unknown) =>
        work({ query: f.query }),
      lockThread: async () => thread,
    });
    await expect(
      f.store.createReviewBatch(id, "review", manifest),
    ).rejects.toThrow("Mandate changed; review the current research plan");
    expect(f.trace).toEqual(["mandate"]);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(
      false,
    );
  },
);

it("runs research schema validation only after the root revision matches and before later feature validators", async () => {
  const f = fixture("research.start", {
    nativeResearchPlanVersion: 1,
    mandateRevision: "10",
  });
  await expect(
    f.store.createReviewBatch(id, "review", manifest),
  ).rejects.toThrow();
  expect(f.trace).toEqual(["transaction", "thread lock", "mandate"]);
  expect(f.query).toHaveBeenCalledTimes(3);
});

it("validates a sequence draft guidance snapshot before reading supervision or saved sequence facts", async () => {
  const f = fixture("sequence.prepare", {
    ...sequence,
    generationGuidance: { version: 1 },
  });
  guidance.mockImplementation(async () => {
    f.trace.push("guidance");
  });
  expect(await f.store.createReviewBatch(id, "review", manifest)).toMatchObject(
    { manifest },
  );
  expect(f.trace).toEqual([
    "transaction",
    "thread lock",
    "guidance",
    "responsibility",
    "mandate",
    "sequence",
    "save review",
  ]);
  expect(guidance).toHaveBeenCalledWith(
    expect.objectContaining({ query: f.query }),
    thread,
    { version: 1 },
  );
  expect(
    f.query.mock.calls.find(([sql]) =>
      sql.includes("FROM campaign_sequences"),
    )?.[1],
  ).toEqual([id, "org", "user"]);
});

it("propagates stale guidance before any later sequence error or review write", async () => {
  const f = fixture(
    "sequence.prepare",
    { ...sequence, generationGuidance: { version: 1 } },
    { mandate: "old", sequence: null },
  );
  guidance.mockRejectedValue(
    Error("Approved guidance changed; prepare a fresh review"),
  );
  await expect(
    f.store.createReviewBatch(id, "review", manifest),
  ).rejects.toThrow("Approved guidance changed; prepare a fresh review");
  expect(f.trace).toEqual(["transaction", "thread lock"]);
  expect(f.query).toHaveBeenCalledTimes(2);
});

it.each([
  { responsibility: null },
  { responsibility: { state: "paused", revision: 4, mandate_revision: "10" } },
  { responsibility: { state: "ready", revision: 5, mandate_revision: "10" } },
  {
    responsibility: { state: "waiting", revision: 4, mandate_revision: "old" },
  },
  { mandate: "old" },
  { mandate: null },
])(
  "rejects changed draft supervision before reading or reporting changed sequence content (%j)",
  async (options) => {
    const f = fixture("sequence.prepare", sequence, {
      ...options,
      sequence: null,
    });
    await expect(
      f.store.createReviewBatch(id, "review", manifest),
    ).rejects.toThrow("Sequence goal or supervision changed");
    expect(f.trace).toEqual([
      "transaction",
      "thread lock",
      "responsibility",
      "mandate",
    ]);
  },
);

it.each([
  { mode: "update", row: null, allowed: false },
  {
    mode: "update",
    row: { mandate_id: "foreign", revision: "3" },
    allowed: false,
  },
  { mode: "update", row: { mandate_id: id, revision: "4" }, allowed: false },
  { mode: "create", row: { mandate_id: id, revision: "3" }, allowed: false },
  { mode: "create", row: null, allowed: true },
  { mode: "update", row: { mandate_id: id, revision: "3" }, allowed: true },
])(
  "keeps saved sequence draft create/update revision admission (%j)",
  async ({ mode, row, allowed }) => {
    const f = fixture(
      "sequence.prepare",
      { ...sequence, mode },
      { sequence: row },
    );
    if (allowed)
      expect(
        await f.store.createReviewBatch(id, "review", manifest),
      ).toMatchObject({ manifest });
    else
      await expect(
        f.store.createReviewBatch(id, "review", manifest),
      ).rejects.toThrow(
        "Sequence draft changed; preserve and review the saved version",
      );
    expect(f.trace).toEqual([
      "transaction",
      "thread lock",
      "responsibility",
      "mandate",
      "sequence",
      ...(allowed ? ["save review"] : []),
    ]);
  },
);

it.each(["research.people", "target.select", "sequence.publish"])(
  "preserves each feature gate and rejects malformed %s before reading feature facts or creating a review",
  async (name) => {
    const f = fixture(name, { nativeSequencePublicationVersion: 1 });
    await expect(
      f.store.createReviewBatch(id, "review", manifest),
    ).rejects.toThrow();
    expect(f.trace).toEqual(["transaction", "thread lock"]);
    expect(f.query).toHaveBeenCalledTimes(2);
  },
);

it.each(["sequence.prepare", "sequence.publish", "sequence.enrol"])(
  "leaves non-native %s review behavior unchanged",
  async (name) => {
    const f = fixture(name, {});
    expect(
      await f.store.createReviewBatch(id, "review", manifest),
    ).toMatchObject({ manifest });
    expect(f.trace).toEqual(["transaction", "thread lock", "save review"]);
  },
);
