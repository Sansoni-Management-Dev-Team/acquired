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


it("edits and previews saved channel nodes instead of temporary samples", () => {
  const draft = { steps: [{ id: "linkedin", kind: "linkedin" as const, title: "Connect on LinkedIn", body: "Hi {{first_name}}, about {{company_name}}" }] };
  const html = renderToStaticMarkup(<CampaignMessagesEditor draft={draft} selectedStepId="linkedin" onChange={() => {}} onSelect={() => {}} contacts={[{ id: "alex", name: "Alex Chen", company: "Harbour" }]} />);
  expect(html).toContain("LinkedIn sequence");
  expect(html).toContain("Connect on LinkedIn");
  expect(html).toContain("Hi Alex, about Harbour");
  expect(html).toContain("Saved with your draft. LinkedIn messages require an accepted connection");
});

it("shows and previews the selected branch message with its path", () => {
  const draft = defaultCampaignDefinition();
  const email = draft.steps[0];
  if (email.kind !== "email") throw new Error("Expected an email");
  const branchA = { ...email, id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0", title: "Variant A", subject: "A for {{company_name}}", body: "Hello {{first_name}} from A" };
  const branchB = { ...email, id: "fb27389c-b213-4323-ab03-decc48ecb3b0", title: "Variant B", subject: "B for {{company_name}}", body: "Hello {{first_name}} from B" };
  const split = { id: "57cff001-6c6b-46c1-bd2e-594b3216f116", afterStepId: email.id, title: "Variants", percentage: 50,
    pathA: [{ id: "65caf381-c46a-42ea-88f1-4b2dc5a007ee", kind: "wait" as const, title: "A wait", days: 1 }, branchA],
    pathB: [{ id: "e928b197-2cc0-4d6a-80ed-77b1b6622ef3", kind: "wait" as const, title: "B wait", days: 5 }, branchB],
  };
  const html = renderToStaticMarkup(<CampaignMessagesEditor draft={{ ...draft, splits: [split] }} selectedStepId={branchB.id} onChange={() => {}} onSelect={() => {}} contacts={[{ id: "morgan", name: "Morgan Lee", company: "Northline" }]} />);
  expect(html).toContain("Variant A"); expect(html).toContain("Variant B");
  expect(html).toContain("Path A · timing depends on path"); expect(html).toContain("Path B · timing depends on path");
  expect(html).toContain("Hello Morgan from B"); expect(html).toContain("B for Northline");
});
