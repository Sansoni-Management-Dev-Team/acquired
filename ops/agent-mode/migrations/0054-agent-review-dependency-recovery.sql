-- Capability returns only an exact audit request key, never audit payload or message content.
-- New wakes are emitted by the existing current-member user-role command, not this enumerator.
CREATE FUNCTION public.agent_registered_review_recovery_scopes(p_max integer,p_runtime_id text)
RETURNS TABLE(organization_id text,owner_user_id text,review_request_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 10
 OR p_runtime_id IS NULL OR p_runtime_id!~'^[a-z][a-z0-9-]{2,99}$'
 OR p_runtime_id IS DISTINCT FROM current_setting('app.acquire_runtime_id',true)
 THEN RAISE EXCEPTION 'Configured registered worker runtime required';END IF;
 RETURN QUERY
 SELECT candidate.organization_id,candidate.owner_user_id,candidate.request_key::uuid FROM (
 SELECT g.organization_id,g.owner_user_id,a.metadata->>'requestKey' AS request_key,min(a.created_at) AS reviewed_at
 FROM public.agent_runtime_registrations g
 JOIN public.agent_responsibilities r ON r.id=g.responsibility_id AND r.thread_id=g.thread_id AND r.organization_id=g.organization_id AND r.owner_user_id=g.owner_user_id AND r.mandate_id=g.mandate_id
 JOIN public.member m ON m.organization_id=g.organization_id AND m.user_id=g.owner_user_id
 JOIN public.mandates mandate ON mandate.id=g.mandate_id AND mandate.organization_id=g.organization_id
 JOIN public.agent_conversations v ON v.thread_id=g.thread_id AND v.organization_id=g.organization_id AND v.owner_user_id=g.owner_user_id AND v.mandate_id=g.mandate_id
 JOIN public.audit_events a ON a.organization_id=g.organization_id AND a.actor_id=g.owner_user_id AND a.action='communications.reply_review_resolved' AND a.entity_type='communication_reply_review' AND a.created_at>=v.created_at
 JOIN public.communication_reply_review_latches resolved ON resolved.organization_id=g.organization_id AND resolved.owner_user_id=g.owner_user_id AND resolved.binding_id::text=a.metadata->>'bindingId' AND resolved.service_event_id=a.metadata->>'serviceEventId' AND resolved.code='identity_pending' AND resolved.resolved_at IS NOT NULL AND resolved.resolution_reference=a.metadata->>'resolutionReference'
 JOIN public.communication_event_receipts receipt ON receipt.binding_id=resolved.binding_id AND receipt.service_event_id=resolved.service_event_id AND receipt.organization_id=g.organization_id AND receipt.owner_user_id=g.owner_user_id AND receipt.result='review' AND receipt.event_type='message' AND receipt.fingerprint_version='acquire.reply.delivery.v1' AND receipt.payload_fingerprint=a.metadata->>'expectedFingerprint'

 WHERE g.runtime_id=p_runtime_id AND g.state='enabled' AND g.responsibility_revision=r.revision
 AND r.state IN('ready','waiting') AND r.mandate_revision=mandate.xmin::text
 AND v.driver_kind='agent' AND v.phase='active' AND NOT v.history_complete AND v.engagement NOT IN('stopped','handoff')
 AND a.entity_id=resolved.binding_id::text||':'||resolved.service_event_id
 AND a.metadata->>'decision'='reviewed_unrelated' AND a.metadata->>'noReplyCredit'='true'
 AND a.metadata->>'requestKey' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 AND a.metadata->>'resolutionReference'='human-unrelated:'||(a.metadata->>'requestKey')
 AND NOT EXISTS(SELECT 1 FROM public.communication_reply_review_latches l WHERE l.organization_id=g.organization_id AND l.resolved_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=v.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 AND NOT EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=v.thread_id AND e.event_key='channel-review-wake:'||(a.metadata->>'requestKey')||':'||v.id::text)
 GROUP BY g.organization_id,g.owner_user_id,a.metadata->>'requestKey'
 ) candidate ORDER BY candidate.reviewed_at,candidate.organization_id,candidate.owner_user_id,candidate.request_key LIMIT p_max;
END $$;
REVOKE ALL ON FUNCTION public.agent_registered_review_recovery_scopes(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_registered_review_recovery_scopes(integer,text) TO acquire_agent_worker;
