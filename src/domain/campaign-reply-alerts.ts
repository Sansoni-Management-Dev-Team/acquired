import type { ReplyChannel } from "./campaign-replies";

export type CampaignReplyAlert = {
  id: string;
  contactId: string;
  contactName: string;
  mandateId: string;
  channel: ReplyChannel;
  receivedAt: string;
  needsReview: boolean;
};
