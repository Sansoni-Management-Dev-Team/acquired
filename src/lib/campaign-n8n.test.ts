import { describe, expect, it } from "vitest";
import { campaignFirstStepIndex, campaignPathFor } from "@/domain/campaign";
import { buildSequenceWorkflow } from "./campaign-n8n";

const versionId = "b74733ca-71e0-4595-afc4-559a3758f9ee";
const definition = { schemaVersion: 1 as const, steps: [
  { id: "30bde832-8119-482a-bd3d-f3ebec223a49", kind: "email" as const, title: "Introduction", subject: "Hello", body: "Hi" },
  { id: "bb439447-a638-4ce7-82ad-785678c65f47", kind: "wait" as const, title: "Three days", days: 3 },
  { id: "157015e0-e84e-48b2-842b-d57430613fa0", kind: "email" as const, title: "Follow up", subject: "Following up", body: "Hi again" },
] };

describe("published sequence workflow", () => {
  it("pins a webhook to the version and gives each email its own send and retry loop", () => {
    const workflow = buildSequenceWorkflow({ versionId, sequenceName: "First Sequence", version: 1, definition, appUrl: "https://app.test" });
    const names = workflow.nodes.map(node => node.name);
    expect(names).toContain("Wait 3 days: Three days");
    expect(names.filter(name => name.startsWith("Send:"))).toHaveLength(2);
    expect(workflow.nodes.find(node => node.name === "Start contact")?.parameters.path).toBe(`acquire/campaign/${versionId}`);
    expect(workflow.connections["Wait until allowed: Introduction"].main[0][0].node).toBe("Send: Introduction");
    expect(workflow.connections["Sent: Introduction"].main[0][0].node).toBe("Wait 3 days: Three days");
    expect(workflow.nodes.find(node => node.name === "Send: Follow up")?.parameters.jsonBody).toContain("stepIndex: 2");
  });
});

