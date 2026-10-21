import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  AgentNativeProposalDetails,
  nativeProposalReviewable,
} from "./agent-native-proposal-details";

const id = "00000000-0000-4000-8000-000000000001";
const contact = {
  contactId: id,
  targetId: id,
  name: "Synthetic owner",
  recipient: "owner@example.com",
  fit: [],
};
const draft = {
  nativeSequenceDraftVersion: 1,
  sequenceId: id,
  mode: "create",
  baseRevision: null,
  name: "Reviewed draft",
  definition: {
    schemaVersion: 1,
    steps: [
      {
        id,
        kind: "email",
        title: "Introduction",
        subject: "Hello",
        body: "Would you consider a conversation?",
      },
    ],
  },
};
const research = {
  nativeResearchPlanVersion: 1,
  config: {
    requestId: "saved-job",
    researchScope: "Veterinary laboratories",
    geography: "NSW",
    targetBusinesses: 20,
  },
  execution: {
    pipeline: "firmable-company-v1",
    peopleResearch: false,
    backgroundResearch: false,
  },
  providerPolicy: {
    requestCeilingMicroUsd: "1000000",
    maxAttempts: { firmable: 20 },
  },
};
const people = {
  nativePeoplePlanVersion: 1,
  includePhones: false,
  maxContactsPerCompany: 2,
  config: { requestId: "people-job" },
  providerPolicy: { requestCeilingMicroUsd: "1000000" },
  selected: [
    {
      targetId: id,
      name: "Synthetic company",
      firmableId: "recorded-company",
      sourceRevision: "1",
    },
  ],
};

it("preserves invitation review boundaries without changing the saved input", () => {
  const input = {
    routeId: id,
    subject: "",
    requiresHumanReview: true,
    body: "A reviewed connection note",
  };
  const before = structuredClone(input);
  expect(nativeProposalReviewable("linkedin.invitation", input)).toBe(true);
  for (const invalid of [
    { ...input, routeId: "unrecorded" },
    { ...input, requiresHumanReview: false },
    { ...input, subject: "Unexpected subject" },
    { ...input, body: " " },
    { ...input, body: "x".repeat(301) },
  ])
    expect(nativeProposalReviewable("linkedin.invitation", invalid)).toBe(
      false,
    );
  expect(input).toEqual(before);
});

it("requires an exact recorded route and nonempty social message for each supported stage", () => {
  for (const channel of ["whatsapp", "linkedin"])
    for (const stage of ["initial", "reply", "follow_up"]) {
      const name = `${channel}.${stage}`,
        input = { routeId: id, subject: "", body: "Reviewed message" };
      expect(nativeProposalReviewable(name, input)).toBe(true);
      for (const invalid of [
        { ...input, routeId: "" },
        { ...input, subject: "Subject" },
        { ...input, body: "\n " },
      ])
        expect(nativeProposalReviewable(name, invalid)).toBe(false);
    }
});

it("renders the recorded company-only research scope and keeps its version-one review contract", () => {
  expect(nativeProposalReviewable("research.start", research)).toBe(true);
  const html = renderToStaticMarkup(
    createElement(AgentNativeProposalDetails, {
      name: "research.start",
      input: research,
    }),
  );
  for (const value of [
    "Veterinary laboratories",
    "NSW",
    "20 companies",
    "saved-job",
    "does not approve",
    "Company research only",
  ])
    expect(html).toContain(value);
  for (const invalid of [
    { ...research, nativeResearchPlanVersion: 2 },
    { ...research, config: { ...research.config, requestId: "" } },
    { ...research, execution: { ...research.execution, peopleResearch: true } },
    {
      ...research,
      execution: { ...research.execution, backgroundResearch: true },
    },
    {
      ...research,
      providerPolicy: {
        ...research.providerPolicy,
        requestCeilingMicroUsd: "0",
      },
    },
  ])
    expect(nativeProposalReviewable("research.start", invalid)).toBe(false);
});

it("keeps reviewed people enrichment limited to recorded companies and email-only scope", () => {
  expect(nativeProposalReviewable("research.people", people)).toBe(true);
  const html = renderToStaticMarkup(
    createElement(AgentNativeProposalDetails, {
      name: "research.people",
      input: people,
    }),
  );
  for (const value of [
    "Synthetic company",
    "recorded-company",
    "Phone enrichment is off",
    "does not approve outreach",
  ])
    expect(html).toContain(value);
  for (const invalid of [
    { ...people, nativePeoplePlanVersion: 2 },
    { ...people, includePhones: true },
    { ...people, selected: [] },
    { ...people, selected: [{ ...people.selected[0], sourceRevision: "" }] },
  ])
    expect(nativeProposalReviewable("research.people", invalid)).toBe(false);
});

it("keeps manual-contact qualification explicitly unconfirmed in local simulation review", () => {
  const manual = {
    ...contact,
    sourceKind: "manual_contact",
    targetId: null,
    qualificationConfirmed: false,
  };
  const input = {
    nativeTargetSelectionVersion: 1,
    delivery: { mode: "local_sink" },
    selected: [manual],
  };
  expect(nativeProposalReviewable("target.select", input)).toBe(true);
  const html = renderToStaticMarkup(
    createElement(AgentNativeProposalDetails, {
      name: "target.select",
      input: input,
    }),
  );
  expect(html).toContain("Local simulation");
  expect(html).toContain("Operator-entered contact");
  expect(html).toContain("Qualification is not confirmed");
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      selected: [{ ...manual, qualificationConfirmed: true }],
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      selected: [{ ...manual, targetId: id }],
    }),
  ).toBe(false);
});

