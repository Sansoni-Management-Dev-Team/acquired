import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanyDataAction } from "./mandate-workspace";

describe("company data action", () => {
  it("stays visible and disabled when nothing is selected", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={0} busy={false} onClick={vi.fn()} />);

    expect(html).toContain("Enrich selected companies →");
    expect(html).toContain("disabled");
  });

  it("enables enrichment once companies are selected", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={2} busy={false} onClick={vi.fn()} />);

    expect(html).toContain("Enrich selected companies →");
    expect(html).not.toContain('disabled=""');
  });
  it("explains the 20-business limit when all matching businesses exceed it", () => {
    const html = renderToStaticMarkup(<CompanyDataAction selectedCount={25} busy={false} onClick={vi.fn()} />);
    expect(html).toContain("Select 20 or fewer businesses (25 selected)");
    expect(html).toContain("disabled");
  });
});

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
  expect(html).toContain('>Status</th>');
  expect(html).not.toContain("Finding businesses");
  expect(html).not.toContain('role="progressbar"');
});
