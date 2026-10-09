import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { collectReplyPages } from "./campaign-reply-collector";
import { withCampaignWorkBudget } from "./campaign-work-budget";

const event = { id: "m1", fromIdentity: "alex@example.test", receivedAt: "2026-10-05T10:00:00Z" };
const page = { accountIdentity: "me@example.test", events: [event], nextCursor: "1", complete: true, checkedAt: "2026-10-05T10:00:01Z" };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T10:00:02Z")); });
afterEach(() => vi.useRealTimers());
it("commits events before marking the account fresh and continues from durable checkpoints", async () => {
  const read = vi.fn().mockResolvedValueOnce({ ...page, complete: false }).mockResolvedValueOnce({ ...page, events: [], nextCursor: "2" });
  const commit = vi.fn().mockResolvedValue(true);
  expect(await collectReplyPages({ cursor: null, accountIdentity: null, read, commit })).toEqual({ complete: true, cursor: "2" });
  expect(read.mock.calls).toEqual([[null], ["1"]]);
  expect(commit.mock.calls[0][0].complete).toBe(false);
});
it("does not advance a checkpoint after a failed transaction", async () => {
  const read = vi.fn().mockResolvedValue(page); const commit = vi.fn().mockRejectedValue(new Error("database offline"));
  await expect(collectReplyPages({ cursor: null, accountIdentity: null, read, commit })).rejects.toThrow("database offline");
  expect(read).toHaveBeenCalledOnce();
});
it("rejects changed accounts, invalid events and pagination loops", async () => {
  const commit = vi.fn();
  await expect(collectReplyPages({ cursor: null, accountIdentity: "old@example.test", read: async () => page, commit })).rejects.toThrow("account changed");
  await expect(collectReplyPages({ cursor: null, accountIdentity: null, read: async () => ({ ...page, events: [{ ...event, receivedAt: "invalid" }] }), commit })).rejects.toThrow();
  await expect(collectReplyPages({ cursor: "1", accountIdentity: null, read: async () => ({ ...page, complete: false }), commit })).rejects.toThrow("checkpoint");
  expect(commit).not.toHaveBeenCalled();
});
it("stops a stale worker after lease takeover and bounds partial scans", async () => {
  const read = vi.fn().mockResolvedValue(page);
  expect(await collectReplyPages({ cursor: null, accountIdentity: null, read, commit: async () => false })).toEqual({ complete: false, cursor: null });
  let count = 0;
  expect(await collectReplyPages({ cursor: null, accountIdentity: null, maxPages: 2, read: async () => ({ ...page, complete: false, nextCursor: String(++count) }), commit: async () => true })).toEqual({ complete: false, cursor: "2" });
});
it.each(["checkedAt", "receivedAt"])("rejects future %s before committing", async field => {
  const future = new Date(Date.now() + 5001).toISOString(); const commit = vi.fn();
  const bad = field === "checkedAt" ? { ...page, checkedAt: future } : { ...page, events: [{ ...event, receivedAt: future }] };
  await expect(collectReplyPages({ cursor: null, accountIdentity: null, read: async () => bad, commit })).rejects.toThrow("timestamps"); expect(commit).not.toHaveBeenCalled();
});
it("detects multi-page cursor cycles and retains only committed progress", async () => {
  const read = vi.fn().mockResolvedValueOnce({ ...page, complete: false, nextCursor: "a" }).mockResolvedValueOnce({ ...page, complete: false, nextCursor: "b" }).mockResolvedValueOnce({ ...page, complete: false, nextCursor: "a" }); const commit = vi.fn().mockResolvedValue(true);
  await expect(collectReplyPages({ cursor: null, accountIdentity: null, read, commit })).rejects.toThrow("checkpoint"); expect(commit).toHaveBeenCalledTimes(2);
});
it("binds all pages to the first observed account even with no saved account", async () => {
  const read = vi.fn().mockResolvedValueOnce({ ...page, complete: false }).mockResolvedValueOnce({ ...page, nextCursor: "2", accountIdentity: "someone-else" }); const commit = vi.fn().mockResolvedValue(true);
  await expect(collectReplyPages({ cursor: null, accountIdentity: null, read, commit })).rejects.toThrow("account changed"); expect(commit).toHaveBeenCalledOnce();
});
it("rejects oversized pages and unexpected fields before commit", async () => {
  for (const bad of [{ ...page, events: Array.from({ length: 501 }, () => event) }, { ...page, complete: "true" }, { ...page, nextCursor: "x".repeat(4001) }, { ...page, ownerUserId: "attacker" }]) {
    const commit = vi.fn(); await expect(collectReplyPages({ cursor: null, accountIdentity: null, read: async () => bad, commit })).rejects.toThrow(); expect(commit).not.toHaveBeenCalled();
  }
});

it("commits queued replies while waiting for the next provider read without looping or certifying freshness", async () => {
  const nextReadAt = "2026-10-05T10:05:00Z";
  const read = vi.fn().mockResolvedValue({ ...page, complete: false, nextCursor: "1", nextReadAt });
  const commit = vi.fn().mockResolvedValue(true);
  expect(await collectReplyPages({ cursor: "1", accountIdentity: page.accountIdentity, read, commit })).toEqual({ complete: false, cursor: "1", nextReadAt });
  expect(read).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce();
});
it("does not accept a repeated checkpoint with an expired backoff", async () => {
  const commit = vi.fn();
  await expect(collectReplyPages({ cursor: "1", accountIdentity: null, read: async () => ({ ...page, complete: false, nextReadAt: "2026-10-05T10:00:01Z" }), commit })).rejects.toThrow("checkpoint");
  expect(commit).not.toHaveBeenCalled();
});

it("defers an untouched page and preserves its durable checkpoint", async () => {
  const read = vi.fn(), commit = vi.fn();
  const result = await withCampaignWorkBudget(0, () => collectReplyPages({ cursor: "saved", accountIdentity: page.accountIdentity, read, commit }));
  expect(result).toEqual({ complete: false, cursor: "saved", deferred: true });
  expect(read).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
});

it("returns committed progress when its budget expires between pages", async () => {
  const read = vi.fn().mockResolvedValue({ ...page, complete: false, nextCursor: "saved-next" });
  const commit = vi.fn().mockImplementation(async () => { vi.setSystemTime(Date.now() + 20); return true; });
  const result = await withCampaignWorkBudget(10, () => collectReplyPages({ cursor: "before", accountIdentity: page.accountIdentity, read, commit }));
  expect(result).toEqual({ complete: false, cursor: "saved-next", deferred: true });
  expect(read).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce();
});
