import "server-only";
import { rejected, type CampaignDeliveryProvider } from "./delivery-provider";
import {
  assertCampaignWhatsappConnected,
  campaignWhatsapp,
  lookupCampaignWhatsapp,
} from "@/lib/campaign-whatsapp";
export const whatsappDeliveryProvider = (): CampaignDeliveryProvider => ({
  channel: "whatsapp",
  capabilities: {
    durableIdempotency: true,
    receiptLookup: true,
    connectionRequests: false,
  },
  ready: assertCampaignWhatsappConnected,
  async submit(input) {
    try {
      return await campaignWhatsapp(input.actor, {
        key: input.key,
        recipient: input.recipient,
        text: input.text,
      });
    } catch (error) {
      return rejected(error, "whatsapp");
    }
  },
  lookup: (input) => lookupCampaignWhatsapp(input.actor, input.key),
});
