// Run with node --experimental-strip-types after creating a temporary local
// n8n API key in .local-data/n8n-test-api-key.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import "./campaign-test-loader.mjs";
const { buildSequenceWorkflow } = await import("../src/lib/campaign-n8n.ts");

const apiKey = process.env.CAMPAIGN_N8N_API_KEY || JSON.parse(await readFile(".local-data/n8n-test-api-key.json", "utf8")).key;
const base = "http://127.0.0.1:5679";
const versionId = randomUUID();
const enrolmentId = randomUUID();
const calls = [];
const persistWait = process.env.CAMPAIGN_N8N_PERSIST_WAIT === "1";
const server = createServer(async (request, response) => {
  if (request.url !== "/api/internal/campaigns/step") { response.writeHead(404).end(); return; }
  let body = "";
  for await (const chunk of request) body += chunk;
  const step = JSON.parse(body);
  calls.push(step.stepIndex);
  const firstRetry = step.stepIndex === 0 && calls.filter(index => index === 0).length === 1;
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ outcome: firstRetry ? "retry" : "sent", nextStepAt: new Date(Date.now() + (firstRetry && persistWait ? 75_000 : 2500)).toISOString() }));
});
await new Promise(resolve => server.listen(3011, "0.0.0.0", resolve));
const api = async (path, method = "GET", body) => {
  const result = await fetch(`${base}/api/v1${path}`, { method, headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!result.ok) throw new Error(`${method} ${path}: ${result.status} ${(await result.text()).slice(0, 200)}`);
  return result.json();
};
let workflowId;
async function assertRestartIsolated() {
  const workflows = await api("/workflows?limit=100");
  assert.ok(!workflows.nextCursor, "Restart check cannot prove isolation with additional workflow pages");
  const foreign = workflows.data.filter(item => item.active && item.id !== workflowId && item.id !== "acquireCampaignLocal");
  assert.equal(foreign.length, 0, `Cannot restart shared local n8n: ${foreign.length} other active workflows. Use a reserved test instance or an idle test window.`);
  const executions = await api("/executions?limit=100");
  assert.ok(!executions.nextCursor, "Restart check cannot prove isolation with additional execution pages");
  assert.equal(executions.data.filter(item => ["running", "waiting", "new"].includes(item.status) && item.workflowId !== workflowId).length, 0, "Cannot restart while another n8n execution is running or waiting");
}
try {
  const definition = { schemaVersion: 1, steps: [
    { id: randomUUID(), kind: "email", title: "Introduction", subject: "Hello", body: "Hi" },
    { id: randomUUID(), kind: "wait", title: "Follow up delay", days: 3 },
    { id: randomUUID(), kind: "email", title: "Follow up", subject: "Hello again", body: "Hi again" },
  ] };
  const workflow = buildSequenceWorkflow({ versionId, sequenceName: "No-send runtime test", version: 1, definition, appUrl: "http://host.docker.internal:3011" });
  workflowId = (await api("/workflows", "POST", workflow)).id;
  if (persistWait) await assertRestartIsolated();
  await api(`/workflows/${workflowId}/activate`, "POST", {});
  const triggered = await fetch(`${base}/webhook/acquire/campaign/${versionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentId }) });
  assert.equal(triggered.status, 200);
  if (persistWait) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    assert.deepEqual(calls, [0], "restart must happen while the first Wait is pending");
    await assertRestartIsolated();
    execFileSync("docker", ["--context", "orbstack", "restart", "project-acquire-n8n"], { stdio: "ignore", timeout: 30_000 });
  }
  let status = "running";
  for (let attempt = 0; attempt < (persistWait ? 180 : 30); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const executions = await api(`/executions?workflowId=${workflowId}&limit=1`).catch(() => ({ data: [] }));
    status = executions.data[0]?.status || "running";
    if (status === "success" || status === "error") break;
  }
  assert.equal(status, "success", `n8n execution ended with ${status}`);
  assert.deepEqual(calls, [0, 0, 2]);
  console.log(`n8n webhook, retry Wait, sequence Wait, and both email nodes passed${persistWait ? " across restart" : ""}`);
} finally {
  if (workflowId) {
    await api(`/workflows/${workflowId}/deactivate`, "POST", {}).catch(() => undefined);
    await api(`/workflows/${workflowId}`, "DELETE").catch(() => undefined);
  }
  server.close();
}
