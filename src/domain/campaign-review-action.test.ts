import {expect,it} from 'vitest';import {campaignReviewAction} from './campaign-review-action';
it.each(['existing_conversation','initial_conversation_requires_review'])('requires explicit conversation review for %s',reason=>expect(campaignReviewAction(reason)).toBe('review_existing_conversation'));
it.each(['send_result_unknown','whatsapp_result_unknown','linkedin_result_requires_review','linkedin_result_unknown','reply_identity_ambiguous'])('never offers a preflight retry for unresolved %s',reason=>expect(campaignReviewAction(reason)).toBeNull());
it('allows retry of ordinary preflight coverage without claiming conversation approval',()=>expect(campaignReviewAction('reply_check_stale')).toBe('retry_preflight'));
