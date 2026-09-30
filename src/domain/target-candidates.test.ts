import { describe, expect, it } from "vitest";
import type { MembershipView } from "./acquisition";
import type { ResearchConfig, SavedResearchFinding } from "./research";
import { candidateWebsites, companyResearchFinished, orderCompanyRows, toggleMatchingTargets, type CandidateWebsite } from "./target-candidates";

function job(id: string, domain: string, status: string, targetId?: string) {
  return {
    id, status, seeds: [`https://${domain}/`],
    config: { discoveryCandidate: true, companyDomain: domain, seeds: [`https://${domain}/`], newBusinessIds: targetId ? [targetId] : [] } as ResearchConfig,
  };
}

describe("finished company research", () => {
  const target = { id: "alpha-id", domain: "alpha.com.au" };

  it("requires finished research and hides queued or running companies", () => {
    expect(companyResearchFinished(target, [], [])).toBe(false);
    for (const status of ["queued", "crawling", "extracting", "failed", "cancelled"]) {
      expect(companyResearchFinished(target, [job("alpha", target.domain, status, target.id)], [])).toBe(false);
    }
    for (const status of ["complete", "partial"]) {
      expect(companyResearchFinished(target, [job("alpha", target.domain, status, target.id)], [])).toBe(true);
    }
  });

  it("waits for company and people followups without waiting for unrelated companies", () => {
    const completed = job("alpha", target.domain, "complete", target.id);
    const followup = { ...job("people", "other-source.com.au", "extracting"), config: { ...completed.config, seeds: [], companyDomain: undefined, newBusinessIds: [], targetId: target.id, purpose: "people" as const } };
    expect(companyResearchFinished(target, [completed, followup], [])).toBe(false);
    expect(companyResearchFinished(target, [completed, { ...followup, status: "complete" }, job("beta", "beta.com.au", "queued")], [])).toBe(true);
  });

  it("links multi-company research through saved findings", () => {
    const discovery = job("discovery", "directory.com.au", "crawling");
    const findings = [{ jobId: discovery.id, targetId: target.id }] as SavedResearchFinding[];
    expect(companyResearchFinished(target, [discovery], findings)).toBe(false);
    expect(companyResearchFinished(target, [{ ...discovery, status: "complete" }], findings)).toBe(true);
  });
});

describe("candidate websites in Targets", () => {
  it("deduplicates domains, keeps discovered evidence, and replaces candidates with saved targets", () => {
    const findings = [{ sourceUrl: "https://alpha.com.au/about", evidence: { kind: "company", name: "Alpha Manufacturing" } }] as SavedResearchFinding[];
    const memberships = [{ target: { id: "saved-1", domain: "saved.com.au" } }] as MembershipView[];
    const candidates = candidateWebsites([
      job("alpha-new", "alpha.com.au", "queued"),
      job("alpha-old", "alpha.com.au", "complete", "alpha-id"),
      job("beta", "beta.com.au", "reading"),
      job("saved", "saved.com.au", "complete", "saved-1"),
      job("unmatched", "unmatched.com.au", "complete"),
    ], findings, memberships);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ domain: "alpha.com.au", name: "Alpha Manufacturing", status: "Business saved", targetId: "alpha-id" });
    expect(candidates[0].findings).toHaveLength(1);
    expect(candidates[1]).toMatchObject({ domain: "beta.com.au", status: "Reading website" });
  });
});

it("select all changes only businesses matching the current filters", () => {
  expect(toggleMatchingTargets(["hidden"], ["a", "b"], true)).toEqual(["hidden", "a", "b"]);
  expect(toggleMatchingTargets(["hidden", "a", "b"], ["a", "b"], false)).toEqual(["hidden"]);
});

it("shows companies with more researched data before pending candidates", () => {
  const candidate = (domain: string, kinds: string[] = []) => ({
    domain, url: `https://${domain}`, name: domain, status: "Queued",
    findings: kinds.map(kind => ({ evidence: { kind } })),
  }) as CandidateWebsite;
  const membership = (id: string, headcount: number | null, revenue: number | null) => ({
    target: { id, headcount: { value: headcount }, revenue: { value: revenue } }, researchFindings: [],
  }) as unknown as MembershipView;

  const rows = orderCompanyRows(
    [candidate("pending.test"), candidate("some-data.test", ["headcount"])],
    [membership("rich", 100, 5_000_000), membership("empty", null, null)],
    [{ targetId: "rich", name: "Director" }],
  );

  expect(rows.map(row => row.kind === "candidate" ? row.candidate.domain : row.membership.target.id))
    .toEqual(["rich", "some-data.test", "pending.test", "empty"]);
});

it("shows concurrent company tasks and pending follow-ups in the company status", async () => {
  const { companyWorkStatus } = await import("./target-candidates");
  const target = { id: "alpha-id", domain: "alpha.com.au" };
  const identity = job("identity", target.domain, "reading", target.id);
  const details = { ...job("details", "records.com.au", "extracting"), config: { ...identity.config, targetId: target.id, companyDomain: undefined, newBusinessIds: [], purpose: "firmographics" as const } };
  expect(companyWorkStatus(target, [identity, details], [])).toBe("Reading sources: company identity · Extracting company details");
  expect(companyWorkStatus(target, [{ ...identity, status: "complete" }], [], [{ targetId: target.id }])).toBe("Waiting for deeper research");
  expect(companyWorkStatus(target, [{ ...identity, status: "complete" }], [])).toBe("Research complete");
});
