/** A preflight retry cannot resolve an uncertain provider operation or approve prior outreach. */
export function campaignReviewAction(reason:string|null|undefined):'review_existing_conversation'|'retry_preflight'|null{
 if(['existing_conversation','initial_conversation_requires_review'].includes(reason||''))return 'review_existing_conversation';
 if(['send_result_unknown','whatsapp_result_unknown','linkedin_result_requires_review','linkedin_result_unknown','reply_identity_ambiguous'].includes(reason||''))return null;
 return 'retry_preflight';
}
