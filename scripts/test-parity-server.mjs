// Exercises the running local app, Worker and Postgres. No migrations.
// Uses the saved local login; leaves a labelled test mandate for inspection.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const app = 'http://localhost:3010';
const worker = 'http://127.0.0.1:8787';
const cookie = readFileSync('.local-data/dev/test-cookie', 'utf8').trim();
const secret = readFileSync('.local-data/dev/service-secret', 'utf8').trim();
const configuration = JSON.parse(readFileSync('.local-data/dev/wrangler.json', 'utf8'));
assert.equal(configuration.vars.LOCAL_DEVELOPMENT, 'true');
assert.equal(configuration.vars.LOCAL_RESEARCH_POLICY, 'production');
assert.equal(configuration.durable_objects.bindings[0].name, 'PROVIDER_COORDINATOR');
const db = new pg.Client({ connectionString: 'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire' });
const report = { startedAt: new Date().toISOString(), checks: [], jobs: [] };
const active = new Set();
async function request(base, path, body, auth = 'user') {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(auth === 'user' ? { cookie } : auth === 'service' ? { authorization: `Bearer ${secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, data: await response.json() };
}
function passed(name) { report.checks.push(name); console.log(`PASS ${name}`); }
async function row(id) { return (await db.query('select * from research_jobs where id=$1', [id])).rows[0]; }
async function waitForJob(id) {
  const deadline = Date.now() + 180000;
  let previous;
  while (Date.now() < deadline) {
    const job = await row(id);
    if (job.status !== previous) { console.log(`Job ${id}: ${job.status} (${job.pages} pages, ${job.model_calls} model calls)`); previous = job.status; }
    if (['complete', 'partial', 'failed', 'cancelled'].includes(job.status)) { active.delete(id); return job; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Job ${id} exceeded test timeout`);
}
await db.connect();
try {
  assert.equal((await request(app, '/api/mandates', undefined, 'none')).status, 401);
  assert.equal((await request(worker, '/', undefined, 'none')).status, 401);
  passed('App and Worker reject unauthenticated requests');
  const listed = await request(app, '/api/mandates');
  assert.equal(listed.status, 200);
  assert.ok(listed.data.mandates.length, 'A saved local mandate is needed as a brief template');
  const template = listed.data.mandates[0].brief;
  assert.ok(template);
  const created = await request(app, '/api/mandates', { ...template, name: `Parity integration test ${report.startedAt}`, disclosureApproved: false });
  assert.equal(created.status, 201);
  report.mandateId = created.data.id;
  passed('Authenticated mandate creation persists through the real API');
  for (const input of [{ engine: 'google' }, { page: 2 }]) {
    assert.equal((await request(worker, '/search', { query: 'industrial construction Australia', ...input }, 'service')).status, 422);
  }
  passed('Live Worker enforces production search restrictions');
  const config = { requestId: randomUUID(), seeds: ['https://arkindustrial.com.au/'],
    searchTerms: ['industrial construction'], geography: 'Australia', approved: true, discover: false,
    budget: { maxPages: 1, maxDomains: 1, maxMinutes: 2, maxModelCalls: 1 } };
  const path = `/api/mandates/${report.mandateId}/research`;
  const start = await request(app, path, config);
  assert.equal(start.status, 202);
  assert.equal(start.data.jobId, config.requestId);
  active.add(config.requestId); report.jobs.push(config.requestId);
  const duplicate = await request(app, path, config);
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.data.jobId, config.requestId);
  assert.equal((await db.query('select count(*)::int as count from research_jobs where id=$1', [config.requestId])).rows[0].count, 1);
  passed('Duplicate start reuses the same persisted job');
  const competing = await request(app, path, { ...config, requestId: randomUUID() });
  assert.equal(competing.status, 409);
  passed('Database active-slot constraint rejects a competing manual job');
  const done = await waitForJob(config.requestId);
  report.research = { status: done.status, message: done.message, pages: done.pages, modelCalls: done.model_calls, runtime: done.config.runtime };
  assert.ok(['complete', 'partial'].includes(done.status), done.message);
  assert.equal(done.pages, 1, done.message);
  assert.equal(done.model_calls, 1, done.message);
  const findings = (await db.query('select source_url,evidence from research_findings where job_id=$1', [done.id])).rows;
  report.findings = findings;
  assert.ok(findings.length, 'Live extraction should persist supported findings');
  passed('Real Workflow reads through OrbStack, extracts with OpenRouter and saves evidence');
  const stale = { revision: done.revision, status: 'crawling', pages: 0, modelCalls: 0, message: 'Stale integration test callback' };
  const callback = await request(app, `/api/research/internal/${done.id}`, stale, 'service');
  assert.equal(callback.status, 200);
  const unchanged = await row(done.id);
  assert.equal(unchanged.status, done.status); assert.equal(unchanged.revision, done.revision); assert.equal(unchanged.pages, done.pages);
  passed('Stale callback cannot overwrite terminal job progress');
  const cancelId = randomUUID();
  const second = await request(app, path, { ...config, requestId: cancelId });
  assert.equal(second.status, 202); active.add(cancelId); report.jobs.push(cancelId);
  assert.equal((await request(app, `/api/research/${cancelId}`, { action: 'cancel' })).status, 200);
  assert.equal((await waitForJob(cancelId)).status, 'cancelled');
  const workflow = await request(worker, `/jobs/${cancelId}`, undefined, 'service');
  report.cancelledWorkflow = workflow.data;
  assert.equal(workflow.status, 200);
  assert.ok(['terminated', 'complete'].includes(workflow.data.status));
  passed('Cancellation persists and stops the real Workflow');
  report.success = true;
} catch (error) {
  report.success = false; report.error = error.message; console.error(`FAIL ${error.message}`); process.exitCode = 1;
} finally {
  for (const id of active) await request(app, `/api/research/${id}`, { action: 'cancel' }).catch(() => {});
  await db.end();
  mkdirSync('.local-data/parity-tests', { recursive: true });
  const file = `.local-data/parity-tests/${report.startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Report: ${file}`);
}
