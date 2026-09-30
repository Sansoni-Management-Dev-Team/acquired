import type { ResearchControl } from '../../src/domain/research-runner';

// Lean controls update liveness, cancellation, budgets and goal counts. They
// deliberately omit durable page content and other execution configuration.
export function mergeResearchControl(previous: ResearchControl, next: ResearchControl): ResearchControl {
  return { ...previous, ...next, seeds: previous.seeds, config: { ...previous.config, ...next.config }, findings: next.findings ?? previous.findings };
}
