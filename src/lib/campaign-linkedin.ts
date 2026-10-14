import 'server-only';
import { contactLinkedin } from '@/domain/contact-record';
import type { CampaignActor } from '@/db/campaign-client';
import { ReplyCheckReview } from '@/lib/campaign-reply-status';
import {actorCommunicationsClient} from './communications-client';
import {resolveRecordedApplicationConnection} from './communications-bindings';

// Compatibility shape for historical campaign state and injected policy fixtures, never a live connection.
export type CampaignLinkedinResult = {
    recipient?: string | null; connected?: boolean | null; status?: string; nextEligibleAt?: number;
    action?: { id: string; status: 'queued' | 'submitted' | 'skipped' | 'uncertain' | 'blocked' | 'expired' | 'cancelled'; reason?: string | null; attemptedAt?: number; nextEligibleAt?: number | null };
};
export function linkedinCampaignEnabled() { return process.env.COMMUNICATIONS_RUNTIME_ENABLED==='true'; }
export function linkedinProfileFor(data: Record<string, unknown>) {
    const profile = contactLinkedin(data.linkedinUrl || data.linkedin || data.linkedin_url);
    if (!profile) throw new Error('Contact needs a valid LinkedIn profile URL before enrolment');
    return profile;
}
export async function campaignLinkedin(actor: CampaignActor, input: { operation: 'status' | 'connect' | 'message'; profile: string; key?: string; text?: string;enrolmentId?:string }): Promise<CampaignLinkedinResult> {
    if(!linkedinCampaignEnabled()||input.operation!=='status')throw new ReplyCheckReview('delivery_disabled', 'linkedin');
    if(!input.enrolmentId)throw new ReplyCheckReview('account_changed','linkedin');
    const original=await resolveRecordedApplicationConnection(actor,'linkedin',{enrolmentId:input.enrolmentId});if(!original)throw new ReplyCheckReview('account_changed','linkedin');
    const observed=await (await actorCommunicationsClient(actor)).inspectRelationship(original.binding,{kind:'linkedin_profile',value:input.profile});
    return {recipient:input.profile,connected:observed.status==='connected'?true:observed.status==='unknown'?null:false,status:observed.status==='unknown'?'retry':'ready'};
}
