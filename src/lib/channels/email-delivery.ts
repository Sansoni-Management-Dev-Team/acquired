import "server-only";
import { rejected, type CampaignDeliveryProvider } from "./delivery-provider";
import { EmailSubmissionRejected } from "@/lib/email-delivery-error";
import type { CampaignMailbox } from "@/lib/campaign-mailbox";
import { ReplyCheckReview } from "@/lib/campaign-reply-status";
import { deliveryOutcomeSchema } from "@/domain/channel-delivery";
export const emailDeliveryProvider = (
  mailbox?: CampaignMailbox,
): CampaignDeliveryProvider => ({
  channel: "email",
  capabilities: {
    durableIdempotency: false,
    receiptLookup: true,
    connectionRequests: false,
  },
  async ready() {
    if (!mailbox) throw new ReplyCheckReview("reconnect", "email");
  },
  async submit(input) {
    try {
      if (!mailbox) throw new ReplyCheckReview("reconnect", "email");
      const receipt = await mailbox.send(input.actor.userId, {
        to: input.recipient,
        subject: input.subject || "",
        text: input.text,
        messageId: input.messageId,
      });
      return deliveryOutcomeSchema.parse({
        status: "submitted",
        id: receipt.providerMessageId,
        threadId: receipt.providerThreadId,
        sentAt: receipt.sentAt.toISOString(),
      });
    } catch (error) {
      return rejected(
        error instanceof EmailSubmissionRejected ? error.failure : error,
        "email",
      );
    }
  },
  async lookup(input) {
    if (!mailbox || !input.messageId) return null;
    const receipt = await mailbox.findByRfcMessageId(input.messageId);
    return receipt
      ? {
          status: "submitted",
          id: receipt.id,
          threadId: receipt.threadId,
          sentAt: new Date().toISOString(),
        }
      : null;
  },
});
