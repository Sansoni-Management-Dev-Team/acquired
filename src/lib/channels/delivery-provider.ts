import type { CampaignActor } from "@/db/campaign-client";
import type { ReplyChannel } from "@/domain/campaign-replies";
import type {
  ChannelCapabilities,
  DeliveryOutcome,
} from "@/domain/channel-delivery";
import {
  ReplyCheckPending,
  ReplyCheckReview,
} from "@/lib/campaign-reply-status";

export type DeliveryInput = {
  actor: CampaignActor;
  key: string;
  recipient: string;
  text: string;
  subject?: string;
  messageId?: string;
  operation?: "connect" | "message";
  attemptId?: string;
  enrolmentId?: string;
  stepIndex?: number;
  stepId?: string;
  runtime?: 'legacy' | 'n8n';
  sourceVersionId?: string;
  draftId?: string;
  draftRevision?: string;
};
export interface CampaignDeliveryProvider {
  channel: ReplyChannel;
  capabilities: ChannelCapabilities;
  ready(actor: CampaignActor): Promise<void>;
  submit(input: DeliveryInput): Promise<DeliveryOutcome>;
  lookup(
    input: DeliveryLookupInput,
  ): Promise<DeliveryOutcome | null>;
}
export type DeliveryLookupInput=Pick<DeliveryInput,'actor'|'key'|'messageId'|'attemptId'|'enrolmentId'|'stepIndex'|'stepId'|'runtime'|'sourceVersionId'|'draftId'|'draftRevision'>;
export function rejected(
  error: unknown,
  channel: ReplyChannel,
): DeliveryOutcome {
  const failure = error;
  if (failure instanceof ReplyCheckPending)
    return {
      status: "waiting",
      code: failure.code,
      retryAt: failure.retryAt.toISOString(),
    };
  if (failure instanceof ReplyCheckReview)
    return { status: "review", code: failure.code };
  // An unclassified transport failure may follow provider acceptance.
  throw error instanceof Error
    ? error
    : new Error(`Unknown ${channel} submission result`);
}