it("compiles mutually exclusive split outputs, branch retry loops and a shared continuation", () => {
  const split = {
    id: "57cff001-6c6b-46c1-bd2e-594b3216f116", title: "A/B", afterStepId: definition.steps[0].id, percentage: 35,
    pathA: [{ ...definition.steps[1], id: "65caf381-c46a-42ea-88f1-4b2dc5a007ee", days: 1 }, { ...definition.steps[2], id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0", title: "Path A" }],
    pathB: [{ ...definition.steps[1], id: "e928b197-2cc0-4d6a-80ed-77b1b6622ef3", days: 5 }, { ...definition.steps[2], id: "fb27389c-b213-4323-ab03-decc48ecb3b0", title: "Path B" }],
  };
  const workflow = buildSequenceWorkflow({ versionId, sequenceName: "Split", version: 1, definition: { ...definition, splits: [split] }, appUrl: "https://app.test", credentialId: "credential" });
  const splitNode = workflow.nodes.find(node => node.name.startsWith("Split:"))!;
  expect(splitNode.type).toBe("n8n-nodes-base.if");
  expect(JSON.stringify(splitNode.parameters)).toContain("String($json.nextStepIndex)");
  expect(JSON.stringify(splitNode.parameters)).toContain('"rightValue":"2"');
  const outputs = workflow.connections[splitNode.name].main;
  expect(outputs).toHaveLength(2);
  expect(outputs[0]).toHaveLength(1); expect(outputs[1]).toHaveLength(1);
  const aWait = outputs[0][0].node, bWait = outputs[1][0].node;
  expect(aWait).toContain("Wait 1 days"); expect(bWait).toContain("Wait 5 days");
  expect(workflow.connections[aWait].main[0][0].node).toBe("Send: Path A");
  expect(workflow.connections[bWait].main[0][0].node).toBe("Send: Path B");
  const continuationA = workflow.connections["Sent: Path A"].main[0][0].node;
  const continuationB = workflow.connections["Sent: Path B"].main[0][0].node;
  expect(continuationA).toBe(continuationB);
  expect(workflow.connections[continuationA].main[0][0].node).toBe("Send: Follow up");
  for (const [title, index] of [["Path A", 2], ["Path B", 4], ["Follow up", 6]] as const) {
    const send = workflow.nodes.find(node => node.name === `Send: ${title}`)!;
    expect(send.parameters.jsonBody).toContain(`stepIndex: ${index}`);
    expect(send.credentials).toEqual({ httpHeaderAuth: { id: "credential", name: "Header Auth account" } });
    expect(workflow.connections[`Wait until allowed: ${title}`].main[0][0].node).toBe(send.name);
    expect(workflow.connections[`Sent: ${title}`].main[1][0].node).toBe(`Retry later: ${title}`);
  }
  expect(workflow.nodes.filter(node => node.type === "n8n-nodes-base.merge")).toHaveLength(0);
  expect(workflow.nodes.filter(node => node.type === "n8n-nodes-base.wait").every(node => node.parameters.dateTime === "={{ $json.nextStepAt }}")).toBe(true);
});

it("keeps duplicate message titles from overwriting n8n connections", () => {
  const repeated = { ...definition, steps: definition.steps.map(step => step.kind === "email" ? { ...step, title: "Same title" } : step) };
  const workflow = buildSequenceWorkflow({ versionId, sequenceName: "Duplicates", version: 1, definition: repeated, appUrl: "https://app.test" });
  expect(new Set(workflow.nodes.map(node => node.name)).size).toBe(workflow.nodes.length);
  expect(workflow.connections["Sent: Same title [1]"].main[0][0].node).toBe("Wait 3 days: Three days");
  expect(workflow.connections["Wait until allowed: Same title [3]"].main[0][0].node).toBe("Send: Same title [3]");
});

it("routes subscription splits identically to enrolment and shares the continuation", () => {
  const split = { id: "57cff001-6c6b-46c1-bd2e-594b3216f116", title: "Initial", afterStepId: "start", percentage: 30,
    pathA: [{ ...definition.steps[0], title: "Intro A" }],
    pathB: [{ ...definition.steps[2], title: "Intro B" }],
  };
  const initial = { schemaVersion: 1 as const, steps: [definition.steps[1], { ...definition.steps[0], id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0", title: "Shared" }], splits: [split] };
  const workflow = buildSequenceWorkflow({ versionId, sequenceName: "Initial split", version: 1, definition: initial, appUrl: "https://app.test" });
  const splitNode = workflow.nodes.find(node => node.name.startsWith("Split:"))!;
  expect(workflow.connections["Start contact"].main[0][0].node).toBe(splitNode.name);
  const expression = (splitNode.parameters.conditions as { conditions: { leftValue: string }[] }).conditions[0].leftValue;
  const evaluate = new Function("$", `return ${expression.slice(3, -2)};`);
  for (const path of ["pathA", "pathB"] as const) {
    const key = Array.from({ length: 100 }, (_, i) => `contact-${i}`).find(key => campaignPathFor(split, key) === path)!;
    expect(evaluate(() => ({ first: () => ({ json: { body: { enrolmentId: key } } }) }))).toBe(path);
    const target = workflow.connections[splitNode.name].main[path === "pathA" ? 0 : 1][0].node;
    expect(target).toBe(path === "pathA" ? "Send: Intro A" : "Send: Intro B");
    expect(workflow.nodes.find(node => node.name === target)!.parameters.jsonBody).toContain(`stepIndex: ${campaignFirstStepIndex(initial, key)}`);
  }
  expect(workflow.connections["Sent: Intro A"].main[0]).toEqual(workflow.connections["Sent: Intro B"].main[0]);
  const sharedWait = workflow.connections["Sent: Intro A"].main[0][0].node;
  expect(workflow.connections[sharedWait].main[0][0].node).toBe("Send: Shared");
});

it("compiles WhatsApp steps through the same callback and retry loop as email and LinkedIn", () => {
  const mixed = { ...definition, steps: [definition.steps[0], definition.steps[1], { id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0", kind: "whatsapp" as const, title: "WhatsApp follow-up", body: "Hi" }, { ...definition.steps[1], id: "65caf381-c46a-42ea-88f1-4b2dc5a007ee" }, { id: "fb27389c-b213-4323-ab03-decc48ecb3b0", kind: "linkedin" as const, title: "LinkedIn follow-up", body: "Hi" }] };
  const workflow = buildSequenceWorkflow({ versionId, sequenceName: "Mixed channels", version: 1, definition: mixed, appUrl: "https://app.test", credentialId: "credential" });
  const send = workflow.nodes.find(node => node.name === "Send: WhatsApp follow-up")!;
  expect(send.parameters.url).toBe("https://app.test/api/internal/campaigns/step");
  expect(send.parameters.jsonBody).toContain("stepIndex: 2");
  expect(send.credentials).toEqual({ httpHeaderAuth: { id: "credential", name: "Header Auth account" } });
  expect(workflow.connections["Wait until allowed: WhatsApp follow-up"].main[0][0].node).toBe(send.name);
  const nextWait = workflow.connections["Sent: WhatsApp follow-up"].main[0][0].node;
  expect(workflow.connections[nextWait].main[0][0].node).toBe("Send: LinkedIn follow-up");
});

it("keeps repeated WhatsApp titles distinct across mixed-channel connections", () => {
  const whatsapp = { kind: "whatsapp" as const, title: "Follow up", body: "Hi" };
  const repeated = { ...definition, steps: [definition.steps[0], definition.steps[1], { ...whatsapp, id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0" }, { ...definition.steps[1], id: "65caf381-c46a-42ea-88f1-4b2dc5a007ee" }, { ...whatsapp, id: "fb27389c-b213-4323-ab03-decc48ecb3b0" }] };
  const workflow = buildSequenceWorkflow({ versionId, sequenceName: "Repeated WhatsApp", version: 1, definition: repeated, appUrl: "https://app.test" });
  expect(new Set(workflow.nodes.map(node => node.name)).size).toBe(workflow.nodes.length);
  expect(workflow.connections["Wait until allowed: Follow up [3]"].main[0][0].node).toBe("Send: Follow up [3]");
  expect(workflow.connections["Wait until allowed: Follow up [5]"].main[0][0].node).toBe("Send: Follow up [5]");
});
