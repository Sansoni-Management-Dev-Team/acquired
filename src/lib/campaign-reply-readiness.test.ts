import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({
  rows: vi.fn(),
  fresh: vi.fn(),
  delivery: vi.fn(),
  whatsapp: vi.fn(),
  mailbox: vi.fn(),
}));
vi.mock("server-only", () => ({}));
// Explicit synthetic grant policy; actual historical grants are separately paused.
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: (grant: {encryptedRefreshToken: string|null;reconnectRequired: boolean;scopes: string[]|null}) => !!grant.encryptedRefreshToken && !grant.reconnectRequired && !!grant.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly") && !!grant.scopes?.includes("https://www.googleapis.com/auth/gmail.compose") }));
vi.mock("@/lib/channels/delivery-registry", async () => {
  const { campaignDeliveryFixture } = await import("@/test/campaign-delivery-fixture");
  return { deliveryProvider: campaignDeliveryFixture({ whatsappReady: mock.whatsapp, linkedinReady: mock.delivery }) };
});
vi.mock("@/db/campaign-client", () => ({
  rows: mock.rows,
  withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({}),
}));
vi.mock("@/lib/campaign-reply-monitor", () => ({
  assertContactReplyFresh: mock.fresh,
}));
vi.mock("@/lib/campaign-linkedin", () => ({
  assertLinkedinDeliveryReady: mock.delivery,
}));
vi.mock("@/lib/campaign-whatsapp", () => ({
  assertCampaignWhatsappConnected: mock.whatsapp,
}));
vi.mock("@/lib/campaign-mailbox", () => ({
  campaignMailboxForConnection: mock.mailbox,
}));
import { campaignReplyReadiness } from "./campaign-reply-readiness";
import { ReplyCheckPending, ReplyCheckReview } from "./campaign-reply-status";
let stopReason: string | null;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce");
  stopReason = null;
  mock.rows.mockImplementation(async () => [
    {
      id: "enrolment",
      contact_id: "contact",
      state: "active",
      stop_reason: stopReason,
      started_at: new Date(0),
      definition: {
        schemaVersion: 1,
        steps: [
          {
            id: randomUUID(),
            kind: "linkedin",
            action: "connect",
            title: "Connect",
            body: "",
          },
        ],
      },
    },
  ]);
});
afterEach(() => vi.unstubAllEnvs());
it("rejects enforcement activation with neither scoped coverage nor an explicit waiting state", async () => {
  mock.fresh.mockRejectedValue(new ReplyCheckPending("incomplete", "linkedin"));
  expect(
    await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
  ).toMatchObject({
    enforceReady: false,
    recoveryReady: false,
    enrolments: [{ coverage: "waiting", explicitWaiting: false }],
  });
});
it("accepts enforcement with an explicit safe waiting state, but never authorizes recovery", async () => {
  stopReason = "reply_monitor_wait";
  mock.fresh.mockRejectedValue(
    new ReplyCheckPending("rate_limited", "linkedin"),
  );
  expect(
    await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
  ).toMatchObject({
    enforceReady: true,
    recoveryReady: false,
    enrolments: [
      { explicitWaiting: true, diagnostic: { code: "rate_limited" } },
    ],
  });
});
it("reports disabled delivery independently of successful coverage", async () => {
  mock.delivery.mockRejectedValue(
    new ReplyCheckReview("delivery_disabled", "linkedin"),
  );
  expect(
    await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
  ).toMatchObject({
    enforceReady: true,
    recoveryReady: false,
    enrolments: [{ coverage: "ready", delivery: "review" }],
  });
});
it("requires enforced fresh coverage and both delivery gates for recovery readiness", async () => {
  expect(
    await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
  ).toMatchObject({ enforceReady: true, recoveryReady: true });
  vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "observe");
  expect(
    await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
  ).toMatchObject({ enforceReady: false, recoveryReady: false });
});

it("reports disabled WhatsApp journals before declaring recovery ready", async () => {
  mock.rows.mockResolvedValue([
    {
      id: "enrolment",
      contact_id: "contact",
      state: "active",
      started_at: new Date(0),
      definition: {
        schemaVersion: 1,
        steps: [
          { id: randomUUID(), kind: "whatsapp", title: "Hello", body: "Hello" },
        ],
      },
    },
  ]);
  mock.whatsapp.mockRejectedValue(
    new ReplyCheckReview("delivery_disabled", "whatsapp"),
  );
  expect(
    await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
  ).toMatchObject({
    recoveryReady: false,
    enrolments: [
      {
        delivery: "review",
        deliveryDiagnostic: { channel: "whatsapp", code: "delivery_disabled" },
      },
    ],
  });
});

it.each([true, false])(
  "email readiness validates the owned mailbox and required scopes: %s",
  async (ready) => {
    const job = {
      id: "enrolment",
      contact_id: "contact",
      state: "active",
      started_at: new Date(0),
      definition: {
        schemaVersion: 1,
        steps: [
          {
            id: randomUUID(),
            kind: "email",
            title: "Hello",
            subject: "Hello",
            body: "Hello",
          },
        ],
      },
    };
    mock.rows.mockImplementation(async (_client, sql: string) =>
      sql.includes("FROM mailbox_connections")
        ? [
            {
              id: "mailbox",
              encrypted_refresh_token: "fixture",
              reconnect_required: false,
              scopes: [
                "https://www.googleapis.com/auth/gmail.compose",
                ...(ready
                  ? ["https://www.googleapis.com/auth/gmail.readonly"]
                  : []),
              ],
            },
          ]
        : [job],
    );
    mock.mailbox.mockReturnValue({});
    expect(
      await campaignReplyReadiness({ organizationId: "org", userId: "owner" }),
    ).toMatchObject({
      recoveryReady: ready,
      enrolments: [{ delivery: ready ? "ready" : "review" }],
    });
    expect(mock.mailbox.mock.calls.length).toBe(ready ? 1 : 0);
  },
);
