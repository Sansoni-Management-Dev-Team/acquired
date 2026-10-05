// Real local n8n execution against a dummy callback; no mailbox or provider access.
// node --env-file=.env.local --experimental-strip-types scripts/test-campaign-n8n-adversarial-local.mjs
import './campaign-test-loader.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const { buildSequenceWorkflow } = await import('../src/lib/campaign-n8n.ts');
const { campaignDefinition, campaignFirstStepIndex, campaignStepEntries, campaignNextOptions } = await import('../src/domain/campaign.ts');
const apiKey = process.env.CAMPAIGN_N8N_API_KEY || JSON.parse(await readFile('.local-data/n8n-test-api-key.json', 'utf8')).key;
const base = 'http://127.0.0.1:5679';
const plans = new Map();
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/api/internal/campaigns/step') return response.writeHead(404).end();
  try {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); assert.deepEqual(Object.keys(body).sort(), ['enrolmentId', 'stepIndex', 'versionId']);
    const plan = plans.get(body.enrolmentId); assert.ok(plan); assert.equal(body.versionId, plan.versionId);
    plan.calls.push(body.stepIndex);
    const expected = plan.indices[plan.position]; assert.equal(body.stepIndex, expected);
    const retry = plan.position === 0 && plan.retries-- > 0;
    let result;
    if (retry) result = { outcome: 'retry', nextStepAt: new Date(Date.now() + 200).toISOString() };
    else if (plan.finish) result = { outcome: 'finished', nextStepAt: null };
    else {
      plan.position++;
      const nextStepIndex = plan.indices[plan.position] ?? null;
      result = { outcome: 'sent', nextStepIndex, nextStepAt: nextStepIndex === null ? null : new Date(Date.now() + 200).toISOString() };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(3012, '0.0.0.0', resolve));
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `n8n ${method} ${path}: ${response.status}`); return response.json();
}
const email = title => ({ id: randomUUID(), kind: 'email', title, subject: 'Hi', body: 'Dummy callback only' });
const wait = title => ({ id: randomUUID(), kind: 'wait', title, days: 1 });
const mixed = () => [email('Follow up'), wait('Delay'), { id: randomUUID(), kind: 'linkedin', action: 'message', title: 'Follow up [1]', body: 'Dummy callback only' }, wait('Delay [2]'), { id: randomUUID(), kind: 'whatsapp', title: 'Follow up', body: 'Dummy callback only' }];
const scenarios = [
  { name: 'Mixed channels and colliding titles', definition: { schemaVersion: 1, steps: mixed() }, retries: 2 },
  { name: 'Finished callback prevents downstream action', definition: { schemaVersion: 1, steps: mixed() }, finish: true },
];
for (const branch of [0, 1]) {
  const first = { id: randomUUID(), kind: 'linkedin', action: 'connect', title: 'Connect', body: '' };
  scenarios.push({ name: `Connection acceptance branch ${branch}`, branch, retries: 2, definition: { schemaVersion: 1, steps: [first, wait('Shared wait'), email('Shared')], splits: [{ id: randomUUID(), afterStepId: first.id, title: 'Connected?', percentage: 50, condition: { kind: 'linkedin_connected', timeoutDays: 7 }, pathA: [wait('Branch wait'), email('Variant')], pathB: [wait('Branch wait'), email('Variant')] }] } });
}
for (let sample = 0; sample < 4; sample++) scenarios.push({ name: `Subscription split ${sample}`, definition: { schemaVersion: 1, steps: [wait('Rejoin wait'), email('Shared')], splits: [{ id: randomUUID(), afterStepId: 'start', title: 'Initial split', percentage: 50, pathA: [email('Variant')], pathB: [email('Variant')] }] } });
try {
  for (const scenario of scenarios) {
    const definition = campaignDefinition.parse(scenario.definition); const enrolmentId = randomUUID(); const versionId = randomUUID();
    const indices = []; let index = campaignFirstStepIndex(definition, enrolmentId);
    for (let guard = 0; guard < campaignStepEntries(definition).length; guard++) {
      indices.push(index); const options = campaignNextOptions(definition, index); if (!options.length) break;
      index = options[options.length === 2 ? scenario.branch ?? 0 : 0].index;
    }
    const plan = { versionId, indices, position: 0, retries: scenario.retries ?? 0, finish: scenario.finish, calls: [] }; plans.set(enrolmentId, plan);
    let workflowId;
    try {
      const workflow = buildSequenceWorkflow({ versionId, sequenceName: `No-send audit: ${scenario.name}`, version: 1, definition, appUrl: 'http://host.docker.internal:3012' });
      workflowId = (await api('/workflows', 'POST', workflow)).id; await api(`/workflows/${workflowId}/activate`, 'POST', {});
      assert.equal((await fetch(`${base}/webhook/acquire/campaign/${versionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enrolmentId }) })).status, 200);
      let status;
      for (let poll = 0; poll < 60; poll++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        status = (await api(`/executions?workflowId=${workflowId}&limit=1`)).data[0]?.status;
        if (['success', 'error'].includes(status)) break;
      }
      assert.equal(status, 'success', `${scenario.name}: ${status}`);
      assert.deepEqual(plan.calls, scenario.finish ? [indices[0]] : [...Array(scenario.retries ?? 0).fill(indices[0]), ...indices]);
      console.log(`Passed: ${scenario.name}`);
    } finally {
      if (workflowId) { await api(`/workflows/${workflowId}/deactivate`, 'POST', {}).catch(() => undefined); await api(`/workflows/${workflowId}`, 'DELETE').catch(() => undefined); }
      plans.delete(enrolmentId);
    }
  }
} finally { server.close(); }
