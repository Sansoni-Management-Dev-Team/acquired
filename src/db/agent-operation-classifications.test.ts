import { expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { AgentStore, type AgentThread } from "./agent-store";
import { AgentOutreachStore } from "./agent-outreach-store";
import { AgentInvitationStore } from "./agent-invitation-store";
import { AgentExecutionStore } from "./agent-execution-store";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  AgentReviewCards,
  type AgentReviewBatchView,
} from "@/components/agent-review-cards";
import { createNativeAgentHandlers } from "@/lib/agent-native-handlers";
import type { AgentModelStore } from "./agent-model-store";
vi.mock("server-only", () => ({}));

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
const messages = [
  "email.initial",
  "email.reply",
  "email.follow_up",
  "whatsapp.initial",
  "whatsapp.reply",
  "whatsapp.follow_up",
  "linkedin.initial",
  "linkedin.reply",
  "linkedin.follow_up",
];
const reviewable = [
  "target.select",
  "research.start",
  "research.people",
  "sequence.prepare",
  "sequence.publish",
  "sequence.enrol",
  ...messages,
  "linkedin.invitation",
  "email.manual_link",
];
const unsupported = [
  "research.fields",
  "",
  "email",
  "Email.reply",
  "email.reply.extra",
  "email.initial\n",
  "email.reconcile",
  "whatsapp.manual_link",
  "linkedin.manual_link",
  "linkedin.accept",
  "human.handoff",
];

class ReviewHarness extends AgentStore {
  check(name: string, changed = false) {
    const query = vi
      .fn()
      .mockResolvedValue({
        rows: [
          {
            id,
            name,
            state: "proposed",
            revision: 1,
            input_digest: digest,
            input: { contextRevision: changed ? "changed" : contextRevision },
          },
        ],
      });
    return this.currentReviewOperations(
      { query } as unknown as PoolClient,
      thread,
      [{ operationId: id, revision: 1, digest, contextRevision }],
    );
  }
}
it("admits only the existing review families and preserves exact saved-context checking", async () => {
  const store = new ReviewHarness({} as Pick<Pool, "connect">, {
    organizationId: "org",
    userId: "user",
  });
  for (const name of reviewable) {
    expect(await store.check(name)).toHaveLength(1);
    await expect(store.check(name, true)).rejects.toThrow("Operation changed");
  }
  for (const name of unsupported)
    await expect(store.check(name)).rejects.toThrow("not reviewable");
});

it("keeps presentation-only social manual links separate from server review admission", () => {
  const rendersEdit = (name: string) => {
    const batch: AgentReviewBatchView = {
      id,
      revision: 1,
      state: "pending",
      stale: false,
      manifest: [],
      operations: [
        {
          id,
          name,
          revision: 1,
          state: "proposed",
          input: { body: "A saved factual reply." },
        },
      ],
    };
    return renderToStaticMarkup(
      createElement(AgentReviewCards, {
        batches: [batch],
        busy: false,
        onDecision: vi.fn(),
        onEdit: vi.fn(),
      }),
    ).includes("Edit reply");
  };
  for (const name of [
    ...messages,
    "linkedin.invitation",
    "email.manual_link",
    "whatsapp.manual_link",
    "linkedin.manual_link",
  ])
    expect(rendersEdit(name), name).toBe(true);
  for (const name of [
    "target.select",
    "research.start",
    "research.fields",
    "email",
    "email.manual_link.extra",
    "email.invitation",
    "LinkedIn.reply",
    "email.initial\n",
    "linkedin.accept",
  ])
    expect(rendersEdit(name), name).toBe(false);
});

