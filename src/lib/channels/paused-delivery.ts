import 'server-only';
import type { ReplyChannel } from '@/domain/campaign-replies';
import { ReplyCheckReview } from '@/lib/campaign-reply-status';
import type { CampaignDeliveryProvider } from './delivery-provider';

// No resolver/admission bridge has authorized this application to dispatch or recover a receipt.
export function pausedDeliveryProvider(channel: ReplyChannel): CampaignDeliveryProvider {
    return {
        channel,
        capabilities: { durableIdempotency: false, receiptLookup: false, connectionRequests: false },
        async ready() { throw new ReplyCheckReview('delivery_disabled', channel); },
        async submit() { return { status: 'review', code: 'delivery_disabled' }; },
        async lookup() { throw new ReplyCheckReview('delivery_disabled', channel); },
    };
}
