-- A cold channel's persisted due time survives replacement of a conversational
-- reminder. This wake confers no sending or model authority: the current run,
-- full history, route policy and human approval are checked again downstream.
CREATE FUNCTION public.agent_channel_due_reassessment(p_thread uuid,p_route uuid,p_policy_revision integer,p_scheduled_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id FOR UPDATE;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=t.id;
 IF t.id IS NULL OR r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_policy_revision IS NULL OR p.revision IS DISTINCT FROM p_policy_revision
 OR p_scheduled_at IS NULL OR r.next_allowed_at IS NULL
 OR date_trunc('milliseconds',r.next_allowed_at) IS DISTINCT FROM p_scheduled_at OR r.next_allowed_at>clock_timestamp()
 OR r.cold_cancelled_at IS NOT NULL OR c.engagement IS DISTINCT FROM 'cold' OR c.phase IS DISTINCT FROM 'active' OR c.driver_kind IS DISTINCT FROM 'agent'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='inbound')
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels peer,jsonb_array_elements(peer.history) m WHERE peer.conversation_id=c.id AND m->>'direction'='inbound')
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.thread_id=t.id AND s.organization_id=t.organization_id AND s.owner_user_id=t.owner_user_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR NOT public.agent_event_eligible(t.id,'channel.due') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('conversationId',c.id,'epoch',c.epoch,'reminderGeneration',c.reminder_generation);
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_due_reassessment(uuid,uuid,integer,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_due_reassessment(uuid,uuid,integer,timestamptz) TO acquire_agent_user;

-- Preserve the existing registration/member fence and the original paused
-- receipt-lookup exception for the two additional channels. A due outreach
-- wake follows the same supervision rule as a conversational reminder.
ALTER FUNCTION public.agent_event_eligible(uuid,text) RENAME TO agent_event_eligible_before_channel_due;
CREATE FUNCTION public.agent_event_eligible(p_thread uuid,p_kind text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN public.agent_event_eligible_before_channel_due(p_thread,CASE WHEN p_kind IN('whatsapp.reconcile','linkedin.reconcile') THEN 'email.reconcile' WHEN p_kind='channel.due' THEN 'conversation.reminder' ELSE p_kind END);
END $$;
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_channel_due(uuid,text) FROM PUBLIC,acquire_agent_user,acquire_agent_worker;
REVOKE ALL ON FUNCTION public.agent_event_eligible(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_event_eligible(uuid,text) TO acquire_agent_user,acquire_agent_worker;
