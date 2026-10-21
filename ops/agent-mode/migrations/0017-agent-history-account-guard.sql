-- Email coverage cannot attest another account/channel, including retired work.
-- This narrow predicate returns only a boolean across canonical person aliases.
CREATE FUNCTION public.agent_history_accounts_clear(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;identities text[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current native history scope required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor;
 IF conv.id IS NULL THEN RETURN false; END IF;
 IF op.name NOT IN('email.initial','email.reply','email.follow_up') OR conv.delivery_mode<>'communications' THEN RETURN true; END IF;
 IF NOT conv.history_complete OR conv.history_source<>'communications' OR conv.binding_id IS NULL THEN RETURN false; END IF;
 identities:=public.agent_person_keys(org,conv.contact_id);
 -- No V1 verified body adapter exists for other recorded accounts/channels.
 -- coverage_bindings is a requirement list, never a completeness certificate.
 RETURN NOT EXISTS(SELECT 1 FROM public.campaign_channel_bindings cb JOIN public.campaign_enrolments e ON e.id=cb.enrolment_id AND e.organization_id=cb.organization_id WHERE e.organization_id=org AND public.agent_person_keys(org,e.contact_id)&&identities AND (cb.binding_id<>conv.binding_id OR cb.channel<>'email'))
 AND NOT EXISTS(SELECT 1 FROM public.outreach_draft_bindings db JOIN public.messages m ON m.id=db.message_id AND m.organization_id=db.organization_id JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE e.organization_id=org AND public.agent_person_keys(org,e.contact_id)&&identities AND db.binding_id<>conv.binding_id)
 AND NOT EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.organization_id=org AND c.id<>conv.id AND c.delivery_mode='communications' AND c.binding_id IS DISTINCT FROM conv.binding_id AND public.agent_person_keys(org,c.contact_id)&&identities);
END $$;
REVOKE ALL ON FUNCTION public.agent_history_accounts_clear(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_history_accounts_clear(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_operation_authorised(uuid) RENAME TO agent_operation_authorised_before_history_accounts;
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_history_accounts(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_operation_authorised(operation uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.agent_operation_authorised_before_history_accounts(operation) AND public.agent_history_accounts_clear(operation);
$$;
REVOKE ALL ON FUNCTION public.agent_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
