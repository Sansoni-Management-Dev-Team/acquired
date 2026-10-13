import 'server-only';
import { contactLinkedin } from '@/domain/contact-record';
import type { CampaignActor } from '@/db/campaign-client';
import { ReplyCheckReview } from '@/lib/campaign-reply-status';

// Compatibility shape for historical campaign state and injected policy fixtures, never a live connection.
export type CampaignLinkedinResult = {
    recipient?: string | null; connected?: boolean | null; status?: string; nextEligibleAt?: number;
    action?: { id: string; status: 'queued' | 'submitted' | 'skipped' | 'uncertain' | 'blocked' | 'expired' | 'cancelled'; reason?: string | null; attemptedAt?: number; nextEligibleAt?: number | null };
};
export function linkedinCampaignEnabled() { return false; }
export function linkedinProfileFor(data: Record<string, unknown>) {
    const profile = contactLinkedin(data.linkedinUrl || data.linkedin || data.linkedin_url);
    if (!profile) throw new Error('Contact needs a valid LinkedIn profile URL before enrolment');
    return profile;
}
export async function campaignLinkedinAccountStatus(actor: CampaignActor): Promise<'connected' | 'disconnected'> {
    void actor; throw new ReplyCheckReview('delivery_disabled', 'linkedin');
}
export async function campaignLinkedin(actor: CampaignActor, input: { operation: 'status' | 'connect' | 'message'; profile: string; key?: string; text?: string }): Promise<CampaignLinkedinResult> {
    void actor; void input; throw new ReplyCheckReview('delivery_disabled', 'linkedin');
}
export async function assertLinkedinDeliveryReady(actor: CampaignActor): Promise<void> {
    void actor; throw new ReplyCheckReview('delivery_disabled', 'linkedin');
}
export async function lookupCampaignLinkedin(actor: CampaignActor, key: string): Promise<CampaignLinkedinResult | null> {
    void actor; void key; throw new ReplyCheckReview('delivery_disabled', 'linkedin');
}
