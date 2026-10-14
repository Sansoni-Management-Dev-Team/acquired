import { describe, expect, it, vi } from 'vitest';
import { UnipileV1Transport } from './v1-http';

const key = 'synthetic-review-key';
function client(fetcher: typeof fetch) {
  return new UnipileV1Transport({ apiVersion: 'v1', baseUrl: 'https://instance.example.test:20255/api/v1', apiKey: key, fetch: fetcher });
}

describe('independent v1 transport review: uncertainty and original request scope', () => {
  it.each([408, 418, 425])('keeps undocumented HTTP %s writes unknown without retry', async status => {
    const fetcher = vi.fn(async () => Response.json({ title: key, type: 'proxy/uncertain', status }, { status }));
    const result = await client(fetcher).sendMessage('original-account', 'original-chat', { text: 'synthetic' });
    expect(result.kind).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each(['errors/provider_unreachable', 'errors/action_already_performed', 'errors/unrecognized_future_error'])('does not turn ambiguous 422 %s into a definitely unsent outcome', async type => {
    const fetcher = vi.fn(async () => Response.json({ title: key, detail: 'synthetic diagnostic content', type, status: 422 }, { status: 422 }));
    const result = await client(fetcher).sendEmail('original-account', { to: [{ identifier: 'synthetic@example.test' }], body: 'synthetic' }, 'original-operation-key');
    expect(result.kind).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain('synthetic diagnostic content');
  });

  it('does not classify malformed 422 as a verified rejection', async () => {
    const fetcher = vi.fn(async () => new Response('upstream response lost', { status: 422 }));
    expect((await client(fetcher).invite('original-account', 'provider-recipient')).kind).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 500, '422'])('does not trust a known error type with missing/conflicting vendor status (%#)', async status => {
    const fetcher = vi.fn(async () => Response.json({ type: 'errors/invalid_recipient', title: 'Synthetic rejection', ...(status === undefined ? {} : { status }) }, { status: 422 }));
    expect((await client(fetcher).sendMessage('original-account', 'original-chat', { text: 'synthetic' })).kind).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts a matching documented pre-dispatch rejection without exposing provider diagnostics', async () => {
    const fetcher = vi.fn(async () => Response.json({ type: 'errors/invalid_recipient', status: 422, title: key, detail: key }, { status: 422 }));
    const result = await client(fetcher).sendMessage('original-account', 'original-chat', { text: 'synthetic' });
    expect(result).toEqual({ kind: 'rejected', status: 422, reason: 'invalid_request' });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves credential origin and encodes hostile opaque IDs in one path segment', async () => {
    const seen: URL[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(new URL(String(url)));
      expect(new Headers(init?.headers).get('x-api-key')).toBe(key);
      expect(init?.redirect).toBe('error');
      return Response.json({ object: 'Account' });
    });
    const api = client(fetcher);
    await api.getAccount('https://other.example.test/../account?leak=true#fragment');
    await api.getMessage('%2e%2e/%2f?x=y');
    expect(seen.every(url => url.origin === 'https://instance.example.test:20255')).toBe(true);
    expect(seen.every(url => url.pathname.startsWith('/api/v1/') && !url.search && !url.hash)).toBe(true);
    expect(seen[0].pathname).toContain('https%3A%2F%2Fother');
    expect(seen[1].pathname).toContain('%252e%252e%2F%252f%3Fx%3Dy');
  });

  it('rejects malformed runtime payloads before dispatch', async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const api = client(fetcher);
    await expect(api.sendMessage('a', 'c', null as never)).rejects.toThrow('Invalid Unipile request');
    await expect(api.createDraft('a', { to: [null], body: 'x' } as never)).rejects.toThrow('Invalid Unipile request');
    await expect(api.listAccounts({ offset: 1 } as never)).rejects.toThrow('Invalid Unipile request');
    await expect(api.getAccount(123 as never)).rejects.toThrow('Invalid Unipile request');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
