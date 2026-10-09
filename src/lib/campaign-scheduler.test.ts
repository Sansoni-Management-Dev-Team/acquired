import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), lock: vi.fn(), prepare: vi.fn(), check: vi.fn(), monitor: vi.fn(), preflight: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignTickLock: mock.lock, withCampaignDb: (_actor: unknown, callback: (client: unknown) => unknown) => callback({ query: mock.query }), withCampaignWorker: (callback: (client: unknown) => unknown) => callback({ query: mock.query }) }));
vi.mock("@/lib/campaign-reply-monitor", () => ({ prepareScheduledReplyContact: mock.prepare, checkScheduledReplyContact: mock.check, runReplyMonitorTick: mock.monitor, checkContactReplyMonitors: mock.preflight }));
import { runCampaignTick } from "./campaign-service";
import { CampaignWorkDeferred } from "./campaign-work-budget";

const definition = { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "linkedin", action: "message", title: "Hello", body: "Hello" }] };
let enrolments: { id: string; contact_id: string; version_id: string; organization_id: string; owner_user_id: string; state: string; recipient_email: null; started_at: Date; last_reply_checked_at: Date | null }[];
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); vi.useFakeTimers(); vi.setSystemTime("2026-10-09T00:00:00Z");
  enrolments = Array.from({ length: 5 }, (_, i) => ({ id: `enrolment-${i}`, contact_id: `contact-${i}`, version_id: "version", organization_id: "org", owner_user_id: "owner", state: "needs_review", recipient_email: null, started_at: new Date(0), last_reply_checked_at: null }));
  mock.lock.mockImplementation(async callback => ({ acquired: true, result: await callback() }));
  mock.prepare.mockResolvedValue(undefined); mock.check.mockResolvedValue(undefined);
  mock.monitor.mockResolvedValue({ scanned: 1, complete: 0, incomplete: 1, failed: 0, skipped: 0, deferred: 0 });
  mock.rows.mockImplementation(async (_client, sql: string, values: unknown[]) => {
    if (sql.includes("last_reply_checked_at IS NULL")) return enrolments.filter(item => !item.last_reply_checked_at || item.last_reply_checked_at.getTime() < Date.now() - 300_000).slice(0, values[0] as number);
    if (sql.includes("FROM contacts")) return [{ id: values[0], personal_data: { linkedinUrl: "https://www.linkedin.com/in/synthetic" } }];
    if (sql.includes("FROM campaign_sequence_versions")) return [{ definition }];
    return [];
  });
  mock.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes("SET last_reply_checked_at")) enrolments.find(item => item.id === values[0])!.last_reply_checked_at = new Date();
    return { rowCount: 1 };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("maintains five contacts fairly with one account scan per tick and no delivery preflights", async () => {
  for (let i = 0; i < 5; i++) {
    const output = await runCampaignTick();
    expect(output.replyScans).toBe(1); expect(output.replyMonitoring.incomplete).toBe(1);
    expect(output.scheduler).toMatchObject({ skipped: false, deferred: false });
    vi.setSystemTime(Date.now() + 60_000);
  }
  expect(mock.prepare.mock.calls.map(([, contact]) => contact.id)).toEqual(enrolments.map(item => item.contact_id));
  expect(mock.monitor).toHaveBeenCalledTimes(5); expect(mock.check).toHaveBeenCalledTimes(5);
  expect(mock.preflight).not.toHaveBeenCalled();
  expect(mock.prepare.mock.invocationCallOrder[0]).toBeLessThan(mock.monitor.mock.invocationCallOrder[0]);
  expect(mock.monitor.mock.invocationCallOrder[0]).toBeLessThan(mock.check.mock.invocationCallOrder[0]);
});

it("does not mark an untouched or deadline-deferred contact checked or failed", async () => {
  mock.prepare.mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 21_000); throw new CampaignWorkDeferred(); });
  expect((await runCampaignTick()).scheduler.deferred).toBe(true);
  expect(enrolments.every(item => item.last_reply_checked_at === null)).toBe(true);
  expect(mock.query).not.toHaveBeenCalled(); expect(mock.check).not.toHaveBeenCalled();
});

it("does not begin work once the admission budget is exhausted", async () => {
  mock.rows.mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 21_000); return [{ id: "dispatch", version_id: "version" }]; });
  const result = await runCampaignTick();
  expect(result.scheduler.deferred).toBe(true); expect(result.n8nDispatches).toBe(0);
  expect(mock.prepare).not.toHaveBeenCalled(); expect(mock.monitor).not.toHaveBeenCalled();
});

it("skips an overlapping scheduler without querying or mutating jobs", async () => {
  mock.lock.mockResolvedValue({ acquired: false });
  const result = await runCampaignTick();
  expect(result.scheduler.skipped).toBe(true); expect(result.replyScans).toBe(0);
  expect(mock.rows).not.toHaveBeenCalled(); expect(mock.query).not.toHaveBeenCalled();
});

it("preserves a completed scan count and contact timestamps if later work is deferred", async () => {
  mock.monitor.mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 21_000); return { scanned: 1, complete: 0, incomplete: 1, failed: 0, skipped: 0, deferred: 1 }; });
  const result = await runCampaignTick();
  expect(result.replyMonitoring).toMatchObject({ scanned: 1, incomplete: 1, deferred: 1 });
  expect(result.scheduler.deferred).toBe(true); expect(enrolments[0].last_reply_checked_at).toBeNull();
  expect(mock.check).not.toHaveBeenCalled(); expect(mock.query).not.toHaveBeenCalled();
});

it("records a genuine maintenance failure without resuming existing holds", async () => {
  mock.check.mockRejectedValueOnce(new Error("LinkedIn inbox incomplete"));
  expect((await runCampaignTick()).replyScans).toBe(1);
  expect(mock.query).toHaveBeenCalledWith(expect.stringContaining("state = 'active'"), ["enrolment-0"]);
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("state = 'active',"))).toBe(false);
});
