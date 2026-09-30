import { expect, it } from 'vitest';
import { mergeResearchControl } from './control-cache';
import type { ResearchControl } from '../../src/domain/research-runner';

it('merges lean cancellation and goal updates while preserving full execution configuration and buffered pages', () => {
  const previous = {
    status: 'crawling', deadline: 500, seeds: ['https://company.example.com/'], findings: [],
    config: { performanceFlags: { telemetryBatching: true }, companyName: 'Company', seeds: ['https://company.example.com/'], runtime: { bufferedPage: { url: 'https://company.example.com/team', page: { markdown: 'Saved read' } } } },
  } as unknown as ResearchControl;
  const lean = { status: 'cancelled', deadline: 200, seeds: [], config: { newBusinessIds: ['new-company'], performanceFlags: { telemetryBatching: true } } } as unknown as ResearchControl;
  const merged = mergeResearchControl(previous, lean);
  expect(merged).toMatchObject({ status: 'cancelled', deadline: 200, seeds: previous.seeds, config: { companyName: 'Company', runtime: previous.config.runtime, newBusinessIds: ['new-company'], performanceFlags: { telemetryBatching: true } } });
  expect(previous.config).not.toHaveProperty('newBusinessIds');
});
