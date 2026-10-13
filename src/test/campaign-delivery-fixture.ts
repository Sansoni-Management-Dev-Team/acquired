import type { CampaignActor } from "@/db/campaign-client";
import type { ReplyChannel } from "@/domain/campaign-replies";
import type { DeliveryOutcome } from "@/domain/channel-delivery";
import type { CampaignMailbox } from "@/lib/campaign-mailbox";
import type { CampaignLinkedinResult } from "@/lib/campaign-linkedin";
import { emailDeliveryProvider } from "@/lib/channels/email-delivery";
import { rejected, type CampaignDeliveryProvider } from "@/lib/channels/delivery-provider";

// Policy tests inject in-memory ports explicitly; no application registry imports
// this fixture, and it has no transport, configuration or connection authority.
export function campaignDeliveryFixture(ports: {
  whatsappReady?: (actor: CampaignActor) => Promise<void>;
  linkedinReady?: (actor: CampaignActor) => Promise<void>;
  whatsappSend?: (actor: CampaignActor, input: {key: string;recipient: string;text: string}) => Promise<DeliveryOutcome>;
  linkedinSend?: (actor: CampaignActor, input: {key: string;profile: string;text: string;operation: "message"|"connect"}) => Promise<CampaignLinkedinResult>;
  whatsappLookup?: (actor: CampaignActor, key: string) => Promise<DeliveryOutcome|null>;
  linkedinLookup?: (actor: CampaignActor, key: string) => Promise<CampaignLinkedinResult|null>;
}) {
  function linkedin(result: CampaignLinkedinResult): DeliveryOutcome {
    if(result.status === "retry" || result.action?.status === "queued") return {status:"waiting",code:"rate_limited",retryAt:new Date(Math.max(Date.now()+60000,(result.nextEligibleAt||result.action?.nextEligibleAt||0)*1000)).toISOString()};
    if(result.action?.status === "submitted" || result.action?.status === "skipped") return {status:result.action.status,id:result.action.id,sentAt:new Date((result.action.attemptedAt||Date.now()/1000)*1000).toISOString()};
    return {status:"unknown"};
  }
  return (channel: ReplyChannel, mailbox?: CampaignMailbox): CampaignDeliveryProvider => {
    if(channel === "email") return emailDeliveryProvider(mailbox);
    const required = (): never => { throw new Error("Missing explicit synthetic campaign provider port"); };
    return {
      channel, capabilities:{durableIdempotency:true,receiptLookup:true,connectionRequests:channel === "linkedin"},
      ready:channel === "whatsapp" ? ports.whatsappReady||required : ports.linkedinReady||required,
      async submit(input) {
        try {
          if(channel === "whatsapp") return await (ports.whatsappSend||required)(input.actor,{key:input.key,recipient:input.recipient,text:input.text});
          return linkedin(await (ports.linkedinSend||required)(input.actor,{key:input.key,profile:input.recipient,text:input.text,operation:input.operation||"message"}));
        } catch(error){return rejected(error,channel);}
      },
      async lookup(input) {
        if(channel === "whatsapp") return (ports.whatsappLookup||required)(input.actor,input.key);
        const result = await (ports.linkedinLookup||required)(input.actor,input.key);
        return result ? linkedin(result) : null;
      }
    };
  };
}
