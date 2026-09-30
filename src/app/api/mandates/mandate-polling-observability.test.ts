import { expect, it, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock('@/db/client', () => ({ requireDb: () => { throw new Error('Unexpected database access'); } }));
import { GET as workspace } from './[id]/route';
import { GET as research } from './[id]/research/route';
it.each([workspace, research])('correlates workspace/research polling, including rejected requests', async handler => {
 const response = await handler(new Request('https://example.com', { headers: { 'x-request-id': 'polling-request-123' } }), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) });
 expect(response.status).toBe(401);
 expect(response.headers.get('x-request-id')).toBe('polling-request-123');
 expect(response.headers.get('x-research-db-calls')).toBe('0');
});
