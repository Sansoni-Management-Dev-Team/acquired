import 'server-only';
import type { CampaignMailbox } from '@/lib/campaign-mailbox';
import type { ReplyChannel } from '@/domain/campaign-replies';
import type { CampaignDeliveryProvider } from './delivery-provider';
import { pausedDeliveryProvider } from './paused-delivery';

// Retained signature does not select a legacy mailbox or imply the Unipile admission bridge is ready.
export function deliveryProvider(channel: ReplyChannel, mailbox?: CampaignMailbox): CampaignDeliveryProvider {
    void mailbox;
    return pausedDeliveryProvider(channel);
}
