import { describe, expect, it } from "vitest";
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
