import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { GET, POST } from './route';
const f = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), read: vi.fn(), write: vi.fn(), where: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: f.session } } }));
vi.mock('@/db/client', () => ({ requireDb: f.db }));
beforeEach(() => {
  vi.resetAllMocks(); f.session.mockResolvedValue({ session: { activeOrganizationId: 'org-owned' } });
  f.read.mockResolvedValue([]); f.write.mockResolvedValue([{ id: 'org-owned' }]);
  f.where.mockImplementation(() => ({ limit: f.read, returning: f.write })); f.set.mockImplementation(() => ({ where: f.where }));
  f.db.mockReturnValue({ select: () => ({ from: () => ({ where: f.where }) }), update: () => ({ set: f.set }) });
});
const request = (body: unknown = {}) => new Request('http://localhost/api/settings/research', { method: 'POST', body: JSON.stringify(body) });
it.each([null, { session: {} }])('requires an authenticated active organization for reads and writes (%j)', async session => {
  f.session.mockResolvedValue(session); expect((await GET(request())).status).toBe(401); expect((await POST(request({ defaultTargetBusinesses: 20 }))).status).toBe(401); expect(f.db).not.toHaveBeenCalled();
});
it('loads only the active organization settings and forbids caching', async () => {
  f.read.mockResolvedValue([{ metadata: JSON.stringify({ researchSettings: { defaultTargetBusinesses: 45 } }) }]);
  const response = await GET(request()); expect(await response.json()).toEqual({ defaultTargetBusinesses: 45 }); expect(response.headers.get('cache-control')).toBe('no-store'); expect(new PgDialect().sqlToQuery(f.where.mock.calls[0][0]).params).toEqual(['org-owned']);
});
it.each([null, 'not json', '{}'])('uses the safe default for absent or invalid metadata (%s)', async metadata => {
  f.read.mockResolvedValue([{ metadata }]); expect(await (await GET(request())).json()).toEqual({ defaultTargetBusinesses: 20 });
});
it.each([0, 101, 1.5, '20', null])('rejects invalid limits without a database write (%j)', async defaultTargetBusinesses => {
  expect((await POST(request({ defaultTargetBusinesses }))).status).toBe(400); expect(f.db).not.toHaveBeenCalled();
});
it('rejects malformed JSON', async () => {
  expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400); expect(f.db).not.toHaveBeenCalled();
});
it.each([1, 100])('updates only the owned organization at boundary %s', async defaultTargetBusinesses => {
  const response = await POST(request({ defaultTargetBusinesses })); expect(await response.json()).toEqual({ defaultTargetBusinesses });
  expect(new PgDialect().sqlToQuery(f.where.mock.calls[0][0]).params).toEqual(['org-owned']);
  const update = new PgDialect().sqlToQuery(f.set.mock.calls[0][0].metadata);
  expect(update.sql).toContain('jsonb_set'); expect(update.params).toEqual([JSON.stringify({ defaultTargetBusinesses })]);
});
it('does not claim success if the organization disappeared', async () => {
  f.write.mockResolvedValue([]); expect((await POST(request({ defaultTargetBusinesses: 20 }))).status).toBe(404);
});
