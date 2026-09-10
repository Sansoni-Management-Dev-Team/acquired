// Local-only measurement run: research the businesses in a mandate that still
// lack headcount evidence, one at a time, and report coverage, elapsed time and
// inference cost. Requires `pnpm dev` and a signed-in session cookie saved at
// .local-data/dev/test-cookie. Output stays under .local-data.
//
//   node scripts/retest-research-gaps.mjs <mandateId> [--limit 5] [--people]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const mandateId = process.argv[2];
if (!mandateId) throw new Error("Usage: node scripts/retest-research-gaps.mjs <mandateId> [--limit N] [--people]");
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : 100;
const includePeople = process.argv.includes("--people");
const origin = process.env.APP_URL || "http://localhost:3010";
const cookie = readFileSync(".local-data/dev/test-cookie", "utf8").trim();
const db = new pg.Client({ connectionString: "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire" });
await db.connect();
const api = async (path, body) => {
  const response = await fetch(`${origin}${path}`, { method: body ? "POST" : "GET", headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error || response.status}`);
  return data;
};
const evidenceFor = async targetId => (await db.query("select evidence, source_url from research_findings where target_id = $1 and mandate_id = $2", [targetId, mandateId])).rows.map(r => ({ ...r.evidence, sourceUrl: r.source_url }));
const summarise = evidence => ({
  headcount: [...new Set(evidence.filter(e => e.kind === "headcount").map(e => e.value))],
  revenue: [...new Set(evidence.filter(e => e.kind === "revenue").map(e => e.value))],
  people: [...new Set(evidence.filter(e => e.kind === "person").map(e => `${e.name} (${e.value})${e.email ? ` <${e.email}>` : ""}`))],
  directEmails: evidence.filter(e => e.kind === "person" && e.email).length,
  relevant: evidence.some(e => ["product", "capability", "customer"].includes(e.kind) && e.relevance === "relevant"),
});
const { rows: members } = await db.query("select t.id, t.company_name, t.domain from mandate_targets mt join targets t on t.id = mt.target_id where mt.mandate_id = $1 and t.domain is not null order by t.company_name", [mandateId]);
const results = [];
const started = Date.now();
for (const member of members) {
  if (results.length >= limit) break;
  const before = summarise(await evidenceFor(member.id));
  if (before.headcount.length && (!includePeople || before.people.length)) { results.push({ company: member.company_name, skipped: "evidence already saved", ...before }); continue; }
  const purpose = before.headcount.length ? "people" : "firmographics";
  const path = purpose === "people" ? `/api/targets/${member.id}/people-research` : `/api/targets/${member.id}/company-research`;
  // One manual research job per organisation at a time: wait for any active job first.
  while ((await db.query("select 1 from research_jobs where status not in ('complete','partial','failed','cancelled') limit 1")).rows.length) await new Promise(r => setTimeout(r, 5000));
  const t0 = Date.now();
  let job;
  try { job = await api(path, { action: "start", mandateId, requestId: randomUUID(), approved: true }); }
  catch (error) { results.push({ company: member.company_name, error: error.message, ...before }); continue; }
  let row;
  do {
    await new Promise(r => setTimeout(r, 5000));
    row = (await db.query("select status, message, pages, model_calls, config from research_jobs where id = $1", [job.jobId])).rows[0];
  } while (!["complete", "partial", "failed", "cancelled"].includes(row.status) && Date.now() - t0 < 16 * 60 * 1000);
  const after = summarise(await evidenceFor(member.id));
  const log = readFileSync(".local-data/dev-start.log", "utf8").split("\n").filter(line => line.startsWith("research-ai ") && line.includes(job.jobId)).map(line => JSON.parse(line.slice("research-ai ".length)));
  results.push({ company: member.company_name, purpose, jobId: job.jobId, status: row.status, message: row.message, pages: row.pages, modelCalls: row.model_calls, searches: (row.config.targetedSearches || []).length, elapsedSeconds: Math.round((Date.now() - t0) / 1000), aiCalls: log.length, costUsd: log.reduce((sum, u) => sum + (u.cost || 0), 0), paidCalls: log.filter(u => u.paidFallback).length, before, after });
  console.log(`${member.company_name}: ${row.status} · ${row.pages} pages · ${(row.config.targetedSearches || []).length} searches · headcount ${after.headcount.join("/") || "unknown"} · people ${after.people.length} · emails ${after.directEmails} · ${Math.round((Date.now() - t0) / 1000)}s`);
}
await db.end();
const measured = results.filter(r => r.jobId);
const all = results.filter(r => !r.error);
const report = {
  mandateId, elapsedMinutes: Math.round((Date.now() - started) / 60000), businesses: all.length, researched: measured.length,
  relevantBusinesses: all.filter(r => (r.after || r).relevant).length,
  headcountCoverage: all.filter(r => (r.after || r).headcount.length).length,
  namedPersonCoverage: all.filter(r => (r.after || r).people.length).length,
  directEmailCoverage: all.filter(r => (r.after || r).directEmails).length,
  totalCostUsd: measured.reduce((sum, r) => sum + r.costUsd, 0), paidCalls: measured.reduce((sum, r) => sum + r.paidCalls, 0), results,
};
mkdirSync(".local-data/research-retests", { recursive: true });
const file = `.local-data/research-retests/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
console.log(`Saved ${file}`);
