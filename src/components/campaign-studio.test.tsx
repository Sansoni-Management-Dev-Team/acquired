import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/campaign-sequence-editor", () => ({ CampaignSequenceEditor: () => null }));
import { CampaignStudio, type StudioData } from "./campaign-studio";
const data: StudioData = {
  sequences: [], enrolments: [], mailbox: null,
  contacts: [
    { id: "fresh", name: "Newly Researched Person", company: "Example Company", email: "owner@example.com", fictionalised: false, doNotContact: false },
    { id: "older", name: "Earlier Company Contact", company: "Example Company", email: "owner@example.com", fictionalised: false, doNotContact: false },
    { id: "incomplete", name: "Name Only Lead", company: "Example Company", email: null, fictionalised: false, doNotContact: false },
    { id: "invalid", name: "Invalid Email Lead", company: "Example Company", email: "invalid", fictionalised: false, doNotContact: false },
    { id: "fictional", name: "Fictional Person", company: "Example Company", email: "fiction@example.com", fictionalised: true, doNotContact: false },
    { id: "blocked", name: "Do Not Contact Person", company: "Example Company", email: "blocked@example.com", fictionalised: false, doNotContact: true },
  ],
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
    expect(html).toContain("No people were returned by this enrichment");
    expect(html).not.toContain("Earlier Company Contact");
  });
  it("shows partial contacts when the page has no enrichment filter", () => {
    const html = render();
    expect(html).toContain("Newly Researched Person");
    expect(html).toContain("Earlier Company Contact");
    expect(html).not.toContain("Earlier Web Lead");
    expect(html).not.toContain("Showing only people");
    expect(html).toContain("Name Only Lead");
    expect(html).toContain("Invalid Email Lead");
    expect(html).not.toContain("Fictional Person");
    expect(html).toContain('aria-label="Select Newly Researched Person"');
    expect(html).toMatch(/aria-label="Select Do Not Contact Person" disabled/);
    expect(html).not.toContain("Use as contact");
  });
});

it("explains connected Gmail with missing reply access on People", () => {
  const html = renderToStaticMarkup(<CampaignStudio mandateId="mandate" mandateName="Example" initialData={{ ...data, mailbox: { address: "sender@example.com", ready: false, status: "reply_access_needed", dailyCap: 100 } }} />);
  expect(html).toContain("Complete email connection and verified reply monitoring before subscribing contacts.");
  expect(html).not.toContain("Reconnect required");
});

it("shows an unconnected mailbox without implying an expired connection", () => {
  expect(render()).toContain("Connect email through Unipile before subscribing contacts.");
  expect(render()).not.toContain("Reconnect required");
});
