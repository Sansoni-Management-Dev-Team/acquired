import { readFileSync, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeResearchEgress(contents, { jobId } = {}) {
  const queries = new Map(), jobs = new Map(), stages = new Map(), fields = new Map(), seen = new Set();
  let first, last, queryCount = 0, failedQueries = 0, measuredQueries = 0, resultJsonBytes = 0, rowsReturned = 0;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  const add = (map, key, identity, event) => {
    const group = map.get(key) || { ...identity, calls: 0, resultJsonBytes: 0, maxResultJsonBytes: 0, rowsReturned: 0, elapsedMs: 0 };
    group.calls++; group.resultJsonBytes += number(event.resultJsonBytes);
    group.maxResultJsonBytes = Math.max(group.maxResultJsonBytes, number(event.resultJsonBytes));
    group.rowsReturned += number(event.rowsReturned); group.elapsedMs += number(event.elapsedMs);
    map.set(key, group);
  };
  for (let line of contents.split('\n')) {
    // Supports local stdout and Vercel `logs --json` messages. Never add request
    // summaries to query totals: they describe the same operations twice.
    try { const outer = JSON.parse(line); if (typeof outer.message === 'string') line = outer.message; } catch { /* Plain stdout. */ }
    const marker = line.indexOf('research-db '); if (marker < 0) continue;
    let event; try { event = JSON.parse(line.slice(marker + 'research-db '.length)); } catch { continue; }
    if (event.event !== 'query_finished' || jobId && event.jobId !== jobId && event.runId !== jobId) continue;
    if (event.queryId && seen.has(event.queryId)) continue;
    if (event.queryId) seen.add(event.queryId);
    queryCount++; if (event.outcome === 'failed') failedQueries++;
    if (event.byteMeasurement === 'utf8_json_returned_rows' && typeof event.resultJsonBytes === 'number' && Number.isFinite(event.resultJsonBytes) && event.resultJsonBytes >= 0) measuredQueries++;
    resultJsonBytes += number(event.resultJsonBytes); rowsReturned += number(event.rowsReturned);
    if (typeof event.timestamp === 'string') { if (!first || event.timestamp < first) first = event.timestamp; if (!last || event.timestamp > last) last = event.timestamp; }
    const identity = { driver: event.driver || 'unknown', operation: event.operation || 'unknown', tables: Array.isArray(event.tables) ? event.tables.join(', ') : 'unknown', queryFingerprint: event.queryFingerprint || 'unknown', stage: event.stage || 'unattributed', action: event.action || 'unattributed' };
    add(queries, JSON.stringify(identity), identity, event);
    add(jobs, event.jobId || event.runId || 'unattributed', { jobId: event.jobId || event.runId || 'unattributed' }, event);
    add(stages, `${identity.stage}:${identity.action}`, { stage: identity.stage, action: identity.action }, event);
    for (const [field, bytes] of Object.entries(event.fieldJsonBytes || {})) fields.set(field, (fields.get(field) || 0) + number(bytes));
  }
  const ranked = map => [...map.values()].sort((a, b) => b.resultJsonBytes - a.resultJsonBytes).map(group => ({ ...group, meanResultJsonBytes: Math.round(group.resultJsonBytes / group.calls) }));
  return { first, last, queryCount, failedQueries, measuredQueries, unmeasuredQueries: queryCount - measuredQueries, resultJsonBytes, rowsReturned, byteMeasurement: 'utf8_json_returned_rows', queries: ranked(queries), jobs: ranked(jobs), stages: ranked(stages), fields: [...fields].map(([field, jsonBytes]) => ({ field, jsonBytes })).sort((a, b) => b.jsonBytes - a.jsonBytes) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), path = resolve(args.find(arg => !arg.startsWith('--')) || '.local-data/dev-start.log');
  const print = () => {
    const result = summarizeResearchEgress(readFileSync(path, 'utf8'), { jobId: args.find(arg => arg.startsWith('--job='))?.slice(6) });
    if (args.includes('--json')) return console.log(JSON.stringify(result, null, 2));
    console.log(`\nResearch database payloads: ${path}\nWindow: ${result.first || 'no measurements'} → ${result.last || 'no measurements'}\n${result.queryCount} queries; ${result.measuredQueries} measured; ${result.unmeasuredQueries} unmeasured; ${(result.resultJsonBytes / 1e6).toFixed(2)} MB measured returned JSON.`);
    console.log('Largest query groups'); console.table(result.queries.slice(0, 20));
    console.log('Jobs'); console.table(result.jobs.slice(0, 20));
    console.log('Stages/actions'); console.table(result.stages.slice(0, 20));
    console.log('Large JSON fields (subset of returned bytes; do not add to query totals)'); console.table(result.fields);
    console.log('Application UTF-8 JSON sizes exclude protocol/TLS overhead and compression. These are not billed egress or wire-byte measurements.');
  };
  print(); if (args.includes('--watch')) watchFile(path, { interval: 5000 }, print);
}
