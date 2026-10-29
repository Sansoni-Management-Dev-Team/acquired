import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ResearchJob } from './research-panel';
import { companyPipelineState, researchRoot } from './company-pipeline-state';
import { CompanyPipelineProgress } from './company-pipeline-progress';
const root = { id: 'root', status: 'partial', createdAt: '2026-10-04T05:16:19Z', updatedAt: '2026-10-04T05:19:21Z', message: 'Company retrieval completed with operational gaps', config: { pipelineDesign: 'hybrid-firmable-v1', parallelResearchSettled: true } } as ResearchJob;
const company = { ...root, id: 'child', status: 'complete', config: { researchTask: 'company', researchRunId: 'root', targetId: 'saved' } } as ResearchJob;
it('shows persisted discovery before any company profile finishes without claiming enrichment or saved results', () => {
  const searching = { ...root, status: 'extracting', discovery: { candidates: 18, firmablePages: 0, webQueries: 3, webFailures: 1 }, config: { ...root.config, parallelResearchSettled: false } };
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={searching} jobs={[searching]} />);
  expect(html).toContain('18 businesses found');
  expect(html).toContain('18 found');
  expect(html).toContain('0 companies researched');
  expect(html).toContain('0 companies saved');
});
it('shows continuation selections as saved businesses selected rather than new discoveries', () => {
  const continuation = { ...root, status: 'extracting', discovery: { candidates: 1, firmablePages: 0, webQueries: 0, webFailures: 0 }, config: { ...root.config, companyContinuation: { version: 1 as const, sourceRootId: 'old-root', sourceDigest: 'a'.repeat(64), candidateKeys: ['firmable:f1'] } } };
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={continuation} jobs={[continuation]} />);
  expect(html).toContain('1 business selected');
  expect(html).toContain('Saved businesses selected');
  expect(html).not.toContain('businesses found');
});
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
  expect(html).toContain('/mandates/mandate/companies');
  expect(html).not.toContain('100%');
  expect(html).not.toContain('Rank for fit');
});
it('does not mark the pipeline settled while any related job is active', () => {
  expect(companyPipelineState(root, [root, { ...company, status: 'reading' }]).settled).toBe(false);
});
it('stops foreground progress for a failed root without claiming unfinished company requests settled', () => {
  const failed = { ...root, status: 'failed' as const, message: 'Firmable rate limit (HTTP 429); no company profile was saved.' };
  const unfinished = { ...company, status: 'extracting' as const, config: { ...company.config, targetId: undefined } };
  expect(companyPipelineState(failed, [failed, unfinished])).toMatchObject({ settled: false, active: 1, savedIds: [] });
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={failed} jobs={[failed, unfinished]} mandateId="mandate" />);
  expect(html).toContain('Research failed');
  expect(html).toContain('Company data rate limit (HTTP 429); no company profile was saved.');
  expect(html).not.toMatch(/firmable/i);
  expect(html).toContain('1 company request is still recorded as in progress.');
  expect(html).toContain('3m 2s elapsed');
  expect(html).not.toContain('animate-spin');
  expect(html).not.toContain('so far');
  expect(html).not.toContain('RESEARCH COMPLETE');
});
it('keeps retained results available after cancellation without marking an unfinished child complete', () => {
  const cancelled = { ...root, status: 'cancelled' as const, message: 'Research cancelled by you.' };
  const unfinished = { ...company, id: 'unfinished', status: 'reading' as const };
  expect(companyPipelineState(cancelled, [cancelled, company, unfinished]).settled).toBe(false);
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={cancelled} jobs={[cancelled, company, unfinished]} mandateId="mandate" />);
  expect(html).toContain('Research cancelled');
  expect(html).toContain(cancelled.message);
  expect(html).toContain('1 company saved');
  expect(html).toContain('/mandates/mandate/companies');
  expect(html).not.toContain('animate-spin');
});
it('continues foreground progress for partial roots while company work is still active', () => {
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={root} jobs={[root, { ...company, status: 'reading' }]} />);
  expect(html).toContain('Finding businesses');
  expect(html).toContain('animate-spin');
  expect(html).toContain('so far');
});
it('counts persisted discovery page maps and search failures', () => {
  const config = { ...root.config, webSearchPages: { '0': { ok: true }, '1': { ok: false } }, firmableSearchPages: { '0': { records: [] } } };
  expect(companyPipelineState({ ...root, config }, [root])).toMatchObject({ webSearches: 2, webFailures: 1, firmableSearches: 1 });
});

