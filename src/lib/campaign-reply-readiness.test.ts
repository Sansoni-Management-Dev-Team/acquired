import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), fresh: vi.fn(), delivery: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({}) }));
vi.mock("@/lib/campaign-reply-monitor", () => ({ assertContactReplyFresh: mock.fresh }));
vi.mock("@/lib/campaign-linkedin", () => ({ assertLinkedinDeliveryReady: mock.delivery }));
import { campaignReplyReadiness } from "./campaign-reply-readiness";
import { ReplyCheckPending, ReplyCheckReview } from "./campaign-reply-status";
let stopReason: string | null;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); stopReason = null;
  mock.rows.mockImplementation(async () => [{ id: "enrolment", contact_id: "contact", state: "active", stop_reason: stopReason, started_at: new Date(0), definition: { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "linkedin", action: "connect", title: "Connect", body: "" }] } }]);
});
afterEach(() => vi.unstubAllEnvs());
it("rejects enforcement activation with neither scoped coverage nor an explicit waiting state", async () => {
  mock.fresh.mockRejectedValue(new ReplyCheckPending("incomplete", "linkedin"));
  expect(await campaignReplyReadiness({ organizationId: "org", userId: "owner" })).toMatchObject({ enforceReady: false, recoveryReady: false, enrolments: [{ coverage: "waiting", explicitWaiting: false }] });
});
it("accepts enforcement with an explicit safe waiting state, but never authorizes recovery", async () => {
  stopReason = "reply_monitor_wait"; mock.fresh.mockRejectedValue(new ReplyCheckPending("rate_limited", "linkedin"));
  expect(await campaignReplyReadiness({ organizationId: "org", userId: "owner" })).toMatchObject({ enforceReady: true, recoveryReady: false, enrolments: [{ explicitWaiting: true, diagnostic: { code: "rate_limited" } }] });
});
it("reports disabled delivery independently of successful coverage", async () => {
  mock.delivery.mockRejectedValue(new ReplyCheckReview("delivery_disabled", "linkedin"));
  expect(await campaignReplyReadiness({ organizationId: "org", userId: "owner" })).toMatchObject({ enforceReady: true, recoveryReady: false, enrolments: [{ coverage: "ready", delivery: "review" }] });
});
it("requires enforced fresh coverage and both delivery gates for recovery readiness", async () => {
  expect(await campaignReplyReadiness({ organizationId: "org", userId: "owner" })).toMatchObject({ enforceReady: true, recoveryReady: true });
  vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "observe");
  expect(await campaignReplyReadiness({ organizationId: "org", userId: "owner" })).toMatchObject({ enforceReady: false, recoveryReady: false });
});
