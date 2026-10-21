-- PREPARED ONLY: shared source context; final native consumer guards follow in this artifact.
-- Applied predecessors0065/0066 are never changed.
DO $$ BEGIN IF current_database()<>'acquire_agent_mode' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only' THEN RAISE EXCEPTION 'Exact marked local database required';END IF;END $$;

ALTER TABLE public.communication_dispatch_intents ADD COLUMN execution_mandate_id uuid,ADD COLUMN execution_context_digest text,ADD COLUMN execution_mode text;
ALTER TABLE public.communication_dispatch_intents ADD CONSTRAINT communication_intent_execution_context_pair CHECK((execution_mandate_id IS NULL AND execution_context_digest IS NULL AND execution_mode IS NULL) OR (execution_mandate_id IS NOT NULL AND execution_context_digest IS NOT NULL AND execution_context_digest~'^[a-f0-9]{64}$' AND execution_mode IS NOT NULL AND execution_mode IN('real','demo')));

CREATE FUNCTION public.agent_demo_runtime_ready(p_run uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.id=p_run AND run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
 AND run.run_id='agent-real-research-demos' AND run.integration_id='sim-agent-real-research-demos' AND run.configuration_ref='sim-agent-real-research-demos-v1'
 AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders));
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_runtime_ready(uuid) FROM PUBLIC;

