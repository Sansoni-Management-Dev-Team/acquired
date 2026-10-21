import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./app-shell", () => ({ SidebarRegistration: () => null }));

it("renders saved companies before research finishes without the discovery loading panel", async () => {
  const { MandateWorkspace } = await import("./mandate-workspace");
  const { emptyBrief, initialAssessment } = await import("@/domain/acquisition");
  const { rankTarget } = await import("@/domain/scoring");
  const { seedTargets, defaultMandate } = await import("@/test/fixtures/scoring-targets");
  const mandate = { id: "mandate", brief: emptyBrief(), createdAt: "2026-09-30", updatedAt: "2026-09-30", version: 1 };
  const target = rankTarget(seedTargets[0], defaultMandate);
  const initial = { mandate, memberships: [{ target, assessment: initialAssessment, accreditations: [], version: 1 }], coverage: [], valuations: [], buyerProfile: null, contacts: [], firmableRefreshes: [] };
  const html = renderToStaticMarkup(<MandateWorkspace mandates={[mandate]} initial={initial} tab="targets" />);
  expect(html).toContain(target.companyName);
  expect(html).toContain('>Fit</th>');
  expect(html).toContain('>Reason for fit</th>');
  for (const movedColumn of ["Status", "Stage", "Headcount", "Revenue (source currency)", "Estimated EBITDA (AUD)", "Key decision-makers", "Evidence"]) {
    expect(html).not.toContain(`>${movedColumn}</th>`);
  }
  expect(html).toContain(`aria-label="Review ${target.companyName}"`);
  expect(html).not.toContain("Finding businesses");
  expect(html).not.toContain('role="progressbar"');
});
