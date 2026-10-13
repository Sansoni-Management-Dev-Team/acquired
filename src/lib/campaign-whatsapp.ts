import 'server-only';
import type { CampaignActor } from '@/db/campaign-client';
import type { DeliveryOutcome } from '@/domain/channel-delivery';
import { ReplyCheckReview } from '@/lib/campaign-reply-status';

// Historical campaign signatures remain for recorded attempts; transport lives in legacy-channel-services.
export function whatsappCampaignEnabled() { return false; }
export class CampaignWhatsappDisconnected extends Error {}
export function whatsappRecipientFor(data: Record<string, unknown>) {
    const phone = typeof data.phone === 'string' ? data.phone.trim().replace(/[\s().-]/g, '') : '';
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error('Contact needs a WhatsApp phone number with an international country code');
    return `${phone.slice(1)}@s.whatsapp.net`;
}
export async function assertCampaignWhatsappConnected(actor: CampaignActor): Promise<void> {
    void actor; throw new ReplyCheckReview('delivery_disabled', 'whatsapp');
}
export async function campaignWhatsapp(actor: CampaignActor, input: { key: string; recipient: string; text: string }): Promise<DeliveryOutcome> {
    void actor; void input; throw new ReplyCheckReview('delivery_disabled', 'whatsapp');
}
export async function lookupCampaignWhatsapp(actor: CampaignActor, key: string): Promise<DeliveryOutcome | null> {
    void actor; void key; throw new ReplyCheckReview('delivery_disabled', 'whatsapp');
}