it("dispatches reviewed messages and invitations only through their recorded communications adapter", async () => {
  for (const name of [
    ...messages,
    "linkedin.invitation",
    ...unsupported,
    "email.manual_link",
  ]) {
    const dispatchProvider = vi.fn(),
      deliverApprovedLocalEmail = vi.fn(),
      store = {
        reviewDispatchTargets: vi
          .fn()
          .mockResolvedValue([{ id, name, delivery_mode: "communications" }]),
        deliverApprovedLocalEmail,
      };
    const handlers = createNativeAgentHandlers({
      store: store as unknown as AgentModelStore,
      dispatchProvider,
    });
    const result = await handlers["review.approved"]({
      event: {
        id,
        thread_id: id,
        kind: "review.approved",
        payload: { reviewBatchId: id },
        lease_owner: id,
        fence: "1",
        attempts: 1,
      },
      runId: id,
      signal: new AbortController().signal,
      assertCurrent: vi.fn(),
    });
    const accepted = messages.includes(name) || name === "linkedin.invitation";
    expect(result.kind, name).toBe(accepted ? "complete" : "review");
    expect(dispatchProvider.mock.calls.length, name).toBe(accepted ? 1 : 0);
    expect(deliverApprovedLocalEmail).not.toHaveBeenCalled();
  }
});

function pendingQuery(prototype: object) {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const store = Object.assign(Object.create(prototype), {
    nativeTransaction: (work: (client: unknown) => unknown) => work({ query }),
    thread: async () => thread,
    lockConversation: async () => ({ id }),
  }) as AgentOutreachStore;
  return { query, store };
}
function operationNames(sql: string) {
  return [...sql.matchAll(/(?:o\.)?name IN\(([^)]+)\)/g)].flatMap((match) =>
    [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]),
  );
}
it("keeps pending ordinary messages distinct from invitation-aware pending work with the same saved review barrier", async () => {
  for (const [prototype, names] of [
    [AgentOutreachStore.prototype, messages],
    [AgentInvitationStore.prototype, [...messages, "linkedin.invitation"]],
  ] as const) {
    const { query, store } = pendingQuery(prototype);
    expect(await store.pendingNativeEmail(id, id, contextRevision)).toBe(false);
    const [sql, values] = query.mock.calls[0];
    expect(operationNames(sql)).toEqual(names);
    expect(values).toEqual([id, id, contextRevision]);
    for (const fragment of [
      "input->>'contextRevision'=$3",
      "state IN('proposed','approved','running','uncertain')",
      "state<>'proposed' OR EXISTS",
      "b.state='pending'",
      "b.manifest @> jsonb_build_array",
    ])
      expect(sql).toContain(fragment);
  }
});
it("invalidates only unstarted message drafts while the invitation override retains its separate pass", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  class InvalidationHarness extends AgentExecutionStore {
    invalidate() {
      return this.invalidateNativeReviews(
        { query } as unknown as PoolClient,
        thread,
        id,
      );
    }
  }
  const store = new InvalidationHarness({} as Pick<Pool, "connect">, {
    organizationId: "org",
    userId: "user",
  });
  await store.invalidate();
  expect(operationNames(query.mock.calls[0][0])).toEqual(messages);
  expect(query.mock.calls[0][0]).toContain("state IN('proposed','approved')");
  expect(query.mock.calls[0][1]).toEqual([id, id]);
  class InvitationInvalidationHarness extends AgentInvitationStore {
    invalidate() {
      return this.invalidateNativeReviews(
        { query } as unknown as PoolClient,
        thread,
        id,
      );
    }
  }
  const invitation = new InvitationInvalidationHarness(
    {} as Pick<Pool, "connect">,
    { organizationId: "org", userId: "user" },
  );
  query.mockClear();
  await invitation.invalidate();
  expect(query.mock.calls).toHaveLength(2);
  expect(operationNames(query.mock.calls[0][0])).toEqual(messages);
  expect(query.mock.calls[1][0]).toContain(
    "name='linkedin.invitation' AND state IN('proposed','approved')",
  );
});