-- Canonical delivery normalization mirrors contactPhone/contactLinkedin. Source
-- facts remain byte-for-byte unchanged; alternate historical LinkedIn keys are
-- accepted only at this shared delivery boundary, never as research evidence.
CREATE FUNCTION public.agent_contact_delivery_recipients(p_data jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE phone text:=regexp_replace(btrim(p_data->>'phone'),'[[:space:]().-]','','g');profile text:=btrim(coalesce(nullif(p_data->>'linkedinUrl',''),nullif(p_data->>'linkedin',''),p_data->>'linkedin_url'));parts text[];linkedin text;
BEGIN
 -- URL's hostname is case-insensitive; preserve path case just as new URL().
 parts:=regexp_match(profile,'^https://(?:[^/?#]*@)?(?:[A-Za-z0-9-]+[.])*linkedin[.]com(?::([0-9]+))?(/in/[^/?#[:space:]]+?)/?(?:[?#].*)?$','i');
 IF parts IS NOT NULL AND parts[2]~'^/in/' AND (parts[1] IS NULL OR (length(parts[1])<=5 AND parts[1]::integer<=65535)) THEN linkedin:='https://www.linkedin.com'||parts[2];END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('email',CASE WHEN btrim(p_data->>'email')~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' THEN lower(btrim(p_data->>'email')) END,'whatsapp',CASE WHEN phone~'^[+][1-9][0-9]{6,14}$' THEN phone END,'linkedin',linkedin));
END $$;
REVOKE ALL ON FUNCTION public.agent_contact_delivery_recipients(jsonb) FROM PUBLIC;

CREATE FUNCTION public.agent_load_mandate_research_context(p_mandate uuid,p_org text,p_actor text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE mode text;
BEGIN
 IF p_org IS DISTINCT FROM current_setting('app.acquire_org',true) OR p_actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=p_org) THEN RAISE EXCEPTION 'Current owned research mandate required';END IF;
 SELECT x.mode INTO mode FROM public.agent_mandate_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=p_org;
 mode:=coalesce(mode,'real');
 RETURN jsonb_build_object('version',1,'mandateId',p_mandate,'mode',mode,'identityScope',jsonb_build_object('kind',CASE WHEN mode='demo' THEN 'demo' ELSE 'organization' END,'id',CASE WHEN mode='demo' THEN p_mandate::text ELSE p_org END));
END $$;
REVOKE ALL ON FUNCTION public.agent_load_mandate_research_context(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_load_mandate_research_context(uuid,text,text) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_assert_execution_context_scope() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true))
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current execution context scope required';END IF;
END $$;
REVOKE ALL ON FUNCTION public.agent_assert_execution_context_scope() FROM PUBLIC;

CREATE FUNCTION public.agent_load_mandate_execution_context(p_origin jsonb,p_org text,p_actor text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE kind text:=p_origin->>'kind';mandate uuid;contact uuid;source uuid;conversation uuid;enrolment uuid;thread uuid;effective jsonb;origin jsonb;recipients jsonb;mapping jsonb;bindings jsonb;policy jsonb;frame jsonb;item jsonb;run public.agent_demo_runs%ROWTYPE;mode text;
BEGIN
 PERFORM public.agent_assert_execution_context_scope();
 IF p_org IS DISTINCT FROM current_setting('app.acquire_org',true) OR p_actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR jsonb_typeof(p_origin) IS DISTINCT FROM 'object' OR kind IS NULL THEN RAISE EXCEPTION 'Exact current owned execution origin required';END IF;
 IF kind='agent' AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_origin) key)=ARRAY['kind','operationId'] THEN
  SELECT o.id,o.mandate_id,o.conversation_id,c.contact_id,o.thread_id INTO source,mandate,conversation,contact,thread FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.thread_id=o.thread_id AND c.organization_id=o.organization_id AND c.owner_user_id=o.owner_user_id AND c.mandate_id=o.mandate_id WHERE o.id=(p_origin->>'operationId')::uuid AND o.organization_id=p_org AND o.owner_user_id=p_actor;
 ELSIF kind='agent_target' AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_origin) key)=ARRAY['contactId','kind','threadId'] THEN
  SELECT t.id,t.mandate_id,(p_origin->>'contactId')::uuid,t.id INTO source,mandate,contact,thread FROM public.agent_threads t WHERE t.id=(p_origin->>'threadId')::uuid AND t.organization_id=p_org AND t.owner_user_id=p_actor;
 ELSIF kind='campaign' AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_origin) key)=ARRAY['attemptId','enrolmentId','kind'] THEN
  SELECT a.id,e.mandate_id,e.contact_id,e.id INTO source,mandate,contact,enrolment FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id WHERE a.id=(p_origin->>'attemptId')::uuid AND e.id=(p_origin->>'enrolmentId')::uuid AND e.organization_id=p_org AND e.owner_user_id=p_actor;
 ELSIF kind='draft' AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_origin) key)=ARRAY['kind','messageId'] THEN
  SELECT m.id,e.mandate_id,e.contact_id,e.id INTO source,mandate,contact,enrolment FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id JOIN public.outreach_draft_bindings b ON b.message_id=m.id WHERE m.id=(p_origin->>'messageId')::uuid AND m.organization_id=p_org AND e.organization_id=p_org AND b.owner_user_id=p_actor;
 ELSE RAISE EXCEPTION 'Unsupported exact execution origin';END IF;
 IF source IS NULL OR mandate IS NULL OR contact IS NULL THEN RAISE EXCEPTION 'Current owned execution source unavailable';END IF;
 effective:=public.agent_effective_contact(mandate,contact);mode:=effective->>'mode';
 IF thread IS NOT NULL THEN
  SELECT jsonb_build_object('revision',p.revision,'channelOrder',p.channel_order,'delaySeconds',p.delay_seconds,'bindings',p.bindings) INTO policy FROM public.agent_channel_policies p WHERE p.thread_id=thread AND p.organization_id=p_org AND p.owner_user_id=p_actor;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'digest',public.agent_recorded_binding_digest(b.id),'generation',b.generation,'channel',b.channel) ORDER BY array_position(p.channel_order,b.channel)),'[]') INTO bindings FROM public.agent_channel_policies p JOIN LATERAL jsonb_array_elements(p.bindings) ref ON true JOIN public.communication_bindings b ON b.id::text=ref->>'bindingId' AND b.channel=ref->>'channel' AND public.agent_recorded_binding_digest(b.id)=ref->>'bindingDigest' WHERE p.thread_id=thread AND b.organization_id=p_org AND b.owner_user_id=p_actor AND b.application_id='acquire' AND b.authority='service';
  IF policy IS NOT NULL AND jsonb_array_length(bindings) IS DISTINCT FROM jsonb_array_length(policy->'bindings') THEN RAISE EXCEPTION 'Every reviewed execution account must match its immutable binding';END IF;
  IF policy IS NULL AND kind='agent' AND conversation IS NOT NULL THEN
   SELECT jsonb_build_object('deliveryMode',c.delivery_mode,'bindingId',b.id,'bindingDigest',c.binding_digest),jsonb_build_array(jsonb_build_object('id',b.id,'digest',public.agent_recorded_binding_digest(b.id),'generation',b.generation,'channel',b.channel)) INTO policy,bindings FROM public.agent_conversations c JOIN public.communication_bindings b ON b.id=c.binding_id AND public.agent_recorded_binding_digest(b.id)=c.binding_digest WHERE c.id=conversation AND c.organization_id=p_org AND c.owner_user_id=p_actor AND c.delivery_mode='communications' AND b.organization_id=p_org AND b.owner_user_id=p_actor;
  END IF;
 ELSIF kind='campaign' THEN
  SELECT jsonb_build_object('versionId',e.version_id,'definition',v.definition) INTO policy FROM public.campaign_enrolments e JOIN public.campaign_sequence_versions v ON v.id=e.version_id WHERE e.id=enrolment;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'digest',public.agent_recorded_binding_digest(b.id),'generation',b.generation,'channel',b.channel) ORDER BY b.channel),'[]') INTO bindings FROM public.campaign_channel_bindings cb JOIN public.communication_bindings b ON b.id=cb.binding_id WHERE cb.enrolment_id=enrolment AND cb.organization_id=p_org AND cb.owner_user_id=p_actor AND b.organization_id=p_org AND b.owner_user_id=p_actor;
 ELSE
  SELECT jsonb_build_object('messageId',source,'bindingId',b.id),jsonb_build_array(jsonb_build_object('id',b.id,'digest',public.agent_recorded_binding_digest(b.id),'generation',b.generation,'channel',b.channel)) INTO policy,bindings FROM public.outreach_draft_bindings d JOIN public.communication_bindings b ON b.id=d.binding_id WHERE d.message_id=source AND d.owner_user_id=p_actor AND b.organization_id=p_org AND b.owner_user_id=p_actor;
 END IF;
 IF policy IS NULL OR jsonb_array_length(coalesce(bindings,'[]')) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Exact reviewed execution accounts required';END IF;
 IF mode='demo' THEN
  SELECT * INTO run FROM public.agent_demo_runs WHERE id=(effective->'demoProjection'->>'demoRunId')::uuid AND organization_id=p_org AND owner_user_id=p_actor;
  IF NOT public.agent_demo_runtime_ready(run.id) THEN RAISE EXCEPTION 'The registered demo runtime is unavailable';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(bindings) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(run.senders) s WHERE s->>'bindingId'=item->>'id' AND s->>'bindingDigest'=item->>'digest' AND s->>'channel'=item->>'channel') THEN RAISE EXCEPTION 'Demo policy must use exact registered simulated bindings';END IF;
  END LOOP;
  recipients:=effective->'demoProjection'->'recipients';mapping:=jsonb_build_object('id',effective->'demoProjection'->>'mappingId','digest',effective->'demoProjection'->>'mappingDigest','demoRunId',run.id);
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(bindings) b JOIN public.agent_demo_runs r ON r.organization_id=p_org JOIN LATERAL jsonb_array_elements(r.senders) s ON s->>'bindingId'=b->>'id') THEN RAISE EXCEPTION 'Real execution cannot use demo registry bindings';END IF;
  recipients:=public.agent_contact_delivery_recipients(effective->'sourceContact'->'personalData');mapping:=NULL;
 END IF;
 origin:=jsonb_strip_nulls(jsonb_build_object('kind',kind,'sourceId',source,'mandateId',mandate,'conversationId',conversation,'enrolmentId',enrolment));
 frame:=jsonb_build_object('version',1,'origin',origin,'mode',mode,'identityScope',jsonb_build_object('kind',CASE WHEN mode='demo' THEN 'demo' ELSE 'organization' END,'id',CASE WHEN mode='demo' THEN mandate::text ELSE p_org END),'contact',jsonb_build_object('sourceId',contact,'sourceRevision',effective->'sourceContact'->>'revision','sourceFingerprint',effective->'sourceContact'->>'fingerprint','effectiveRecipients',recipients),'mapping',mapping,'allowedBindings',bindings,'policyDigest',encode(sha256(convert_to(public.agent_channel_canonical_json(policy),'UTF8')),'hex'));
 RETURN frame||jsonb_build_object('manifestDigest',encode(sha256(convert_to(public.agent_channel_canonical_json(frame),'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.agent_load_mandate_execution_context(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_load_mandate_execution_context(jsonb,text,text) TO acquire_agent_user,acquire_campaign_user;
-- Do not lift0065's hard outreach fence until every native consumer below has
-- adopted this same projection, namespace and admission contract.

-- DELIVERY ONLY: this virtual row must not be used as research/model facts or
-- shown as the saved person's details. Source facts/CAS remain agent_effective_contact.sourceContact.
CREATE FUNCTION public.agent_delivery_contact_projection(p_mandate uuid,p_contact uuid) RETURNS public.contacts
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result public.contacts%ROWTYPE;effective jsonb;recipients jsonb;
BEGIN
 effective:=public.agent_effective_contact(p_mandate,p_contact);
 SELECT * INTO result FROM public.contacts WHERE id=p_contact AND organization_id=current_setting('app.acquire_org',true);
 recipients:=CASE WHEN effective->>'mode'='demo' THEN effective->'demoProjection'->'recipients' ELSE public.agent_contact_delivery_recipients(result.personal_data) END;
 SELECT * INTO result FROM jsonb_populate_record(result,jsonb_build_object('personal_data',coalesce(result.personal_data,'{}')||jsonb_build_object('email',recipients->>'email','phone',recipients->>'whatsapp','linkedinUrl',recipients->>'linkedin')));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_delivery_contact_projection(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_delivery_contact_projection(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;

-- Immutable route provenance for receipt/history processing. It deliberately
-- does not require current source CAS, responsibility, policy, driver or phase:
-- those cannot deny an authenticated original receipt after physical submission.
CREATE FUNCTION public.agent_recorded_demo_route_matches(p_route uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF org IS NULL OR actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held owned recorded route scope required';END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_conversation_channels r
  JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.organization_id=r.organization_id AND c.owner_user_id=r.owner_user_id AND c.mandate_id=r.mandate_id
  JOIN public.agent_mandate_execution_modes mode ON mode.mandate_id=c.mandate_id AND mode.organization_id=c.organization_id AND mode.mode='demo' AND mode.created_by=c.owner_user_id
  JOIN public.agent_demo_contact_mappings m ON m.mandate_id=c.mandate_id AND m.demo_id=mode.demo_id AND m.contact_id=c.contact_id AND m.organization_id=c.organization_id AND m.created_by=c.owner_user_id
  JOIN public.agent_demo_runs run ON run.id=m.demo_run_id AND run.organization_id=m.organization_id AND run.owner_user_id=m.created_by
  JOIN public.communication_bindings b ON b.id=r.binding_id AND b.organization_id=r.organization_id AND b.owner_user_id=r.owner_user_id AND b.channel=r.channel
  JOIN communications.connection_generations g ON g.connection_id=b.service_connection_id AND g.account_id=b.service_account_id AND g.generation=b.generation AND g.application_id=b.application_id AND g.tenant_id=b.organization_id AND g.owner_id=b.owner_user_id AND g.channel=b.channel AND g.platform=b.platform AND g.backend=b.backend AND g.integration_id=run.integration_id AND g.provider_configuration_reference=run.configuration_ref AND g.authority='service' AND g.provider_api_version='v1'
  WHERE r.id=p_route AND r.organization_id=org AND r.owner_user_id=actor AND r.binding_digest=public.agent_recorded_binding_digest(b.id)
   AND r.recipient_value=CASE r.channel WHEN 'email' THEN m.wire->>'email' WHEN 'whatsapp' THEN m.wire->>'phone' WHEN 'linkedin' THEN m.wire->>'linkedin' END
   AND r.recipient_kind=CASE r.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END
   AND r.identity_source->>'revision'=m.source_revision
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(run.senders) s WHERE s->>'bindingId'=b.id::text AND s->>'bindingDigest'=r.binding_digest AND s->>'channel'=r.channel));
END $$;
REVOKE ALL ON FUNCTION public.agent_recorded_demo_route_matches(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_recorded_demo_route_matches(uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_mandate_identity_scope(p_mandate uuid) RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);mode text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org) THEN RAISE EXCEPTION 'Owned mandate identity scope required';END IF;
 SELECT x.mode INTO mode FROM public.agent_mandate_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=org;
 RETURN CASE WHEN mode='demo' THEN 'demo:'||p_mandate::text ELSE 'organization:'||org END;
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_identity_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_mandate_identity_scope(uuid) TO acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_same_execution_identity_scope(p_left uuid,p_right uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_left IS NULL AND p_right IS NULL THEN RETURN true;END IF;
 IF p_left IS NULL THEN RETURN public.agent_mandate_identity_scope(p_right)='organization:'||current_setting('app.acquire_org',true);END IF;
 IF p_right IS NULL THEN RETURN public.agent_mandate_identity_scope(p_left)='organization:'||current_setting('app.acquire_org',true);END IF;
 RETURN public.agent_mandate_identity_scope(p_left)=public.agent_mandate_identity_scope(p_right);
END $$;
REVOKE ALL ON FUNCTION public.agent_same_execution_identity_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_same_execution_identity_scope(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_mandate_legacy_sequence_occupied(p_mandate uuid,p_contact uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);aliases uuid[];
BEGIN
 PERFORM public.agent_assert_control_scope();aliases:=public.agent_canonical_contact_aliases(p_contact);
 RETURN EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review') AND public.agent_same_execution_identity_scope(p_mandate,e.mandate_id));
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_legacy_sequence_occupied(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_mandate_legacy_sequence_occupied(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;

-- Read-only delivery availability: missing setup/map is data, never real fallback
-- and never a reason to repeat paid company/people research.
CREATE FUNCTION public.agent_delivery_candidate_projection(p_mandate uuid,p_contact uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE research jsonb;person public.contacts%ROWTYPE;mapping public.agent_demo_contact_mappings%ROWTYPE;run public.agent_demo_runs%ROWTYPE;revision text;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 SELECT c.* INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=current_setting('app.acquire_org',true) AND (c.mandate_id=p_mandate OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.mandate_id=p_mandate AND mt.target_id=c.target_id));
 IF person.id IS NULL THEN RAISE EXCEPTION 'Owned source person required';END IF;
 IF research->>'mode'='real' THEN RETURN jsonb_build_object('available',true,'mode','real','recipients',public.agent_contact_delivery_recipients(person.personal_data));END IF;
 SELECT xmin::text INTO revision FROM public.contacts WHERE id=person.id;
 SELECT * INTO mapping FROM public.agent_demo_contact_mappings WHERE mandate_id=p_mandate AND contact_id=p_contact AND organization_id=current_setting('app.acquire_org',true) AND created_by=current_setting('app.acquire_user',true);
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=mapping.demo_run_id AND organization_id=mapping.organization_id AND owner_user_id=mapping.created_by;
 IF mapping.id IS NULL OR mapping.source_revision IS DISTINCT FROM revision OR mapping.source_fingerprint IS DISTINCT FROM public.agent_demo_contact_fingerprint(p_contact) OR run.id IS NULL OR NOT public.agent_demo_runtime_ready(run.id) THEN RETURN jsonb_build_object('available',false,'mode','demo','recipients','{}'::jsonb);END IF;
 RETURN jsonb_build_object('available',true,'mode','demo','mappingId',mapping.id,'mappingDigest',mapping.mapping_digest,'recipients',jsonb_build_object('email',mapping.wire->>'email','whatsapp',mapping.wire->>'phone','linkedin',mapping.wire->>'linkedin'));
END $$;
REVOKE ALL ON FUNCTION public.agent_delivery_candidate_projection(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_delivery_candidate_projection(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
CREATE OR REPLACE FUNCTION public.agent_mandate_person_keys(p_mandate uuid,p_contact uuid) RETURNS text[]
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE research jsonb;keys text[];prefix text;projected jsonb;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 keys:=public.agent_person_keys(current_setting('app.acquire_org',true),p_contact);
 IF research->>'mode'='real' THEN RETURN keys;END IF;
 projected:=public.agent_delivery_candidate_projection(p_mandate,p_contact);prefix:='demo:'||p_mandate::text||':';
 RETURN ARRAY(SELECT prefix||k FROM unnest(keys) k)||ARRAY(SELECT prefix||key||':'||value FROM jsonb_each_text(projected->'recipients'));
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_person_keys(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_mandate_person_keys(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;

-- Explicit forward native kernel adoption; no applied predecessor is edited.
-- agent_target_snapshot: namespace only; source qualification and real facts retained.
CREATE OR REPLACE FUNCTION public.agent_target_snapshot(p_thread uuid, p_contacts uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;m public.mandates%ROWTYPE;c record;ids text[];aliases uuid[];items jsonb:='[]';reasons jsonb;source text;findings jsonb;mandate_revision text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL OR cardinality(p_contacts)>50 THEN RAISE EXCEPTION 'Owned bounded target scope required'; END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id;
 SELECT * INTO m FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 SELECT xmin::text INTO mandate_revision FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mandate_revision THEN RAISE EXCEPTION 'Current active mandate supervision required'; END IF;
 FOR c IN SELECT p.*,p.xmin::text contact_revision,g.xmin::text target_revision,g.company_name,g.domain,g.identifiers,g.firmographics,g.status target_status,g.qualification,g.fit_score,g.ripeness_score,g.financeability_score,g.confidence_score,g.band,mt.version membership_version,mt.assessment
 FROM public.contacts p JOIN public.mandate_targets mt ON mt.organization_id=p.organization_id AND mt.target_id=p.target_id AND mt.mandate_id=t.mandate_id JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org
 WHERE p.organization_id=org AND (p_contacts IS NULL OR p.id=ANY(p_contacts)) ORDER BY EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key='contact:'||p.id::text),p.fictionalised,coalesce(p.personal_data->>'doNotContact','false')<>'false',coalesce(p.personal_data->>'email','')='',p.id LIMIT 50 LOOP
  ids:=public.agent_mandate_person_keys(t.mandate_id,c.id);
  aliases:=public.agent_canonical_contact_aliases(c.id);
  reasons:='[]';
  IF NOT (public.agent_delivery_candidate_projection(t.mandate_id,c.id)->>'available')::boolean THEN reasons:=reasons||'"demo_mapping_required"'::jsonb;END IF;
  IF c.fictionalised OR coalesce(c.personal_data->>'doNotContact','false')<>'false' THEN reasons:=reasons||'"contact_not_admissible"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts a WHERE a.id=ANY(aliases) AND (lower(s.address)=lower(btrim(a.personal_data->>'email')) OR lower(s.domain)=split_part(lower(btrim(a.personal_data->>'email')),'@',2)))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') THEN reasons:=reasons||'"suppressed"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.agent_person_claims k WHERE k.organization_id=org AND k.identity_key=ANY(ids)) THEN reasons:=reasons||'"conversation_already_owned"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND public.agent_same_execution_identity_scope(t.mandate_id,e.mandate_id) AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review')) THEN reasons:=reasons||'"structured_sequence_owner"'::jsonb;END IF;
  IF (public.agent_delivery_candidate_projection(t.mandate_id,c.id)->>'available')::boolean AND public.agent_mandate_person_has_unresolved_sends(t.mandate_id,c.id,NULL::uuid) THEN reasons:=reasons||'"unresolved_send"'::jsonb;END IF;
  IF (public.agent_mandate_identity_scope(t.mandate_id) NOT LIKE 'demo:%' AND c.assessment->>'stage' IN('contacted','in-conversation')) OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND public.agent_same_execution_identity_scope(t.mandate_id,se.mandate_id) AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id WHERE a.organization_id=org AND public.agent_same_execution_identity_scope(t.mandate_id,e.mandate_id) AND e.contact_id=ANY(aliases) AND (a.state='sent' OR a.sent_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM public.campaign_inbound_events x WHERE x.organization_id=org AND public.agent_mandate_identity_scope(t.mandate_id) NOT LIKE 'demo:%' AND x.contact_id=ANY(aliases)) THEN reasons:=reasons||'"previously_contacted"'::jsonb;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'jobId',f.job_id,'targetId',f.target_id,'sourceUrl',f.source_url,'observedAt',f.observed_at,'evidence',f.evidence,'confidence',f.confidence) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT * FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.target_id ORDER BY observed_at DESC,id LIMIT 20)f;
  source:=encode(sha256(convert_to(jsonb_build_object('contact',c.contact_revision,'target',c.target_revision,'membership',c.membership_version,'assessment',c.assessment,'findings',findings)::text,'UTF8')),'hex');
  IF public.agent_mandate_identity_scope(t.mandate_id) LIKE 'demo:%' THEN source:=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(source,public.agent_delivery_candidate_projection(t.mandate_id,c.id))),'UTF8')),'hex');END IF;
  items:=items||jsonb_build_array(jsonb_build_object('contactId',c.id,'targetId',c.target_id,'name',c.display_name,'email',coalesce(public.agent_delivery_candidate_projection(t.mandate_id,c.id)->'recipients'->>'email',''),'sourceRevision',source,'assessment',c.assessment,'findings',findings,'blockedReasons',reasons,'identityKeys',to_jsonb(ids),
   'target',jsonb_build_object('id',c.target_id,'organizationId',org,'companyName',c.company_name,'domain',c.domain,'identifiers',c.identifiers,'firmographics',c.firmographics,'status',c.target_status,'qualification',c.qualification,'fitScore',c.fit_score,'ripenessScore',c.ripeness_score,'financeabilityScore',c.financeability_score,'confidenceScore',c.confidence_score,'band',c.band)));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mandate_revision,'responsibilityId',r.id,'responsibilityRevision',r.revision,'brief',m.filters->'brief','candidates',items,'companies',(SELECT count(*) FROM public.mandate_targets WHERE organization_id=org AND mandate_id=t.mandate_id),'contacts',(SELECT count(*) FROM public.contacts p JOIN public.mandate_targets mt ON mt.target_id=p.target_id AND mt.organization_id=p.organization_id WHERE p.organization_id=org AND mt.mandate_id=t.mandate_id));
END $function$;

-- agent_manual_target_snapshot: namespace only; source qualification and real facts retained.
CREATE OR REPLACE FUNCTION public.agent_manual_target_snapshot(p_thread uuid, p_contacts uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;m public.mandates%ROWTYPE;c record;ids text[];aliases uuid[];items jsonb:='[]';reasons jsonb;source text;mandate_revision text;total integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL OR cardinality(p_contacts)>50 THEN RAISE EXCEPTION 'Owned bounded manual contact scope required'; END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id FOR SHARE;
 SELECT * INTO m FROM public.mandates WHERE id=t.mandate_id AND organization_id=org FOR SHARE;
 SELECT xmin::text INTO mandate_revision FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mandate_revision THEN RAISE EXCEPTION 'Current active mandate supervision required'; END IF;
 FOR c IN SELECT p.*,p.xmin::text AS contact_revision,receipt.id AS creation_receipt,NULL::jsonb AS assessment
 FROM public.contacts p JOIN LATERAL(SELECT a.id FROM public.audit_events a
 WHERE a.organization_id=org AND a.actor_id=actor AND a.action='contact.created' AND a.entity_type='contact' AND a.entity_id=p.id::text AND a.metadata->>'mandateId'=t.mandate_id::text AND a.metadata->>'source'='Manual entry' ORDER BY a.created_at,a.id LIMIT 1)receipt ON true
 WHERE p.organization_id=org AND p.mandate_id=t.mandate_id AND p.target_id IS NULL AND p.provenance->>'source'='Manual entry' AND p.provenance->>'createdBy'=actor AND (p_contacts IS NULL OR p.id=ANY(p_contacts))
 ORDER BY EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key='contact:'||p.id::text),p.fictionalised,coalesce(p.personal_data->>'doNotContact','false')<>'false',coalesce(p.personal_data->>'email','')='',p.id LIMIT 50 FOR SHARE OF p LOOP
  ids:=public.agent_mandate_person_keys(t.mandate_id,c.id);
  aliases:=public.agent_canonical_contact_aliases(c.id);
  reasons:='[]';
  IF NOT (public.agent_delivery_candidate_projection(t.mandate_id,c.id)->>'available')::boolean THEN reasons:=reasons||'"demo_mapping_required"'::jsonb;END IF;
  IF c.fictionalised OR coalesce(c.personal_data->>'doNotContact','false')<>'false' THEN reasons:=reasons||'"contact_not_admissible"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts a WHERE a.id=ANY(aliases) AND (lower(s.address)=lower(btrim(a.personal_data->>'email')) OR lower(s.domain)=split_part(lower(btrim(a.personal_data->>'email')),'@',2)))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') THEN reasons:=reasons||'"suppressed"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.agent_person_claims k WHERE k.organization_id=org AND k.identity_key=ANY(ids)) THEN reasons:=reasons||'"conversation_already_owned"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND public.agent_same_execution_identity_scope(t.mandate_id,e.mandate_id) AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review')) THEN reasons:=reasons||'"structured_sequence_owner"'::jsonb;END IF;
  IF (public.agent_delivery_candidate_projection(t.mandate_id,c.id)->>'available')::boolean AND public.agent_mandate_person_has_unresolved_sends(t.mandate_id,c.id,NULL::uuid) THEN reasons:=reasons||'"unresolved_send"'::jsonb;END IF;
  IF (public.agent_mandate_identity_scope(t.mandate_id) NOT LIKE 'demo:%' AND c.assessment->>'stage' IN('contacted','in-conversation')) OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND public.agent_same_execution_identity_scope(t.mandate_id,se.mandate_id) AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id WHERE a.organization_id=org AND public.agent_same_execution_identity_scope(t.mandate_id,e.mandate_id) AND e.contact_id=ANY(aliases) AND (a.state='sent' OR a.sent_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM public.campaign_inbound_events x WHERE x.organization_id=org AND public.agent_mandate_identity_scope(t.mandate_id) NOT LIKE 'demo:%' AND x.contact_id=ANY(aliases)) THEN reasons:=reasons||'"previously_contacted"'::jsonb;END IF;
  source:=encode(sha256(convert_to(jsonb_build_object('sourceKind','manual_contact','contact',c.contact_revision,'mandate',t.mandate_id,'actor',actor,'creationReceipt',c.creation_receipt)::text,'UTF8')),'hex');
  IF public.agent_mandate_identity_scope(t.mandate_id) LIKE 'demo:%' THEN source:=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(source,public.agent_delivery_candidate_projection(t.mandate_id,c.id))),'UTF8')),'hex');END IF;
  items:=items||jsonb_build_array(jsonb_build_object('sourceKind','manual_contact','contactId',c.id,'targetId',NULL,'target',NULL,'companyName',coalesce(c.personal_data->>'companyName',''),'name',c.display_name,'email',coalesce(public.agent_delivery_candidate_projection(t.mandate_id,c.id)->'recipients'->>'email',''),'sourceRevision',source,'assessment',NULL,'findings','[]'::jsonb,'blockedReasons',reasons,'identityKeys',to_jsonb(ids)));
 END LOOP;
 SELECT count(*) INTO total FROM public.contacts p WHERE p.organization_id=org AND p.mandate_id=t.mandate_id AND p.target_id IS NULL AND p.provenance->>'source'='Manual entry' AND p.provenance->>'createdBy'=actor
 AND EXISTS(SELECT 1 FROM public.audit_events a WHERE a.organization_id=org AND a.actor_id=actor AND a.action='contact.created' AND a.entity_type='contact' AND a.entity_id=p.id::text AND a.metadata->>'mandateId'=t.mandate_id::text AND a.metadata->>'source'='Manual entry');
 PERFORM public.agent_assert_control_scope();
 RETURN jsonb_build_object('mandateRevision',mandate_revision,'responsibilityId',r.id,'responsibilityRevision',r.revision,'brief',m.filters->'brief','candidates',items,'companies',0,'contacts',total);
