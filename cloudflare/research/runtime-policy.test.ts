import { expect, it, vi } from "vitest";
import { cancelCrawl, crawlRetryUrl, CrawlerRequestError, requestBudgetStop, stalledResearch } from "./runtime-policy";
it("keeps the production reserve but lets local research pass it", () => {
  expect(requestBudgetStop(31, false)).toBeUndefined();
  expect(requestBudgetStop(32, false)).toContain("request budget");
  expect(requestBudgetStop(511, false, true)).toBeUndefined();
  expect(requestBudgetStop(512, false, true)).toContain("request budget");
  expect(requestBudgetStop(33, true)).toBeUndefined();
  expect(requestBudgetStop(1000, true)).toBeUndefined();
});
it("accepts a cancellation race only after verifying the crawl is finished", async () => {
  const request = vi.fn().mockRejectedValueOnce(new CrawlerRequestError(400)).mockResolvedValueOnce({ status: "completed" });
  await expect(cancelCrawl("test-id", request)).resolves.toBeUndefined();
  expect(request.mock.calls).toEqual([["/test-id", "DELETE"], ["/test-id", "GET"]]);
});
it("preserves genuine cancellation errors", async () => {
  const request = vi.fn().mockRejectedValueOnce(new CrawlerRequestError(400)).mockResolvedValueOnce({ status: "running" });
  await expect(cancelCrawl("test-id", request)).rejects.toThrow("400");
  const denied = vi.fn().mockRejectedValue(new CrawlerRequestError(401));
  await expect(cancelCrawl("test-id", denied)).rejects.toThrow("401");
  expect(denied).toHaveBeenCalledTimes(1);
});
it("retries only crawl navigation errors, never explicit access restrictions", () => {
  expect(crawlRetryUrl([{url:"https://example.com",status:"errored",metadata:{status:422}}])).toBe("https://example.com");
  expect(crawlRetryUrl([{url:"https://example.com",status:"disallowed",metadata:{status:422}}])).toBeUndefined();
  expect(crawlRetryUrl([{url:"https://example.com",status:"errored",metadata:{status:403}}])).toBeUndefined();
});

it("recovers only active work without progress beyond all bounded step retries", () => {
  const now = Date.parse("2026-09-15T08:15:00Z");
  expect(stalledResearch({status:"crawling",updatedAt:"2026-09-15T07:58:00Z"}, now)).toBe(true);
  expect(stalledResearch({status:"extracting",updatedAt:"2026-09-15T08:10:00Z"}, now)).toBe(false);
  for (const status of ["queued","complete","partial","cancelled","failed"]) expect(stalledResearch({status,updatedAt:"2026-09-15T07:58:00Z"}, now)).toBe(false);
  expect(stalledResearch({status:"crawling"}, now)).toBe(false);
});

it('uses fresh company execution progress while an old root awaits company callbacks',()=>{
 const now=Date.parse('2026-10-26T02:05:00Z');
 expect(stalledResearch({status:'extracting',updatedAt:'2026-10-26T01:51:00Z',executionUpdatedAt:'2026-10-26T02:04:30Z'} as Parameters<typeof stalledResearch>[0],now)).toBe(false);
});

it('keeps terminal severity and missing/invalid progress safe despite stale timestamps',()=>{
 const now=Date.parse('2026-10-26T02:05:00Z');
 for(const status of ['complete','partial','failed','cancelled'])expect(stalledResearch({status,updatedAt:'2026-10-26T01:51:00Z',executionUpdatedAt:'2026-10-26T01:52:00Z'},now)).toBe(false);
 expect(stalledResearch({status:'extracting',updatedAt:'2026-10-26T01:51:00Z',executionUpdatedAt:'invalid'},now)).toBe(false);
});
