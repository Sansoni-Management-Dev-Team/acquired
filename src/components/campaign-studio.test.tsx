import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/campaign-sequence-editor", () => ({ CampaignSequenceEditor: () => null }));
import { CampaignStudio, type StudioData } from "./campaign-studio";
const data: StudioData = {
  sequences: [], enrolments: [], mailbox: null,
  contacts: [
    { id: "fresh", name: "Newly Researched Person", company: "Example Company", email: null, fictionalised: false, doNotContact: false },
    { id: "older", name: "Earlier Company Contact", company: "Example Company", email: null, fictionalised: false, doNotContact: false },
  ],
  researchPeople: [{ findingId: "web", targetId: "company", name: "Earlier Web Lead", company: "Example Company", role: "Owner", sourceUrl: "https://example.com", observedAt: "2026-09-30T00:00:00Z" }],
};
function render(ids?: string[]) {
  return renderToStaticMarkup(<CampaignStudio mandateId="mandate" mandateName="Example" initialData={data} enrichmentContactIds={ids} />);
}
describe("People enrichment filter", () => {
  it("shows only the profiles returned by this batch, including when older contacts belong to the same company", () => {
    const html = render(["fresh"]);
    expect(html).toContain("Newly Researched Person");
    expect(html).not.toContain("Earlier Company Contact");
    expect(html).not.toContain("Earlier Web Lead");
    expect(html).toContain("Show all people");
    expect(html).toContain("/mandates/mandate/people");
  });
  it("keeps an empty enrichment filtered instead of showing older people", () => {
    const html = render([]);
    expect(html).toContain("No contacts were returned by this enrichment");
    expect(html).not.toContain("Earlier Company Contact");
  });
  it("shows contacts and web leads when the page has no enrichment filter", () => {
    const html = render();
    expect(html).toContain("Newly Researched Person");
    expect(html).toContain("Earlier Company Contact");
    expect(html).toContain("Earlier Web Lead");
    expect(html).not.toContain("Showing only people");
  });
});