END $function$;

-- Route registration consumes DELIVERY projection, never saved-source facts.
CREATE OR REPLACE FUNCTION public.agent_register_channel(p_thread uuid, p_conversation uuid, p_revision integer, p_context text, p_binding uuid, p_channel text, p_kind text, p_value text, p_source jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.agent_threads%ROWTYPE;conv public.agent_conversations%ROWTYPE;person public.contacts%ROWTYPE;source_revision text;policy public.agent_channel_policies%ROWTYPE;binding public.communication_bindings%ROWTYPE;route public.agent_conversation_channels%ROWTYPE;identity_hash text;keys text[];key text;notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=p_conversation AND thread_id=t.id FOR UPDATE;
 IF conv.id IS NULL OR p_revision IS NULL OR conv.revision<>p_revision OR public.agent_context_revision(conv.id) IS DISTINCT FROM p_context OR conv.driver_kind<>'agent' OR conv.phase<>'active' OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Current owned person context required';END IF;
 SELECT * INTO policy FROM public.agent_channel_policies WHERE thread_id=t.id;
 SELECT * INTO binding FROM public.communication_bindings WHERE id=p_binding AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id AND channel=p_channel AND application_id='acquire' AND authority='service' AND backend='unipile';
 IF binding.id IS NULL OR policy.thread_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(policy.bindings) x WHERE x->>'bindingId'=binding.id::text AND x->>'channel'=p_channel AND x->>'bindingDigest'=public.agent_recorded_binding_digest(binding.id)) THEN RAISE EXCEPTION 'Exact reviewed policy account required';END IF;
 SELECT * INTO person FROM public.agent_delivery_contact_projection(t.mandate_id,conv.contact_id);
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id;
 IF person.id IS NULL OR person.fictionalised IS DISTINCT FROM false OR coalesce(person.personal_data->>'doNotContact','false')<>'false' OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_source))<>2 OR p_source->>'kind' IS DISTINCT FROM 'recorded_contact' OR p_source->>'revision' IS DISTINCT FROM source_revision THEN RAISE EXCEPTION 'Current explicitly reviewed contact identity required';END IF;
 IF NOT coalesce(CASE p_channel WHEN 'email' THEN p_kind='email' AND p_value=lower(btrim(person.personal_data->>'email')) AND p_value~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$'
 WHEN 'whatsapp' THEN p_kind='phone' AND p_value=person.personal_data->>'phone' AND p_value~'^[+][1-9][0-9]{6,14}$'
 WHEN 'linkedin' THEN p_kind='linkedin_profile' AND p_value=person.personal_data->>'linkedinUrl' AND p_value~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END,false) THEN RAISE EXCEPTION 'Exact canonical recipient differs from reviewed contact';END IF;
 IF policy.accelerated_simulation AND (NOT public.agent_channel_local_binding(binding.id) OR NOT public.agent_channel_reserved_recipient(p_channel,p_value)) THEN RAISE EXCEPTION 'Accelerated route must use the exact reserved simulation identity';END IF;
 IF public.agent_mandate_person_has_unresolved_sends(t.mandate_id,person.id,NULL) THEN RAISE EXCEPTION 'Original unresolved sends must be reconciled before adding a route';END IF;
 identity_hash:=encode(sha256(convert_to(jsonb_build_object('contactId',person.id,'sourceRevision',source_revision,'channel',p_channel,'recipientKind',p_kind,'recipient',p_value,'bindingDigest',public.agent_recorded_binding_digest(binding.id))::text,'UTF8')),'hex');
 SELECT * INTO route FROM public.agent_conversation_channels WHERE conversation_id=conv.id AND channel=p_channel;
 IF route.id IS NOT NULL THEN
  IF route.binding_id<>binding.id OR route.recipient_value<>p_value OR route.identity_revision<>identity_hash THEN RAISE EXCEPTION 'Recorded route identity/account is immutable; review a reconciled replacement';END IF;RETURN jsonb_build_object('id',route.id,'revision',route.revision);
 END IF;
 INSERT INTO public.agent_conversation_channels(conversation_id,organization_id,owner_user_id,thread_id,mandate_id,channel,binding_id,binding_digest,recipient_kind,recipient_value,identity_source,identity_revision,history_revision,next_allowed_at)
 VALUES(conv.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,p_channel,binding.id,public.agent_recorded_binding_digest(binding.id),p_kind,p_value,p_source,identity_hash,encode(sha256(convert_to('[]','UTF8')),'hex'),clock_timestamp()+((array_position(policy.channel_order,p_channel)-1)*policy.delay_seconds)*interval '1 second') RETURNING * INTO route;
 keys:=public.agent_mandate_person_keys(t.mandate_id,person.id);
 FOREACH key IN ARRAY keys LOOP
  IF EXISTS(SELECT 1 FROM public.agent_person_claims WHERE organization_id=t.organization_id AND identity_key=key AND conversation_id<>conv.id) THEN RAISE EXCEPTION 'This person already has another active owner';END IF;
  INSERT INTO public.agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES(t.organization_id,key,conv.id,t.owner_user_id) ON CONFLICT(organization_id,identity_key) DO NOTHING;
 END LOOP;
 UPDATE public.agent_conversations SET history_complete=false,revision=revision+1,epoch=epoch+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
 PERFORM public.agent_invalidate_person_reviews(conv.id);
 notice:=jsonb_build_object('text','You reviewed a person’s exact channel and account. Provider identity and full history must still be verified before outreach.','details',jsonb_build_object('conversationId',conv.id,'routeId',route.id,'channel',p_channel,'bindingId',binding.id,'recipientKind',p_kind,'recipient',p_value,'policyRevision',policy.revision));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,'channel-route:'||route.id,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(t.organization_id,t.owner_user_id,'agent.channel_route_reviewed','agent_conversation',conv.id::text,notice->'details');
 RETURN jsonb_build_object('id',route.id,'revision',route.revision);
