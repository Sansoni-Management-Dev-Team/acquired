import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const workloadFiles = ['cloudflare/research/index.ts', 'src/domain/automatic-research.ts', 'src/app/api/mandates/[id]/research/route.ts', 'src/lib/parallel-business-research.ts', 'src/app/api/research/internal/[jobId]/route.ts'];

// Overrides belong only to the frozen benchmark copy, never the working app.
export function benchmarkWorkloadSources(sources, { companies, minutes }) {
  if (!Number.isInteger(companies) || companies < 1 || companies > 100 || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw Error('Invalid benchmark workload');
  const replace = (file, before, after, count) => {
    if (sources[file].split(before).length - 1 !== count) throw Error(`Benchmark override no longer matches ${file}; review before running`);
    sources[file] = sources[file].replaceAll(before, after);
  };
  replace('cloudflare/research/index.ts', 'maxCompanies:100', `maxCompanies:${companies}`, 3);
  replace('src/domain/automatic-research.ts', 'DISCOVERY_CANDIDATE_LIMIT = 90', `DISCOVERY_CANDIDATE_LIMIT = ${companies}`, 1);
  replace('src/domain/automatic-research.ts', 'automaticDeadline: Date.now() + effort.minutes * 60 * 1000', `automaticDeadline: Date.now() + ${minutes} * 60 * 1000`, 1);
  replace('src/app/api/mandates/[id]/research/route.ts', 'config.automaticDeadline=Date.now()+10*60000', `config.automaticDeadline=Date.now()+${minutes}*60000`, 1);
  replace('src/lib/parallel-business-research.ts', 'const admittedDomains = new Set(related.filter(j => (j.config as ResearchConfig).researchTask).map(j => (j.config as ResearchConfig).companyDomain));', 'const admittedDomains = new Set(related.filter(j => (j.config as ResearchConfig).researchTask).map(j => (j.config as ResearchConfig).companyDomain));\n  const selectedDomains = new Set(admittedDomains);', 1);
  replace('src/lib/parallel-business-research.ts', 'const domain = researchDomain(safe);', `const domain = researchDomain(safe);\n    if (!selectedDomains.has(domain)) {\n      if (selectedDomains.size >= ${companies}) return;\n      selectedDomains.add(domain);\n    }`, 1);
  replace('src/app/api/research/internal/[jobId]/route.ts', 'discovery.targets.slice(0, 100)', `discovery.targets.slice(0, ${companies})`, 2);
  return sources;
}

export function applyBenchmarkWorkload(directory, options) {
  const files = workloadFiles;
  const sources = benchmarkWorkloadSources(Object.fromEntries(files.map(file => [file, readFileSync(resolve(directory, file), 'utf8')])), options);
  for (const [file, source] of Object.entries(sources)) writeFileSync(resolve(directory, file), source);
  return { ...options, files, scope: 'Frozen benchmark source only; candidate cap does not guarantee qualification.' };
}
