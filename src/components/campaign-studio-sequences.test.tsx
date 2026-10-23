import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { defaultCampaignDefinition } from "@/domain/default-campaign";
vi.mock("@/components/campaign-sequence-editor", () => ({ CampaignSequenceEditor: ({ draft }: { draft: { steps: { kind: string }[] } }) => <div>{draft.steps.filter(step => step.kind === "email").length} emails in editor</div> }));
import { CampaignStudio } from "./campaign-studio";

it("opens the saved default sequence immediately on the sequences page", () => {
  const html = renderToStaticMarkup(<CampaignStudio mandateId="mandate" mandateName="Example" initialView="sequences" initialData={{
    sequences: [{ id: "default", name: "7-step introduction sequence", draft: defaultCampaignDefinition(), publishedDefinition: null, publishedVersion: 0, n8nWorkflowId: null, draftRevision:'24',updatedAt: new Date().toISOString() }],
    enrolments: [], contacts: [], mailbox: null,
  }} />);
  expect(html).toContain("7 emails in editor");
  expect(html).not.toContain('aria-label="Sequence views"');
  expect(html).not.toContain("Selected recipients");
  expect(html).not.toContain("Preview for");
  expect(html).toContain('value="7-step introduction sequence"');
  expect(html).toContain("Save draft");
  expect(html).not.toContain("Select or create a sequence.");
});
