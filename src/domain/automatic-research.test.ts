import { describe, expect, it } from 'vitest';
import { automaticBatch, automaticResearchConfig, mandateResearchSlot } from './automatic-research';
import type { ResearchConfig } from './research';
const base: ResearchConfig = { mode: 'automatic', workflow: 'business', targetBusinesses: 20, findPeople: true, seeds: [], searchTerms: ['sensors'], geography: 'Australia', approved: true, discover: true, budget: { maxPages: 3, maxDomains: 3, maxModelCalls: 3, maxMinutes: 10 } };
const runtime = { remaining: ['https://next.example.com/'], visited: ['https://done.example.com/'], attempts: [{ url: 'https://done.example.com/', status: 'read' as const, reason: 'Read' }] };
describe('automatic research', () => {
  it('continues unsearched target types even when the first batch has no seeds', () => {
    const config = { ...automaticResearchConfig(base), discoveryCursor: 6, discoveryPending: true, runtime: { remaining: [], visited: [], attempts: [] } };
    expect(automaticBatch({ id: 'root', status: 'partial', config })).toMatchObject({ discover: true, discoveryCursor: 6, discoveryPending: true });
  });
  it('sizes enrichment for the target rather than only two companies', () => {
    const config = automaticResearchConfig(base);
    expect(config.companyBudget).toEqual({ maxCompanies: 20, maxPages: 12 });
    expect(config.peopleBudget?.maxCompanies).toBe(20);
    expect(config.budget.maxPages).toBe(10);
  });
  it('continues unread sources after a page batch without rediscovering or losing counts', () => {
    const config = { ...automaticResearchConfig(base), discoveryPending: false, runtime, newBusinessIds: ['a', 'b'] };
    const next = automaticBatch({ id: 'root', status: 'partial', config })!;
    expect(next.discover).toBe(false);
    expect(next.runtime?.visited).toEqual(runtime.visited);
    expect(next.runtime?.attempts).toEqual([]);
    expect(next.newBusinessIds).toEqual(['a', 'b']);
    expect(next.automaticPagesUsed).toBe(1);
    expect(next.researchRunId).toBe('root');
  });
  it('stops at target, cancellation, no progress, exhausted sources or automatic ceilings', () => {
    const config = { ...automaticResearchConfig(base), discoveryPending: false, runtime };
    const job = { id: 'root', status: 'partial', config };
    expect(automaticBatch({ ...job, config: { ...config, targetBusinesses: 1, newBusinessIds: ['a'] } })).toBeNull();
    expect(automaticBatch({ ...job, status: 'cancelled' })).toBeNull();
    expect(automaticBatch({ ...job, config: { ...config, automaticDeadline: 1 } })).toBeNull();
    expect(automaticBatch({ ...job, config: { ...config, automaticPageLimit: 1 } })).toBeNull();
    expect(automaticBatch({ ...job, config: { ...config, runtime: { ...runtime, remaining: [] } } })).toBeNull();
    expect(automaticBatch({ ...job, config: { ...config, runtime: { ...runtime, attempts: [] } } })).toBeNull();
  });
  it('does not enable paid enrichment or change older manually bounded runs', () => {
    const legacy = { ...base, mode: undefined };
    expect(automaticResearchConfig(legacy)).toBe(legacy);
    expect(automaticResearchConfig({ ...base, findPeople: false }).peopleBudget).toBeUndefined();
  });
});

it('namespaces discovery and enrichment slots while preserving continuation identity', () => {
  expect(mandateResearchSlot('a',0)).not.toBe(mandateResearchSlot('b',0));
  expect(mandateResearchSlot('a','a:1')).toBe('a:1');
  expect(mandateResearchSlot('a',1)).toBe('a:1');
});
