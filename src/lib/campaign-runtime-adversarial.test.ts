import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { CampaignDefinition } from "@/domain/campaign";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), fresh: vi.fn(), monitor: vi.fn(), send: vi.fn(), linkedin: vi.fn(), whatsapp: vi.fn(), connected: vi.fn(), gmail: { inboundFrom: vi.fn(), hasConversation: vi.fn(), outboundToSince: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, callback: (client: unknown) => unknown) => callback({ query: mock.query }), withCampaignWorker: (callback: (client: unknown) => unknown) => callback({ query: mock.query }) }));
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: () => true }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: () => ({ ...mock.gmail, send: mock.send }) }));
vi.mock("@/lib/campaign-reply-monitor", () => ({ checkContactReplyMonitors: mock.monitor, assertContactReplyFresh: mock.fresh, prepareReplyContact: vi.fn(), runReplyMonitorTick: vi.fn() }));
vi.mock("@/lib/campaign-linkedin", async original => ({ ...await original<typeof import("./campaign-linkedin")>(), campaignLinkedin: mock.linkedin }));
vi.mock("@/lib/campaign-whatsapp", async original => ({ ...await original<typeof import("./campaign-whatsapp")>(), campaignWhatsapp: mock.whatsapp, assertCampaignWhatsappConnected: mock.connected }));
import { processCampaignEnrolment, processN8nCampaignStep, changeEnrolment } from "./campaign-service";
const actor = { organizationId: "org", userId: "owner" }; const id = randomUUID(); const stepId = randomUUID();
let noEmail: boolean;
let definition: CampaignDefinition, state: string, stopReason: string | null, attempt: string | undefined, stepIndex: number, nextAt: Date | null, reviewed: boolean;
let contactReads: number, changed: string | null, used: number, lastClaim: Date | null, hold: boolean, failCommit: boolean, activeReads: number, race: string | null, suppressed: boolean;
const contact = () => ({ id: "contact", display_name: "Alex Smith", company_name: "Example", fictionalised: changed === "fictionalised" && contactReads > 1,
  personal_data: { email: noEmail ? null : changed === "email" && contactReads > 1 ? "someone@example.test" : "alex@example.test", doNotContact: changed === "suppression" && contactReads > 1,
    phone: changed === "phone" && contactReads > 1 ? "+61499999999" : "+61412345678", linkedinUrl: changed === "profile" && contactReads > 1 ? "https://linkedin.com/in/someone-else" : changed === "invalid-profile" && contactReads > 1 ? "invalid" : "https://linkedin.com/in/alex" } });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "off"); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T01:00:00Z"));
  noEmail = false; state = "active"; stopReason = null; attempt = undefined; stepIndex = 0; nextAt = new Date(0); reviewed = true; contactReads = 0; changed = null; used = 0; lastClaim = null; hold = false; failCommit = false; activeReads = 0; race = null; suppressed = false;
  definition = { schemaVersion: 1, steps: [{ id: stepId, kind: "email", title: "Send", subject: "Hello", body: "Hi {{first_name}}" }] };
  mock.fresh.mockResolvedValue(undefined); mock.monitor.mockResolvedValue(undefined); mock.connected.mockResolvedValue(undefined);
  mock.gmail.inboundFrom.mockResolvedValue([]); mock.gmail.hasConversation.mockResolvedValue(false); mock.gmail.outboundToSince.mockResolvedValue([]);
  mock.send.mockResolvedValue({ providerMessageId: "email-id", providerThreadId: "thread", sentAt: new Date() });
  mock.linkedin.mockResolvedValue({ action: { id: "linkedin-id", status: "submitted" } }); mock.whatsapp.mockResolvedValue({ id: "whatsapp-id", status: "submitted" });
  mock.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("state = 'sent'") && sql.startsWith("UPDATE campaign_send_attempts")) { if (failCommit) { failCommit = false; throw new Error("commit lost after provider acceptance"); } attempt = "sent"; }
    if (sql.startsWith("UPDATE campaign_send_attempts") && sql.includes("state = 'unknown'")) attempt = "unknown";
    if (sql.startsWith("UPDATE campaign_send_attempts") && sql.includes("state = 'cancelled'")) attempt = "cancelled";
    if (sql.startsWith("UPDATE campaign_enrolments SET state = 'needs_review'")) { state = "needs_review"; stopReason = sql.includes("send_result_unknown") ? "send_result_unknown" : sql.includes("whatsapp_result_unknown") ? "whatsapp_result_unknown" : sql.includes("linkedin_result_requires_review") ? "linkedin_result_requires_review" : String(values[1]); }
    if (sql.startsWith("UPDATE campaign_enrolments SET state = $2")) { state = String(values[1]); if (sql.includes("step_index = $3")) { stepIndex = Number(values[2]); nextAt = values[3] as Date | null; } }
    if (sql.startsWith("UPDATE campaign_enrolments SET next_step_at")) nextAt = values[1] as Date;
    return { rows: [], rowCount: 1 };
  });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.startsWith("SELECT * FROM campaign_enrolments")) {
      activeReads++;
      if (race && activeReads === 4) { if (race === "hold") hold = true; else state = race; }
      return [{ id, contact_id: "contact", state, stop_reason: stopReason, organization_id: "org", owner_user_id: "owner", step_index: stepIndex, next_step_at: nextAt, recipient_email: noEmail ? null : "alex@example.test", started_at: new Date(0), initial_conversation_reviewed: reviewed, runtime: "n8n" }];
    }
    if (sql.includes("FROM campaign_sequence_versions")) return [{ definition }];
    if (sql.includes("FROM mailbox_connections")) return [{ id: "mailbox", daily_cap: 10 }];
    if (sql.includes("FROM contacts")) { contactReads++; return [contact()]; }
    if (sql.includes("FROM campaign_contact_holds")) return hold ? [{ reason: "reply_received" }] : [];
    if (sql.includes("FROM suppressions")) return suppressed ? [{ reason: "domain suppression" }] : [];
    if (sql.includes("FROM campaign_contact_assignments")) return [{ id: "assignment" }];
    if (sql.startsWith("SELECT count(*)")) return [{ used: String(used) }];
    if (sql.startsWith("SELECT a.claimed_at")) return lastClaim ? [{ claimed_at: lastClaim }] : [];
    if (sql.includes("FROM campaign_send_attempts") && sql.startsWith("SELECT id, state")) return attempt ? [{ id: "attempt", state: attempt }] : [];
    if (sql.startsWith("SELECT state, sent_at")) return attempt ? [{ state: attempt, sent_at: new Date() }] : [];
    if (sql.startsWith("SELECT sent_at")) return attempt === "sent" ? [{ sent_at: new Date() }] : [];
    if (sql.startsWith("INSERT INTO campaign_send_attempts") || sql.startsWith("UPDATE campaign_send_attempts SET state = 'claimed'")) { attempt = "claimed"; return [{ id: "attempt" }]; }
    return [];
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const providers = () => [mock.send, mock.linkedin, mock.whatsapp];
function channel(kind: "email" | "linkedin" | "whatsapp") {
  const base = { id: stepId, title: "Send", body: "Hi {{first_name}}" };
  definition = { schemaVersion: 1, steps: [kind === "email" ? { ...base, kind, subject: "Hello" } : kind === "linkedin" ? { ...base, kind, action: "message" } : { ...base, kind }] };
}
for (const kind of ["email", "linkedin", "whatsapp"] as const) {
  it(`${kind}: replay never sends twice after successful completion`, async () => {
    channel(kind); expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "sent" });
    expect(state).toBe("completed"); expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "not_due" });
    expect(providers().reduce((n, fn) => n + fn.mock.calls.length, 0)).toBe(1);
  });
  it.each(["paused", "stopped", "hold"])(`${kind}: cancels an unsent claim if %s races with preflight`, async event => {
    channel(kind); race = event; expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "not_due" });
    expect(attempt).toBe("cancelled"); providers().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });
  it(`${kind}: a reply-monitor failure after claiming prevents delivery`, async () => {
    channel(kind); mock.fresh.mockRejectedValue(new Error("reply arrived during preflight"));
    expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" }); expect(attempt).toBe("cancelled"); providers().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });
  it(`${kind}: lost database commit after submission is held and not automatically resent`, async () => {
    channel(kind); failCommit = true; await processCampaignEnrolment(actor, id); expect(attempt).toBe("unknown"); expect(state).toBe("needs_review");
    await processCampaignEnrolment(actor, id); expect(providers().reduce((n, fn) => n + fn.mock.calls.length, 0)).toBe(1);
  });
}
it.each(["email", "suppression", "fictionalised"])("rejects contact %s changing between load and claim", async change => {
  changed = change; expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" }); expect(mock.send).not.toHaveBeenCalled(); expect(attempt).toBeUndefined();
});
it.each(["profile", "invalid-profile"])("LinkedIn holds outreach when %s changes", async change => {
  channel("linkedin"); changed = change; expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" }); expect(attempt).toBe(change === "invalid-profile" ? undefined : "cancelled"); expect(mock.linkedin).not.toHaveBeenCalled();
});
it("WhatsApp cancels changed phone before sending", async () => { channel("whatsapp"); changed = "phone"; await processCampaignEnrolment(actor, id); expect(attempt).toBe("cancelled"); expect(mock.whatsapp).not.toHaveBeenCalled(); });
it.each(["claimed", "unknown", "sent"])("email never resends an existing %s attempt", async previous => { attempt = previous; await processCampaignEnrolment(actor, id); expect(mock.send).not.toHaveBeenCalled(); });
it.each([9, 10, 11])("enforces the exact mailbox daily cap with usage %s", async count => {
  used = count; await processCampaignEnrolment(actor, id); expect(mock.send.mock.calls.length).toBe(count < 10 ? 1 : 0); if (count >= 10) expect(nextAt!.getTime()).toBeGreaterThan(Date.now());
});
it.each([59999, 60000, 60001])("enforces spacing at %s milliseconds", async age => { lastClaim = new Date(Date.now() - age); await processCampaignEnrolment(actor, id); expect(mock.send.mock.calls.length).toBe(age < 60000 ? 0 : 1); });
it("holds unexpected manual outbound instead of composing a competing email", async () => { mock.gmail.outboundToSince.mockResolvedValue(["manual-id"]); expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "manual_outbound_detected" }); expect(mock.send).not.toHaveBeenCalled(); });
it("holds a conversation discovered after enrolment", async () => { reviewed = false; mock.gmail.hasConversation.mockResolvedValue(true); expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "existing_conversation" }); expect(mock.send).not.toHaveBeenCalled(); });
it.each(["send_result_unknown", "linkedin_result_requires_review", "whatsapp_result_unknown", "existing_conversation"])("cannot automatically retry hold %s", async reason => {
  state = "needs_review"; stopReason = reason; await expect(changeEnrolment(actor, id, "retry_preflight")).rejects.toThrow("manual review"); expect(mock.query).not.toHaveBeenCalled();
});
it.each(["completed", "stopped"])("terminal n8n enrolment %s does no provider work", async terminal => { state = terminal; expect(await processN8nCampaignStep(id, randomUUID(), 0)).toEqual({ outcome: "finished", nextStepAt: null }); providers().forEach(fn => expect(fn).not.toHaveBeenCalled()); });
it("future n8n callback does not jump over the current step", async () => { expect(await processN8nCampaignStep(id, randomUUID(), 2)).toEqual({ outcome: "finished", nextStepAt: null }); providers().forEach(fn => expect(fn).not.toHaveBeenCalled()); });

for (const kind of ["email", "linkedin", "whatsapp"] as const) it(`${kind}: suppression introduced after the claim cancels delivery`, async () => {
  channel(kind); mock.fresh.mockImplementation(async () => { suppressed = true; });
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review", reason: expect.stringContaining("suppressed") });
  expect(attempt).toBe("cancelled"); providers().forEach(fn => expect(fn).not.toHaveBeenCalled());
});

it.each(["linkedin", "whatsapp"] as const)("delivers a %s-only sequence without an email or Gmail mailbox", async kind => {
  noEmail = true; channel(kind);
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "sent" });
  expect(mock.rows.mock.calls.some(([,sql]) => sql.includes("FROM mailbox_connections"))).toBe(false);
  expect(mock.gmail.inboundFrom).not.toHaveBeenCalled(); expect(mock.gmail.hasConversation).not.toHaveBeenCalled(); expect(mock.gmail.outboundToSince).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
  expect(kind === "linkedin" ? mock.linkedin : mock.whatsapp).toHaveBeenCalledOnce();
});
