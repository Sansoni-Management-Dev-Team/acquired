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