END $function$;

-- Atomic allocation keeps source CAS/review and changes only delivery+claim scope.
CREATE OR REPLACE FUNCTION public.agent_allocate_channel_target(p_thread uuid, p_operation uuid, p_contact uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;o public.agent_operations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;c public.contacts%ROWTYPE;r public.agent_responsibilities%ROWTYPE;v public.agent_conversations%ROWTYPE;selected jsonb;snapshot jsonb;candidate jsonb;x jsonb;b public.communication_bindings%ROWTYPE;source_revision text;email text;key text;route_id uuid;context_hash text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND thread_id=t.id AND name='target.select' AND state IN('approved','running') FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=t.id;
 SELECT * INTO selected FROM jsonb_array_elements(o.input->'selected') item WHERE item->>'contactId'=p_contact::text AND item->>'sourceRevision'=p_source;
 IF t.id IS NULL OR o.id IS NULL OR p.thread_id IS NULL OR selected IS NULL OR o.input->'delivery'->>'mode' IS DISTINCT FROM 'channels' OR o.input->'delivery'->>'policyRevision' IS DISTINCT FROM p.revision::text OR NOT EXISTS(SELECT 1 FROM public.agent_review_batches rb WHERE rb.thread_id=t.id AND rb.state='approved' AND rb.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact current channel target selection approval required';END IF;
 snapshot:=public.agent_owned_target_snapshot(t.id,ARRAY[p_contact]);candidate:=snapshot->'candidates'->0;
 IF snapshot->>'mandateRevision' IS DISTINCT FROM o.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM o.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM o.input->>'responsibilityRevision' OR candidate IS NULL OR candidate->>'sourceRevision' IS DISTINCT FROM p_source OR jsonb_array_length(candidate->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Current target evidence, supervision and exclusive owner required';END IF;
 IF jsonb_typeof(selected->'channels') IS DISTINCT FROM 'array' OR jsonb_array_length(selected->'channels')<>cardinality(p.channel_order) OR (SELECT count(DISTINCT value->>'channel') FROM jsonb_array_elements(selected->'channels'))<>cardinality(p.channel_order) THEN RAISE EXCEPTION 'Every exact selected route must be human reviewed';END IF;
 SELECT * INTO c FROM public.agent_delivery_contact_projection(t.mandate_id,p_contact);
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=p_contact AND organization_id=org;
 SELECT * INTO r FROM public.agent_responsibilities WHERE id=(snapshot->>'responsibilityId')::uuid AND thread_id=t.id AND state IN('ready','waiting') FOR UPDATE;
 IF r.id IS NULL OR c.id IS NULL OR c.fictionalised IS DISTINCT FROM false OR coalesce(c.personal_data->>'doNotContact','false')<>'false' OR public.agent_mandate_legacy_sequence_occupied(t.mandate_id,c.id) OR public.agent_mandate_person_has_unresolved_sends(t.mandate_id,c.id,NULL) THEN RAISE EXCEPTION 'Permitted unoccupied person required';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(selected->'channels') LOOP
  SELECT * INTO b FROM public.communication_bindings WHERE id::text=x->>'bindingId' AND organization_id=org AND owner_user_id=actor AND channel=x->>'channel' AND authority='service' AND backend='unipile';
  IF b.id IS NULL OR x->>'bindingDigest' IS DISTINCT FROM public.agent_recorded_binding_digest(b.id) OR x->'identityProof' IS DISTINCT FROM jsonb_build_object('kind','recorded_contact','revision',source_revision) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) ref WHERE ref->>'bindingId'=b.id::text AND ref->>'bindingDigest'=x->>'bindingDigest' AND ref->>'channel'=x->>'channel') THEN RAISE EXCEPTION 'Exact current contact and reviewed account generation required';END IF;
 END LOOP;
 x:=selected->'channels'->0;
 SELECT * INTO b FROM public.communication_bindings WHERE id::text=x->>'bindingId';
 email:=CASE WHEN c.personal_data->>'email'~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' THEN lower(btrim(c.personal_data->>'email')) ELSE NULL END;
 INSERT INTO public.agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_id,binding_digest,recipient_email,driver_kind,phase,history_revision,history_complete,history_source)
 VALUES(t.id,org,t.mandate_id,actor,r.id,c.id,'communications',b.id,public.agent_recorded_binding_digest(b.id),email,'agent','active',encode(sha256(convert_to('[]','UTF8')),'hex'),false,'unavailable') RETURNING * INTO v;
 FOREACH key IN ARRAY public.agent_mandate_person_keys(t.mandate_id,c.id) LOOP
  INSERT INTO public.agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES(org,key,v.id,actor);
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(selected->'channels') LOOP
  context_hash:=public.agent_context_revision(v.id);
  PERFORM public.agent_register_channel(t.id,v.id,v.revision,context_hash,(x->>'bindingId')::uuid,x->>'channel',x->'recipient'->>'kind',x->'recipient'->>'value',x->'identityProof');
  SELECT * INTO v FROM public.agent_conversations WHERE id=v.id;
 END LOOP;
 RETURN jsonb_build_object('id',v.id,'revision',v.revision,'epoch',v.epoch,'reminderGeneration',v.reminder_generation);
END $function$;

