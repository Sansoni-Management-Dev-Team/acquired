import { expect, it } from 'vitest';
import { fieldSatisfied, missingResearchFields, nextSearchQuery } from './research-objectives';
import type { ResearchFinding } from './research';

it('keeps revenue and email open after headcount and a person are found', () => {
  expect(missingResearchFields({ purpose: 'firmographics' }, [{ kind: 'headcount', value: '51-200 employees' } as ResearchFinding])).toEqual(['revenue']);
  expect(missingResearchFields({ purpose: 'people' }, [{ kind: 'person', name: 'Alex Example', value: 'Director' } as ResearchFinding])).toEqual(['email']);
  expect(fieldSatisfied('email', [{ kind: 'person', value: 'Owner', email: 'alex@example.com' } as ResearchFinding])).toBe(true);
  expect(fieldSatisfied('size', [{ kind: 'headcount', factMetadata: { basis: 'search_snippet' } } as ResearchFinding])).toBe(false);
});
it('retries a failed query once, never repeats successful empty searches, and terminates repeated failures', () => {
  const queries = ['company employees', 'company size'];
  const failed = { query: queries[0], field: 'size' as const, status: 'failed' as const };
  expect(nextSearchQuery(queries, [], [failed])).toBe(queries[0]);
  expect(nextSearchQuery(queries, [], [failed, failed])).toBe(queries[1]);
  expect(nextSearchQuery(queries, [queries[0]], [])).toBe(queries[1]);
  expect(nextSearchQuery(queries, queries, [])).toBeUndefined();
});

it('retains leadership research without treating a manager or their email as an owner contact', () => {
  for (const value of ['General Manager', 'Manager, Quality Assurance', 'Manager - Queensland', 'Sales Director', 'CEO', 'Key Principal']) {
    expect(missingResearchFields({ purpose: 'people' }, [{ kind: 'person', value, email: 'alex@example.com' } as ResearchFinding])).toEqual(['people', 'email']);
  }
  expect(missingResearchFields({ purpose: 'people' }, [{ kind: 'person', value: 'Owner', email: 'alex@example.com' } as ResearchFinding])).toEqual([]);
});
