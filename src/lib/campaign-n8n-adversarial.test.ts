import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildSequenceWorkflow, provisionSequenceWorkflow } from "./campaign-n8n";
import { campaignDefinition, campaignStepEntries, type CampaignStep } from "@/domain/campaign";
const message = (title: string): CampaignStep => ({ id: randomUUID(), kind: "email", title, subject: "Hi", body: "Hello" });
const wait = (title: string): CampaignStep => ({ id: randomUUID(), kind: "wait", title, days: 1 });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function workflow(steps: CampaignStep[]) { return buildSequenceWorkflow({ versionId: randomUUID(), sequenceName: "Test", version: 1, definition: campaignDefinition.parse({ schemaVersion: 1, steps }), appUrl: "https://app.test" }); }
it("keeps generated-suffix lookalikes distinct for every node and wait", () => {
  const result = workflow([message("Follow up"), wait("Delay"), message("Follow up [1]"), wait("Delay [2]"), message("Follow up"), wait("Delay"), message("Follow up [1] (2)")]);
  expect(new Set(result.nodes.map(node => node.name)).size).toBe(result.nodes.length);
  const sends = result.nodes.filter(node => node.type.endsWith(".httpRequest")); expect(sends).toHaveLength(4);
  const actionWaits = result.nodes.filter(node => node.name.startsWith("Wait 1 days")); expect(actionWaits).toHaveLength(3);
  const names = new Set(result.nodes.map(node => node.name));
  for (const [from, links] of Object.entries(result.connections)) {
    expect(names.has(from)).toBe(true);
    for (const link of links.main.flat()) expect(names.has(link.node)).toBe(true);
  }
});
it.each(["__proto__", "constructor", "toString", "' }); throw new Error('injected'); //", "<script>alert(1)</script>", "Wait until allowed: Start contact", "💬\n\"\\"])("treats title %s only as display text", title => {
  const result = workflow([message(title), wait(title), message(title)]);
  expect(new Set(result.nodes.map(n => n.name)).size).toBe(result.nodes.length);
  for (const node of result.nodes.filter(n => n.type.endsWith(".httpRequest"))) {
    const expression = String(node.parameters.jsonBody).slice(3, -2);
    const body = JSON.parse(new Function("$", `return ${expression}`)(() => ({ first: () => ({ json: { body: { enrolmentId: "contact" } } }) })));
    expect(body.enrolmentId).toBe("contact"); expect([0, 2]).toContain(body.stepIndex);
  }
});
it("every compiled action reaches exactly its specified successor through a wait", () => {
  const first = message("Same"), shared = message("Same [1]");
  const definition = campaignDefinition.parse({ schemaVersion: 1, steps: [first, wait("Delay"), shared], splits: [{ id: randomUUID(), title: "Branches", afterStepId: first.id, percentage: 50, pathA: [wait("Delay"), message("Same")], pathB: [wait("Delay [2]"), message("Same")] }] });
  const result = buildSequenceWorkflow({ versionId: randomUUID(), sequenceName: "Branches", version: 1, definition, appUrl: "https://app.test" });
  const entries = campaignStepEntries(definition);
  const sendFor = (index: number) => result.nodes.find(n => n.type.endsWith(".httpRequest") && String(n.parameters.jsonBody).includes(`stepIndex: ${index} }`))!;
  const firstSend = sendFor(0); const sent = result.connections[firstSend.name].main[0][0].node;
  const split = result.connections[sent].main[0][0].node;
  for (let branch = 0; branch < 2; branch++) {
    const branchWait = result.connections[split].main[branch][0].node;
    const branchSend = result.connections[branchWait].main[0][0].node;
    expect(branchSend).toBe(sendFor(branch === 0 ? 2 : 4).name);
    const branchSent = result.connections[branchSend].main[0][0].node;
    const sharedWait = result.connections[branchSent].main[0][0].node;
    expect(result.connections[sharedWait].main[0][0].node).toBe(sendFor(entries.length - 1).name);
  }
});
function configured() {
  vi.stubEnv("CAMPAIGN_N8N_URL", "https://n8n.test"); vi.stubEnv("CAMPAIGN_N8N_API_KEY", "test-key"); vi.stubEnv("CAMPAIGN_APP_URL", "https://app.test"); vi.stubEnv("NODE_ENV", "test");
}
it("deletes an orphan workflow if activation fails and preserves the original error", async () => {
  configured(); const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: "orphan" })).mockResolvedValueOnce(new Response("activation failure", { status: 503 })).mockResolvedValueOnce(new Response("cleanup failure", { status: 503 })); vi.stubGlobal("fetch", fetch);
  await expect(provisionSequenceWorkflow({ versionId: randomUUID(), sequenceName: "Test", version: 1, definition: { schemaVersion: 1, steps: [message("Hi")] } })).rejects.toThrow("activation failure");
  expect(fetch.mock.calls.map(([url, options]) => [url, options.method])).toEqual([["https://n8n.test/api/v1/workflows", "POST"], ["https://n8n.test/api/v1/workflows/orphan/activate", "POST"], ["https://n8n.test/api/v1/workflows/orphan", "DELETE"]]);
});
it("production cannot provision a workflow exposing an environment secret expression", async () => {
  configured(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CAMPAIGN_N8N_WORKER_CREDENTIAL_ID", ""); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(provisionSequenceWorkflow({ versionId: randomUUID(), sequenceName: "Test", version: 1, definition: { schemaVersion: 1, steps: [message("Hi")] } })).rejects.toThrow("credential"); expect(fetch).not.toHaveBeenCalled();
});
