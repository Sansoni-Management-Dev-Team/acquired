import { afterEach, expect, it, vi } from 'vitest';
import { guardBrowserMutation } from './browser-mutation';

afterEach(() => vi.unstubAllEnvs());

it.each(['access', 'authority', 'recipient', 'coverage', 'events'])(
  'lets the independently authenticated hosted /%s callback reach its handler', path => {
    const request = new Request(`https://acquire.mlai.au/api/agent/hosted-demo/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(guardBrowserMutation(request)).toBeNull();
  },
);

it('keeps browser origin checks on other agent and future hosted routes even with a bearer', () => {
  vi.stubEnv('APP_URL', 'https://acquire.mlai.au');
  for (const path of ['/api/agent/hosted-demo/unknown', '/api/agent/hosted-demo/recipient/extra', '/api/mandates/example/agent']) {
    const denied = guardBrowserMutation(new Request(`https://acquire.mlai.au${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: '{}',
    }));
    expect(denied?.status).toBe(403);
  }
});
