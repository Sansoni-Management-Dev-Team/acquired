import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CandidateWebsite } from "@/domain/target-candidates";
import type { SavedResearchFinding } from "@/domain/research";
import { CandidateResearchCells } from "./candidate-research-cells";

function render(status: string, findings: SavedResearchFinding[] = []) {
  const candidate: CandidateWebsite = { domain: "example.com", url: "https://example.com", name: "Example", status, findings };
  return renderToStaticMarkup(<table><tbody><tr><CandidateResearchCells candidate={candidate} /></tr></tbody></table>);
}

describe("candidate research cells", () => {
  it.each(["Checked", "Needs retry", "Stopped", "Business saved"])("does not imply more work is running for %s candidates", status => {
    const html = render(status);
    expect(html).not.toContain("Pending");
    expect(html).not.toContain("Checking");
    expect(html).toContain("Unknown");
    expect(html).toContain("Unavailable");
    expect(html).toContain("No findings");
    expect(html).not.toContain("person found");
  });

  it.each(["Queued", "Reading website", "Extracting data", "Checking website", "Finding website"])("keeps pending details for %s candidates", status => {
    const html = render(status);
    expect(html.match(/Pending/g)).toHaveLength(4);
    expect(html).toContain("Checking");
    expect(html).not.toContain("person found");
  });

  it.each(["Needs retry", "Reading website"])("shows available findings for %s candidates", status => {
    const findings = [
      { id: "headcount", evidence: { kind: "headcount", name: "Example", value: "11–50 employees" } },
      { id: "revenue", evidence: { kind: "revenue", name: "Example", value: "$2M" } },
      { id: "person", evidence: { kind: "person", name: "Alex Smith", value: "Director" } },
    ].map(finding => ({ ...finding, sourceUrl: "https://example.com/about", observedAt: "2026-09-30" })) as SavedResearchFinding[];
    const html = render(status, findings);
    expect(html).toContain("11–50 employees");
    expect(html).toContain("$2M");
    expect(html).toContain("Alex Smith");
    expect(html).toContain("1 person found");
    expect(html).not.toContain("Pending");
    expect(html).toContain("3 findings");
  });
});
