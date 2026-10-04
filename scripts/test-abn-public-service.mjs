// Live benchmark of the same bounded client C calls. No database writes.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('wrangler/package.json')] }));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const source = option('jobs');
if (!source) throw new Error('Pass --jobs diagnostic-jobs.json');
const out = resolve(option('out', '.local-data/abn-public-service'));
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const bundle = resolve(out, 'service.mjs');
await build({ entryPoints: ['src/adapters/abn-public-lookup.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle });
const { createPublicAbnLookup } = await import(pathToFileURL(bundle).href);
let active = 0, peak = 0;
const lookup = createPublicAbnLookup(async (url, options) => {
  active++; peak = Math.max(peak, active);
  try { return await fetch(url, options); } finally { active--; }
});
const jobs = JSON.parse(fs.readFileSync(source, 'utf8'));
const companies = [...new Map(jobs.filter(j => j.config.researchTask === 'company').map(j => [j.config.companyDomain, { name: j.config.companyName || j.config.companyDomain, domain: j.config.companyDomain }])).values()];
const results = [], began = Date.now();
// Submit paired requests, stopping rather than flooding the registry on 429.
for (let i = 0; i < companies.length; i += 2) {
  await Promise.all(companies.slice(i, i + 2).map(async company => {
    const start = Date.now();
    try { results.push({ ...company, ...await lookup(company.name), elapsedMs: Date.now() - start }); }
    catch (error) { results.push({ ...company, status: 'request_error', error: error.message, elapsedMs: Date.now() - start }); }
  }));
  fs.writeFileSync(resolve(out, 'results.json'), JSON.stringify({ results }, null, 2), { mode: 0o600 });
  if (results.some(r => r.error?.includes('429'))) break;
  if (results.length % 30 === 0) console.log(JSON.stringify({ attempted: results.length, total: companies.length }));
}
const summary = { attempted: results.length, total: companies.length, durationMs: Date.now() - began, peakRequests: peak, concurrencyLimit: 2, minimumStartSpacingMs: 500, statusCounts: results.reduce((counts, r) => ({ ...counts, [r.status]: (counts[r.status] || 0) + 1 }), {}), identityNote: 'Name matches are candidates; C still validates the official entity record before saving an ABN.' };
fs.writeFileSync(resolve(out, 'results.json'), JSON.stringify({ summary, results }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