-- agent_channel_operation_before_invitations: current namespace/source for NEW effects only.
CREATE OR REPLACE FUNCTION public.agent_channel_operation_before_invitations(p_operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;g public.agent_authority_grants%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF c.id IS NOT NULL THEN PERFORM public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent','operationId',o.id),org,actor);END IF;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage NOT IN('initial','reply','follow_up') OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>6000 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
 OR r.channel<>'email' AND o.input->>'subject' IS DISTINCT FROM '' OR r.channel='email' AND coalesce(o.input->>'subject','')='' OR NOT public.agent_channel_proposal_permitted(r.id,stage) THEN RETURN false;END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(clock_timestamp()) THEN RETURN false;END IF;
 -- A plan revision, a manual handoff, an opt-out or another account's unknown
 -- outcome cannot be bypassed by choosing a different channel.
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR public.agent_mandate_person_has_unresolved_sends(c.mandate_id,c.contact_id,o.id) THEN RETURN false;END IF;
 aliases:=public.agent_canonical_contact_aliases(c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false'))
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>clock_timestamp() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage='initial' OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage='initial' OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NULL THEN
  SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
  IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 ELSE
  SELECT * INTO g FROM public.agent_authority_grants WHERE id=a.grant_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
  IF o.input->>'requiresHumanReview'='true' OR g.id IS NULL OR g.revision<>a.grant_revision OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR g.approved_at>clock_timestamp() OR g.used_sends>g.max_sends OR g.channel<>r.channel OR g.binding_digest<>r.binding_digest OR NOT g.actions ? kind OR NOT g.recipient_keys ? (r.channel||':'||r.recipient_value) OR NOT g.route_ids ? r.id::text THEN RETURN false;END IF;
 END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $function$;

-- agent_invitation_operation_authorised: current namespace/source for NEW effects only.
CREATE OR REPLACE FUNCTION public.agent_invitation_operation_authorised(p_operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF c.id IS NOT NULL THEN PERFORM public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent','operationId',o.id),org,actor);END IF;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage IS DISTINCT FROM 'invitation' OR r.channel<>'linkedin' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>300 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
 OR r.channel<>'email' AND o.input->>'subject' IS DISTINCT FROM '' OR r.channel='email' AND coalesce(o.input->>'subject','')='' OR NOT public.agent_channel_proposal_before_invitations(r.id,'initial') THEN RETURN false;END IF;
 -- Admission validates this already-running exact HIL operation. Proposal-time
 -- duplicate checks still reject every running invitation, including this one.
 IF NOT EXISTS(SELECT 1 FROM public.agent_linkedin_relationships relationship WHERE relationship.route_id=r.id AND relationship.binding_digest=r.binding_digest AND relationship.identity_revision=r.identity_revision AND relationship.status='not_connected' AND relationship.can_message IS NOT TRUE AND relationship.observed_at<=clock_timestamp() AND relationship.observed_at>=clock_timestamp()-interval '5 minutes')
 OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations invitation WHERE invitation.route_id=r.id AND invitation.state IN('unknown','pending','accepted'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.conversation_id=r.conversation_id AND other.name='linkedin.invitation' AND other.id<>o.id AND other.state IN('running','uncertain','complete')) THEN RETURN false;END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(clock_timestamp()) THEN RETURN false;END IF;
 -- A plan revision, a manual handoff, an opt-out or another account's unknown
 -- outcome cannot be bypassed by choosing a different channel.
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR public.agent_mandate_person_has_unresolved_sends(c.mandate_id,c.contact_id,o.id) THEN RETURN false;END IF;
 aliases:=public.agent_canonical_contact_aliases(c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false'))
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>clock_timestamp() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NOT NULL OR a.review_batch_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=o.id)<>4 THEN RETURN false;END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $function$;

CREATE FUNCTION public.agent_recorded_reply_execution_scope(p_binding uuid,p_kind text,p_sender text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);registered boolean;scope text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held recorded reply scope required';END IF;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text JOIN public.communication_bindings b ON b.id=p_binding AND b.organization_id=run.organization_id AND b.owner_user_id=run.owner_user_id AND public.agent_recorded_binding_digest(b.id)=s->>'bindingDigest' WHERE run.organization_id=org AND run.owner_user_id=actor) INTO registered;
 IF NOT registered THEN RETURN jsonb_build_object('registered',false,'scope',NULL);END IF;
 SELECT min(r.mandate_id::text) INTO scope FROM public.agent_conversation_channels r WHERE r.organization_id=org AND r.owner_user_id=actor AND r.binding_id=p_binding AND r.recipient_kind=p_kind AND r.recipient_value=p_sender AND public.agent_recorded_demo_route_matches(r.id)
 HAVING count(DISTINCT r.mandate_id)=1;
 RETURN jsonb_build_object('registered',true,'scope',CASE WHEN scope IS NULL THEN NULL ELSE jsonb_build_object('kind','demo','id',scope) END);
END $$;
REVOKE ALL ON FUNCTION public.agent_recorded_reply_execution_scope(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_recorded_reply_execution_scope(uuid,text,text) TO acquire_agent_user,acquire_campaign_user;

-- Recorded namespace ingress: immutable receipt/body-free chain unchanged.
CREATE OR REPLACE FUNCTION public.agent_channel_communications_change(p jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);b public.communication_bindings%ROWTYPE;receipt public.communication_event_receipts%ROWTYPE;conv public.agent_conversations%ROWTYPE;candidate record;frame jsonb;outcome jsonb;binding uuid;event text;fingerprint text;changed text;occurred timestamptz;conflict boolean;reviewed boolean;key text;notice jsonb;payload jsonb;affected integer:=0;sender_kind text;sender_value text;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel receipt scope required';END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>20000 OR (SELECT count(*) FROM jsonb_object_keys(p))<>12 OR NOT(p ?& ARRAY['bindingId','serviceEventId','receiptFingerprint','changeFingerprint','channel','sender','providerMessageId','providerConversationId','occurredAt','reviewRequired','reviewReason','receiptPreimage']) THEN RAISE EXCEPTION 'Exact bounded channel receipt required';END IF;
 binding:=(p->>'bindingId')::uuid;event:=p->>'serviceEventId';fingerprint:=p->>'receiptFingerprint';changed:=p->>'changeFingerprint';occurred:=(p->>'occurredAt')::timestamptz;reviewed:=(p->>'reviewRequired')::boolean;sender_kind:=p->'sender'->>'kind';sender_value:=p->'sender'->>'value';
 IF coalesce(length(event),0) NOT BETWEEN 1 AND 200 OR coalesce(fingerprint,'')!~'^[a-f0-9]{64}$' OR coalesce(changed,'')!~'^[a-f0-9]{64}$' OR sender_kind IS NULL OR sender_value IS NULL OR occurred IS NULL OR occurred>clock_timestamp()+interval '1 minute' OR reviewed IS NULL OR coalesce(length(p->>'providerMessageId'),0) NOT BETWEEN 1 AND 2048 OR jsonb_typeof(p->'sender') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'sender'))<>2 THEN RAISE EXCEPTION 'Verified channel metadata required';END IF;
 SELECT * INTO b FROM public.communication_bindings WHERE id=binding AND organization_id=org AND owner_user_id=actor AND application_id='acquire' AND backend='unipile' AND authority='service' FOR SHARE;
 IF b.id IS NULL OR b.channel IS DISTINCT FROM p->>'channel' OR sender_kind IS DISTINCT FROM (CASE b.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END) OR NOT (CASE b.channel WHEN 'email' THEN sender_value=lower(btrim(sender_value)) AND sender_value~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' WHEN 'whatsapp' THEN sender_value~'^[+][1-9][0-9]{6,14}$' WHEN 'linkedin' THEN sender_value~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END) THEN RAISE EXCEPTION 'Original owned canonical channel required';END IF;
 IF coalesce(octet_length(p->>'receiptPreimage'),0) NOT BETWEEN 1 AND 12000 OR encode(sha256(convert_to(p->>'receiptPreimage','UTF8')),'hex') IS DISTINCT FROM changed THEN RAISE EXCEPTION 'Exact authenticated receipt preimage required';END IF;
 frame:=(p->>'receiptPreimage')::jsonb;outcome:=frame->7;
 IF jsonb_typeof(frame) IS DISTINCT FROM 'array' OR jsonb_array_length(frame)<>8 OR frame->>0 IS DISTINCT FROM 'acquire.reply.delivery.v1' OR frame->1 IS DISTINCT FROM jsonb_build_array(b.application_id,b.organization_id,b.owner_user_id,b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend) OR frame->>2 IS DISTINCT FROM binding::text OR frame->>3 IS DISTINCT FROM event OR jsonb_typeof(outcome) IS DISTINCT FROM 'array' OR jsonb_array_length(outcome)<>6 OR outcome->>0 IS DISTINCT FROM p->>'providerMessageId' OR outcome->1 IS DISTINCT FROM p->'providerConversationId' OR outcome->>2 IS DISTINCT FROM 'inbound' OR outcome->>3 IS DISTINCT FROM sender_kind OR outcome->>4 IS DISTINCT FROM sender_value OR (outcome->>5)::timestamptz IS DISTINCT FROM occurred OR (frame->>6)::timestamptz<occurred OR (frame->>6)::timestamptz>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'Authenticated receipt metadata differs';END IF;
 IF frame->>4 IS DISTINCT FROM encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array('communications.reply.event.v1',frame->1,outcome->1,outcome->0)),'UTF8')),'hex') OR frame->>5 IS DISTINCT FROM encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array('communications.reply.content.v1',frame->1,outcome->0,outcome->1,'inbound',sender_kind,sender_value,outcome->5)),'UTF8')),'hex') THEN RAISE EXCEPTION 'Original source fingerprint differs';END IF;
 SELECT * INTO receipt FROM public.communication_event_receipts WHERE binding_id=binding AND service_event_id=event AND organization_id=org AND owner_user_id=actor FOR SHARE;
 IF receipt.binding_id IS NULL OR receipt.payload_fingerprint IS DISTINCT FROM fingerprint OR receipt.fingerprint_version IS DISTINCT FROM 'acquire.reply.delivery.v1' OR receipt.event_type IS DISTINCT FROM 'message' THEN RAISE EXCEPTION 'Original application receipt required';END IF;
 conflict:=fingerprint IS DISTINCT FROM changed;
 IF conflict AND (NOT reviewed OR p->>'reviewReason' IS DISTINCT FROM 'semantic_conflict') OR NOT conflict AND (receipt.occurred_at IS DISTINCT FROM occurred OR reviewed AND p->>'reviewReason' IS DISTINCT FROM 'identity_pending') THEN RAISE EXCEPTION 'Exact original receipt/review state required';END IF;
 -- A caller cannot promote an immutable review receipt by changing the flag.
 -- Only independently resolved original review evidence permits verified replay.
 IF NOT conflict AND NOT reviewed AND receipt.result='review' AND NOT EXISTS(SELECT 1 FROM public.communication_reply_review_latches l WHERE l.binding_id=binding AND l.service_event_id=event AND l.organization_id=org AND l.owner_user_id=actor AND l.resolved_at IS NOT NULL AND l.resolution_reference NOT LIKE 'human-unrelated:%') THEN reviewed:=true;END IF;
 -- A changed payload cannot identify a person. Notify only threads already bound
 -- to this account, dedup by ORIGINAL receipt, with no ownership/state changes.
 IF conflict THEN
  IF (SELECT count(DISTINCT thread_id) FROM public.agent_conversation_channels WHERE binding_id=binding AND organization_id=org AND owner_user_id=actor)>100 THEN RAISE EXCEPTION 'Channel receipt thread bound exceeded';END IF;
  FOR candidate IN SELECT DISTINCT thread_id,mandate_id FROM public.agent_conversation_channels WHERE binding_id=binding AND organization_id=org AND owner_user_id=actor ORDER BY thread_id LOOP
   PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
   key:='channel-receipt-conflict:'||encode(sha256(convert_to(jsonb_build_array(binding,event,fingerprint)::text,'UTF8')),'hex');
   IF EXISTS(SELECT 1 FROM public.agent_messages WHERE thread_id=candidate.thread_id AND request_key=key) THEN CONTINUE;END IF;
   notice:=jsonb_build_object('text','An account event conflicts with its original receipt and needs human review. No person was identified and no reply or cancellation was inferred. Account sending remains blocked by the communications review barrier.','details',jsonb_build_object('bindingId',binding,'serviceEventId',event,'reviewRequired',true,'verifiedReply',false));
   INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(candidate.thread_id,org,candidate.mandate_id,actor,key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
   affected:=affected+1;
  END LOOP;RETURN affected;
 END IF;
 IF (SELECT count(*) FROM public.agent_conversation_channels WHERE binding_id=binding AND organization_id=org AND owner_user_id=actor AND recipient_kind=sender_kind AND recipient_value=sender_value)>100 THEN RAISE EXCEPTION 'Channel incoming person bound exceeded';END IF;
 FOR candidate IN SELECT r.conversation_id,r.thread_id,r.id FROM public.agent_conversation_channels r JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.organization_id=org AND c.owner_user_id=actor WHERE r.binding_id=binding AND r.organization_id=org AND r.owner_user_id=actor AND r.channel=b.channel AND r.binding_digest=public.agent_recorded_binding_digest(binding) AND r.recipient_kind=sender_kind AND r.recipient_value=sender_value AND (reviewed OR public.agent_recorded_demo_route_matches(r.id) OR EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.owner_user_id=actor AND i.contact_id=c.contact_id AND i.channel=b.channel AND i.source_identity=sender_value AND (i.identity=sender_value OR (b.channel='whatsapp' AND sender_kind='phone' AND i.identity=substring(sender_value from 2)||'@s.whatsapp.net')))) AND (reviewed OR b.channel<>'whatsapp' OR (SELECT count(DISTINCT other.contact_id) FROM public.agent_conversation_channels other_route JOIN public.agent_conversations other ON other.id=other_route.conversation_id AND other.thread_id=other_route.thread_id WHERE other_route.binding_id=binding AND other_route.organization_id=org AND other_route.owner_user_id=actor AND other.organization_id=org AND other.owner_user_id=actor AND other_route.channel='whatsapp' AND other_route.binding_digest=public.agent_recorded_binding_digest(binding) AND other_route.recipient_kind='phone' AND other_route.recipient_value=sender_value)=1) ORDER BY r.thread_id,r.conversation_id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.conversation_id FOR UPDATE;
  key:='channel-incoming:'||encode(sha256(convert_to(jsonb_build_array(binding,event,fingerprint,conv.id,reviewed)::text,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.agent_events WHERE thread_id=conv.thread_id AND event_key=key) THEN CONTINUE;END IF;
  UPDATE public.agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,phase=CASE WHEN reviewed AND driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,pause_reason=CASE WHEN driver_kind<>'agent' OR phase<>'active' THEN pause_reason WHEN reviewed THEN 'incoming_channel_review_required' ELSE 'provider_history_changed' END,updated_at=clock_timestamp() WHERE id=conv.id;
  UPDATE public.agent_conversation_channels SET history_complete=false,revision=revision+1,updated_at=clock_timestamp(),cold_cancelled_at=CASE WHEN NOT reviewed THEN coalesce(cold_cancelled_at,clock_timestamp()) ELSE cold_cancelled_at END,next_allowed_at=CASE WHEN NOT reviewed THEN NULL ELSE next_allowed_at END WHERE conversation_id=conv.id;
  PERFORM public.agent_invalidate_person_reviews(conv.id);
  -- Invitation is a separate effect, but a pending cold invitation also loses
  -- authority on any incoming event; original in-flight evidence is untouched.
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND name='linkedin.invitation' AND state IN('proposed','approved');
  UPDATE public.agent_review_batches rb SET state='invalidated' WHERE rb.thread_id=conv.thread_id AND rb.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(rb.manifest) item JOIN public.agent_operations o ON o.id::text=item->>'operationId' WHERE o.conversation_id=conv.id AND o.state='failed' AND o.result->>'reason'='context_changed');
  -- Ordinary verified replies invalidate every old proposal, not a human's
  -- still-current exact reply-only delegation. No cold or mixed grant survives.
  -- Missing body/full history remains non-authorising; dispatch checks it later.
  UPDATE public.agent_authority_grants g SET revoked_at=clock_timestamp(),revision=revision+1
   WHERE g.thread_id=conv.thread_id AND g.revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=conv.id AND (g.route_ids ? r.id::text OR g.recipient_keys ? (r.channel||':'||r.recipient_value)))
    AND NOT (
     NOT reviewed AND conv.phase='active' AND conv.driver_kind='agent' AND conv.engagement NOT IN('handoff','stopped')
     AND g.organization_id=org AND g.owner_user_id=actor AND g.mandate_id=conv.mandate_id
     AND g.channel=b.channel AND g.binding_digest=public.agent_recorded_binding_digest(binding)
     AND g.actions=jsonb_build_array('reply_'||b.channel)
     AND g.route_ids ? candidate.id::text AND g.recipient_keys ? (b.channel||':'||sender_value)
     AND g.approved_at<=clock_timestamp() AND g.expires_at>clock_timestamp() AND g.used_sends<g.max_sends
     AND EXISTS(SELECT 1 FROM public.agent_responsibilities a JOIN public.mandates m ON m.id=a.mandate_id AND m.organization_id=a.organization_id
      JOIN public.agent_operations approval ON approval.id=g.id AND approval.thread_id=g.thread_id AND approval.organization_id=org AND approval.owner_user_id=actor
      WHERE a.id=conv.responsibility_id AND a.thread_id=conv.thread_id AND a.state IN('ready','waiting') AND a.mandate_revision=m.xmin::text
       AND approval.name='authority.create_channels' AND approval.state='complete' AND approval.input->>'mandateRevision'=m.xmin::text)
    );
  UPDATE public.agent_handoffs SET revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=conv.id AND state IN('pending','acknowledged','link_sent');
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text',CASE WHEN reviewed THEN 'An incoming channel event needs identity review. No verified reply or cold cancellation was inferred. Automation remains paused.' WHEN conv.phase='complete' THEN 'A verified reply arrived on a stopped conversation. Cold outreach across all channels is cancelled; automation remains stopped.' WHEN conv.driver_kind<>'agent' OR conv.phase<>'active' THEN 'A verified reply arrived for this person. Cold outreach across all channels is cancelled; your existing control remains in place.' ELSE 'A verified reply arrived. Cold outreach across all channels is cancelled while I check the full conversation.' END,'details',jsonb_build_object('conversationId',conv.id,'routeId',candidate.id,'channel',b.channel,'bindingId',binding,'serviceEventId',event,'providerMessageId',p->>'providerMessageId','occurredAt',occurred,'reviewRequired',reviewed,'verifiedReply',NOT reviewed));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.incoming_channel','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',event,'channel',b.channel,'reviewRequired',reviewed));affected:=affected+1;
 END LOOP;RETURN affected;
