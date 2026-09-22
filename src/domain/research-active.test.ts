import { describe, expect, it } from "vitest";
import { researchActive, researchJobRunning, STALE_RESEARCH_JOB_MS } from "./research";

const now = 1_000_000;
describe("researchActive", () => {
  it("is false when there are no jobs", () => {
    expect(researchActive([], now)).toBe(false);
  });
  it("is true while any job is still running", () => {
    expect(researchActive([{ status: "complete", config: {} }, { status: "crawling", config: { purpose: "people" } }], now)).toBe(true);
  });
  it("is false once every manual job is terminal", () => {
    expect(researchActive([{ status: "partial", config: {} }, { status: "failed", config: { purpose: "firmographics" } }], now)).toBe(false);
  });
  it("stays true for an automatic run until its deadline so dispatch retries keep firing", () => {
    const jobs = [{ status: "partial", config: { mode: "automatic", automaticDeadline: now + 60_000 } }];
    expect(researchActive(jobs, now)).toBe(true);
    expect(researchActive(jobs, now + 60_000)).toBe(false);
  });
  it("ignores a cancelled automatic run and judges the latest root, not its children", () => {
    expect(researchActive([{ status: "cancelled", config: { mode: "automatic", automaticDeadline: now + 60_000 } }], now)).toBe(false);
    expect(researchActive([
      { status: "complete", config: { purpose: "people", mode: "automatic", automaticDeadline: now + 60_000 } },
      { status: "complete", config: { discoveryCandidate: true, mode: "automatic", automaticDeadline: now + 60_000 } },
      { status: "complete", config: {} },
    ], now)).toBe(false);
  });
  it("treats a job the worker abandoned as inactive once it goes stale", () => {
    const fresh = { status: "crawling", updatedAt: new Date(now - 60_000), config: {} };
    const stale = { status: "extracting", updatedAt: new Date(now - STALE_RESEARCH_JOB_MS), config: {} };
    expect(researchJobRunning(fresh, now)).toBe(true);
    expect(researchJobRunning(stale, now)).toBe(false);
    expect(researchActive([stale], now)).toBe(false);
    expect(researchActive([stale, fresh], now)).toBe(true);
  });
});
