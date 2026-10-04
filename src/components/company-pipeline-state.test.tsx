import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ResearchJob } from './research-panel';
import { companyPipelineState, researchRoot } from './company-pipeline-state';
import { CompanyPipelineProgress } from './company-pipeline-progress';
const root = { id: 'root', status: 'partial', createdAt: '2026-10-04T05:16:19Z', updatedAt: '2026-10-04T05:19:21Z', message: 'Company retrieval completed with operational gaps', config: { pipelineDesign: 'hybrid-firmable-v1', parallelResearchSettled: true } } as ResearchJob;
const company = { ...root, id: 'child', status: 'complete', config: { researchTask: 'company', researchRunId: 'root', targetId: 'saved' } } as ResearchJob;
it('selects the overall root even when completed children precede it', () => {
  expect(researchRoot([company, root])).toBe(root);
});
it('counts saved company records once and excludes older runs', () => {
  expect(companyPipelineState(root, [company, company, root, { ...company, id: 'old', config: { ...company.config, researchRunId: 'old', targetId: 'other' } }]).savedIds).toEqual(['saved']);
});
it('renders partial completion honestly with saved counts, elapsed time and a results link', () => {
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={root} jobs={[company, root]} mandateId="mandate" />);
  expect(html).toContain('Finished with issues');
  expect(html).toContain('1 company saved');
  expect(html).toContain('3m 2s');
  expect(html).toContain('/mandates/mandate?tab=targets');
  expect(html).not.toContain('100%');
  expect(html).not.toContain('Rank for fit');
});
it('does not mark the pipeline settled while any related job is active', () => {
  expect(companyPipelineState(root, [root, { ...company, status: 'reading' }]).settled).toBe(false);
});
it('counts persisted discovery page maps and search failures', () => {
  const config = { ...root.config, webSearchPages: { '0': { ok: true }, '1': { ok: false } }, firmableSearchPages: { '0': { records: [] } } };
  expect(companyPipelineState({ ...root, config }, [root])).toMatchObject({ webSearches: 2, webFailures: 1, firmableSearches: 1 });
});

it('shows the familiar progress bar and high-level tasks without provider names', () => {
  const running = { ...root, status: 'extracting', config: { ...root.config, parallelResearchSettled: false } };
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={running} jobs={[running, company]} mandateId="mandate" />);
  for (const label of ['Searching for businesses', 'Finding headcounts', 'Finding revenue bands', 'Verifying ABNs', 'Saving company results']) expect(html).toContain(label);
  expect(html).toContain('role="progressbar"');
  expect(html).not.toContain('aria-valuenow');
  expect(html).not.toContain('View companies');
  expect(html).not.toMatch(/Firmable|Web discovery|searches returned|profiles matched/i);
});
it('counts retrieved size and revenue data while preserving missing fields', () => {
  const withProfile = { ...company, config: { ...company.config, firmableProfile: { headcountExact: null, headcountBand: { min: 10, max: 20 }, revenueBand: null } } };
  expect(companyPipelineState(root, [root, withProfile])).toMatchObject({ headcounts: 1, revenueBands: 0 });
});
it('retains the progress screen until linked people research is settled', () => {
 const job = { ...root, status: 'complete', config: { ...root.config, includeCompanyPeople: true, companyPeopleProgress: {total:1,active:1,queued:0,complete:0,failed:0,found:3,saved:1,profilesFailed:0,settled:false} } };
 expect(companyPipelineState(job,[job,company]).settled).toBe(false);
 expect(renderToStaticMarkup(<CompanyPipelineProgress job={job} jobs={[job,company]}/>)).toContain('Finding people and emails');
 expect(companyPipelineState({...job,config:{...job.config,companyPeopleProgress:{...job.config.companyPeopleProgress,active:0,settled:true}}},[company]).settled).toBe(true);
});
