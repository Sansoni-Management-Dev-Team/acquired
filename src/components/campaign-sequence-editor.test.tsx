import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CampaignStep } from "@/domain/campaign";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string; data: { label: React.ReactNode } }[] }) => <div>{nodes.map(node => <div key={node.id}>{node.data.label}</div>)}</div>,
  Background: () => null,
  Controls: () => null,
}));
import { CampaignSequenceEditor } from "./campaign-sequence-editor";

it.each(["whatsapp", "linkedin"] as const)("offers and edits a saved %s node", kind => {
  const step: CampaignStep = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind, title: "Follow-up", body: "Hi {{first_name}}" };
  const html = renderToStaticMarkup(<CampaignSequenceEditor draft={{ steps: [step] }} selectedStepId={step.id} onChange={() => {}} onSelect={() => {}} />);
  expect(html).toContain("WhatsApp");
  expect(html).toContain("LinkedIn");
  expect(html.match(/draggable="true"/g)).toHaveLength(4);
  expect(html).toContain(`${kind === "whatsapp" ? "WhatsApp" : "LinkedIn"} settings`);
  expect(html).toContain("Hi {{first_name}}");
  expect(html).not.toContain("Days to wait");
  expect(html).not.toContain(">Subject<");
  expect(html).not.toContain("To save or publish:");
});
