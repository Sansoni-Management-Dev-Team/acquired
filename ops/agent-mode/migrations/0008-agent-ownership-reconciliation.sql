-- Forward local migration under the user's isolated-local blanket approval.
-- Stopping a sequence does not resolve an accepted/uncertain provider send.
CREATE INDEX agent_intent_contact_idx ON communication_dispatch_intents(organization_id,contact_id);
CREATE INDEX agent_operation_conversation_state_idx ON agent_operations(organization_id,conversation_id,state);
CREATE FUNCTION agent_person_has_unresolved_sends(contact uuid,ignored_operation uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);identities text[];contacts uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 SELECT array_agg(c.id) INTO contacts FROM public.contacts c WHERE c.organization_id=org AND public.agent_person_keys(org,c.id)&&identities;
 IF ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.id=ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND c.contact_id=ANY(contacts)) THEN RAISE EXCEPTION 'Only this owned send operation may be excluded'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.organization_id=org AND e.contact_id=ANY(contacts) AND a.state IN('claimed','unknown')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.organization_id=org AND e.contact_id=ANY(contacts) AND m.state='queued') THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND o.name IN('email.initial','email.reply','email.follow_up','email.manual_link') AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation) THEN RETURN true; END IF;
 -- A prepared/admitted intent stays unresolved until its original no-submission
 -- proof or a positively materialised original delivery receipt is saved.
 RETURN EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
 WHERE i.organization_id=org AND i.contact_id=ANY(contacts)
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
 AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
 AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))
 AND NOT(i.source_kind='agent' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=org AND o.state='complete' AND o.result->'delivery'->>'status'='submitted'))
 AND (ignored_operation IS NULL OR i.source_kind<>'agent' OR i.source_id<>ignored_operation));
