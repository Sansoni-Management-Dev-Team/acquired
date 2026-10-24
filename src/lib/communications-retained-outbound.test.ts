import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  blocked: false,
  finishBlocked: false,
  finished: [] as unknown[],
  client: null as unknown,
}));
vi.mock(
  "../../communications/packages/storage-postgres/src/runtime-sql",
  () => ({
    runtimeTransaction: async (
      _p: unknown,
      _t: unknown,
      fn: (c: unknown) => unknown,
    ) => fn(state.client),
  }),
);
vi.mock(
  "../../communications/packages/storage-postgres/src/reply-barrier",
  () => ({
    createPostgresReplyBarrier: () => ({
      lock: async () => {},
      route: async () => ({ revision: "1" }),
      review: async () => {},
    }),
  }),
);
vi.mock(
  "../../communications/packages/storage-postgres/src/webhook-repository",
  () => ({
    createPostgresWebhookRepository: (options: {
      replyBarrier: { lock(c: unknown, a: string, t: string): Promise<void> };
    }) => ({
      claim: async () => {
        await options.replyBarrier.lock(state.client, "acquire", "org");
        return { kind: "claimed", record: { key: "original" } };
      },
      finish: async (input: unknown) => {
        state.blocked = state.finishBlocked;
        await options.replyBarrier.lock(state.client, "acquire", "org");
        state.finished.push(input);
        return { committed: true };
      },
    }),
  }),
);
import { createRetainedOutboundReview } from "./communications-retained-outbound";
function fixture() {
  const raw = {
    event: "mail_sent",
    account_id: "provider",
    tracking_id: "tracking",
    email_id: "email",
  };
  const row = {
    id: "original",
    application_id: "acquire",
    tenant_id: "org",
    owner_id: "user",
    connection_id: "connection",
    account_id: "account",
    generation: 1,
    channel: "email",
    platform: "gmail",
    backend: "unipile",
    integration_id: "integration",
    provider_configuration_reference: "configuration",
    encrypted_payload: "{}",
    received_at: "2026-01-01T00:00:00Z",
    key_version: "k1",
    payload_digest: "digest",
    provider_account_key_version: "k1",
    provider_account_digest: "provider-digest",
  };
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith("SELECT w.*")
      ? [row]
      : sql.startsWith("SELECT 1 WHERE")
        ? state.blocked
          ? [{}]
          : []
        : [{}],
  }));
  state.client = { query };
  const verify = vi.fn(async () => true),
    authorize = vi.fn(async () => {});
  const service = createRetainedOutboundReview({
    pool: {} as never,
    captureCodec: {
      decode: () => ({
        receivedAt: row.received_at,
        rawBody: Buffer.from(JSON.stringify(raw)),
      }),
      digest: () => row.payload_digest,
    } as never,
    eventCodec: {} as never,
    subscriberId: "subscriber",
    providerDigest: () => row.provider_account_digest,
    providerAccount: () => raw.account_id,
    authorize,
    withAuthority: async (_s, work) => work(),
    externalSent: {
      recipientIdentity: () => ({
        keyVersion: "identity-v1",
        digest: "a".repeat(64),
      }),
      verify,
      trackingDigests: () => ["tracking-digest"],
    },
  });
  return { service, verify, authorize, query };
}
const scope = { applicationId: "acquire", tenantId: "org", ownerId: "user" };
beforeEach(() => {
  state.blocked = false;
  state.finishBlocked = false;
  state.finished = [];
});
it("completes canonical external sent observation despite unrelated fully tracked journals without receipt or reply credit", async () => {
  const f = fixture();
  expect(await f.service.drain(scope)).toEqual({ reviewed: 1 });
  expect(state.finished).toEqual([
    {
      record: { key: "original" },
      outcome: { kind: "ignore", reason: "outgoing_message" },
    },
  ]);
  expect(
    f.query.mock.calls.filter(([s]) => s.startsWith("SELECT 1 WHERE")),
  ).toHaveLength(2);
});
it.each(["matching ACK", "active send", "unknown send"])(
  "retains original callback when %s association exists",
  async () => {
    state.blocked = true;
    const f = fixture();
    expect(await f.service.drain(scope)).toEqual({ reviewed: 0 });
    expect(state.finished).toEqual([]);
  },
);
it("rechecks under finish lock and retains original when an ACK or unresolved send races canonical provider read", async () => {
  state.finishBlocked = true;
  const f = fixture();
  expect(await f.service.drain(scope)).toEqual({ reviewed: 0 });
  expect(state.finished).toEqual([]);
});
it("retains invalid canonical source and revoked owner without changing manual review behavior", async () => {
  const f = fixture();
  f.verify.mockResolvedValue(false);
  expect(await f.service.drain(scope)).toEqual({ reviewed: 0 });
  expect(state.finished).toEqual([]);
  f.authorize.mockRejectedValue(Error("revoked"));
  await expect(f.service.drain(scope)).rejects.toThrow("revoked");
  expect(state.finished).toEqual([]);
});
