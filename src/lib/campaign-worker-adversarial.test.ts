import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), start: vi.fn(), provision: vi.fn(), remove: vi.fn(), replyTick: vi.fn(), actor: vi.fn(), find: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignTickLock: async (callback: () => Promise<unknown>) => ({ acquired: true, result: await callback() }), withCampaignWorker: (callback: (client: unknown) => unknown) => callback({ query: mock.query }), withCampaignDb: (actor: unknown, callback: (client: unknown) => unknown) => { mock.actor(actor); return callback({ query: mock.query }); } }));
vi.mock("@/lib/campaign-n8n", () => ({ startSequenceContact: mock.start, provisionSequenceWorkflow: mock.provision, removeSequenceWorkflow: mock.remove, n8nCampaignEnabled: () => true }));
vi.mock("@/lib/campaign-reply-monitor", () => ({ runReplyMonitorTick: mock.replyTick, checkContactReplyMonitors: vi.fn(), assertContactReplyFresh: vi.fn() }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: () => ({ findByRfcMessageId: mock.find }) }));
import { runCampaignTick, syncPublishedCampaignWorkflows } from "./campaign-service";
const definition = { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "email", title: "Intro", subject: "Hi", body: "Hello" }] };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "off"); mock.rows.mockResolvedValue([]); mock.query.mockResolvedValue({ rows: [], rowCount: 1 }); mock.start.mockResolvedValue(undefined); mock.replyTick.mockResolvedValue({ scanned: 0, complete: 0, incomplete: 0, failed: 0, skipped: 0, deferred: 0 }); mock.provision.mockResolvedValue("workflow"); mock.remove.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());
it("empty tick is a no-op and does not provision, dispatch or inspect mailbox", async () => {
  expect(await runCampaignTick()).toMatchObject({ processed: 0, n8nDispatches: 0, replyScans: 0, unknownChecks: 0 }); expect(mock.start).not.toHaveBeenCalled(); expect(mock.provision).not.toHaveBeenCalled(); expect(mock.find).not.toHaveBeenCalled();
});
it("a failed webhook dispatch remains unmarked so the next tick can recover", async () => {
  mock.rows.mockResolvedValueOnce([{ id: "enrolment", version_id: "version" }]); mock.start.mockRejectedValue(new Error("response lost"));
  await runCampaignTick(); expect(mock.start).toHaveBeenCalledWith("version", "enrolment"); expect(mock.query.mock.calls.some(([sql]) => sql.includes("SET n8n_started_at"))).toBe(false);
});
it("dispatch marker is written only after the webhook accepted the request", async () => {
  mock.rows.mockResolvedValueOnce([{ id: "enrolment", version_id: "version" }]); await runCampaignTick(); expect(mock.query).toHaveBeenCalledWith(expect.stringContaining("n8n_started_at IS NULL"), ["enrolment"]); expect(mock.start.mock.invocationCallOrder[0]).toBeLessThan(mock.query.mock.invocationCallOrder[0]);
});
it("one failed legacy job does not prevent later jobs and uses their recorded owners", async () => {
  mock.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "bad", organization_id: "org", owner_user_id: "owner-a" }, { id: "good", organization_id: "org", owner_user_id: "owner-b" }]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("owner removed")).mockResolvedValueOnce([]);
  const result = await runCampaignTick(); expect(result.processed).toBe(2); expect(result.results).toEqual([{ id: "bad", outcome: "owner removed" }, { id: "good", outcome: "not_due" }]); expect(mock.actor.mock.calls.map(([actor]) => actor)).toEqual([{ organizationId: "org", userId: "owner-a" }, { organizationId: "org", userId: "owner-b" }]);
});
it("mailbox scan failure holds the enrolment without attempting any send", async () => {
  mock.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "enrolment", organization_id: "org", owner_user_id: "owner" }]); await runCampaignTick(); expect(mock.query).toHaveBeenCalledWith(expect.stringContaining("reply_check_failed"), ["enrolment"]); expect(mock.find).not.toHaveBeenCalled();
});
it("ambiguous-send reconciliation failures are isolated and do not become sends", async () => {
  mock.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "attempt", organization_id: "org", owner_user_id: "owner" }]).mockRejectedValueOnce(new Error("mailbox unavailable")); expect((await runCampaignTick()).unknownChecks).toBe(1); expect(mock.start).not.toHaveBeenCalled(); expect(mock.query).not.toHaveBeenCalled();
});
it("sync losing a version race removes its orphan workflow", async () => { mock.rows.mockResolvedValue([{ id: "version", sequence_name: "Sequence", version: 1, definition }]); mock.query.mockResolvedValue({ rows: [], rowCount: 0 }); expect(await syncPublishedCampaignWorkflows()).toEqual({ synced: [] }); expect(mock.remove).toHaveBeenCalledWith("workflow"); });
it("sync preserves database failures even if orphan cleanup fails", async () => { mock.rows.mockResolvedValue([{ id: "version", sequence_name: "Sequence", version: 1, definition }]); mock.query.mockRejectedValue(new Error("db failed")); mock.remove.mockRejectedValue(new Error("cleanup failed")); await expect(syncPublishedCampaignWorkflows()).rejects.toThrow("db failed"); expect(mock.remove).toHaveBeenCalledWith("workflow"); });
it("sync pins the original version and updates only its empty workflow reference", async () => { mock.rows.mockResolvedValue([{ id: "version", sequence_name: "Sequence", version: 4, definition }]); expect(await syncPublishedCampaignWorkflows()).toEqual({ synced: [{ versionId: "version", workflowId: "workflow" }] }); expect(mock.provision).toHaveBeenCalledWith({ versionId: "version", sequenceName: "Sequence", version: 4, definition }); expect(mock.query).toHaveBeenCalledWith(expect.stringContaining("n8n_workflow_id IS NULL"), ["version", "workflow"]); expect(mock.query.mock.calls.every(([sql]) => !sql.includes("campaign_enrolments"))).toBe(true); });
it("sync refuses malformed stored graphs before provisioning", async () => { mock.rows.mockResolvedValue([{ id: "version", definition: { schemaVersion: 1, steps: [] } }]); await expect(syncPublishedCampaignWorkflows()).rejects.toThrow(); expect(mock.provision).not.toHaveBeenCalled(); });