it("requires the recorded communication account and a complete selected-contact scope", () => {
  const input = {
    nativeTargetSelectionVersion: 1,
    delivery: {
      mode: "communications",
      bindingId: id,
      bindingDigest: "a".repeat(64),
    },
    selected: [contact],
  };
  expect(nativeProposalReviewable("target.select", input)).toBe(true);
  for (const invalid of [
    { ...input, delivery: { mode: "communications", bindingId: id } },
    { ...input, selected: [] },
    { ...input, selected: [{ ...contact, recipient: "" }] },
    { ...input, selected: [{ ...contact, targetId: "" }] },
  ])
    expect(nativeProposalReviewable("target.select", invalid)).toBe(false);
});

const route = {
  channel: "email",
  bindingId: id,
  bindingDigest: "a".repeat(64),
  recipient: { kind: "email", value: "owner@example.com" },
  identityProof: { kind: "recorded_contact", revision: "1" },
};
it("requires a recorded policy revision and exact canonical identities for channel selection", () => {
  const input = {
    nativeTargetSelectionVersion: 1,
    delivery: { mode: "channels", policyRevision: 1 },
    selected: [{ ...contact, channels: [route] }],
  };
  expect(nativeProposalReviewable("target.select", input)).toBe(true);
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      delivery: { ...input.delivery, policyRevision: 0 },
    }),
  ).toBe(false);
  for (const invalidRoute of [
    { ...route, bindingDigest: "missing" },
    { ...route, recipient: { kind: "email", value: "Owner@Example.com" } },
    { ...route, identityProof: { kind: "recorded_contact", revision: "0" } },
  ])
    expect(
      nativeProposalReviewable("target.select", {
        ...input,
        selected: [{ ...contact, channels: [invalidRoute] }],
      }),
    ).toBe(false);
});

it("rejects duplicated or empty channel routes rather than implying a reviewed destination", () => {
  const input = {
    nativeTargetSelectionVersion: 1,
    delivery: { mode: "channels", policyRevision: 1 },
    selected: [{ ...contact, channels: [route] }],
  };
  for (const channels of [[], [route, route], [route, route, route, route]])
    expect(
      nativeProposalReviewable("target.select", {
        ...input,
        selected: [{ ...contact, channels }],
      }),
    ).toBe(false);
});

it("renders both new and revised saved sequence drafts without granting execution", () => {
  expect(nativeProposalReviewable("sequence.prepare", draft)).toBe(true);
  const update = { ...draft, mode: "update", baseRevision: "12" };
  expect(nativeProposalReviewable("sequence.prepare", update)).toBe(true);
  const html = renderToStaticMarkup(
    createElement(AgentNativeProposalDetails, {
      name: "sequence.prepare",
      input: update,
    }),
  );
  for (const value of [
    "Reviewed draft",
    "Update draft revision 12",
    "Introduction",
    "Would you consider a conversation?",
    "does not publish",
    "draft only",
  ])
    expect(html).toContain(value);
  for (const invalid of [
    { ...draft, sequenceId: "" },
    { ...draft, name: "" },
    { ...draft, name: "x".repeat(121) },
    { ...draft, mode: "update", baseRevision: null },
    { ...draft, definition: { schemaVersion: 1, steps: [] } },
  ])
    expect(nativeProposalReviewable("sequence.prepare", invalid)).toBe(false);
});

it("requires the frozen publication handle and recorded original runtime", () => {
  const input = {
    nativeSequencePublicationVersion: 1,
    sequenceId: id,
    versionId: id,
    draftRevision: "12",
    publishedVersion: 1,
    runtime: "n8n",
    definition: { schemaVersion: 1 },
  };
  expect(nativeProposalReviewable("sequence.publish", input)).toBe(true);
  for (const invalid of [
    { ...input, nativeSequencePublicationVersion: 2 },
    { ...input, versionId: "" },
    { ...input, runtime: "unrecorded" },
    { ...input, definition: {} },
  ])
    expect(nativeProposalReviewable("sequence.publish", invalid)).toBe(false);
});

it("requires exact enrolment identities and saved source revisions before review", () => {
  const input = {
    nativeSequenceEnrolmentVersion: 1,
    sequenceId: id,
    versionId: id,
    bindingId: id,
    bindingDigest: "a".repeat(64),
    version: 1,
    runtime: "legacy",
    selected: [
      {
        contactId: id,
        enrolmentId: id,
        recipient: "owner@example.com",
        sourceRevision: "12",
      },
    ],
  };
  expect(nativeProposalReviewable("sequence.enrol", input)).toBe(true);
  const html = renderToStaticMarkup(
    createElement(AgentNativeProposalDetails, {
      name: "sequence.enrol",
      input: input,
    }),
  );
  expect(html).toContain("starts held");
  expect(html).toContain("No send");
  for (const invalid of [
    { ...input, bindingDigest: "" },
    { ...input, selected: [] },
    { ...input, selected: [{ ...input.selected[0], sourceRevision: "" }] },
  ])
    expect(nativeProposalReviewable("sequence.enrol", invalid)).toBe(false);
});

it("leaves operations outside this renderer to their own review boundary", () => {
  expect(nativeProposalReviewable("email.reply", {})).toBe(true);
  expect(
    renderToStaticMarkup(
      createElement(AgentNativeProposalDetails, {
        name: "email.reply",
        input: {},
      }),
    ),
  ).toBe("");
});
