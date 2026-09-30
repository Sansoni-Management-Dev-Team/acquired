import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyBrief } from '@/domain/acquisition';
import type { CompanyList } from '@/domain/company-list';
const mocks = vi.hoisted(() => ({ poll: vi.fn() }));
vi.mock('./use-active-polling', () => ({ useActivePolling: mocks.poll }));
vi.mock('./app-shell', () => ({ SidebarRegistration: () => null }));
import { CompaniesWorkspace } from './companies-workspace';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('checks compact revisions and runs recovery separately without fetching research history or company details', async () => {
  const initial: CompanyList = {
    mandate: { id: 'mandate', brief: emptyBrief(), createdAt: '2026-09-30' },
    revision: 'a'.repeat(64), active: true, hasResearch: true,
    rows: [], total: 0, page: 1, pages: 1,
  };
  const fetcher = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => Response.json(
    options.method === 'POST' ? { ok: true } : { unchanged: true, active: true, revision: initial.revision },
  ));
  vi.stubGlobal('fetch', fetcher);
  renderToStaticMarkup(<CompaniesWorkspace mandates={[initial.mandate]} initial={initial} />);
  const [refresh, polling] = mocks.poll.mock.calls[0];
  const [recover, recoveryPolling] = mocks.poll.mock.calls[1];
  expect(polling).toMatchObject({ active: true, intervalMs: 5000 });
  expect(recoveryPolling).toMatchObject({ active: true, intervalMs: 30000 });
  await refresh(); await recover();
  const url = new URL(fetcher.mock.calls[0][0], 'http://localhost');
  expect(url.pathname).toBe('/api/mandates/mandate/companies');
  expect(url.searchParams.get('revision')).toBe(initial.revision);
  expect(url.searchParams.get('page')).toBe('1');
  expect(fetcher.mock.calls[1]).toEqual(['/api/mandates/mandate/companies', expect.objectContaining({ method: 'POST' })]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
