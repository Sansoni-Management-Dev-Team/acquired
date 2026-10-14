import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), check: vi.fn(), fresh: vi.fn(), coverage: vi.fn(), delivery: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/lib/campaign-reply-monitor", () => ({ checkContactReplyMonitors: mock.check, assertContactReplyFresh: mock.fresh, assertReplyCoverage: mock.coverage }));
vi.mock("@/lib/communications-bindings", () => ({ resolveRecordedApplicationConnection: async () => ({ bindingId: "original-binding", binding: { applicationId: "acquire", tenantId: "org", ownerId: "owner", connectionId: "original", accountId: "account", generation: 1, channel: "linkedin", platform: "linkedin", backend: "unipile" }, recoveryOnly: false }) }));
vi.mock("@/lib/communications-client", () => ({ actorCommunicationsClient: async () => ({ ready: mock.delivery }) }));
import { changeEnrolment } from "./campaign-service";
import { ReplyCheckPending, ReplyCheckReview } from "./campaign-reply-status";
const actor = { organizationId: "org", userId: "owner" };
const id = randomUUID(), contactId = randomUUID();
let attempt: string | undefined, canonicalHold: boolean;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("COMMUNICATIONS_RUNTIME_ENABLED", "true"); mock.delivery.mockResolvedValue({status:"ready"}); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); vi.stubEnv("CAMPAIGN_TEST_SEND_ANYTIME", "true"); attempt = undefined; canonicalHold = false;
  mock.query.mockResolvedValue({ rowCount: 1 });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.includes("FROM campaign_enrolments")) return [{ id, contact_id: contactId, organization_id: "org", owner_user_id: "owner", state: "needs_review", stop_reason: "reply_check_failed", recipient_email: null, recipient_linkedin: "https://www.linkedin.com/in/alex", step_index: 0, started_at: new Date(0) }];
    if (sql.includes("FROM campaign_sequence_versions")) return [{ definition: { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "linkedin", action: "connect", title: "Connect", body: "" }] } }];
    if (sql.includes("FROM contacts")) return [{ id: contactId, personal_data: { linkedinUrl: "https://www.linkedin.com/in/alex" } }];
    if (sql.includes("FROM campaign_send_attempts")) return attempt ? [{ state: attempt }] : [];
    if (sql.includes("FROM campaign_reply_holds")) return canonicalHold ? [{ reason: "reply_received" }] : [];
    return [];
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["claimed", "unknown", "sent"])("never restores a current step with a %s attempt", async state => {
  attempt = state;
  await expect(changeEnrolment(actor, id, "retry_preflight")).rejects.toThrow();
  expect(mock.query).not.toHaveBeenCalled();
});
it("keeps canonical reply holds intact", async () => {
  canonicalHold = true;
  await expect(changeEnrolment(actor, id, "retry_preflight")).rejects.toThrow(); expect(mock.query).not.toHaveBeenCalled();
});
it.each([new ReplyCheckPending("stale", "linkedin"), new ReplyCheckReview("account_changed", "linkedin")])("does not restore failed freshness checks", async failure => {
  mock.check.mockRejectedValue(failure);
  await expect(changeEnrolment(actor, id, "retry_preflight")).rejects.toThrow(); expect(mock.query).not.toHaveBeenCalled();
});
it("requires both delivery gates before restoring a LinkedIn hold", async () => {
  mock.delivery.mockRejectedValue(new ReplyCheckReview("delivery_disabled", "linkedin"));
  await expect(changeEnrolment(actor, id, "retry_preflight")).rejects.toThrow(); expect(mock.query).not.toHaveBeenCalled();
});
it("rechecks coverage under the recovery lock and restores only the existing step", async () => {
  expect(await changeEnrolment(actor, id, "retry_preflight")).toMatchObject({ state: "active", nextStepAt: expect.any(Date) });
  expect(mock.check).toHaveBeenCalledOnce(); expect(mock.delivery).toHaveBeenCalledOnce(); expect(mock.coverage).toHaveBeenCalledOnce();
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("step_index ="))).toBe(false);
});
it("rejects coverage invalidated between preflight and the recovery transaction", async () => {
  mock.coverage.mockRejectedValue(new ReplyCheckPending("stale", "linkedin"));
  await expect(changeEnrolment(actor, id, "retry_preflight")).rejects.toThrow(); expect(mock.query).not.toHaveBeenCalled();
});

it("accepts equivalent saved LinkedIn URLs from older enrolments", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    const result = await original(client, sql);
    if (sql.includes("FROM campaign_enrolments")) result[0].recipient_linkedin = "https://au.linkedin.com/in/alex/?tracking=old";
    return result;
  });
  expect(await changeEnrolment(actor, id, "retry_preflight")).toMatchObject({ state: "active" });
});
