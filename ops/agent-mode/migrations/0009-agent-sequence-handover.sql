-- Local-only forward helpers, authorised by the isolated-worktree migration
-- permission. No enrolment/version/runtime data is rewritten by this migration.
CREATE FUNCTION agent_sequence_handover_source(thread uuid,enrolment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('enrolmentId',e.id,'versionId',e.version_id,'generation',v.version,'runtime',e.runtime,'state',e.state,'contactId',e.contact_id,'recipientEmail',e.recipient_email,'bindingId',b.id,'startedAt',e.started_at,'otherChannelBindings',(SELECT count(*) FROM public.campaign_channel_bindings x WHERE x.enrolment_id=e.id AND x.channel<>'email')) INTO result
 FROM public.agent_threads t JOIN public.campaign_enrolments e ON e.organization_id=t.organization_id AND e.owner_user_id=t.owner_user_id AND e.mandate_id=t.mandate_id
 JOIN public.campaign_sequence_versions v ON v.id=e.version_id AND v.organization_id=e.organization_id AND v.owner_user_id=e.owner_user_id
 LEFT JOIN public.campaign_channel_bindings w ON w.enrolment_id=e.id AND w.organization_id=e.organization_id AND w.owner_user_id=e.owner_user_id AND w.channel='email'
 LEFT JOIN public.communication_bindings b ON b.id=w.binding_id AND b.organization_id=e.organization_id AND b.owner_user_id=e.owner_user_id AND b.backend='unipile' AND b.authority='service'
 WHERE t.id=thread AND t.organization_id=org AND t.owner_user_id=actor AND e.id=enrolment;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned original sequence required'; END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_sequence_handover_source(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_sequence_handover_source(uuid,uuid) TO acquire_agent_user;
CREATE FUNCTION agent_sequence_driver_matches(conversation uuid,enrolment uuid,requested_runtime text,requested_generation integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 PERFORM public.agent_assert_control_scope();
 RETURN EXISTS(SELECT 1 FROM public.agent_conversations c
 JOIN public.campaign_enrolments e ON e.organization_id=c.organization_id AND e.owner_user_id=c.owner_user_id AND e.mandate_id=c.mandate_id AND e.contact_id=c.contact_id
 JOIN public.campaign_sequence_versions v ON v.id=e.version_id AND v.organization_id=e.organization_id AND v.owner_user_id=e.owner_user_id
 JOIN public.campaign_channel_bindings w ON w.enrolment_id=e.id AND w.organization_id=e.organization_id AND w.owner_user_id=e.owner_user_id AND w.channel='email'
 WHERE c.id=conversation AND c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND w.binding_id=c.binding_id
 AND e.id=enrolment AND e.recipient_email=c.recipient_email AND e.runtime=requested_runtime AND v.version=requested_generation AND e.state IN('active','paused','needs_review'));
END $$;
REVOKE ALL ON FUNCTION agent_sequence_driver_matches(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_sequence_driver_matches(uuid,uuid,text,integer) TO acquire_agent_user;
