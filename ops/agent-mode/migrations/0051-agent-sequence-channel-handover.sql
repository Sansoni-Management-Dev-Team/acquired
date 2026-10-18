-- Existing n8n definitions/enrolments remain assigned to n8n until stopped and
-- drained. This explicit human command records all original channel accounts;
-- it does not migrate enrolments, approve outreach or change provider backends.
CREATE FUNCTION public.agent_sequence_channel_handover_source(p_thread uuid,p_enrolment uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;e public.campaign_enrolments%ROWTYPE;v public.campaign_sequence_versions%ROWTYPE;p public.agent_channel_policies%ROWTYPE;c public.contacts%ROWTYPE;contact_revision text;channels jsonb:='[]';original record;recipient text;kind text;source jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 SELECT * INTO e FROM public.campaign_enrolments WHERE id=p_enrolment AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id AND mandate_id=t.mandate_id;
 SELECT * INTO v FROM public.campaign_sequence_versions WHERE id=e.version_id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id AND sequence_id=e.sequence_id;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=t.id;
 SELECT * INTO c FROM public.contacts WHERE id=e.contact_id AND organization_id=t.organization_id;
 SELECT xmin::text INTO contact_revision FROM public.contacts WHERE id=c.id;
 IF t.id IS NULL OR e.id IS NULL OR v.id IS NULL OR p.thread_id IS NULL OR c.id IS NULL OR e.runtime NOT IN('n8n','legacy') OR e.state NOT IN('active','paused','needs_review','stopped','completed') OR c.fictionalised IS DISTINCT FROM false OR coalesce(c.personal_data->>'doNotContact','false')<>'false' THEN RAISE EXCEPTION 'Current owned sequence, contact and reviewed channel policy required';END IF;
 FOR original IN SELECT cb.channel,cb.binding_id,b.platform,b.service_account_id FROM public.campaign_channel_bindings cb JOIN public.communication_bindings b ON b.id=cb.binding_id AND b.organization_id=cb.organization_id AND b.owner_user_id=cb.owner_user_id AND b.channel=cb.channel WHERE cb.enrolment_id=e.id AND cb.organization_id=t.organization_id AND cb.owner_user_id=t.owner_user_id AND b.application_id='acquire' AND b.backend='unipile' AND b.authority='service' ORDER BY array_position(p.channel_order,cb.channel),cb.channel LOOP
  recipient:=CASE original.channel WHEN 'email' THEN e.recipient_email WHEN 'whatsapp' THEN e.recipient_phone WHEN 'linkedin' THEN e.recipient_linkedin END;
  kind:=CASE original.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END;
  IF NOT coalesce(CASE original.channel WHEN 'email' THEN recipient=lower(btrim(c.personal_data->>'email')) AND recipient~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' WHEN 'whatsapp' THEN recipient=c.personal_data->>'phone' AND recipient~'^[+][1-9][0-9]{6,14}$' WHEN 'linkedin' THEN recipient=c.personal_data->>'linkedinUrl' AND recipient~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END,false)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) ref WHERE ref->>'channel'=original.channel AND ref->>'bindingId'=original.binding_id::text AND ref->>'bindingDigest'=public.agent_recorded_binding_digest(original.binding_id)) THEN RAISE EXCEPTION 'Every original account and canonical recipient must match the reviewed policy and current contact';END IF;
  channels:=channels||jsonb_build_array(jsonb_build_object('channel',original.channel,'bindingId',original.binding_id,'bindingDigest',public.agent_recorded_binding_digest(original.binding_id),'recipient',jsonb_build_object('kind',kind,'value',recipient),'identityProof',jsonb_build_object('kind','recorded_contact','revision',contact_revision),'senderLabel',original.channel||' · '||original.platform||' · '||original.service_account_id));
 END LOOP;
 IF jsonb_array_length(channels)<>cardinality(p.channel_order) OR (SELECT count(*) FROM public.campaign_channel_bindings WHERE enrolment_id=e.id)<>jsonb_array_length(channels) THEN RAISE EXCEPTION 'Review all original channel accounts; no default or partial substitution is allowed';END IF;
 source:=jsonb_build_object('enrolmentId',e.id,'versionId',v.id,'generation',v.version,'runtime',e.runtime,'state',e.state,'contactId',c.id,'contactName',c.display_name,'startedAt',e.started_at,'channelPolicyRevision',p.revision,'channels',channels);
 RETURN source||jsonb_build_object('sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(source),'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.agent_sequence_channel_handover_source(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_sequence_channel_handover_source(uuid,uuid) TO acquire_agent_user;

CREATE FUNCTION public.agent_adopt_sequence_channels(p_thread uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;s public.agent_responsibilities%ROWTYPE;source jsonb;person public.agent_conversations%ROWTYPE;route jsonb;key text;coverage jsonb;primary_route jsonb;notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO s FROM public.agent_responsibilities WHERE thread_id=t.id AND state IN('ready','waiting') FOR UPDATE;
 IF t.id IS NULL OR s.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.mandates m WHERE m.id=t.mandate_id AND m.organization_id=t.organization_id AND m.xmin::text=s.mandate_revision) THEN RAISE EXCEPTION 'Current reviewed mandate responsibility required';END IF;
 source:=public.agent_sequence_channel_handover_source(t.id,(p_review->>'enrolmentId')::uuid);
 IF source->>'versionId' IS DISTINCT FROM p_review->>'expectedVersionId' OR source->>'sourceRevision' IS DISTINCT FROM p_review->>'sourceRevision' OR source->>'channelPolicyRevision' IS DISTINCT FROM p_review->>'channelPolicyRevision' OR source->'channels' IS DISTINCT FROM p_review->'channels' THEN RAISE EXCEPTION 'Original sequence or exact human reviewed channel identities changed';END IF;
 IF public.agent_legacy_sequence_conflicts((source->>'contactId')::uuid,(source->>'enrolmentId')::uuid) THEN RAISE EXCEPTION 'Another sequence owns this canonical person';END IF;
 primary_route:=source->'channels'->0;
 SELECT jsonb_agg(jsonb_build_object('channel',x->>'channel','bindingId',x->>'bindingId','since',source->>'startedAt')) INTO coverage FROM jsonb_array_elements(source->'channels') x;
 INSERT INTO public.agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_id,binding_digest,recipient_email,driver_kind,sequence_enrolment_id,sequence_runtime,driver_generation,phase,history_revision,coverage_bindings)
 VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,s.id,(source->>'contactId')::uuid,'communications',(primary_route->>'bindingId')::uuid,primary_route->>'bindingDigest',(SELECT x->'recipient'->>'value' FROM jsonb_array_elements(source->'channels') x WHERE x->>'channel'='email'),'sequence',(source->>'enrolmentId')::uuid,source->>'runtime',(source->>'generation')::integer,'active',encode(sha256(convert_to('[]','UTF8')),'hex'),coverage) RETURNING * INTO person;
 FOREACH key IN ARRAY public.agent_person_keys(t.organization_id,person.contact_id) LOOP INSERT INTO public.agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES(t.organization_id,key,person.id,t.owner_user_id);END LOOP;
 FOR route IN SELECT value FROM jsonb_array_elements(source->'channels') LOOP
  INSERT INTO public.agent_conversation_channels(conversation_id,organization_id,owner_user_id,thread_id,mandate_id,channel,binding_id,binding_digest,recipient_kind,recipient_value,identity_source,identity_revision,history_revision,next_allowed_at)
  VALUES(person.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,route->>'channel',(route->>'bindingId')::uuid,route->>'bindingDigest',route->'recipient'->>'kind',route->'recipient'->>'value',route->'identityProof',encode(sha256(convert_to(public.agent_channel_canonical_json(route),'UTF8')),'hex'),encode(sha256(convert_to('[]','UTF8')),'hex'),clock_timestamp()+(SELECT delay_seconds FROM public.agent_channel_policies WHERE thread_id=t.id)*interval '1 second');
 END LOOP;
 notice:=jsonb_build_object('text','You reviewed all original sequence accounts and contact identities. The sequence still owns this person until it is stopped, its in-flight outcomes are reconciled, and you explicitly complete the handover. No agent message is approved.','details',jsonb_build_object('conversationId',person.id,'enrolmentId',source->>'enrolmentId','versionId',source->>'versionId','runtime',source->>'runtime','channels',source->'channels','sourceRevision',source->>'sourceRevision'));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,'sequence-channels-adopt:'||person.id,'assistant',notice,encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('role','assistant','content',notice)),'UTF8')),'hex'));
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(t.organization_id,t.owner_user_id,'agent.sequence_channels_adopted','agent_conversation',person.id::text,notice->'details');
 RETURN jsonb_build_object('id',person.id,'revision',person.revision,'epoch',person.epoch,'status','sequence_owned');
