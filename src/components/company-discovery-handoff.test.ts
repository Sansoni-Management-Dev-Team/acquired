import { afterEach, expect, it, vi } from 'vitest';
import { emptyBrief } from '@/domain/acquisition';
import type { CompanyList } from '@/domain/company-list';
import { clearDiscoveredCompanies, discoveredCompaniesFor, preloadDiscoveredCompanies } from './company-discovery-handoff';

const initial: CompanyList = {
  mandate: { id: 'mandate', brief: emptyBrief(), createdAt: '2026-09-30' },
  revision: 'before', active: true, hasResearch: true,
  rows: [], total: 0, page: 1, pages: 1,
};
afterEach(() => { clearDiscoveredCompanies('mandate'); vi.useRealTimers(); });

it('uses the saved discovery snapshot over the older prefetched page only for its mandate', () => {
  const saved = { ...initial, revision: 'saved', total: 1 };
  preloadDiscoveredCompanies(saved);
  expect(discoveredCompaniesFor(initial)).toBe(saved);
  const other = { ...initial, mandate: { ...initial.mandate, id: 'other' } };
  expect(discoveredCompaniesFor(other)).toBe(other);
  clearDiscoveredCompanies('mandate');
  expect(discoveredCompaniesFor(initial)).toBe(initial);
});

it('expires an unused handoff so subsequent visits use server results', () => {
  vi.useFakeTimers();
  preloadDiscoveredCompanies({ ...initial, revision: 'saved' });
  vi.advanceTimersByTime(60_000);
  expect(discoveredCompaniesFor(initial)).toBe(initial);
});
