import { it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { browserMarkdown } from '../cloudflare/research/browser-reader';
import { observedCompanyFacts } from '../src/domain/company-facts';
import { validatePeopleFindings } from '../src/domain/people-research';
import { missingResearchFields } from '../src/domain/research-objectives';
import type { ResearchConfig } from '../src/domain/research';

// Explicit opt-in only: three public homepage reads, no searches, AI or DB writes.
// Run with the existing provider environment; output records unknown fields too.
it.skipIf(process.env.RUN_RESEARCH_BENCHMARK !== '1')('benchmarks the production page reader on a fixed three-company sample', async () => {
  const sample = [
    ['MechTest', 'mechtest.com.au'],
    ['CISCAL', 'ciscal.com.au'],
    ['WA Calibrations', 'wacalibrations.com.au'],
  ];
  const rows = [];
  for (const [name, domain] of sample) {
    if (rows.length) await new Promise(resolve => setTimeout(resolve, 11000));
    const started = Date.now();
    try {
      const markdown = await browserMarkdown({ CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID, CF_BROWSER_TOKEN: process.env.CF_BROWSER_TOKEN }, `https://${domain}/`, { operation: 'benchmark_homepage', permit: async () => ({ granted: true, retryAfterMs: 0 }) });
      const config = { companyName: name, companyDomain: domain } as ResearchConfig;
      const findings = [...observedCompanyFacts(markdown, `https://${domain}/`, config), ...validatePeopleFindings([], markdown, `https://${domain}/`, config)];
      rows.push({ name, domain, status: 'read', elapsedMs: Date.now() - started, characters: markdown.length, fieldsFound: [...new Set(findings.map(f => f.kind))], missing: [...missingResearchFields({ purpose: 'firmographics' }, findings), ...missingResearchFields({ purpose: 'people' }, findings)] });
    } catch (error) {
      rows.push({ name, domain, status: 'failed', elapsedMs: Date.now() - started, category: error instanceof Error && 'category' in error ? error.category : 'unknown' });
    }
  }
  await mkdir('.local-data', { recursive: true });
  await writeFile('.local-data/stu-206-reader-benchmark.json', JSON.stringify({ observedAt: new Date().toISOString(), scope: 'Three homepage reads using current reader; not a full enrichment run or a before/after live coverage comparison', browserRequests: 3, searchRequests: 0, modelCalls: 0, actualCost: null, rows }, null, 2));
  expect(rows).toHaveLength(3);
}, 120000);
