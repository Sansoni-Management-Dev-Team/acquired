import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultCampaignDefinition } from "@/domain/default-campaign";
import { CampaignMessagesEditor } from "./campaign-messages-editor";

it("personalises the selected email and derives day labels from the actual waits", () => {
  const draft = defaultCampaignDefinition();
  const wait = draft.steps[1];
  if (wait.kind === "wait") wait.days = 5;
  const html = renderToStaticMarkup(<CampaignMessagesEditor draft={draft} selectedStepId={draft.steps[2].id} onChange={() => {}} onSelect={() => {}} contacts={[{ id: "morgan", name: "Morgan Lee", company: "Northline Industrial" }]} />);
  expect(html).toContain("Day 6");
  expect(html).toContain("Day 21");
  expect(html).toContain("Hi Morgan,");
  expect(html).toContain("Following up on Northline Industrial");
  expect(html).toContain("LinkedIn sample");
  expect(html).toContain("WhatsApp sample");
});

it("supports a mandate with no contacts without inventing recipients", () => {
  const html = renderToStaticMarkup(<CampaignMessagesEditor draft={defaultCampaignDefinition()} selectedStepId={null} onChange={() => {}} onSelect={() => {}} contacts={[]} />);
  expect(html).toContain("0 contacts");
  expect(html).toContain("Select a recipient");
  expect(html).toContain("Add people to this mandate");
});
