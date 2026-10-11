import "server-only";
import { rejected, type CampaignDeliveryProvider } from "./delivery-provider";
import type { DeliveryOutcome } from "@/domain/channel-delivery";
import {
  assertLinkedinDeliveryReady,
  campaignLinkedin,
  lookupCampaignLinkedin,
} from "@/lib/campaign-linkedin";
function linkedinResult(
  result: Awaited<ReturnType<typeof campaignLinkedin>>,
): DeliveryOutcome {
  if (result.status === "retry" || result.action?.status === "queued")
    return {
      status: "waiting",
      code: "rate_limited",
      retryAt: new Date(
        Math.max(
          Date.now() + 60_000,
          (result.nextEligibleAt || result.action?.nextEligibleAt || 0) * 1000,
        ),
      ).toISOString(),
    };
  if (
    result.action?.status === "submitted" ||
    result.action?.status === "skipped"
  )
    return {
      status: result.action.status,
      id: result.action.id,
      sentAt: new Date(
        (result.action.attemptedAt || Date.now() / 1000) * 1000,
      ).toISOString(),
    };
  return { status: "unknown" };
}
export const linkedinDeliveryProvider = (): CampaignDeliveryProvider => ({
  channel: "linkedin",
  capabilities: {
    durableIdempotency: true,
    receiptLookup: true,
    connectionRequests: true,
  },
  async ready(actor) {
    await assertLinkedinDeliveryReady(actor);
  },
  async submit(input) {
    try {
      return linkedinResult(
        await campaignLinkedin(input.actor, {
          operation: input.operation || "message",
          profile: input.recipient,
          key: input.key,
          text: input.text,
        }),
      );
    } catch (error) {
      return rejected(error, "linkedin");
    }
  },
  async lookup(input) {
    const receipt = await lookupCampaignLinkedin(input.actor, input.key);
    return receipt ? linkedinResult(receipt) : null;
  },
});
