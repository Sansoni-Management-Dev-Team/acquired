import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import AuditPage from './page';
const f = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), repository: vi.fn(), audit: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`redirect:${path}`); } }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: f.session } } }));
vi.mock('@/db/client', () => ({ requireDb: f.db }));
vi.mock('@/db/repositories', () => ({ OrganizationRepository: class { constructor(db: unknown, org: string) { f.repository(db, org); } listAudit = f.audit; } }));
beforeEach(() => { vi.resetAllMocks(); f.session.mockResolvedValue({ session: { activeOrganizationId: 'owned-org' } }); f.audit.mockResolvedValue([]); f.db.mockReturnValue({ fixture: true }); });
it.each([[null, '/sign-in?next=/audit'], [{ session: {} }, '/onboarding']])('redirects without a scoped session before querying audit data', async (session, destination) => {
  f.session.mockResolvedValue(session); await expect(AuditPage()).rejects.toThrow(`redirect:${destination}`); expect(f.repository).not.toHaveBeenCalled();
});
it('renders a useful empty audit state scoped to the active organization', async () => {
  const html = renderToStaticMarkup(await AuditPage()); expect(html).toContain('No persisted audit events yet.'); expect(f.repository).toHaveBeenCalledWith({ fixture: true }, 'owned-org'); expect(f.audit).toHaveBeenCalledWith(100);
});
it('renders event metadata as escaped text, with a readable timestamp', async () => {
  f.audit.mockResolvedValue([{ id: 'event-1', createdAt: new Date('2026-01-01T00:00:00Z'), action: 'research.completed', entityType: 'company', entityId: 'company-1', metadata: { note: '<script>alert(1)</script>' } }]);
  const html = renderToStaticMarkup(await AuditPage()); expect(html).toContain('research.completed'); expect(html).toContain('company-1'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('No persisted audit events'); expect(html).toContain('<time');
});
