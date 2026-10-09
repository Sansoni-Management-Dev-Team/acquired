import { afterEach, expect, it, vi } from "vitest";
import { assertCampaignWorkRemaining, campaignReadSignal, campaignRemainingMs, CampaignWorkDeferred, withCampaignWorkBudget, withCampaignWorkCleanup, withoutCampaignWorkBudget } from "./campaign-work-budget";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("isolates concurrent scheduler budgets and leaves delivery callbacks unbounded", async () => {
  await withCampaignWorkBudget(0, async () => {
    expect(() => assertCampaignWorkRemaining()).toThrow(CampaignWorkDeferred);
    await withoutCampaignWorkBudget(async () => expect(campaignRemainingMs()).toBe(Infinity));
    expect(campaignRemainingMs()).toBe(0);
  });
  expect(campaignRemainingMs()).toBe(Infinity);
});

it("nested work cannot extend admission but awaited cleanup gets a fresh bounded budget", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  await withCampaignWorkBudget(20, async () => {
    await withCampaignWorkBudget(100, async () => expect(campaignRemainingMs()).toBe(20));
    vi.setSystemTime(1021);
    await withCampaignWorkCleanup(async () => expect(campaignRemainingMs()).toBe(5000));
    expect(() => campaignReadSignal()).toThrow(CampaignWorkDeferred);
  });
});

it("limits scheduled reads to the remaining work and keeps normal reader timeouts", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  vi.useFakeTimers(); vi.setSystemTime(1000);
  campaignReadSignal(); expect(timeout).toHaveBeenLastCalledWith(50_000);
  await withCampaignWorkBudget(20_000, async () => {
    campaignReadSignal(); expect(timeout).toHaveBeenLastCalledWith(10_000);
    vi.setSystemTime(20_000);
    campaignReadSignal(); expect(timeout).toHaveBeenLastCalledWith(1000);
  });
});
