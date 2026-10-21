import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyBrief } from '@/domain/acquisition';
import { CompaniesWorkspace } from './companies-workspace';

vi.mock('./app-shell', () => ({ SidebarRegistration: () => null }));
vi.mock('./use-active-polling', () => ({ useActivePolling: () => {} }));
const fixture={reviewId:'11111111-1111-4111-8111-111111111111',revision:1,previewDigest:'a'.repeat(64),reason:'consistent_existing_duplicates',source:{observationId:'22222222-2222-4222-8222-222222222222',jobId:'33333333-3333-4333-8333-333333333333',mandateId:'44444444-4444-4444-8444-444444444444',companyName:'Source company',firmableId:'f123',domain:'source.example.test',observedAt:'2026-10-18T00:00:00Z',sourceUrl:'https://source.example.test'},candidates:[]};
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  try {
    if (tree) await act(async () => tree!.unmount());
  } finally {
    tree = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('surfaces identity reviews and permits only the normal automatic duplicate check on mount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (_url, init) =>
    Response.json(init?.method === 'POST' ? { resolved: 0 } : { reviews: [fixture] }),
  );
  vi.stubGlobal('fetch', fetcher);
  const mandate = { id: fixture.source.mandateId, brief: emptyBrief(), createdAt: '2026-10-18' };
  await act(async () => {
    tree = create(<CompaniesWorkspace mandates={[mandate]} initial={{ mandate, revision: 'current', active: false, hasResearch: true, rows: [], total: 0, page: 1, pages: 1 }} />);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const endpoint = '/api/mandates/' + mandate.id + '/company-identities';
  expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ cache: 'no-store' }));
  const buttons = tree!.root.findAllByType('button');
  expect(buttons.some(button => button.props.children === 'Review company identities')).toBe(true);
  const phoneButton = buttons.find(button => String(button.props.children).includes('Find phone numbers'));
  expect(phoneButton).toBeDefined();
  expect(phoneButton!.props.disabled).toBe(true);
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe(endpoint);
  expect(JSON.parse(posts[0][1]!.body as string)).toEqual({ action: 'reconcile_duplicates' });
  expect(fetcher.mock.calls.every(([url, init]) => url === endpoint && (!init?.method || ['GET', 'POST'].includes(init.method)))).toBe(true);
});