END $function$;

CREATE FUNCTION public.agent_origin_mandate(p_kind text,p_source uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE p_kind WHEN 'agent' THEN (SELECT o.mandate_id FROM public.agent_operations o WHERE o.id=p_source AND o.organization_id=current_setting('app.acquire_org',true))
 WHEN 'campaign' THEN (SELECT e.mandate_id FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.id=p_source AND a.organization_id=current_setting('app.acquire_org',true))
 WHEN 'draft' THEN (SELECT e.mandate_id FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=p_source AND m.organization_id=current_setting('app.acquire_org',true)) END;
$$;
REVOKE ALL ON FUNCTION public.agent_origin_mandate(text,uuid) FROM PUBLIC;
CREATE FUNCTION public.agent_is_demo_origin(p_mandate uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=current_setting('app.acquire_org',true) AND x.mode='demo');
$$;
REVOKE ALL ON FUNCTION public.agent_is_demo_origin(uuid) FROM PUBLIC;

CREATE FUNCTION public.agent_is_original_demo_source(p_kind text,p_source uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.organization_id=current_setting('app.acquire_org',true) AND i.source_kind=p_kind AND i.source_id=p_source AND i.execution_mode='demo' AND i.execution_mandate_id IS NOT NULL AND i.execution_context_digest IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.agent_is_original_demo_source(text,uuid) FROM PUBLIC;

-- Organization/global guards exclude explicitly namespaced demo effects.
-- Missing/unattributed origins remain conservatively global; no guessed namespace.
CREATE OR REPLACE FUNCTION public.agent_person_unresolved_before_invitations(contact uuid, ignored_operation uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);identities text[];contacts uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 contacts:=public.agent_canonical_contact_aliases(contact);
 IF ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.id=ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id)) THEN RAISE EXCEPTION 'Only this owned send operation may be excluded'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.organization_id=org AND e.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('campaign',a.id) AND a.state IN('claimed','unknown')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.organization_id=org AND e.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('draft',m.id) AND m.state='queued') THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id) AND o.name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','email.manual_link') AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation) THEN RETURN true; END IF;
 -- A prepared/admitted intent stays unresolved until its original no-submission
 -- proof or a positively materialised original delivery receipt is saved.
 RETURN EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
 WHERE i.organization_id=org AND i.contact_id=ANY(contacts) AND NOT (i.execution_mandate_id IS NOT NULL AND i.execution_context_digest IS NOT NULL AND i.execution_mode='demo')
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
 AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
 AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))
 AND NOT(i.source_kind='agent' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=org AND o.state='complete' AND o.result->'delivery'->>'status'='submitted'))
 AND (ignored_operation IS NULL OR i.source_kind<>'agent' OR i.source_id<>ignored_operation));
END $function$;
CREATE OR REPLACE FUNCTION public.agent_person_has_unresolved_sends(contact uuid, ignored_operation uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE aliases uuid[];
BEGIN
 IF public.agent_person_unresolved_before_invitations(contact,ignored_operation) THEN RETURN true;END IF;
 aliases:=public.agent_canonical_contact_aliases(contact);
 RETURN EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=current_setting('app.acquire_org',true) AND c.contact_id=ANY(aliases) AND NOT public.agent_is_original_demo_source('agent',o.id) AND o.name='linkedin.invitation' AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation);
END $function$;

