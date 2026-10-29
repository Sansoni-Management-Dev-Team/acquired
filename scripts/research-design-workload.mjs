import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const workloadFiles = ['cloudflare/research/index.ts', 'src/domain/automatic-research.ts', 'src/lib/start-mandate-research.ts', 'src/lib/parallel-business-research.ts', 'src/app/api/research/internal/[jobId]/route.ts'];

// Overrides belong only to the frozen benchmark copy, never the working app.
export function benchmarkWorkloadSources(sources, { companies, minutes }) {
  if (!Number.isInteger(companies) || companies < 1 || companies > 100 || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw Error('Invalid benchmark workload');
  const replace = (file, before, after, count) => {
    if (typeof sources[file] !== 'string' || sources[file].split(before).length - 1 !== count) throw Error(`Benchmark override no longer matches ${file}; review before running`);
    sources[file] = sources[file].replaceAll(before, after);
  };
  // Match each current engine exactly. Only ordinary fallback limits change;
  // native and V3/V4/V5 policies retain their independently reviewed bounds.
  replace('cloudflare/research/index.ts', 'maxCompanies:100', `maxCompanies:${companies}`, 1);
  const hybridLimit='maxCompanies:(initial.config.companyDiscoveryPolicy?.version===4||initial.config.companyDiscoveryPolicy?.version===5)?initial.config.companyDiscoveryPolicy.maxProfiledCompanies:initial.config.nativeAgent||initial.config.companyDiscoveryPolicy?.version===3?Math.min(initial.config.targetBusinesses||20,20):100';
  replace('cloudflare/research/index.ts', hybridLimit, hybridLimit.slice(0,-3)+companies, 1);
  replace('cloudflare/research/index.ts', 'maxCompanies:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,20):100', `maxCompanies:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,20):${companies}`, 1);
  replace('cloudflare/research/index.ts', 'pageSize:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,20):100', `pageSize:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,20):${companies}`, 1);
  replace('src/domain/automatic-research.ts', 'DISCOVERY_CANDIDATE_LIMIT = 90', `DISCOVERY_CANDIDATE_LIMIT = ${companies}`, 1);
  const reviewed='config.nativeAgent||config.companyDiscoveryPolicy?.version===3||config.companyDiscoveryPolicy?.version===4||config.companyDiscoveryPolicy?.version===5';
  replace('src/domain/automatic-research.ts', 'automaticDeadline: Date.now() + effort.minutes * 60 * 1000', `automaticDeadline: Date.now() + (${reviewed}?effort.minutes:${minutes}) * 60 * 1000`, 1);
  // Finite company workloads retain their completion policy, including in benchmarks.
  const completion="config.completionPolicy='work-items';\n    delete config.automaticDeadline;";
  replace('src/lib/start-mandate-research.ts',completion,completion,1);
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
