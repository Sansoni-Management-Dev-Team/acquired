import { describe, expect, it } from "vitest";
import type { MembershipView } from "./acquisition";
import type { ResearchConfig, SavedResearchFinding } from "./research";
import { candidateWebsites, orderCompanyRows, toggleMatchingTargets, type CandidateWebsite } from "./target-candidates";

function job(id: string, domain: string, status: string, targetId?: string) {
  return {
    id, status, seeds: [`https://${domain}/`],
    config: { discoveryCandidate: true, companyDomain: domain, seeds: [`https://${domain}/`], newBusinessIds: targetId ? [targetId] : [] } as ResearchConfig,
  };
}

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
