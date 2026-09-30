import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ResearchTimingPanel } from './research-timing-panel';
import { summariseResearchTimings } from '@/domain/research-timing';

it('does not show an empty timing panel and distinguishes work time from elapsed time', () => {
  expect(renderToStaticMarkup(createElement(ResearchTimingPanel, {}))).toBe('');
  const span = { id: '00000000-0000-4000-8000-000000000001', step: 'extract-1', segment: 'extraction' as const, startedAt: '2026-09-30T00:00:00.000Z', finishedAt: '2026-09-30T00:00:02.000Z', elapsedMs: 2000, outcome: 'succeeded' as const };
  const timing = summariseResearchTimings([{ id: 'job', createdAt: span.startedAt, config: { pipelineTiming: { [span.id]: span }, researchMilestones: { firstCompanyAt: span.finishedAt } } }]);
  const html = renderToStaticMarkup(createElement(ResearchTimingPanel, { timing }));
  expect(html).toContain('First new relevant company:');
  expect(html).toContain('cannot be added to get elapsed time');
  expect(html).toContain('extraction');
  expect(html).toContain('2.0s');
});