END $$;
REVOKE ALL ON FUNCTION public.agent_adopt_sequence_channels(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_adopt_sequence_channels(uuid,jsonb) TO acquire_agent_user;

-- A fresh explicit sequence driver must retain all original owned route
-- accounts and recipients; primary social routes need no invented email.
ALTER FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) RENAME TO agent_sequence_driver_matches_before_channels;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches_before_channels(uuid,uuid,text,integer) FROM PUBLIC,acquire_agent_user;
CREATE FUNCTION public.agent_sequence_driver_matches(p_conversation uuid,p_enrolment uuid,p_runtime text,p_generation integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.agent_conversations%ROWTYPE;e public.campaign_enrolments%ROWTYPE;v public.campaign_sequence_versions%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO c FROM public.agent_conversations WHERE id=p_conversation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF c.id IS NULL THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels WHERE conversation_id=c.id) THEN RETURN public.agent_sequence_driver_matches_before_channels(p_conversation,p_enrolment,p_runtime,p_generation);END IF;
 SELECT * INTO e FROM public.campaign_enrolments WHERE id=p_enrolment AND organization_id=c.organization_id AND owner_user_id=c.owner_user_id AND mandate_id=c.mandate_id AND contact_id=c.contact_id;
 SELECT * INTO v FROM public.campaign_sequence_versions WHERE id=e.version_id AND organization_id=c.organization_id AND owner_user_id=c.owner_user_id AND sequence_id=e.sequence_id;
 RETURN e.id IS NOT NULL AND v.id IS NOT NULL AND p_runtime IS NOT NULL AND p_generation IS NOT NULL AND e.runtime=p_runtime AND v.version=p_generation AND e.state IN('active','paused','needs_review')
 AND (SELECT count(*) FROM public.campaign_channel_bindings WHERE enrolment_id=e.id)=(SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id AND (NOT EXISTS(SELECT 1 FROM public.campaign_channel_bindings cb WHERE cb.enrolment_id=e.id AND cb.channel=r.channel AND cb.binding_id=r.binding_id AND cb.organization_id=c.organization_id AND cb.owner_user_id=c.owner_user_id) OR r.recipient_value IS DISTINCT FROM CASE r.channel WHEN 'email' THEN e.recipient_email WHEN 'whatsapp' THEN e.recipient_phone WHEN 'linkedin' THEN e.recipient_linkedin END OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id)));
