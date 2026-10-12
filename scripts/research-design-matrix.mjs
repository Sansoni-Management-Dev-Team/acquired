import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const designs = ['A', 'B', 'C', 'D', 'E', 'F'];
const demoNames = ['Food Packaging Manufacturers', 'Veterinary Diagnostics Laboratories', 'Aged Care Software Support'];
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export async function demoCases() {
  const require = createRequire(import.meta.url);
  const esbuild = createRequire(require.resolve('vitest/package.json'))('esbuild');
  const bundle = esbuild.buildSync({ stdin: { contents: 'export { testMandates } from "./src/domain/test-mandates"; export { briefToMandate } from "./src/domain/acquisition";', resolveDir: root }, tsconfig: resolve('tsconfig.json'), bundle: true, platform: 'node', format: 'esm', write: false });
  const { testMandates, briefToMandate } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  return demoNames.map((name, index) => {
    const brief = testMandates.find(candidate => candidate.name.includes(name));
    if (!brief) throw Error(`Demo mandate not found: ${name}`);
    return { version: 1, name, demoIndex: testMandates.indexOf(brief), slug: ['packaging', 'veterinary', 'software'][index], mandate: { natural_language: brief.naturalLanguage, filters: { ...briefToMandate(brief), brief }, confirmation: brief.name, provenance: { source: 'Run demo catalogue; fixed benchmark brief' } }, input: { fromBrief: true } };
  });
}

export function matrixPlan(cases) {
  // Rotate design order between mandates to distribute provider/time-of-day drift.
  return cases.flatMap((testCase, index) => [...designs.slice(index * 2), ...designs.slice(0, index * 2)].map(design => ({ case: testCase.slug, design })));
}

