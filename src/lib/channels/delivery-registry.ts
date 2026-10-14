import 'server-only';
import type { ReplyChannel } from '@/domain/campaign-replies';
import type { CampaignDeliveryProvider } from './delivery-provider';
import { pausedDeliveryProvider } from './paused-delivery';
import {configuredCommunicationsProvider} from './configured-communications';

// Caller-supplied objects cannot grant transport or connection authority.
export function deliveryProvider(channel: ReplyChannel, _untrustedProvider?: unknown): CampaignDeliveryProvider {
    void _untrustedProvider;
    if(process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true')return configuredCommunicationsProvider(channel);
    return pausedDeliveryProvider(channel);
}