END $$;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) TO acquire_agent_user;

-- Historical n8n/human outbound history also imposes the person-wide quiet
-- interval. It cannot be bypassed just because no native receipt exists yet.
ALTER FUNCTION public.agent_channel_proposal_permitted(uuid,text) RENAME TO agent_channel_proposal_permitted_before_history_quiet;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted_before_history_quiet(uuid,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_channel_proposal_permitted(p_route uuid,p_stage text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE last_out timestamptz;delay integer;c public.agent_conversations%ROWTYPE;
BEGIN
 IF NOT public.agent_channel_proposal_permitted_before_history_quiet(p_route,p_stage) THEN RETURN false;END IF;
 SELECT person.* INTO c FROM public.agent_conversations person JOIN public.agent_conversation_channels r ON r.conversation_id=person.id WHERE r.id=p_route;
 IF c.engagement='cold' AND p_stage IN('initial','follow_up','invitation') THEN
  SELECT max((m->>'at')::timestamptz) INTO last_out FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='outbound';
  SELECT delay_seconds INTO delay FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
  IF last_out IS NOT NULL AND (delay IS NULL OR last_out+make_interval(secs=>delay)>clock_timestamp()) THEN RETURN false;END IF;
 END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) TO acquire_agent_user,acquire_campaign_user;