export function writeMatrixReport(directory, state) {
  const completed = state.samples.filter(sample => sample.final);
  const failed = state.samples.filter(sample => sample.failure);
  const lines = ['Research pipeline benchmark: three demo mandates × six variants', `Updated: ${new Date().toISOString()}`, `State: ${state.status}; completed ${completed.length}/18; failed ${failed.length}/18`, '', 'Each case uses the same frozen brief, source, starting DB dump and a fresh synthetic organization.', 'Workload: at most 20 researched candidates; 10-minute root research budget; normal bounded child-job drain.', 'No database migrations. Original local/remote app data is unchanged.', 'Single samples are exploratory; live providers drift. Bands, estimates, accepted ABNs and contacts are separate metrics.', 'D/E do not request people; F does. Source evidence and actual persisted fields are retained.', '', 'Mandate | Variant | Outcome | Saved companies | ABN | Headcount | Revenue | Accreditations | Companies with people | Companies with person email | Seconds'];
  if (state.audit) lines.push('', 'Post-run audit:', ...state.audit.notes, '');
  for (const planned of state.plan) {
    const sample = state.samples.find(item => item.case === planned.case && item.design === planned.design);
    const summary = sample?.final?.summary || sample?.latest || (state.current?.case === planned.case && state.current?.design === planned.design ? state.current.latest : undefined);
    const d = summary?.dataCompletion;
    lines.push([planned.case, planned.design, sample?.final ? summary.status + '/' + summary.completion : sample?.failure ? 'FAILED: ' + sample.failure.message : state.current?.case === planned.case && state.current?.design === planned.design ? 'running' : 'pending', d?.savedCompanies ?? '-', ...['abn', 'headcount', 'revenue', 'accreditations', 'people', 'personEmail'].map(key => d?.fields[key]?.found ?? '-'), summary ? Math.round(summary.elapsedMs / 1000) : '-'].join(' | '));
  }
  lines.push('', 'Field counts above use saved companies. report.json additionally records completion against the requested 20, profile bands, contacts, evidence-validator coverage, provider failures and per-stage timings.', 'deadline-snapshot.json records the first observation at the root deadline; final.json includes child-job completion.', 'A reachable or faster implementation is not automatically a deprecation recommendation; compare coverage and operational failures.', '', 'Mandates:');
  for (const c of state.cases) lines.push(`${c.name}: ${c.mandate.natural_language}`);
  writeFileSync(resolve(directory, 'report.txt'), lines.join('\n') + '\n', { mode: 0o600 });
  save(resolve(directory, 'report.json'), state);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node scripts/research-design-matrix.mjs [--out DIR] [--dry-run] [--resume]\nRuns A–F serially on three contrasting Run demo mandates, capped at 20 companies and 10 minutes each.'); return; }
  const index = args.indexOf('--out');
  const directory = resolve(index >= 0 ? args[index + 1] : `.local-data/research-design/matrix-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let state;
  if (args.includes('--resume')) state = JSON.parse(readFileSync(resolve(directory, 'report.json')));
  else { const cases = await demoCases(); state = { startedAt: new Date().toISOString(), status: 'prepared', cases, plan: matrixPlan(cases), samples: [] }; }
  writeMatrixReport(directory, state);
  if (args.includes('--dry-run')) { console.log(JSON.stringify({ directory, cases: state.cases.map(c => c.name), samples: state.plan.length })); return; }
  const lock = resolve('.local-data/research-design/suite.lock'), token = randomUUID();
  if (existsSync(lock)) {
    let owner; try { owner = JSON.parse(readFileSync(resolve(lock, 'owner.json'))); } catch { throw Error('Benchmark lock is occupied'); }
    let alive = true; try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw Error('Another live benchmark suite is running');
    rmSync(lock, { recursive: true });
  }
  mkdirSync(lock); save(resolve(lock, 'owner.json'), { pid: process.pid, token, startedAt: state.startedAt });
  let child, stopping = false;
  const stop = () => { stopping = true; child?.kill('SIGTERM'); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const run = (argv, logFile) => new Promise((yes, no) => {
    child = spawn(process.execPath, [resolve('scripts/research-design-benchmark.mjs'), ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => {
      writeFileSync(logFile, data, { flag: 'a', mode: 0o600 }); process.stdout.write(data);
      const latest = state.current && resolve(state.current.directory, 'latest.json');
      if (latest && existsSync(latest)) { state.current.latest = JSON.parse(readFileSync(latest)); writeMatrixReport(directory, state); }
    });
    child.stderr.on('data', data => writeFileSync(logFile, data, { flag: 'a', mode: 0o600 }));
    child.once('error', no); child.once('exit', code => { child = undefined; if (code === 0) yes(); else no(Error(`Benchmark exited ${code}; see ${logFile}`)); });
  });
  try {
    state.status = 'running'; writeMatrixReport(directory, state);
    let firstBaseline;
    for (const c of state.cases) {
      const baseline = resolve(directory, `${c.slug}-baseline`); const file = resolve(directory, `${c.slug}-case.json`); save(file, c);
      if (!existsSync(resolve(baseline, 'manifest.json'))) await run(['prepare', '--case', file, '--out', baseline, '--company-limit', '20', '--duration-minutes', '10', ...(firstBaseline ? ['--reuse-baseline', firstBaseline] : [])], resolve(directory, 'prepare.log'));
      firstBaseline ||= baseline;
    }
    for (const planned of state.plan) {
      if (stopping) break;
      if (state.samples.some(sample => sample.case === planned.case && sample.design === planned.design && sample.final)) continue;
      const sampleDirectory = resolve(directory, `${planned.case}-${planned.design}-${Date.now()}`);
      state.current = { ...planned, directory: sampleDirectory }; writeMatrixReport(directory, state);
      console.log(JSON.stringify({ event: 'matrix_sample_started', ...state.current }));
      let failure;
      try { await run(['run', '--design', planned.design, '--policy', 'production', '--baseline', resolve(directory, `${planned.case}-baseline`), '--out', sampleDirectory], resolve(directory, 'matrix.log')); }
      catch (error) { failure = { message: error.message }; }
      const read = name => existsSync(resolve(sampleDirectory, name)) ? JSON.parse(readFileSync(resolve(sampleDirectory, name))) : undefined;
      const sample = { ...planned, directory: sampleDirectory, final: read('final.json'), latest: read('latest.json'), deadline: read('deadline-snapshot.json'), failure: read('failure.json') || failure };
      state.samples = state.samples.filter(item => item.case !== planned.case || item.design !== planned.design); state.samples.push(sample); delete state.current; writeMatrixReport(directory, state);
      console.log(JSON.stringify({ event: 'matrix_sample_finished', ...planned, completed: state.samples.filter(s => s.final).length, failed: state.samples.filter(s => s.failure).length }));
    }
    state.status = stopping ? 'interrupted' : state.samples.every(sample => sample.final) && state.samples.length === 18 ? 'complete' : 'complete_with_failures';
    state.finishedAt = new Date().toISOString(); writeMatrixReport(directory, state);
    console.log(JSON.stringify({ event: 'matrix_finished', status: state.status, directory }));
  } catch (error) {
    state.status = 'failed'; state.finishedAt = new Date().toISOString(); state.error = error.message;
    writeMatrixReport(directory, state); throw error;
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    const owner = JSON.parse(readFileSync(resolve(lock, 'owner.json'))); if (owner.token === token) rmSync(lock, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
