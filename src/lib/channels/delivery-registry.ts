import "server-only";
import type { CampaignMailbox } from "@/lib/campaign-mailbox";
import type { ReplyChannel } from "@/domain/campaign-replies";
import type { CampaignDeliveryProvider } from "./delivery-provider";
import { emailDeliveryProvider } from "./email-delivery";
import { whatsappDeliveryProvider } from "./whatsapp-delivery";
import { linkedinDeliveryProvider } from "./linkedin-delivery";

// New providers register here; campaign state transitions stay in the core.
const factories: Record<
  ReplyChannel,
  (mailbox?: CampaignMailbox) => CampaignDeliveryProvider
> = {
  email: emailDeliveryProvider,
  whatsapp: whatsappDeliveryProvider,
  linkedin: linkedinDeliveryProvider,
};
export function deliveryProvider(
  channel: ReplyChannel,
  mailbox?: CampaignMailbox,
): CampaignDeliveryProvider {
  return factories[channel](mailbox);
}
