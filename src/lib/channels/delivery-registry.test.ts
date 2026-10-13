import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deliveryProvider } from './delivery-registry';
const input = { actor: { organizationId: 'org', userId: 'recorded-owner' }, key: 'historical-operation', recipient: 'recipient', text: 'Hello', messageId: '<receipt@example.invalid>' };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(['email', 'whatsapp', 'linkedin'] as const)('%s registry cannot activate a legacy or unverified injected provider', async channel => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('CAMPAIGN_LINKEDIN_ENABLED', 'true');
    for (const name of ['WHATSAPP', 'LINKEDIN']) { vi.stubEnv(`${name}_SERVICE_URL`, 'https://legacy.example.test'); vi.stubEnv(`${name}_SERVICE_SECRET`, 'synthetic-secret'); }
    const mailbox = { send: vi.fn(), lookupSent: vi.fn(), inboundFrom: vi.fn() };
    const provider = deliveryProvider(channel, mailbox as never);
    expect(provider.channel).toBe(channel);
    expect(provider.capabilities).toEqual({ durableIdempotency: false, receiptLookup: false, connectionRequests: false });
    await expect(provider.ready(input.actor)).rejects.toMatchObject({ code: 'delivery_disabled', channel });
    expect(await provider.submit(input)).toEqual({ status: 'review', code: 'delivery_disabled' });
    await expect(provider.lookup(input)).rejects.toMatchObject({ code: 'delivery_disabled', channel });
    expect(mailbox.send).not.toHaveBeenCalled(); expect(mailbox.lookupSent).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
