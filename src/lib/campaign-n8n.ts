import { randomUUID } from "node:crypto";
import type { CampaignDefinition } from "@/domain/campaign";

type Node = { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown>; credentials?: Record<string, unknown>; webhookId?: string };
type Link = { node: string; type: "main"; index: number };

function n8nUrl() {
  const url = process.env.CAMPAIGN_N8N_URL;
  if (!url) throw new Error("Campaign n8n URL must be configured");
  return url.replace(/\/$/, "");
}

function n8nConfig() {
  const url = n8nUrl();
  const apiKey = process.env.CAMPAIGN_N8N_API_KEY;
  const appUrl = process.env.CAMPAIGN_APP_URL;
  if (!apiKey || !appUrl) throw new Error("Campaign n8n API key and app URL must be configured");
  return { url, apiKey, appUrl: appUrl.replace(/\/$/, "") };
}

export function n8nCampaignEnabled() { return process.env.CAMPAIGN_N8N_ENABLED === "true"; }

export function buildSequenceWorkflow(input: { versionId: string; sequenceName: string; version: number; definition: CampaignDefinition; appUrl: string; credentialId?: string }) {
  const nodes: Node[] = [];
  const connections: Record<string, { main: Link[][] }> = {};
  const add = (name: string, type: string, typeVersion: number, parameters: Record<string, unknown>, x: number, y: number, credentials?: Record<string, unknown>) => {
    nodes.push({ id: randomUUID(), name, type: `n8n-nodes-base.${type}`, typeVersion, position: [x, y], parameters, ...(credentials ? { credentials } : {}) });
  };
  const link = (from: string, to: string, branch = 0) => {
    const main = connections[from]?.main || [];
    while (main.length <= branch) main.push([]);
    main[branch].push({ node: to, type: "main", index: 0 });
    connections[from] = { main };
  };
  add("Start contact", "webhook", 2, { httpMethod: "POST", path: `acquire/campaign/${input.versionId}`, responseMode: "onReceived", options: {} }, 160, 300);
  nodes[0].webhookId = input.versionId;
  let previous = "Start contact";
  const emails = input.definition.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.kind === "email");
  for (const { step, index } of emails) {
    const x = 430 + index * 530;
    if (index > 0) {
      const wait = input.definition.steps[index - 1];
      const waitName = `Wait ${wait.kind === "wait" ? wait.days : "?"} days: ${wait.title}`;
      add(waitName, "wait", 1.1, { resume: "specificTime", dateTime: "={{ $json.nextStepAt }}" }, x - 180, 300);
      link(previous, waitName);
      previous = waitName;
    }
    const sendName = `Send: ${step.title}`;
    const params: Record<string, unknown> = {
      method: "POST",
      url: `${input.appUrl}/api/internal/campaigns/step`,
      sendHeaders: true,
      headerParameters: { parameters: input.credentialId ? [] : [{ name: "Authorization", value: "={{ 'Bearer ' + $env.OUTREACH_WORKER_SECRET }}" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ enrolmentId: $('Start contact').first().json.body.enrolmentId, versionId: '${input.versionId}', stepIndex: ${index} }) }}`,
      options: { timeout: 120000 },
      ...(input.credentialId ? { authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth" } : {}),
    };
    add(sendName, "httpRequest", 4.2, params, x, 300, input.credentialId ? { httpHeaderAuth: { id: input.credentialId, name: process.env.CAMPAIGN_N8N_WORKER_CREDENTIAL_NAME || "Header Auth account" } } : undefined);
    link(previous, sendName);
    const sentName = `Sent: ${step.title}`;
    const retryName = `Retry later: ${step.title}`;
    const retryWait = `Wait until allowed: ${step.title}`;
    const condition = (value: string) => ({ options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: randomUUID(), leftValue: "={{ $json.outcome }}", rightValue: value, operator: { type: "string", operation: "equals" } }], combinator: "and" });
    add(sentName, "if", 2.2, { conditions: condition("sent") }, x + 180, 300);
    add(retryName, "if", 2.2, { conditions: condition("retry") }, x + 180, 500);
    add(retryWait, "wait", 1.1, { resume: "specificTime", dateTime: "={{ $json.nextStepAt }}" }, x - 60, 550);
    link(sendName, sentName);
    link(sentName, retryName, 1);
    link(retryName, retryWait);
    link(retryWait, sendName);
    previous = sentName;
  }
  return { name: `Acquire · ${input.sequenceName} · v${input.version}`, nodes, connections, settings: { executionOrder: "v1", timezone: "Australia/Melbourne", saveExecutionProgress: true } };
}

async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const { url, apiKey } = n8nConfig();
  const response = await fetch(`${url}/api/v1${path}`, { method, headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  if (!response.ok) throw new Error(`n8n ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 250)}`);
  return response.json() as Promise<T>;
}

export async function provisionSequenceWorkflow(input: { versionId: string; sequenceName: string; version: number; definition: CampaignDefinition }) {
  const { appUrl } = n8nConfig();
  const credentialId = process.env.CAMPAIGN_N8N_WORKER_CREDENTIAL_ID;
  if (process.env.NODE_ENV === "production" && !credentialId) throw new Error("Production n8n worker credential is not configured");
  const workflow = buildSequenceWorkflow({ ...input, appUrl, credentialId });
  const created = await api<{ id: string }>("/workflows", "POST", workflow);
  try { await api(`/workflows/${created.id}/activate`, "POST"); }
  catch (error) { await api(`/workflows/${created.id}`, "DELETE").catch(() => undefined); throw error; }
  return created.id;
}

export async function removeSequenceWorkflow(workflowId: string) {
  await api(`/workflows/${workflowId}/deactivate`, "POST").catch(() => undefined);
  await api(`/workflows/${workflowId}`, "DELETE");
}

export async function startSequenceContact(versionId: string, enrolmentId: string) {
  const url = n8nUrl();
  const response = await fetch(`${url}/webhook/acquire/campaign/${versionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentId }), cache: "no-store" });
  if (!response.ok) throw new Error(`n8n contact start failed (${response.status})`);
}
