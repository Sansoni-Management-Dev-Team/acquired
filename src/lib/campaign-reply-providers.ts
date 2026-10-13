import 'server-only';
import type { CampaignActor } from '@/db/campaign-client';
import type { ReplyChannel, ReplyPage } from '@/domain/campaign-replies';
import { ReplyCheckReview } from '@/lib/campaign-reply-status';

// A retired reader cannot turn an empty cache into coverage or change recorded provider identity.
export async function readChannelReplies(actor: CampaignActor, channel: Exclude<ReplyChannel, 'email'>, cursor: string | null, since?: Date, options: { refresh?: boolean } = {}): Promise<ReplyPage> {
    void actor; void cursor; void since; void options;
    throw new ReplyCheckReview('delivery_disabled', channel);
}
