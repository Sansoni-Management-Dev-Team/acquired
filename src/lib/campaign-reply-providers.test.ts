import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readChannelReplies } from './campaign-reply-providers';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(['whatsapp', 'linkedin'] as const)('%s retirement preserves actor and opaque historical cursor without certifying coverage', async channel => {
    const actor = { organizationId: 'org&userId=other', userId: 'recorded-owner' }, cursor = 'opaque/+?other-owner';
    const before = structuredClone(actor), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(readChannelReplies(actor, channel, cursor, new Date(0), { refresh: false })).rejects.toMatchObject({ code: 'delivery_disabled', channel });
    expect(actor).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
});
