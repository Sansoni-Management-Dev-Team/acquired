import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { campaignLinkedin, lookupCampaignLinkedin } from './campaign-linkedin';
import { campaignWhatsapp, lookupCampaignWhatsapp } from './campaign-whatsapp';
import { readChannelReplies } from './campaign-reply-providers';
const actor = { organizationId: 'org&userId=other', userId: 'recorded-owner?organizationId=other' }, fetcher = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetcher); vi.stubEnv('CAMPAIGN_LINKEDIN_ENABLED', 'true'); for (const name of ['LINKEDIN', 'WHATSAPP']) { vi.stubEnv(`${name}_SERVICE_URL`, 'https://legacy.example.test'); vi.stubEnv(`${name}_SERVICE_SECRET`, 'synthetic-secret'); } });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetcher.mockClear(); });
it.each(['linkedin', 'whatsapp'] as const)('%s retired direct operation cannot use hostile actor delimiters to reach another owner', async channel => {
    const before = structuredClone(actor);
    const send = channel === 'linkedin' ? campaignLinkedin(actor, { operation: 'message', profile: 'https://www.linkedin.com/in/alex', key: 'recorded-key', text: 'Hello' }) : campaignWhatsapp(actor, { key: 'recorded-key', recipient: '61412345678@s.whatsapp.net', text: 'Hello' });
    await expect(send).rejects.toMatchObject({ code: 'delivery_disabled', channel });
    await expect((channel === 'linkedin' ? lookupCampaignLinkedin : lookupCampaignWhatsapp)(actor, 'recorded-key')).rejects.toMatchObject({ code: 'delivery_disabled', channel });
    await expect(readChannelReplies(actor, channel, 'opaque/+?')).rejects.toMatchObject({ code: 'delivery_disabled', channel });
    expect(actor).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
});
