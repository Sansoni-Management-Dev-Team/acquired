import { describe, expect, it, vi } from 'vitest';

const { requestHandler } = vi.hoisted(() => ({
  requestHandler: vi.fn(async () => Response.json({ error: 'Not available' }, { status: 404 })),
}));
vi.mock('@/lib/hosted-demo-runtime', () => ({ hostedDemoRequest: requestHandler }));

describe('hosted simulator callback routes', () => {
  it.each(['access', 'authority', 'recipient', 'coverage', 'events'])(
    'mounts the authenticated Node handler for /%s', async (path) => {
      const route = await import(`./${path}/route.ts`);
      expect(route.runtime).toBe('nodejs');
      expect(route.POST).toBe(requestHandler);
      const request = new Request(`https://acquire.mlai.au/api/agent/hosted-demo/${path}`, { method: 'POST' });
      const response = await route.POST(request);
      expect(response.status).toBe(404);
      expect(requestHandler).toHaveBeenLastCalledWith(request);
    },
  );
});
