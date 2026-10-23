import { expect, it } from "vitest";
import { nativeProposalReviewable } from "./agent-native-proposal-details";

const id = "00000000-0000-4000-8000-000000000001";
const wait = { id, kind: "wait", title: "Wait", days: 1 };
function draft() {
  return {
    nativeSequenceDraftVersion: 1,
    sequenceId: id,
    name: "Saved draft",
    mode: "create",
    baseRevision: null,
    definition: { schemaVersion: 1, steps: [wait] },
  };
}
function fieldPlan() {
  return {
    nativeFieldsPlanVersion: 1,
    config: { requestId: "saved-job" },
    execution: {
      pipeline: "public-fields-v1",
      peopleResearch: false,
      ai: false,
    },
    providerPolicy: {
      version: 1,
      requestCeilingMicroUsd: "1000000",
      perCompany: { search: 12, page: 64 },
      maxAttempts: { search: 60, page: 320, ai: 0, firmable: 0 },
    },
    selected: [
      {
        targetId: "target",
        childJobId: "child",
        sourceRevision: "revision",
        name: "Company",
        domain: "company.example",
        verifyAbn: true,
        fields: [] as string[],
      },
    ],
  };
}
function targetPlan() {
  return {
    nativeTargetSelectionVersion: 1,
    delivery: { mode: "channels", policyRevision: 1 },
    selected: [
      {
        contactId: "contact",
        targetId: "target",
        name: "Person",
        fit: [],
        channels: [
          {
            channel: "whatsapp",
            bindingId: id,
            bindingDigest: "a".repeat(64),
            recipient: { kind: "phone", value: "+61400000000" },
            identityProof: { kind: "recorded_contact", revision: "1" },
          },
        ],
      },
    ],
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

it("preserves the existing permissive fallback for names outside the specialized review branches", () => {
  for (const name of [
    "email.initial",
    "future.operation",
    "",
    "linkedin.manual_link",
  ]) {
    expect(
      nativeProposalReviewable(name, freeze({ arbitrary: ["unchanged"] })),
    ).toBe(true);
  }
});

it("bounds reviewed invitation notes by raw UTF-16 length and requires the exact human-review metadata", () => {
  const input = {
    routeId: id.toUpperCase(),
    subject: "",
    requiresHumanReview: true,
    body: "😀".repeat(150),
  };
  expect(nativeProposalReviewable("linkedin.invitation", freeze(input))).toBe(
    true,
  );
  for (const changed of [
    { ...input, body: "😀".repeat(151) },
    { ...input, body: "  " },
    { ...input, subject: "Subject" },
    { ...input, requiresHumanReview: false },
    { ...input, routeId: "not-a-route" },
  ]) {
    expect(nativeProposalReviewable("linkedin.invitation", changed)).toBe(
      false,
    );
  }
});

it("keeps ordinary social-message review separate from the invitation note limit and HIL flag", () => {
  for (const name of [
    "whatsapp.initial",
    "whatsapp.reply",
    "linkedin.follow_up",
  ]) {
    expect(
      nativeProposalReviewable(name, {
        routeId: id,
        subject: "",
        body: "x".repeat(10001),
      }),
    ).toBe(true);
    expect(
      nativeProposalReviewable(name, { routeId: id, subject: "", body: "   " }),
    ).toBe(false);
    expect(
      nativeProposalReviewable(name, {
        routeId: id,
        subject: null,
        body: "Reply",
      }),
    ).toBe(false);
  }
});

it("preserves raw draft-name bounds and create/update revision distinctions", () => {
  const input = draft();
  expect(
    nativeProposalReviewable("sequence.prepare", {
      ...input,
      name: "x".repeat(120),
    }),
  ).toBe(true);
  expect(
    nativeProposalReviewable("sequence.prepare", {
      ...input,
      name: "x".repeat(121),
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("sequence.prepare", { ...input, name: "  " }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("sequence.prepare", {
      ...input,
      mode: "update",
      baseRevision: "0000000000",
    }),
  ).toBe(true);
  for (const baseRevision of ["12345678901", "-1", "", 1, null]) {
    expect(
      nativeProposalReviewable("sequence.prepare", {
        ...input,
        mode: "update",
        baseRevision,
      }),
    ).toBe(false);
  }
  expect(
    nativeProposalReviewable("sequence.prepare", {
      ...input,
      baseRevision: "1",
    }),
  ).toBe(false);
});

it("allows incomplete builder layouts while requiring at least one draft node and leaving the saved input untouched", () => {
  const input = draft();
  Object.assign(input.definition, {
    disconnectedConnections: [{ source: id, target: "end" }],
  });
  const before = structuredClone(input);
  expect(nativeProposalReviewable("sequence.prepare", freeze(input))).toBe(
    true,
  );
  expect(input).toEqual(before);
  expect(
    nativeProposalReviewable("sequence.prepare", {
      ...input,
      definition: { schemaVersion: 1, steps: [] },
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("sequence.prepare", {
      ...input,
      definition: { ...input.definition, unexpected: true },
    }),
  ).toBe(false);
});

it("keeps legacy publication review structural rather than introducing new numeric or identifier validation", () => {
  const input = {
    nativeSequencePublicationVersion: 1,
    sequenceId: " ",
    versionId: " ",
    draftRevision: " ",
    publishedVersion: NaN,
    runtime: "legacy",
    definition: { schemaVersion: 1, legacyExtra: true },
  };
  expect(nativeProposalReviewable("sequence.publish", freeze(input))).toBe(
    true,
  );
  expect(
    nativeProposalReviewable("sequence.publish", {
      ...input,
      runtime: "other",
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("sequence.publish", { ...input, definition: [] }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("sequence.publish", {
      ...input,
      publishedVersion: "1",
    }),
  ).toBe(false);
});

it("retains legacy enrolment number and repeated-selection behavior without relaxing required selected fields", () => {
  const selected = {
    contactId: "contact",
    enrolmentId: "enrolment",
    recipient: "recipient",
    sourceRevision: "revision",
  };
  const input = {
    nativeSequenceEnrolmentVersion: 1,
    sequenceId: "sequence",
    versionId: "version",
    bindingId: "binding",
    bindingDigest: "digest",
    version: Infinity,
    runtime: "n8n",
    selected: [selected, selected],
  };
  expect(nativeProposalReviewable("sequence.enrol", freeze(input))).toBe(true);
  expect(
    nativeProposalReviewable("sequence.enrol", {
      ...input,
      selected: [{ ...selected, sourceRevision: "" }],
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("sequence.enrol", { ...input, selected: [] }),
  ).toBe(false);
});

it("accepts ABN-only field checks, bounds selected companies and rejects unsupported field scope", () => {
  const input = fieldPlan();
  const before = structuredClone(input);
  expect(nativeProposalReviewable("research.fields", freeze(input))).toBe(true);
  expect(input).toEqual(before);
  expect(
    nativeProposalReviewable("research.fields", {
      ...input,
      selected: Array(5).fill(input.selected[0]),
    }),
  ).toBe(true);
  expect(
    nativeProposalReviewable("research.fields", {
      ...input,
      selected: Array(6).fill(input.selected[0]),
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.fields", {
      ...input,
      selected: [{ ...input.selected[0], verifyAbn: false }],
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.fields", {
      ...input,
      selected: [{ ...input.selected[0], fields: ["team_members"] }],
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.fields", {
      ...input,
      execution: { ...input.execution, ai: true },
    }),
  ).toBe(false);
});

it("retains the legacy people-plan number check while preserving explicit phone exclusion", () => {
  const input = {
    nativePeoplePlanVersion: 1,
    includePhones: false,
    maxContactsPerCompany: NaN,
    config: { requestId: "job" },
    providerPolicy: { requestCeilingMicroUsd: "1000000" },
    selected: [
      {
        targetId: "target",
        name: "Company",
        firmableId: "provider",
        sourceRevision: "revision",
      },
    ],
  };
  expect(nativeProposalReviewable("research.people", freeze(input))).toBe(true);
  expect(
    nativeProposalReviewable("research.people", {
      ...input,
      includePhones: true,
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.people", {
      ...input,
      maxContactsPerCompany: "3",
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.people", {
      ...input,
      selected: [{ ...input.selected[0], firmableId: "" }],
    }),
  ).toBe(false);
});

it("requires exact multichannel recipients, unique routes and a positive integer policy revision", () => {
  const input = targetPlan(),
    person = input.selected[0],
    route = person.channels[0];
  const before = structuredClone(input);
  expect(nativeProposalReviewable("target.select", freeze(input))).toBe(true);
  expect(input).toEqual(before);
  for (const policyRevision of [0, -1, 1.5, "1"]) {
    expect(
      nativeProposalReviewable("target.select", {
        ...input,
        delivery: { ...input.delivery, policyRevision },
      }),
    ).toBe(false);
  }
  for (const channels of [
    [route, route],
    [{ ...route, bindingDigest: "A".repeat(64) }],
    [{ ...route, recipient: { kind: "phone", value: "0400000000" } }],
    [{ ...route, identityProof: { ...route.identityProof, revision: "0" } }],
  ]) {
    expect(
      nativeProposalReviewable("target.select", {
        ...input,
        selected: [{ ...person, channels }],
      }),
    ).toBe(false);
  }
  // The historical presentation check uses a 36-character hex/hyphen pattern, not UUID parsing.
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      selected: [
        { ...person, channels: [{ ...route, bindingId: "-".repeat(36) }] },
      ],
    }),
  ).toBe(true);
});

it("keeps manual-contact qualification distinct from company-backed selection in legacy delivery modes", () => {
  const person = {
    contactId: "manual",
    sourceKind: "manual_contact",
    targetId: null,
    qualificationConfirmed: false,
    name: "Person",
    recipient: "saved-recipient",
    fit: [],
  };
  const input = {
    nativeTargetSelectionVersion: 1,
    delivery: { mode: "local_sink" },
    selected: [person],
  };
  expect(nativeProposalReviewable("target.select", freeze(input))).toBe(true);
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      selected: [{ ...person, qualificationConfirmed: true }],
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      selected: [{ ...person, targetId: "company" }],
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      delivery: { mode: "communications" },
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("target.select", {
      ...input,
      delivery: {
        mode: "communications",
        bindingId: "binding",
        bindingDigest: "digest",
      },
    }),
  ).toBe(true);
});

it("preserves legacy company research limits without imposing the newer V4/V5 budget shape", () => {
  const input = {
    nativeResearchPlanVersion: 1,
    config: {
      requestId: "job",
      researchScope: "Company",
      geography: "AU",
      targetBusinesses: 20,
    },
    execution: {
      productionPipeline: "firmable-v1",
      pipeline: "firmable-company-v1",
      peopleResearch: false,
      backgroundResearch: false,
    },
    providerPolicy: {
      version: 1,
      requestCeilingMicroUsd: "1000000",
      maxAttempts: { firmable: 60, search: 6, page: 5, ai: 5 },
    },
  };
  expect(nativeProposalReviewable("research.start", freeze(input))).toBe(true);
  expect(
    nativeProposalReviewable("research.start", {
      ...input,
      providerPolicy: {
        ...input.providerPolicy,
        maxAttempts: { ...input.providerPolicy.maxAttempts, firmable: 61 },
      },
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.start", {
      ...input,
      execution: { ...input.execution, backgroundResearch: true },
    }),
  ).toBe(false);
  expect(
    nativeProposalReviewable("research.start", {
      ...input,
      config: { ...input.config, companyDiscoveryPolicy: undefined },
    }),
  ).toBe(false);
});