function editFixture(
  name: string,
  options: {
    requiresHumanReview?: boolean;
    state?: string;
    revision?: number;
  } = {},
) {
  const input = {
    contextRevision,
    ...(options.requiresHumanReview === undefined
      ? {}
      : { requiresHumanReview: options.requiresHumanReview }),
  };
  const operation = {
    id,
    name,
    state: options.state ?? "proposed",
    revision: options.revision ?? 1,
    input_digest: digest,
    input,
  };
  const manifest = [{ operationId: id, revision: 1, digest, contextRevision }];
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT * FROM agent_review_batches WHERE thread_id="))
      return { rows: [] };
    if (sql.startsWith("SELECT * FROM agent_review_batches WHERE id="))
      return { rows: [{ id, state: "pending", manifest }] };
    if (sql.startsWith("SELECT * FROM agent_operations"))
      return { rows: [operation] };
    if (sql.startsWith("INSERT INTO agent_review_batches"))
      return { rows: [{ id, manifest }] };
    if (sql.startsWith("UPDATE agent_operations"))
      return { rows: [{ ...operation, revision: 2 }] };
    if (sql.startsWith("UPDATE agent_review_batches")) return { rows: [] };
    throw Error("Unexpected fixture query: " + sql);
  });
  class EditHarness extends AgentStore {
    protected override async transaction<T>(
      work: (c: PoolClient) => Promise<T>,
    ) {
      return work({ query } as unknown as PoolClient);
    }
    protected override async lockThread() {
      return thread;
    }
  }
  return {
    query,
    store: new EditHarness({} as Pick<Pool, "connect">, {
      organizationId: "org",
      userId: "user",
    }),
  };
}
it("edits only the original seventeen reviewable proposal names and preserves revision/state fences", async () => {
  for (const name of reviewable) {
    const { store } = editFixture(name);
    expect(
      (await store.editProposedOperation(id, id, 1, { contextRevision }))
        .revision,
      name,
    ).toBe(2);
  }
  for (const name of unsupported) {
    const { store, query } = editFixture(name);
    await expect(
      store.editProposedOperation(id, id, 1, { contextRevision }),
      name,
    ).rejects.toThrow("Operation changed or unavailable");
    expect(query.mock.calls).toHaveLength(1);
  }
  for (const options of [{ state: "approved" }, { revision: 2 }]) {
    const { store } = editFixture("email.reply", options);
    await expect(
      store.editProposedOperation(id, id, 1, { contextRevision }),
    ).rejects.toThrow("Operation changed or unavailable");
  }
});
it("edits only eleven human-reviewed message names and retains invitation-specific body fences", async () => {
  for (const name of [
    ...messages,
    "linkedin.invitation",
    "email.manual_link",
  ]) {
    const { store } = editFixture(name, { requiresHumanReview: true });
    expect(
      (await store.editEmailReview(id, id, id, 1, " A revised reply. ")).id,
      name,
    ).toBe(id);
  }
  for (const name of reviewable.filter(
    (name) =>
      ![...messages, "linkedin.invitation", "email.manual_link"].includes(name),
  )) {
    const { store, query } = editFixture(name);
    await expect(store.editEmailReview(id, id, id, 1, "Reply")).rejects.toThrow(
      "Email proposal changed or unavailable",
    );
    expect(query.mock.calls.every(([sql]) => !sql.startsWith("UPDATE"))).toBe(
      true,
    );
  }
  for (const [requiresHumanReview, body] of [
    [false, "Reply"],
    [true, "a".repeat(301)],
  ] as const) {
    const { store } = editFixture("linkedin.invitation", {
      requiresHumanReview,
    });
    await expect(store.editEmailReview(id, id, id, 1, body)).rejects.toThrow(
      "An invitation requires human review and at most 300 characters",
    );
  }
});
it("permits an absent legacy route only for the original three email names", async () => {
  for (const name of messages) {
    const query = vi
        .fn()
        .mockResolvedValue({
          rows: [{ id, name, conversation_id: id, state: "approved" }],
        }),
      assertLegacyAgentEmail = vi.fn();
    const store = Object.assign(Object.create(AgentOutreachStore.prototype), {
      nativeTransaction: (work: (c: unknown) => unknown) => work({ query }),
      thread: async () => thread,
      lockConversation: async () => ({ id }),
      nativeOperationRoute: async () => null,
      assertLegacyAgentEmail,
    }) as AgentOutreachStore;
    if (name.startsWith("email.")) {
      expect((await store.channelDispatchRecord(id, id)).route).toBeNull();
      expect(assertLegacyAgentEmail).toHaveBeenCalledOnce();
    } else {
      await expect(store.channelDispatchRecord(id, id), name).rejects.toThrow(
        "Social messages require their original reviewed route",
      );
      expect(assertLegacyAgentEmail).not.toHaveBeenCalled();
    }
  }
});