ALTER FUNCTION public.agent_channel_local_binding(uuid) RENAME TO agent_channel_local_binding_before_execution_context;
REVOKE ALL ON FUNCTION public.agent_channel_local_binding_before_execution_context(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_channel_local_binding(p_binding uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF public.agent_channel_local_binding_before_execution_context(p_binding) THEN RETURN true;END IF;
 IF current_database()<>'acquire_agent_mode' OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR current_setting('app.acquire_channel_simulation',true) IS DISTINCT FROM 'true' OR current_setting('app.acquire_runtime_id',true) IS DISTINCT FROM 'agent-multichannel-20261017' THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)
  AND run.run_id='agent-real-research-demos' AND run.integration_id='sim-agent-real-research-demos' AND run.configuration_ref='sim-agent-real-research-demos-v1'
  AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders));
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_local_binding(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.agent_channel_reserved_recipient(p_channel text,p_value text) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE p_channel WHEN 'email' THEN p_value~'^lead-[0-9]{3}@agent-(multichannel-20261017|real-research-demos)[.]leads[.]acquire[.]test$'
 WHEN 'whatsapp' THEN p_value~'^[+]999[0-9]{12}$'
 WHEN 'linkedin' THEN p_value~'^https://www[.]linkedin[.]com/in/sim-agent-(multichannel-20261017|real-research-demos)-lead-[0-9]{3}$' ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.agent_channel_reserved_recipient(text,text) FROM PUBLIC;

CREATE FUNCTION public.agent_route_execution_permitted(p_route uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;context jsonb;contact uuid;
BEGIN
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF r.id IS NULL THEN RETURN false;END IF;
 SELECT c.contact_id INTO contact FROM public.agent_conversations c WHERE c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.organization_id=r.organization_id AND c.owner_user_id=r.owner_user_id;
 context:=public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent_target','threadId',r.thread_id,'contactId',contact),current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 RETURN context->'contact'->>'sourceRevision'=r.identity_source->>'revision'
  AND context->'contact'->'effectiveRecipients'->>r.channel=r.recipient_value
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(context->'allowedBindings') b WHERE b->>'id'=r.binding_id::text AND b->>'digest'=r.binding_digest AND b->>'channel'=r.channel);
END $$;
REVOKE ALL ON FUNCTION public.agent_route_execution_permitted(uuid) FROM PUBLIC;
ALTER FUNCTION public.agent_channel_proposal_permitted(uuid,text) RENAME TO agent_channel_proposal_before_execution_context;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_execution_context(uuid,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_channel_proposal_permitted(p_route uuid,p_stage text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.agent_route_execution_permitted(p_route) THEN RETURN false;END IF;
 RETURN public.agent_channel_proposal_before_execution_context(p_route,p_stage);
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) TO acquire_agent_user,acquire_campaign_user;

-- Replace the stage-A blanket fence only with exact native source/route gates.
-- Manual draft/campaign demo admission remains separately fenced by0068.
CREATE OR REPLACE FUNCTION public.agent_assert_mandate_outreach_mode(p_mandate uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE research jsonb;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 IF research->>'mode'='demo' AND NOT EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true) AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)) THEN RAISE EXCEPTION 'Verified owned demo sender setup is required; real contact fallback is disabled.';END IF;
END $$;
REVOKE ALL ON FUNCTION public.agent_assert_mandate_outreach_mode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_assert_mandate_outreach_mode(uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE OR REPLACE FUNCTION public.agent_mandate_outreach_mode_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE effective jsonb;conv public.agent_conversations%ROWTYPE;route public.agent_conversation_channels%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME NOT IN('agent_conversations','agent_operations') THEN RAISE EXCEPTION 'Unsupported execution source guard';END IF;
 IF TG_OP='UPDATE' AND OLD.mandate_id IS DISTINCT FROM NEW.mandate_id AND (public.agent_is_demo_origin(OLD.mandate_id) OR public.agent_is_demo_origin(NEW.mandate_id)) THEN RAISE EXCEPTION 'Execution origin is immutable';END IF;
 IF NOT public.agent_is_demo_origin(NEW.mandate_id) THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='agent_conversations' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.delivery_mode IS DISTINCT FROM OLD.delivery_mode OR NEW.binding_id IS DISTINCT FROM OLD.binding_id OR NEW.binding_digest IS DISTINCT FROM OLD.binding_digest OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email THEN RAISE EXCEPTION 'Recorded demo delivery origin is immutable';END IF;
   RETURN NEW; -- receipt/history/ownership updates never acquire new send authority
  END IF;
  PERFORM public.agent_assert_execution_context_scope();
  effective:=public.agent_effective_contact(NEW.mandate_id,NEW.contact_id);
  IF NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true) OR NEW.delivery_mode IS DISTINCT FROM 'communications'
   OR NOT public.agent_demo_runtime_ready((effective->'demoProjection'->>'demoRunId')::uuid)
   OR NEW.recipient_email IS NOT NULL AND NEW.recipient_email IS DISTINCT FROM effective->'demoProjection'->'recipients'->>'email'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effective->'demoProjection'->'senders') b WHERE b->>'bindingId'=NEW.binding_id::text AND b->>'bindingDigest'=NEW.binding_digest)
   OR NOT EXISTS(SELECT 1 FROM public.agent_channel_policies p WHERE p.thread_id=NEW.thread_id AND p.organization_id=NEW.organization_id AND p.owner_user_id=NEW.owner_user_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) b WHERE b->>'bindingId'=NEW.binding_id::text AND b->>'bindingDigest'=NEW.binding_digest))
  THEN RAISE EXCEPTION 'Exact reviewed mapped demo delivery required; real fallback is disabled';END IF;
  RETURN NEW;
 END IF;
 IF NEW.name!~'^(email|whatsapp|linkedin)[.]' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.input IS NOT DISTINCT FROM OLD.input AND NEW.input_digest IS NOT DISTINCT FROM OLD.input_digest AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND (NEW.state IN('failed','complete','uncertain') OR OLD.state IN('running','uncertain')) THEN RETURN NEW;END IF;
 PERFORM public.agent_assert_execution_context_scope();
 SELECT * INTO conv FROM public.agent_conversations WHERE id=NEW.conversation_id AND thread_id=NEW.thread_id AND mandate_id=NEW.mandate_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF conv.id IS NULL OR NOT NEW.input ? 'routeId' OR coalesce(NEW.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'Exact recorded demo route required';END IF;
 SELECT * INTO route FROM public.agent_conversation_channels WHERE id=(NEW.input->>'routeId')::uuid AND conversation_id=conv.id AND thread_id=conv.thread_id AND organization_id=conv.organization_id AND owner_user_id=conv.owner_user_id;
 IF route.id IS NULL OR NOT public.agent_route_execution_permitted(route.id) OR NEW.input->>'bindingDigest' IS DISTINCT FROM route.binding_digest OR NEW.input->>'identityRevision' IS DISTINCT FROM route.identity_revision OR NEW.input->>'recipientKey' IS DISTINCT FROM route.channel||':'||route.recipient_value OR split_part(NEW.name,'.',1) IS DISTINCT FROM route.channel THEN RAISE EXCEPTION 'Current immutable demo source/account/recipient required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_mandate_outreach_mode_guard() FROM PUBLIC;

-- Explicit human history-read guard retains all original evidence requirements.
CREATE OR REPLACE FUNCTION public.agent_review_history_holds_clear(p_conversation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);c public.agent_conversations%ROWTYPE;person public.contacts%ROWTYPE;h public.campaign_reply_holds%ROWTYPE;identities text[];matched boolean;verified integer:=0;source_revision text;
BEGIN
 IF current_setting('role',true)<>'acquire_agent_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current history review scope required';END IF;
 SELECT * INTO c FROM public.agent_conversations WHERE id=p_conversation AND organization_id=org AND owner_user_id=actor;
 IF c.id IS NULL OR c.driver_kind<>'agent' OR c.pending_driver IS NOT NULL OR NOT(c.phase='active' OR c.phase='held' AND c.pause_reason='human_review_required') OR c.engagement IN('stopped','handoff') OR c.delivery_mode<>'communications' THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='inbound' AND m->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 SELECT * INTO person FROM public.contacts WHERE id=c.contact_id AND organization_id=org AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false';
 IF person.id IS NULL THEN RETURN false;END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id AND organization_id=org;
 identities:=public.agent_mandate_person_keys(c.mandate_id,c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.organization_id=org AND x.id<>c.contact_id AND x.id=ANY(public.agent_canonical_contact_aliases(c.contact_id))) THEN RETURN false;END IF;
 IF public.agent_mandate_person_has_unresolved_sends(c.mandate_id,c.contact_id,NULL::uuid) OR public.agent_mandate_legacy_sequence_occupied(c.mandate_id,c.contact_id)
 OR EXISTS(SELECT 1 FROM public.agent_operations WHERE conversation_id=c.id AND state IN('running','uncertain'))
 OR EXISTS(SELECT 1 FROM public.agent_handoffs WHERE conversation_id=c.id AND state<>'dismissed')
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(c.recipient_email) OR lower(s.domain)=split_part(lower(c.recipient_email),'@',2) OR EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(lower(r.recipient_value),'@',2))))) THEN RETURN false;END IF;
 -- The read must still address every current, explicitly recorded account and
 -- unchanged canonical contact. Staleness/incompleteness is what it will repair.
 IF NOT EXISTS(SELECT 1 FROM public.agent_channel_policies p WHERE p.thread_id=c.thread_id AND cardinality(p.channel_order)=(SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id))
 OR NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels WHERE conversation_id=c.id)
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels r LEFT JOIN public.communication_bindings b ON b.id=r.binding_id LEFT JOIN public.agent_channel_policies p ON p.thread_id=r.thread_id WHERE r.conversation_id=c.id AND (b.id IS NULL OR b.organization_id IS DISTINCT FROM org OR b.owner_user_id IS DISTINCT FROM actor OR b.authority IS DISTINCT FROM 'service' OR b.backend IS DISTINCT FROM 'unipile' OR b.channel IS DISTINCT FROM r.channel OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) OR r.identity_source->>'revision' IS DISTINCT FROM source_revision OR p.thread_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'channel'=r.channel AND x->>'bindingId'=r.binding_id::text AND x->>'bindingDigest'=r.binding_digest) OR (CASE r.channel WHEN 'email' THEN lower(btrim((public.agent_delivery_contact_projection(c.mandate_id,c.contact_id)).personal_data->>'email')) WHEN 'whatsapp' THEN (public.agent_delivery_contact_projection(c.mandate_id,c.contact_id)).personal_data->>'phone' ELSE regexp_replace((public.agent_delivery_contact_projection(c.mandate_id,c.contact_id)).personal_data->>'linkedinUrl','/$','') END) IS DISTINCT FROM r.recipient_value)) THEN RETURN false;END IF;
 FOR h IN SELECT * FROM public.campaign_reply_holds held WHERE held.organization_id=org AND public.agent_person_keys(org,held.contact_id)&&identities LOOP
  IF h.contact_id<>c.contact_id OR h.reason<>'reply_received' THEN RETURN false;END IF;
  SELECT EXISTS(SELECT 1 FROM public.agent_conversation_channels r JOIN public.communication_bindings b ON b.id=r.binding_id
   JOIN public.campaign_reply_receipts receipt ON receipt.organization_id=org AND receipt.owner_user_id=actor AND receipt.channel=r.channel AND receipt.received_at=h.received_at AND receipt.from_identity=r.recipient_value
   AND receipt.account_identity=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array('communications.account.binding.v1',jsonb_build_array(b.application_id,b.organization_id,b.owner_user_id,b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend))),'UTF8')),'hex')
   JOIN public.campaign_inbound_events inbound ON inbound.organization_id=org AND inbound.owner_user_id=actor AND inbound.contact_id=c.contact_id AND inbound.channel=h.channel AND inbound.received_at=h.received_at AND inbound.from_identity=receipt.from_identity AND inbound.provider_event_id=h.provider_event_id||':'||c.contact_id::text
   WHERE r.conversation_id=c.id AND r.channel=h.channel AND h.provider_event_id=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(org,receipt.account_identity,receipt.provider_event_id)),'UTF8')),'hex')
   AND EXISTS(SELECT 1 FROM public.communication_event_receipts delivered WHERE delivered.binding_id=b.id AND delivered.organization_id=org AND delivered.owner_user_id=actor AND delivered.event_type='message' AND delivered.result='processed' AND delivered.occurred_at=h.received_at AND delivered.fingerprint_version='acquire.reply.delivery.v1'
    -- The public delivery ledger does not retain the campaign sourceKey. Bind
    -- this receipt to the immutable, verified native incoming notice instead;
    -- its request key includes this exact service event and payload fingerprint.
    AND EXISTS(SELECT 1 FROM public.agent_messages notice WHERE notice.thread_id=c.thread_id AND notice.organization_id=org AND notice.owner_user_id=actor AND notice.mandate_id=c.mandate_id AND notice.role='assistant'
     AND notice.request_key='channel-incoming:'||encode(sha256(convert_to(jsonb_build_array(b.id,delivered.service_event_id,delivered.payload_fingerprint,c.id,false)::text,'UTF8')),'hex')
     AND notice.content->'details'->>'conversationId'=c.id::text AND notice.content->'details'->>'routeId'=r.id::text AND notice.content->'details'->>'channel'=r.channel AND notice.content->'details'->>'bindingId'=b.id::text
     AND notice.content->'details'->>'serviceEventId'=delivered.service_event_id AND notice.content->'details'->'verifiedReply'='true'::jsonb AND notice.content->'details'->'reviewRequired'='false'::jsonb
     AND nullif(notice.content->'details'->>'providerMessageId','') IS NOT NULL
     AND notice.content->'details'->>'occurredAt'=(to_jsonb(h.received_at)#>>'{}')
     AND notice.content_digest=encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice.content)::text,'UTF8')),'hex')))) INTO matched;
  IF matched IS DISTINCT FROM true THEN RETURN false;END IF;
  verified:=verified+1;
 END LOOP;
 IF verified=0 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds held WHERE held.organization_id=org AND lower(held.email)=lower(c.recipient_email) AND held.reason<>'reply_received') THEN RETURN false;END IF;
 RETURN true;
END $function$;