it('shows the familiar progress bar and high-level tasks without provider names', () => {
  const running = { ...root, status: 'extracting', config: { ...root.config, parallelResearchSettled: false } };
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={running} jobs={[running, company]} mandateId="mandate" />);
  for (const label of ['Searching for businesses', 'Finding headcounts', 'Finding revenue bands', 'Finding ABNs', 'Saving company results']) expect(html).toContain(label);
  expect(html).toContain('role="progressbar"');
  expect(html).not.toContain('aria-valuenow');
  expect(html).toContain('View companies');
  expect(html).toContain('/mandates/mandate/companies');
  expect(html).not.toMatch(/Firmable|Web discovery|searches returned|profiles matched/i);
});
it('counts retrieved size and revenue data while preserving missing fields', () => {
  const withProfile = { ...company, config: { ...company.config, firmableProfile: { headcountExact: null, headcountBand: { min: 10, max: 20 }, revenueBand: null } } };
  expect(companyPipelineState(root, [root, withProfile])).toMatchObject({ headcounts: 1, revenueBands: 0 });
});
it('keeps overall progress open while linked people research continues', () => {
 const job = { ...root, status: 'complete', config: { ...root.config, includeCompanyPeople: true, companyPeopleProgress: {total:1,active:1,queued:0,complete:0,failed:0,cancelled:0,found:3,saved:1,profilesFailed:0,settled:false} } };
 expect(companyPipelineState(job,[job,company])).toMatchObject({companySettled:true,settled:false,peopleSettled:false,peopleActive:1});
 expect(renderToStaticMarkup(<CompanyPipelineProgress job={job} jobs={[job,company]}/>)).toContain('Finding people and emails');
 expect(companyPipelineState({...job,config:{...job.config,companyPeopleProgress:{...job.config.companyPeopleProgress,active:0,settled:true}}},[company]).settled).toBe(true);
});
it('RC-07 integration: retained partial company remains saved and reports an operational issue',()=>{const partial={...company,status:'partial' as const,message:'Website research failed; company retained'};const state=companyPipelineState(root,[root,partial,partial]);expect(state.savedIds).toEqual(['saved']);expect(state.failed).toBe(1);expect(state.settled).toBe(true);const html=renderToStaticMarkup(<CompanyPipelineProgress job={root} jobs={[root,partial]} mandateId="mandate"/>);expect(html).toContain('1 company saved');expect(html).toContain('Finished with issues');});
it('keeps results available while durable background company fields remain queued or reading', () => {
  const job = { ...root, status: 'complete' as const };
  const background = { ...company, id: 'background', status: 'reading' as const, config: { purpose: 'firmographics', researchTask: 'field', parentJobId: root.id, companyBackgroundResearch: { fields: ['companyPhone'] } } } as unknown as ResearchJob;
  const queued = { ...background, id: 'queued', status: 'queued' as const };
  expect(companyPipelineState(job, [job, company, background, queued])).toMatchObject({ companySettled: true, settled: false, backgroundActive: 1, backgroundQueued: 1, processed: 1 });
  const html = renderToStaticMarkup(<CompanyPipelineProgress job={job} jobs={[job, company, background, queued]} mandateId="mandate" />);
  expect(html).not.toContain('RESEARCH COMPLETE');
  expect(html).toContain('Completing research');
  expect(html).toContain('1 queued');
  expect(html).toContain('View companies');
});