END $$;
REVOKE ALL ON FUNCTION agent_person_has_unresolved_sends(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_person_has_unresolved_sends(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION agent_legacy_sequence_conflicts(contact uuid,allowed_enrolment uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);identities text[];
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF NOT EXISTS(SELECT 1 FROM public.campaign_enrolments WHERE id=allowed_enrolment AND organization_id=org AND owner_user_id=actor) THEN RAISE EXCEPTION 'Owned source enrolment required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 RETURN EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.id<>allowed_enrolment AND e.state IN('active','paused','needs_review') AND public.agent_person_keys(org,e.contact_id)&&identities);
END $$;
REVOKE ALL ON FUNCTION agent_legacy_sequence_conflicts(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_legacy_sequence_conflicts(uuid,uuid) TO acquire_agent_user;
-- Preserve0006's admission conditions; add unresolved-send reconciliation.
CREATE OR REPLACE FUNCTION agent_operation_authorised(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);latest_inbound timestamptz;latest_body text;op public.agent_operations%ROWTYPE;conversation public.agent_conversations%ROWTYPE;authority public.agent_authority_uses%ROWTYPE;delegation public.agent_authority_grants%ROWTYPE;batch public.agent_review_batches%ROWTYPE;kind text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current dispatch authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up','email.manual_link') OR op.state<>'running' OR op.lease_until IS NULL OR op.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO conversation FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor;
 IF conversation.id IS NULL OR conversation.phase<>'active' OR NOT conversation.history_complete OR conversation.history_observed_at IS NULL OR conversation.history_observed_at>clock_timestamp() OR conversation.history_observed_at<clock_timestamp()-interval '5 minutes'
 OR op.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(conversation.id) OR op.input->>'recipientKey' IS DISTINCT FROM 'email:'||conversation.recipient_email OR op.input->>'bindingDigest' IS DISTINCT FROM conversation.binding_digest THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN
  IF conversation.driver_kind<>'human' OR conversation.human_user_id<>actor THEN RETURN false; END IF;
 ELSE
  IF conversation.driver_kind<>'agent' OR NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r WHERE r.id=conversation.responsibility_id AND r.state IN('ready','waiting')) THEN RETURN false; END IF;
  IF (op.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR op.input->>'intent' IN('meeting_ready','opt_out','uncertain') THEN RETURN false; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contacts person WHERE person.id=conversation.contact_id AND person.organization_id=org AND person.fictionalised=false AND COALESCE(person.personal_data->>'doNotContact','false')='false' AND lower(btrim(person.personal_data->>'email'))=conversation.recipient_email)
 OR EXISTS(SELECT 1 FROM public.suppressions WHERE organization_id=org AND (lower(address)=conversation.recipient_email OR lower(domain)=split_part(conversation.recipient_email,'@',2)))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL) THEN RETURN false; END IF;
 SELECT (value->>'at')::timestamptz,value->>'text' INTO latest_inbound,latest_body FROM jsonb_array_elements(conversation.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' LIMIT 1;
 IF latest_inbound>clock_timestamp() OR latest_body~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))' THEN RETURN false; END IF;
 IF op.name IN('email.reply','email.manual_link') AND latest_inbound IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND (h.contact_id=conversation.contact_id OR public.agent_person_keys(org,h.contact_id)&&public.agent_person_keys(org,conversation.contact_id)) AND (op.name='email.initial' OR op.name='email.follow_up' AND conversation.engagement='cold' OR h.reason<>'reply_received' OR latest_inbound IS NULL OR h.received_at>latest_inbound))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.agent_person_claims p WHERE p.conversation_id=conversation.id AND p.organization_id=org AND p.identity_key='email:'||lower(h.email)) AND (op.name='email.initial' OR op.name='email.follow_up' AND conversation.engagement='cold' OR h.reason<>'reply_received' OR latest_inbound IS NULL)) THEN RETURN false; END IF;
 SELECT * INTO authority FROM public.agent_authority_uses WHERE operation_id=operation AND organization_id=org AND owner_user_id=actor;
 IF authority.operation_id IS NULL OR authority.state<>'reserved' OR authority.operation_revision<>op.revision OR authority.operation_fence<>op.fence OR authority.operation_digest<>op.input_digest OR authority.context_revision IS DISTINCT FROM op.input->>'contextRevision' OR authority.binding_digest<>conversation.binding_digest THEN RETURN false; END IF;
 IF authority.grant_id IS NOT NULL THEN
  IF jsonb_array_length(conversation.history)>0 AND NOT EXISTS(SELECT 1 FROM public.agent_sink_messages m WHERE m.conversation_id=conversation.id) AND NOT EXISTS(SELECT 1 FROM public.agent_operations p WHERE p.conversation_id=conversation.id AND p.state='complete' AND p.result->'delivery'->>'status'='submitted') THEN RETURN false; END IF;
  kind:=CASE op.name WHEN 'email.initial' THEN 'initial_email' WHEN 'email.reply' THEN 'reply_email' WHEN 'email.follow_up' THEN 'follow_up_email' ELSE NULL END;
  SELECT * INTO delegation FROM public.agent_authority_grants WHERE id=authority.grant_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
  IF kind IS NULL OR delegation.id IS NULL OR delegation.revision<>authority.grant_revision OR delegation.revoked_at IS NOT NULL OR delegation.expires_at<=clock_timestamp() OR delegation.used_sends>delegation.max_sends OR delegation.binding_digest<>conversation.binding_digest OR NOT delegation.actions ? kind OR NOT delegation.recipient_keys ? ('email:'||conversation.recipient_email) THEN RETURN false; END IF;
 ELSE
  SELECT * INTO batch FROM public.agent_review_batches WHERE id=authority.review_batch_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
  IF batch.id IS NULL OR batch.state<>'approved' OR NOT batch.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision')) THEN RETURN false; END IF;
 END IF;
 IF public.agent_person_has_unresolved_sends(conversation.contact_id,operation) THEN RETURN false; END IF;
 -- Reservations remain charged while outcomes/usage are uncertain. Require an
 -- active send-count reservation in the current window immediately at dispatch.
 IF NOT EXISTS(SELECT 1 FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id AND a.organization_id=r.organization_id WHERE r.operation_id=operation AND r.state='reserved' AND a.unit='sends' AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap) THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION agent_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
