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
  expect(render()).toContain("Connect email before subscribing contacts.");
  expect(render()).not.toContain("Reconnect required");
});

 it('keeps campaign connection guidance free of internal supplier names', () => {
  expect(render()).not.toMatch(/unipile|n8n|firmable/i);
 });
 it.each([null, 'workflow-1'])('uses generic published workflow copy while preserving configured links (%s)', workflowId => {
  const definition = { schemaVersion: 1 as const, steps: [{ id: 'email-1', kind: 'email' as const, title: 'Introduction', subject: 'Hello', body: 'Hello there' }] };
  const html = renderToStaticMarkup(<CampaignStudio mandateId="mandate" mandateName="Example" initialView="sequences" initialData={{ ...data, n8nUrl: 'https://automation.example.test', sequences: [{ id: 'sequence-1', name: 'Introduction', draft: definition, publishedDefinition: definition, publishedVersion: 1, n8nWorkflowId: workflowId, draftRevision:'24',updatedAt: '2026-10-14T00:00:00Z' }] }} />);
  expect(html).not.toMatch(/unipile|n8n|firmable/i);
  if(workflowId) expect(html).toContain('https://automation.example.test/workflow/workflow-1');
 });


it('keeps agent-run people browsable while explaining why sequence subscription is unavailable',()=>{
 const html=renderToStaticMarkup(<CampaignStudio mandateId="mandate" mandateName="Example" initialData={{...data,outreachOwner:'agent'}} />);
 expect(html).toContain('Newly Researched Person');expect(html).toContain('owner@example.com');
 expect(html).toContain('The agent manages outreach for this mandate.');expect(html).toContain('/mandates/mandate/agent');
 expect(html).toContain('Why are sequence subscriptions unavailable?');
 expect(html).not.toContain('Connect email before subscribing');expect(html).not.toContain('aria-label="Select Newly Researched Person"');
 expect(html).not.toContain('Select all shown');expect(html).not.toContain('Filter by available contact details, then select people for a published sequence.');
 expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Subscribe/);
});
