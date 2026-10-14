import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { assertCampaignWhatsappConnected, campaignWhatsapp, lookupCampaignWhatsapp, whatsappCampaignEnabled } from '@/test/fixtures/campaign-whatsapp';
import { assertLinkedinDeliveryReady, campaignLinkedin, campaignLinkedinAccountStatus, linkedinCampaignEnabled, lookupCampaignLinkedin } from '@/test/fixtures/legacy-campaign-linkedin';
import { readChannelReplies } from '@/test/fixtures/campaign-reply-providers';
import { pausedDeliveryProvider } from './channels/paused-delivery';

const actor = { organizationId: 'retirement-org', userId: 'recorded-owner' };
const input = { actor, key: 'historical-operation', recipient: '61412345678@s.whatsapp.net', text: 'Authorized old synthetic fixture', operation: 'message' as const };
const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    const path = new URL(String(url)).pathname;
    if (path === '/connection') return Response.json({ status: 'connected' });
    if (path === '/capabilities') return Response.json({ contractVersion: 1, campaignsEnabled: true, capabilities: ['idempotent_submission', 'receipt_lookup'] });
    if (path === '/settings') return Response.json({ fixture: true, protection: { liveSendsEnabled: true, campaignsEnabled: true } });
    if (path === '/replies') return Response.json({ accountIdentity: 'old-account', events: [], nextCursor: null, complete: true, checkedAt: new Date().toISOString() });
    return Response.json({ contractVersion: 1, status: 'submitted', id: 'old-receipt', sentAt: new Date().toISOString(), connected: true, action: { id: 'old-action', status: 'submitted' } });
});
beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('CAMPAIGN_LINKEDIN_ENABLED', 'true');
    for (const channel of ['WHATSAPP', 'LINKEDIN']) { vi.stubEnv(`${channel}_SERVICE_URL`, 'https://legacy.example.test'); vi.stubEnv(`${channel}_SERVICE_SECRET`, 'synthetic-configured-secret'); }
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const denied = { code: 'delivery_disabled' };

describe('configured legacy social providers are retired from Acquire', () => {
    it.each([['whatsapp', whatsappCampaignEnabled], ['linkedin', linkedinCampaignEnabled]] as const)('%s old configuration cannot enable campaigns', (_channel, enabled) => {
        expect(enabled()).toBe(false); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each([['whatsapp', assertCampaignWhatsappConnected], ['linkedin', assertLinkedinDeliveryReady]] as const)('%s connection readiness requires review without egress', async (_channel, ready) => {
        await expect(ready(actor)).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
    it('cannot read an old LinkedIn connection as current readiness', async () => {
        await expect(campaignLinkedinAccountStatus(actor)).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
    it('cannot send through the configured WhatsApp endpoint', async () => {
        await expect(campaignWhatsapp(actor, input)).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['status', 'connect', 'message'] as const)('cannot execute an old LinkedIn %s operation', async operation => {
        await expect(campaignLinkedin(actor, { operation, profile: 'https://www.linkedin.com/in/old-fixture', key: input.key, text: input.text })).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each([['whatsapp', lookupCampaignWhatsapp], ['linkedin', lookupCampaignLinkedin]] as const)('%s historical lookup remains review rather than false missing or resubmission', async (_channel, lookup) => {
        await expect(lookup(actor, input.key)).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['whatsapp', 'linkedin'] as const)('%s old reply reader cannot certify complete coverage', async channel => {
        await expect(readChannelReplies(actor, channel, 'recorded-cursor', new Date(0))).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['whatsapp', 'linkedin'] as const)('%s paused factory advertises no live capabilities', async channel => {
        const provider = pausedDeliveryProvider(channel);
        expect(provider.capabilities).toEqual({ durableIdempotency: false, receiptLookup: false, connectionRequests: false });
        await expect(provider.ready(actor)).rejects.toMatchObject(denied);
        expect(await provider.submit(input)).toEqual({ status: 'review', code: 'delivery_disabled' });
        await expect(provider.lookup(input)).rejects.toMatchObject(denied); expect(fetcher).not.toHaveBeenCalled();
    });
});