CREATE FUNCTION public.agent_intent_execution_context_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE origin jsonb;context jsonb;enrolment uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.execution_mandate_id IS DISTINCT FROM OLD.execution_mandate_id OR NEW.execution_context_digest IS DISTINCT FROM OLD.execution_context_digest OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode THEN RAISE EXCEPTION 'Original intent execution context is immutable';END IF;
  RETURN NEW;
 END IF;
 IF NEW.execution_mandate_id IS NULL AND NEW.execution_context_digest IS NULL AND NEW.execution_mode IS NULL THEN
  IF public.agent_is_demo_origin(public.agent_origin_mandate(NEW.source_kind,NEW.source_id)) THEN RAISE EXCEPTION 'Demo effects require a sealed original execution context';END IF;
  RETURN NEW; -- old real/v1 compatibility; never namespaced by mutable source rows
 END IF;
 IF NEW.execution_mandate_id IS NULL OR NEW.execution_context_digest IS NULL OR NEW.execution_mode IS NULL THEN RAISE EXCEPTION 'Complete original execution metadata required';END IF;
 IF NEW.source_kind='agent' THEN origin:=jsonb_build_object('kind','agent','operationId',NEW.source_id);
 ELSIF NEW.source_kind='draft' THEN origin:=jsonb_build_object('kind','draft','messageId',NEW.source_id);
 ELSIF NEW.source_kind='campaign' THEN SELECT a.enrolment_id INTO enrolment FROM public.campaign_send_attempts a WHERE a.id=NEW.source_id AND a.organization_id=NEW.organization_id;origin:=jsonb_build_object('kind','campaign','attemptId',NEW.source_id,'enrolmentId',enrolment);
 ELSE RAISE EXCEPTION 'Exact physical submission origin required';END IF;
 context:=public.agent_load_mandate_execution_context(origin,NEW.organization_id,NEW.owner_user_id);
 IF context->'origin'->>'mandateId' IS DISTINCT FROM NEW.execution_mandate_id::text OR context->>'manifestDigest' IS DISTINCT FROM NEW.execution_context_digest OR context->>'mode' IS DISTINCT FROM NEW.execution_mode OR context->'contact'->>'sourceId' IS DISTINCT FROM NEW.contact_id::text
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'allowedBindings') b WHERE b->>'id'=NEW.binding_id::text) THEN RAISE EXCEPTION 'Original execution context differs from exact physical source';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_intent_execution_context_guard() FROM PUBLIC;
CREATE TRIGGER agent_intent_execution_context_guard BEFORE INSERT OR UPDATE ON public.communication_dispatch_intents FOR EACH ROW EXECUTE FUNCTION public.agent_intent_execution_context_guard();

CREATE FUNCTION public.agent_recorded_reply_identity_registration(p_thread uuid,p_conversation uuid,p_route uuid,p_binding uuid,p_channel text,p_identity text,p_contact uuid) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_execution_context_scope();
 SELECT * INTO c FROM public.agent_conversations WHERE id=p_conversation AND thread_id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND contact_id=p_contact AND delivery_mode='communications';
 IF c.id IS NULL THEN RAISE EXCEPTION 'Owned original person required';END IF;
 IF p_route IS NULL THEN
  IF public.agent_is_demo_origin(c.mandate_id) OR p_binding IS DISTINCT FROM c.binding_id OR p_channel IS DISTINCT FROM 'email' OR p_identity IS DISTINCT FROM c.recipient_email THEN RAISE EXCEPTION 'Exact recorded route identity required';END IF;
  RETURN 'organization';
 END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND conversation_id=c.id AND thread_id=c.thread_id AND organization_id=c.organization_id AND owner_user_id=c.owner_user_id AND binding_id=p_binding AND channel=p_channel AND recipient_value=p_identity AND binding_digest=public.agent_recorded_binding_digest(p_binding);
 IF r.id IS NULL THEN RAISE EXCEPTION 'Exact recorded route identity required';END IF;
 IF public.agent_is_demo_origin(c.mandate_id) THEN
  IF NOT public.agent_recorded_demo_route_matches(r.id) THEN RAISE EXCEPTION 'Original mapped demo route proof required';END IF;
  RETURN 'demo';
 END IF;
 RETURN 'organization';
END $$;
REVOKE ALL ON FUNCTION public.agent_recorded_reply_identity_registration(uuid,uuid,uuid,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_recorded_reply_identity_registration(uuid,uuid,uuid,uuid,text,text,uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_allowed_mandate_binding(p_mandate uuid,p_binding uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE research jsonb;registered boolean;demo_allowed boolean;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 IF NOT EXISTS(SELECT 1 FROM public.communication_bindings WHERE id=p_binding AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND application_id='acquire' AND authority='service') THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text AND s->>'bindingDigest'=public.agent_recorded_binding_digest(p_binding) WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)) INTO registered;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text AND s->>'bindingDigest'=public.agent_recorded_binding_digest(p_binding) WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true) AND public.agent_demo_runtime_ready(run.id)) INTO demo_allowed;
 RETURN CASE WHEN research->>'mode'='demo' THEN demo_allowed ELSE NOT registered END;
END $$;
REVOKE ALL ON FUNCTION public.agent_allowed_mandate_binding(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_allowed_mandate_binding(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_demo_execution_readiness(p_thread uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;prepared integer;stale integer;sources integer;accounts boolean;policy boolean;
BEGIN
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF t.id IS NULL OR NOT public.agent_is_demo_origin(t.mandate_id) THEN RAISE EXCEPTION 'Owned demo readiness required';END IF;
 PERFORM public.agent_load_mandate_research_context(t.mandate_id,t.organization_id,t.owner_user_id);
 SELECT count(*) INTO sources FROM public.contacts c WHERE c.organization_id=t.organization_id AND (c.mandate_id=t.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.mandate_id=t.mandate_id AND mt.target_id=c.target_id));
 SELECT count(*) FILTER(WHERE c.id IS NOT NULL AND c.xmin::text=m.source_revision AND public.agent_demo_contact_fingerprint(c.id)=m.source_fingerprint),count(*) FILTER(WHERE CASE WHEN c.id IS NULL THEN true ELSE c.xmin::text IS DISTINCT FROM m.source_revision OR public.agent_demo_contact_fingerprint(c.id) IS DISTINCT FROM m.source_fingerprint END) INTO prepared,stale FROM public.agent_demo_contact_mappings m LEFT JOIN public.contacts c ON c.id=m.contact_id AND c.organization_id=m.organization_id WHERE m.mandate_id=t.mandate_id AND m.organization_id=t.organization_id AND m.created_by=t.owner_user_id;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.organization_id=t.organization_id AND run.owner_user_id=t.owner_user_id AND public.agent_demo_runtime_ready(run.id)) INTO accounts;
 SELECT EXISTS(SELECT 1 FROM public.agent_channel_policies p WHERE p.thread_id=t.id AND jsonb_array_length(p.bindings)=cardinality(p.channel_order) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) ref WHERE NOT public.agent_allowed_mandate_binding(t.mandate_id,(ref->>'bindingId')::uuid) OR ref->>'bindingDigest' IS DISTINCT FROM public.agent_recorded_binding_digest((ref->>'bindingId')::uuid))) INTO policy;
 RETURN jsonb_build_object('prepared',prepared,'stale',stale,'sourcePeopleAvailable',sources>0,'sourcePeople',sources,'accountsReady',accounts,'policyReady',policy,'outreachReady',accounts AND policy AND prepared>0,'reason',CASE WHEN NOT accounts THEN 'demo_accounts_required' WHEN NOT policy THEN 'review_channel_policy' WHEN prepared=0 THEN 'demo_mapping_required' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.agent_demo_execution_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_demo_execution_readiness(uuid) TO acquire_agent_user;

ALTER FUNCTION public.agent_save_channel_policy(uuid,integer,jsonb,integer,jsonb,boolean) RENAME TO agent_save_channel_policy_before_execution_context;
REVOKE ALL ON FUNCTION public.agent_save_channel_policy_before_execution_context(uuid,integer,jsonb,integer,jsonb,boolean) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_save_channel_policy(p_thread uuid,p_revision integer,p_order jsonb,p_delay integer,p_bindings jsonb,p_accelerated boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;ref jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF t.id IS NULL OR jsonb_typeof(p_bindings) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Exact owned channel policy required';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_bindings) LOOP
  IF coalesce(ref->>'bindingId','')!~'^[a-f0-9-]{36}$' OR NOT public.agent_allowed_mandate_binding(t.mandate_id,(ref->>'bindingId')::uuid) THEN RAISE EXCEPTION 'The selected account belongs to another execution context';END IF;
 END LOOP;
 RETURN public.agent_save_channel_policy_before_execution_context(p_thread,p_revision,p_order,p_delay,p_bindings,p_accelerated);
END $$;
REVOKE ALL ON FUNCTION public.agent_save_channel_policy(uuid,integer,jsonb,integer,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_save_channel_policy(uuid,integer,jsonb,integer,jsonb,boolean) TO acquire_agent_user;

-- Unavailable mapping conservatively blocks new effects but never makes a
-- read-only cached-source availability query throw or fall back to real routes.
CREATE OR REPLACE FUNCTION public.agent_mandate_person_has_unresolved_sends(p_mandate uuid,p_contact uuid,p_ignored_operation uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);effective jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required';END IF;
 IF public.agent_is_demo_origin(p_mandate) AND NOT (public.agent_delivery_candidate_projection(p_mandate,p_contact)->>'available')::boolean THEN RETURN true;END IF;
 effective:=public.agent_effective_contact(p_mandate,p_contact);
 IF effective->>'mode'='real' THEN RETURN public.agent_person_has_unresolved_sends(p_contact,p_ignored_operation);END IF;
 aliases:=public.agent_canonical_contact_aliases(p_contact);
 IF p_ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id
  WHERE o.id=p_ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND o.mandate_id=p_mandate AND c.mandate_id=p_mandate AND c.contact_id=ANY(aliases)) THEN RAISE EXCEPTION 'Only this owned demo operation may be excluded';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id
  WHERE o.organization_id=org AND o.mandate_id=p_mandate AND c.mandate_id=p_mandate AND c.contact_id=ANY(aliases) AND o.name~'^(email|whatsapp|linkedin)[.]' AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM p_ignored_operation) THEN RETURN true;END IF;
 IF EXISTS(SELECT 1 FROM public.agent_linkedin_invitations i JOIN public.agent_conversations c ON c.id=i.conversation_id AND c.organization_id=i.organization_id
  WHERE i.organization_id=org AND c.mandate_id=p_mandate AND c.contact_id=ANY(aliases) AND i.state='unknown' AND i.operation_id IS DISTINCT FROM p_ignored_operation) THEN RETURN true;END IF;
 -- If an original intent on this demo account cannot be assigned to an
 -- immutable native mandate, never guess another namespace or drop the hold.
 IF EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
  WHERE i.organization_id=org AND i.owner_user_id=actor AND i.contact_id=ANY(aliases)
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(effective->'demoProjection'->'senders') b WHERE b->>'bindingId'=i.binding_id::text)
  AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
  AND (i.source_kind<>'agent' OR NOT EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=i.organization_id))
  AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
  AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))) THEN RETURN true;END IF;
 RETURN EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.agent_operations o ON i.source_kind='agent' AND o.id=i.source_id AND o.organization_id=i.organization_id
  WHERE i.organization_id=org AND o.mandate_id=p_mandate AND i.contact_id=ANY(aliases)
  AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
  AND NOT(o.state='complete' AND o.result->'delivery'->>'status'='submitted') AND o.id IS DISTINCT FROM p_ignored_operation);
END $$;
