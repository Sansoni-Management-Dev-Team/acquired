import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
vi.mock('server-only', () => ({}));
import { campaignLinkedin, campaignLinkedinAccountStatus, lookupCampaignLinkedin, assertLinkedinDeliveryReady } from './campaign-linkedin';
import { campaignWhatsapp, assertCampaignWhatsappConnected, lookupCampaignWhatsapp } from './campaign-whatsapp';
import { readChannelReplies } from './campaign-reply-providers';
import { deliveryProvider } from './channels/delivery-registry';
const actor = { organizationId: 'retired-http-org', userId: 'recorded-owner' };
let requests = 0;
const server = createServer((_request, response) => { requests++; response.writeHead(500).end(); });
beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv('CAMPAIGN_LINKEDIN_ENABLED', 'true');
    for (const name of ['LINKEDIN', 'WHATSAPP']) { vi.stubEnv(`${name}_SERVICE_URL`, base); vi.stubEnv(`${name}_SERVICE_SECRET`, 'synthetic-http-secret'); }
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); vi.unstubAllEnvs(); });
it('configured legacy endpoints receive no connection, send, receipt or reply requests over actual HTTP', async () => {
    const operations = [assertCampaignWhatsappConnected(actor), assertLinkedinDeliveryReady(actor), campaignLinkedinAccountStatus(actor), campaignWhatsapp(actor, { key: 'old-key', recipient: '61412345678@s.whatsapp.net', text: 'Hello' }), campaignLinkedin(actor, { operation: 'message', profile: 'https://www.linkedin.com/in/old-fixture', key: 'old-key', text: 'Hello' }), lookupCampaignWhatsapp(actor, 'old-key'), lookupCampaignLinkedin(actor, 'old-key'), readChannelReplies(actor, 'whatsapp', 'old-cursor'), readChannelReplies(actor, 'linkedin', 'old-cursor')];
    const settled = await Promise.allSettled(operations);
    expect(settled).toHaveLength(9); for (const result of settled) { expect(result.status).toBe('rejected'); if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'delivery_disabled' }); }
    for (const channel of ['email', 'whatsapp', 'linkedin'] as const) expect(await deliveryProvider(channel).submit({ actor, key: 'old-key', recipient: 'old-recipient', text: 'Hello' })).toEqual({ status: 'review', code: 'delivery_disabled' });
    expect(requests).toBe(0);
});
