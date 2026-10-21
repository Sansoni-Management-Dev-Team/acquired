-- PROPOSAL ONLY. NOT APPLIED. Exact production native-agent baseline v1.
-- Target: existing Acquire Supabase PostgreSQL17; system identifier7678071634733212629.
-- Derived from the final marked local public schema and read-only production inventory.
-- Contains application objects only. No service schema, provider credentials,
-- fixture registrations, source-data copies, clock acceleration or send activation.
-- Specific approval is required for THIS exact artifact/hash before execution.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL check_function_bodies=false;
SET LOCAL search_path=pg_catalog,public;
SELECT pg_advisory_xact_lock(1094930773,2902);
DO $target$
DECLARE target jsonb;
BEGIN
 target:=current_setting('app.agent_schema_review_target',true)::jsonb;
 IF target IS NULL OR jsonb_typeof(target) IS DISTINCT FROM 'object'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(target) k) IS DISTINCT FROM ARRAY['artifact','database','environment','owner','systemIdentifier']
 OR target->>'artifact' IS DISTINCT FROM 'native-agent-baseline-v1'
 OR target->>'database' IS DISTINCT FROM current_database()
 OR target->>'systemIdentifier' IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
 OR target->>'owner' IS DISTINCT FROM current_user OR current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'Exact approved target and artifact selector required';END IF;
 IF target->>'environment'='production' THEN
  IF current_database()<>'postgres' OR target->>'systemIdentifier'<>'7678071634733212629' THEN RAISE EXCEPTION 'Exact production target required';END IF;
 ELSIF target->>'environment'='rehearsal' THEN
  IF current_database()<>'acquire_hosted_demo_rehearsal' OR target->>'systemIdentifier'='7678071634733212629'
  OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only'
  THEN RAISE EXCEPTION 'Exact isolated rehearsal target required';END IF;
 ELSE RAISE EXCEPTION 'Explicit production or isolated rehearsal selection required';END IF;
 IF to_regclass('public.agent_threads') IS NOT NULL OR to_regclass('public.company_identity_observations') IS NOT NULL
 OR to_regclass('public.agent_production_schema_migrations') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('acquire_agent_user','acquire_agent_worker'))
 THEN RAISE EXCEPTION 'Native baseline target must be absent; no partial or repeated application';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.communications_policy_statement_fence()')) IS DISTINCT FROM '66fe52ab322f025480a7dfc125150f694a199764ebd61a3212bd26f2b1ce9e52'
 OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.communication_dispatch_intents'::regclass AND conname='communication_dispatch_intents_source_kind_check') IS DISTINCT FROM 'CHECK ((source_kind = ANY (ARRAY[''campaign''::text, ''draft''::text])))'
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='communication_dispatch_intents' AND column_name IN('execution_mandate_id','execution_context_digest','execution_mode'))
 THEN RAISE EXCEPTION 'Production predecessor differs from reviewed inventory';END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public."user"'::regclass AND conname='user_email_unique') IS DISTINCT FROM 'UNIQUE (email)'
 OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public."user"'::regclass AND conname='user_pkey') IS DISTINCT FROM 'PRIMARY KEY (id)'
 THEN RAISE EXCEPTION 'Reviewed existing user keys required';END IF;
END $target$;
CREATE ROLE acquire_agent_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE acquire_agent_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT acquire_agent_user,acquire_agent_worker TO postgres;
GRANT USAGE ON SCHEMA public TO acquire_agent_user,acquire_agent_worker;
ALTER TABLE public.communication_dispatch_intents ADD COLUMN execution_mandate_id uuid,ADD COLUMN execution_context_digest text,ADD COLUMN execution_mode text;
ALTER TABLE public.communication_dispatch_intents DROP CONSTRAINT communication_dispatch_intents_source_kind_check;
ALTER TABLE public.communication_dispatch_intents ADD CONSTRAINT communication_dispatch_intents_source_kind_check CHECK(source_kind IN('campaign','draft','agent'));
CREATE FUNCTION public.agent_business_now() RETURNS timestamptz LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $clock$
BEGIN
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NOT NULL OR nullif(current_setting('acquire.simulator_business_time',true),'') IS NOT NULL THEN RAISE EXCEPTION 'Production uses real wall time';END IF;
 RETURN clock_timestamp();
END $clock$;
REVOKE ALL ON FUNCTION public.agent_business_now() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agent_business_now() TO acquire_agent_user,acquire_agent_worker,acquire_campaign_user,acquire_campaign_worker,acquire_communications_writer;
-- Name: agent_adopt_sequence_channels(uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_adopt_sequence_channels(p_thread uuid, p_review jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
  VALUES(person.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,route->>'channel',(route->>'bindingId')::uuid,route->>'bindingDigest',route->'recipient'->>'kind',route->'recipient'->>'value',route->'identityProof',encode(sha256(convert_to(public.agent_channel_canonical_json(route),'UTF8')),'hex'),encode(sha256(convert_to('[]','UTF8')),'hex'),public.agent_business_now()+(SELECT delay_seconds FROM public.agent_channel_policies WHERE thread_id=t.id)*interval '1 second');
 END LOOP;
 notice:=jsonb_build_object('text','You reviewed all original sequence accounts and contact identities. The sequence still owns this person until it is stopped, its in-flight outcomes are reconciled, and you explicitly complete the handover. No agent message is approved.','details',jsonb_build_object('conversationId',person.id,'enrolmentId',source->>'enrolmentId','versionId',source->>'versionId','runtime',source->>'runtime','channels',source->'channels','sourceRevision',source->>'sourceRevision'));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,'sequence-channels-adopt:'||person.id,'assistant',notice,encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('role','assistant','content',notice)),'UTF8')),'hex'));
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(t.organization_id,t.owner_user_id,'agent.sequence_channels_adopted','agent_conversation',person.id::text,notice->'details');
 RETURN jsonb_build_object('id',person.id,'revision',person.revision,'epoch',person.epoch,'status','sequence_owned');
END $$;

-- Name: agent_aliases_have_unresolved_sends(uuid[], uuid, boolean); Type: FUNCTION
CREATE FUNCTION public.agent_aliases_have_unresolved_sends(p_aliases uuid[], ignored_operation uuid, p_invitations boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);contacts uuid[]:=p_aliases;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current send scope required'; END IF;
 IF p_aliases IS NULL THEN RAISE EXCEPTION 'Canonical aliases required';END IF;
 IF ignored_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.id=ignored_operation AND o.organization_id=org AND o.owner_user_id=actor AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id)) THEN RAISE EXCEPTION 'Only this owned send operation may be excluded'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.organization_id=org AND e.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('campaign',a.id) AND a.state IN('claimed','unknown')) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.organization_id=org AND e.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('draft',m.id) AND m.state='queued') THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id) AND o.name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','email.manual_link') AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation) THEN RETURN true; END IF;
 -- A prepared/admitted intent stays unresolved until its original no-submission
 -- proof or a positively materialised original delivery receipt is saved.
 IF EXISTS(SELECT 1 FROM public.communication_dispatch_intents i
 WHERE i.organization_id=org AND i.contact_id=ANY(contacts) AND NOT (i.execution_mandate_id IS NOT NULL AND i.execution_context_digest IS NOT NULL AND i.execution_mode='demo')
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions r WHERE r.intent_id=i.id)
 AND NOT(i.source_kind='campaign' AND EXISTS(SELECT 1 FROM public.campaign_send_attempts a WHERE a.id=i.source_id AND a.organization_id=org AND a.state='sent' AND a.provider_message_id IS NOT NULL AND a.sent_at IS NOT NULL))
 AND NOT(i.source_kind='draft' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=i.source_id AND m.organization_id=org AND m.state='sent' AND m.provider_message_id IS NOT NULL AND m.sent_at IS NOT NULL))
 AND NOT(i.source_kind='agent' AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=i.source_id AND o.organization_id=org AND o.state='complete' AND o.result->'delivery'->>'status'='submitted'))
 AND (ignored_operation IS NULL OR i.source_kind<>'agent' OR i.source_id<>ignored_operation)) THEN RETURN true;END IF;
 RETURN p_invitations AND EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=org AND c.contact_id=ANY(contacts) AND NOT public.agent_is_original_demo_source('agent',o.id) AND o.name='linkedin.invitation' AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation);
END $$;

-- Name: agent_allocate_channel_target(uuid, uuid, uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_allocate_channel_target(p_thread uuid, p_operation uuid, p_contact uuid, p_source text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
END $_$;

-- Name: agent_allowed_mandate_binding(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_allowed_mandate_binding(p_mandate uuid, p_binding uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE research jsonb;registered boolean;demo_allowed boolean;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 IF NOT EXISTS(SELECT 1 FROM public.communication_bindings WHERE id=p_binding AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND application_id='acquire' AND authority='service') THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text AND s->>'bindingDigest'=public.agent_recorded_binding_digest(p_binding) WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true)) INTO registered;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text AND s->>'bindingDigest'=public.agent_recorded_binding_digest(p_binding) WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true) AND public.agent_demo_runtime_ready(run.id)) INTO demo_allowed;
 RETURN CASE WHEN research->>'mode'='demo' THEN demo_allowed ELSE NOT registered END;
END $$;

-- Name: agent_assert_automatic_people_target(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_assert_automatic_people_target(operation uuid, target uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);fid text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT j.config->'automaticPeopleCompanies'->target::text->>'firmableId' INTO fid FROM public.agent_operations o JOIN public.research_jobs j ON j.id=(o.input->'config'->>'requestId')::uuid AND j.organization_id=o.organization_id AND j.mandate_id=o.mandate_id AND j.created_by=o.owner_user_id WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.start' AND o.state='running' AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF fid IS NULL THEN RAISE EXCEPTION 'Saved automatic People company admission required';END IF;
 RETURN public.agent_automatic_people_context(operation,target,fid);
END $$;

-- Name: agent_assert_company_continuation(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_assert_company_continuation(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 o public.agent_operations%ROWTYPE;s public.research_jobs%ROWTYPE;original public.agent_operations%ROWTYPE;
 meta jsonb;selection jsonb;item jsonb;key text;fid text;domain text;keys text[];h text;child_id uuid;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF o.id IS NULL OR o.name<>'research.start' THEN RAISE EXCEPTION 'Owned company continuation operation required';END IF;
 IF NOT(o.input->'config' ? 'companyContinuation') THEN RETURN NULL;END IF;
 meta:=o.input->'config'->'companyContinuation';
 IF jsonb_typeof(meta) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(meta))<>4
 OR meta->'version' IS DISTINCT FROM '1'::jsonb OR coalesce(meta->>'sourceRootId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR coalesce(meta->>'sourceDigest','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(meta->'candidateKeys') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Exact company continuation metadata required';END IF;
 IF jsonb_array_length(meta->'candidateKeys') NOT BETWEEN 1 AND 800
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(meta->'candidateKeys') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}') NOT BETWEEN 3 AND 320)
 THEN RAISE EXCEPTION 'Bounded company continuation selection required';END IF;
 SELECT array_agg(value) INTO keys FROM jsonb_array_elements_text(meta->'candidateKeys');
 IF cardinality(keys)<>(SELECT count(DISTINCT x) FROM unnest(keys)x) THEN RAISE EXCEPTION 'Distinct company continuation candidates required';END IF;
 SELECT * INTO s FROM public.research_jobs WHERE id=(meta->>'sourceRootId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF s.id IS NULL OR s.status<>'partial' OR s.id::text=o.input->'config'->>'requestId'
 OR s.config ? 'companyContinuation' OR s.config->'companyDiscoveryPolicy'->>'version' IS DISTINCT FROM '4'
 OR s.config->'companyIdentityPolicyVersion' IS DISTINCT FROM '1'::jsonb OR s.config->'companyOnly' IS DISTINCT FROM 'true'::jsonb
 OR s.config->'findPeople' IS DISTINCT FROM 'false'::jsonb OR s.config->'includeCompanyPeople' IS DISTINCT FROM 'false'::jsonb OR s.config->'includePhones' IS DISTINCT FROM 'false'::jsonb
 OR s.config->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'hybrid-company-v1'
 THEN RAISE EXCEPTION 'Owned original partial company-only V4 source required';END IF;
 SELECT * INTO original FROM public.agent_operations WHERE id::text=s.config->'nativeAgent'->>'operationId' AND organization_id=org AND owner_user_id=actor AND mandate_id=o.mandate_id AND thread_id=o.thread_id AND name='research.start' AND state='complete';
 IF original.id IS NULL OR original.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1'
 OR original.input->'config'->>'requestId' IS DISTINCT FROM s.id::text
 OR original.input->'config'->'companyDiscoveryPolicy' IS DISTINCT FROM s.config->'companyDiscoveryPolicy'
 THEN RAISE EXCEPTION 'Completed owned source operation required';END IF;
 IF o.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1'
 OR o.input->'config'->'companyDiscoveryPolicy' IS DISTINCT FROM s.config->'companyDiscoveryPolicy'
 OR o.input->'config'->'companyIdentityPolicyVersion' IS DISTINCT FROM '1'::jsonb OR o.input->'config'->'companyOnly' IS DISTINCT FROM 'true'::jsonb
 OR o.input->'config'->'findPeople' IS DISTINCT FROM 'false'::jsonb OR o.input->'config'->'includeCompanyPeople' IS DISTINCT FROM 'false'::jsonb OR o.input->'config'->'includePhones' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Company-only V4 continuation scope required';END IF;
 selection:=s.config->'hybridResult'->'selection';
 IF jsonb_typeof(selection) IS DISTINCT FROM 'array' OR jsonb_array_length(selection) NOT BETWEEN 1 AND 800 THEN RAISE EXCEPTION 'Saved bounded company candidate manifest required';END IF;
 -- The source row lock and the existing organization gate serialize competing
 -- claims, including proposals in different threads. Failed/uncertain/completed
 -- descendants retain their claim; rejection releases only a proposal that has
 -- no root, dispatch or physical effect whatsoever.
 IF EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.organization_id=org AND other.mandate_id=o.mandate_id AND other.id<>o.id AND other.name='research.start'
 AND other.input->'config'->'companyContinuation'->>'sourceRootId'=s.id::text
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(other.input->'config'->'companyContinuation'->'candidateKeys')='array' THEN other.input->'config'->'companyContinuation'->'candidateKeys' ELSE '[]'::jsonb END)x WHERE x=ANY(keys))
 AND (other.state<>'rejected'
 OR EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.organization_id=org AND j.config->'nativeAgent'->>'operationId'=other.id::text)
 OR EXISTS(SELECT 1 FROM public.agent_operations effect WHERE effect.organization_id=org AND effect.input->>'researchOperationId'=other.id::text AND effect.name IN('research.worker_dispatch','research.provider'))))
 THEN RAISE EXCEPTION 'Company continuation candidate already claimed';END IF;
 FOREACH key IN ARRAY keys LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(selection)x WHERE x->>'candidateKey'=key)<>1 THEN RAISE EXCEPTION 'Exact saved company candidate required';END IF;
  SELECT value INTO item FROM jsonb_array_elements(selection) WHERE value->>'candidateKey'=key;
  domain:=coalesce(item->>'domain','');fid:=nullif(item->>'firmableId','');
  IF item->>'outcome' IS DISTINCT FROM 'not_started' OR domain<>lower(domain)
  OR (fid IS NOT NULL AND (fid !~ '^f[0-9]+$' OR key IS DISTINCT FROM 'firmable:'||fid))
  OR (fid IS NULL AND (domain='' OR key IS DISTINCT FROM 'domain:'||domain))
  THEN RAISE EXCEPTION 'Explicit never-started company identity required';END IF;
  h:=encode(sha256(convert_to(s.id::text||':firmable:'||key,'UTF8')),'hex');
  child_id:=(substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid;
  IF EXISTS(SELECT 1 FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id
  AND (child.id=child_id OR child.config->>'parentJobId'=s.id::text
   OR EXISTS(SELECT 1 FROM public.research_jobs descendant WHERE descendant.organization_id=org AND descendant.mandate_id=o.mandate_id AND descendant.config->'companyContinuation'->>'sourceRootId'=s.id::text AND descendant.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text AND child.config->>'parentJobId'=descendant.id::text))
  AND (child.id=child_id OR (fid IS NOT NULL AND (child.config->>'hybridFirmableId'=fid OR child.config->>'firmableCompanyId'=fid)) OR (domain<>'' AND (child.config->>'hybridExpectedDomain'=domain OR child.config->>'companyDomain'=domain))))
  THEN RAISE EXCEPTION 'Company candidate already has original or descendant work';END IF;
 END LOOP;
 RETURN jsonb_build_object('version',1,'sourceRootId',s.id,'sourceDigest',meta->>'sourceDigest','candidateKeys',meta->'candidateKeys');
END $_$;

-- Name: agent_assert_control_scope(); Type: FUNCTION
CREATE FUNCTION public.agent_assert_control_scope() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true)<>'acquire_agent_user'
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current agent authority required'; END IF;
END $$;

-- Name: agent_assert_execution_context_scope(); Type: FUNCTION
CREATE FUNCTION public.agent_assert_execution_context_scope() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true))
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current execution context scope required';END IF;
END $$;

-- Name: agent_assert_mandate_outreach_mode(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_assert_mandate_outreach_mode(p_mandate uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE research jsonb;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 IF research->>'mode'='demo' AND NOT EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.organization_id=current_setting('app.acquire_org',true) AND run.owner_user_id=current_setting('app.acquire_user',true) AND public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)) THEN RAISE EXCEPTION 'Verified owned demo sender setup is required; real contact fallback is disabled.';END IF;
END $$;

-- Name: agent_assert_manual_mandate_outreach_mode(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_assert_manual_mandate_outreach_mode(p_mandate uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 -- Historical null-origin records retain existing behavior. Normal approval
 -- separately rejects missing origins; this function grants no effect authority.
 IF p_mandate IS NULL THEN RETURN;END IF;
 IF org IS NULL OR org='' OR actor IS NULL OR actor=''
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org)
 THEN RAISE EXCEPTION 'Current owned mandate required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes WHERE mandate_id=p_mandate AND organization_id=org AND mode='demo')
 THEN RAISE EXCEPTION 'Manual outreach is disabled for demo mandates; use reviewed demo agent routes.';END IF;
END $$;

-- Name: agent_assert_target_allocation(uuid, uuid, uuid, text, text, uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_assert_target_allocation(p_thread uuid, p_operation uuid, p_contact uuid, p_source text, p_mode text, p_binding uuid, p_binding_digest text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE op public.agent_operations%ROWTYPE;snapshot jsonb;candidate jsonb;selected jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND thread_id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND name='target.select' AND state IN('approved','running');
 IF op.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=p_thread AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact current target approval required'; END IF;
 SELECT item INTO selected FROM jsonb_array_elements(op.input->'selected') item WHERE item->>'contactId'=p_contact::text AND item->>'sourceRevision'=p_source;
 IF selected IS NULL THEN RAISE EXCEPTION 'Contact not in approved selection'; END IF;
 snapshot:=public.agent_owned_target_snapshot(p_thread,ARRAY[p_contact]);
 IF snapshot->>'mandateRevision' IS DISTINCT FROM op.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM op.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM op.input->>'responsibilityRevision' THEN RAISE EXCEPTION 'Target supervision changed'; END IF;
 candidate:=snapshot->'candidates'->0;
 IF candidate IS NULL OR candidate->>'sourceRevision' IS DISTINCT FROM p_source OR jsonb_array_length(candidate->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Target contact evidence or ownership needs review'; END IF;
 IF p_mode IS DISTINCT FROM op.input->'delivery'->>'mode' THEN RAISE EXCEPTION 'Approved delivery mode changed'; END IF;
 IF p_mode='communications' THEN
  IF p_binding::text IS DISTINCT FROM op.input->'delivery'->>'bindingId' OR p_binding_digest IS DISTINCT FROM op.input->'delivery'->>'bindingDigest' THEN RAISE EXCEPTION 'Approved email account changed'; END IF;
 ELSIF p_mode<>'local_sink' OR p_binding IS NOT NULL THEN RAISE EXCEPTION 'Explicit delivery mode required'; END IF;
END $$;

-- Name: agent_audit_completed_sequence(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_audit_completed_sequence(p_operation uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;s public.campaign_sequences%ROWTYPE;action_name text;details jsonb;audit_id uuid;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT o.* INTO op FROM public.agent_operations o JOIN public.agent_threads t ON t.id=o.thread_id AND t.organization_id=o.organization_id AND t.owner_user_id=o.owner_user_id AND t.mandate_id=o.mandate_id
 JOIN public.mandates m ON m.id=t.mandate_id AND m.organization_id=t.organization_id
 WHERE o.id=p_operation AND o.organization_id=org AND o.owner_user_id=actor AND o.name IN('sequence.prepare','sequence.publish') AND o.state='complete';
 IF op.id IS NULL OR op.result IS NULL OR NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=op.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exactly reviewed completed owned sequence operation required'; END IF;
 SELECT * INTO s FROM public.campaign_sequences WHERE id=(op.input->>'sequenceId')::uuid AND organization_id=org AND owner_user_id=actor AND mandate_id=op.mandate_id;
 IF s.id IS NULL THEN RAISE EXCEPTION 'Owned sequence receipt required'; END IF;
 IF op.name='sequence.prepare' THEN
  IF op.input->>'nativeSequenceDraftVersion' IS DISTINCT FROM '1' OR op.result->>'sequenceId' IS DISTINCT FROM s.id::text OR op.result->>'draftRevision' IS NULL THEN RAISE EXCEPTION 'Native draft receipt required'; END IF;
  action_name:='agent.sequence_draft_saved';details:=jsonb_build_object('operationId',op.id,'draftRevision',op.result->>'draftRevision');
 ELSE
  IF op.input->>'nativeSequencePublicationVersion' IS DISTINCT FROM '1' OR op.result->>'id' IS DISTINCT FROM op.input->>'versionId'
   OR NOT EXISTS(SELECT 1 FROM public.campaign_sequence_versions v WHERE v.id=(op.input->>'versionId')::uuid AND v.sequence_id=s.id AND v.organization_id=org AND v.owner_user_id=actor AND v.version::text=op.result->>'version' AND v.definition=op.input->'definition') THEN RAISE EXCEPTION 'Original publication receipt required'; END IF;
  action_name:='agent.sequence_published';details:=jsonb_build_object('operationId',op.id,'versionId',op.result->>'id','version',(op.result->>'version')::integer,'runtime',op.input->>'runtime');
 END IF;
 -- agent_assert_control_scope requires the shared exclusive organization gate,
 -- so this replay check and insert serialize with all scoped callers.
 SELECT id INTO audit_id FROM public.audit_events WHERE organization_id=org AND actor_id=actor AND action=action_name AND entity_type='campaign_sequence' AND entity_id=s.id::text AND metadata->>'operationId'=op.id::text LIMIT 1;
 IF audit_id IS NULL THEN INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,action_name,'campaign_sequence',s.id::text,details) RETURNING id INTO audit_id; END IF;
 RETURN audit_id;
END $$;

-- Name: agent_authority_use_immutable(); Type: FUNCTION
CREATE FUNCTION public.agent_authority_use_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF ROW(NEW.operation_id,NEW.conversation_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.thread_id,NEW.grant_id,NEW.grant_revision,NEW.review_batch_id,NEW.operation_revision,NEW.operation_fence,NEW.operation_digest,NEW.context_revision,NEW.binding_digest)
 IS DISTINCT FROM ROW(OLD.operation_id,OLD.conversation_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.thread_id,OLD.grant_id,OLD.grant_revision,OLD.review_batch_id,OLD.operation_revision,OLD.operation_fence,OLD.operation_digest,OLD.context_revision,OLD.binding_digest) THEN RAISE EXCEPTION 'Recorded authority cannot be substituted'; END IF;
 RETURN NEW;
END $$;

-- Name: agent_automatic_people_context(uuid, uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_automatic_people_context(operation uuid, target uuid, firmable_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;source jsonb;projection jsonb;item jsonb;saved jsonb;company_domain text;aliases uuid[];identity_keys text[];identity_aliases uuid[];assessment jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state='running' FOR UPDATE;
 IF o.id IS NULL OR NOT public.agent_research_v5_scope(o.input) OR firmable_id IS NULL OR firmable_id!~'^f[0-9]+$' OR target IS NULL THEN RAISE EXCEPTION 'Current approved V5 automatic People scope required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact initial automatic People approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'true' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config ? 'companyOnly' OR j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'hybrid-company-v1' OR NOT coalesce((public.agent_research_phase_budget_status(o.id)->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Saved current automatic People root and funding required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.created_by=actor AND child.config->>'parentJobId'=j.id::text AND child.config->>'targetId'=target::text AND child.status IN('complete','partial') AND (child.config->>'firmableCompanyId'=firmable_id OR child.config->>'hybridFirmableId'=firmable_id)) THEN RAISE EXCEPTION 'Accepted original company result required before People';END IF;
 -- Exact membership/source lookup, never the historical ranked/top-50 People
 -- selection. Scoring is evidence for the GUI, not admission for this V5 rule.
 SELECT mt.assessment INTO assessment FROM public.mandate_targets mt WHERE mt.organization_id=org AND mt.mandate_id=o.mandate_id AND mt.target_id=target;
 IF NOT FOUND OR assessment->>'stage' IN('contacted','in-conversation') OR (assessment->>'stage' IN('excluded','parked') AND assessment->>'decisionOrigin' IS DISTINCT FROM 'automatic') THEN RAISE EXCEPTION 'Current explicitly available company membership required';END IF;
 source:=public.agent_fields_current_source(org,o.mandate_id,target);projection:=source->'projection';
 IF projection IS NULL OR projection->'target'->>'firmableCompanyId' IS DISTINCT FROM firmable_id THEN RAISE EXCEPTION 'Current accepted canonical company source required';END IF;
 item:=jsonb_build_object('targetId',target,'firmableId',firmable_id,'sourceRevision',source->>'sourceRevision');
 company_domain:=projection->'target'->>'domain';
 SELECT array_agg(p.id) INTO aliases FROM public.contacts p JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org WHERE p.organization_id=org AND (g.id=target OR (coalesce(company_domain,'')<>'' AND lower(regexp_replace(g.domain,'^www[.]',''))=lower(regexp_replace(company_domain,'^www[.]',''))) OR g.firmable_company_id=firmable_id);
 WITH batch AS MATERIALIZED(SELECT * FROM public.agent_contact_identity_batch(org,coalesce(aliases,'{}'::uuid[])))
 SELECT ARRAY(SELECT DISTINCT unnest(b.identity_keys) FROM batch b),ARRAY(SELECT DISTINCT unnest(b.contact_aliases) FROM batch b) INTO identity_keys,identity_aliases;
 IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])))
 OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND x.state='sent')
 OR EXISTS(SELECT 1 FROM public.campaign_inbound_events e WHERE e.organization_id=org AND e.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])))
 OR EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key=ANY(coalesce(identity_keys,'{}'::text[]))) THEN RAISE EXCEPTION 'Previous outreach or owned conversation requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND coalesce(p.personal_data->>'doNotContact','false')<>'false')
 OR public.agent_aliases_have_unresolved_sends(identity_aliases,NULL::uuid,true)
 OR EXISTS(SELECT 1 FROM public.suppressions suppression WHERE suppression.organization_id=org AND ((coalesce(company_domain,'')<>'' AND lower(regexp_replace(suppression.domain,'^www[.]',''))=lower(regexp_replace(company_domain,'^www[.]',''))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND lower(suppression.address)=lower(p.personal_data->>'email')))) THEN RAISE EXCEPTION 'Opt-out, suppression or unresolved outcome requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND NOT p.fictionalised AND coalesce(p.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AND p.provenance->>'nativeAutomaticPeopleOperationId' IS DISTINCT FROM o.id::text) THEN RAISE EXCEPTION 'Existing cached contact requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.firmable_sync_runs run WHERE run.organization_id=org AND run.target_id=target AND run.status IN('queued','running'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.organization_id=org AND other.id<>o.id AND other.name='research.people' AND other.state IN('proposed','approved','running','uncertain') AND EXISTS(SELECT 1 FROM jsonb_array_elements(other.input->'selected') selection WHERE selection->>'targetId'=target::text OR selection->>'firmableId'=firmable_id))
 OR EXISTS(SELECT 1 FROM public.research_jobs other JOIN public.agent_operations parent ON parent.id::text=other.config->'nativeAgent'->>'operationId' AND parent.organization_id=org WHERE other.organization_id=org AND other.id<>j.id AND other.config->'automaticPeopleCompanies' @> jsonb_build_object(target::text,jsonb_build_object('firmableId',firmable_id)) AND (parent.state IN('approved','running','uncertain') OR EXISTS(SELECT 1 FROM public.agent_operations attempt WHERE attempt.organization_id=org AND attempt.input->>'researchOperationId'=parent.id::text AND attempt.input->>'targetId'=target::text AND attempt.name='research.provider' AND attempt.state IN('running','uncertain')))) THEN RAISE EXCEPTION 'Existing People work requires its original outcome';END IF;
 saved:=j.config->'automaticPeopleCompanies'->target::text;
 IF saved IS NOT NULL THEN
  IF saved->>'targetId' IS DISTINCT FROM target::text OR saved->>'firmableId' IS DISTINCT FROM firmable_id OR saved->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' THEN RAISE EXCEPTION 'Automatic People company source changed';END IF;
 ELSE
  IF jsonb_typeof(coalesce(j.config->'automaticPeopleCompanies','{}'::jsonb))<>'object' OR (SELECT count(*) FROM jsonb_object_keys(coalesce(j.config->'automaticPeopleCompanies','{}'::jsonb)))>=800 THEN RAISE EXCEPTION 'Automatic People company bound reached';END IF;
  saved:=jsonb_build_object('targetId',target,'firmableId',firmable_id,'sourceRevision',item->>'sourceRevision','maxContactsPerCompany',3);
  UPDATE public.research_jobs SET config=jsonb_set(config,'{automaticPeopleCompanies}',coalesce(config->'automaticPeopleCompanies','{}'::jsonb)||jsonb_build_object(target::text,saved)),updated_at=clock_timestamp() WHERE id=j.id;
 END IF;
 RETURN saved;
END $_$;

-- Name: agent_canonical_contact_aliases(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_canonical_contact_aliases(p_contact uuid) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE result uuid[];BEGIN
 SELECT b.contact_aliases INTO result FROM public.agent_contact_identity_batch(current_setting('app.acquire_org',true),ARRAY[p_contact]) b;
 IF result IS NULL THEN RAISE EXCEPTION 'Canonical contact not found';END IF;RETURN result;END $$;

-- Name: agent_channel_canonical_json(jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_channel_canonical_json(v jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE result text;
BEGIN
 IF jsonb_typeof(v)='object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.agent_channel_canonical_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);RETURN result;
 ELSIF jsonb_typeof(v)='array' THEN SELECT '['||coalesce(string_agg(public.agent_channel_canonical_json(value),',' ORDER BY ordinality),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY;RETURN result;
 ELSE RETURN v::text;END IF;
END $$;

-- Name: agent_channel_communications_change(jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_channel_communications_change(p jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);b public.communication_bindings%ROWTYPE;receipt public.communication_event_receipts%ROWTYPE;conv public.agent_conversations%ROWTYPE;candidate record;frame jsonb;outcome jsonb;binding uuid;event text;fingerprint text;changed text;occurred timestamptz;conflict boolean;reviewed boolean;key text;notice jsonb;payload jsonb;affected integer:=0;sender_kind text;sender_value text;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel receipt scope required';END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>20000 OR (SELECT count(*) FROM jsonb_object_keys(p))<>12 OR NOT(p ?& ARRAY['bindingId','serviceEventId','receiptFingerprint','changeFingerprint','channel','sender','providerMessageId','providerConversationId','occurredAt','reviewRequired','reviewReason','receiptPreimage']) THEN RAISE EXCEPTION 'Exact bounded channel receipt required';END IF;
 binding:=(p->>'bindingId')::uuid;event:=p->>'serviceEventId';fingerprint:=p->>'receiptFingerprint';changed:=p->>'changeFingerprint';occurred:=(p->>'occurredAt')::timestamptz;reviewed:=(p->>'reviewRequired')::boolean;sender_kind:=p->'sender'->>'kind';sender_value:=p->'sender'->>'value';
 IF coalesce(length(event),0) NOT BETWEEN 1 AND 200 OR coalesce(fingerprint,'')!~'^[a-f0-9]{64}$' OR coalesce(changed,'')!~'^[a-f0-9]{64}$' OR sender_kind IS NULL OR sender_value IS NULL OR occurred IS NULL OR occurred>public.agent_business_now()+interval '1 minute' OR reviewed IS NULL OR coalesce(length(p->>'providerMessageId'),0) NOT BETWEEN 1 AND 2048 OR jsonb_typeof(p->'sender') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'sender'))<>2 THEN RAISE EXCEPTION 'Verified channel metadata required';END IF;
 SELECT * INTO b FROM public.communication_bindings WHERE id=binding AND organization_id=org AND owner_user_id=actor AND application_id='acquire' AND backend='unipile' AND authority='service' FOR SHARE;
 IF b.id IS NULL OR b.channel IS DISTINCT FROM p->>'channel' OR sender_kind IS DISTINCT FROM (CASE b.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END) OR NOT (CASE b.channel WHEN 'email' THEN sender_value=lower(btrim(sender_value)) AND sender_value~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' WHEN 'whatsapp' THEN sender_value~'^[+][1-9][0-9]{6,14}$' WHEN 'linkedin' THEN sender_value~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END) THEN RAISE EXCEPTION 'Original owned canonical channel required';END IF;
 IF coalesce(octet_length(p->>'receiptPreimage'),0) NOT BETWEEN 1 AND 12000 OR encode(sha256(convert_to(p->>'receiptPreimage','UTF8')),'hex') IS DISTINCT FROM changed THEN RAISE EXCEPTION 'Exact authenticated receipt preimage required';END IF;
 frame:=(p->>'receiptPreimage')::jsonb;outcome:=frame->7;
 IF jsonb_typeof(frame) IS DISTINCT FROM 'array' OR jsonb_array_length(frame)<>8 OR frame->>0 IS DISTINCT FROM 'acquire.reply.delivery.v1' OR frame->1 IS DISTINCT FROM jsonb_build_array(b.application_id,b.organization_id,b.owner_user_id,b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend) OR frame->>2 IS DISTINCT FROM binding::text OR frame->>3 IS DISTINCT FROM event OR jsonb_typeof(outcome) IS DISTINCT FROM 'array' OR jsonb_array_length(outcome)<>6 OR outcome->>0 IS DISTINCT FROM p->>'providerMessageId' OR outcome->1 IS DISTINCT FROM p->'providerConversationId' OR outcome->>2 IS DISTINCT FROM 'inbound' OR outcome->>3 IS DISTINCT FROM sender_kind OR outcome->>4 IS DISTINCT FROM sender_value OR (outcome->>5)::timestamptz IS DISTINCT FROM occurred OR (frame->>6)::timestamptz<occurred OR (frame->>6)::timestamptz>public.agent_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Authenticated receipt metadata differs';END IF;
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
END $_$;

-- Name: agent_channel_communications_no_submission(uuid, uuid, text, uuid, uuid, uuid, bigint); Type: FUNCTION
CREATE FUNCTION public.agent_channel_communications_no_submission(operation uuid, intent uuid DEFAULT NULL::uuid, expected_proof_digest text DEFAULT NULL::text, current_run uuid DEFAULT NULL::uuid, current_event uuid DEFAULT NULL::uuid, current_lease_owner uuid DEFAULT NULL::uuid, current_fence bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;original public.communication_dispatch_intents%ROWTYPE;reservation record;evidence jsonb;content jsonb;message_key text;route public.agent_conversation_channels%ROWTYPE;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up') THEN RAISE EXCEPTION 'Owned original channel operation required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id FOR UPDATE;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF conv.id IS NULL OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Original communications conversation required'; END IF;
 IF jsonb_typeof(op.input->'routeId') IS DISTINCT FROM 'string' OR op.input->>'routeId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Original recorded channel route required';END IF;
 SELECT * INTO route FROM public.agent_conversation_channels WHERE id=(op.input->>'routeId')::uuid AND conversation_id=conv.id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 IF route.id IS NULL OR split_part(op.name,'.',1) IS DISTINCT FROM route.channel OR op.input->>'bindingDigest' IS DISTINCT FROM route.binding_digest OR op.input->>'identityRevision' IS DISTINCT FROM route.identity_revision THEN RAISE EXCEPTION 'Exact immutable original channel account required';END IF;
 IF op.result->'delivery'->>'status'='submitted' THEN RAISE EXCEPTION 'A positive original receipt cannot be closed as not submitted';END IF;

 IF intent IS NOT NULL THEN
  IF expected_proof_digest IS NULL OR expected_proof_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Authenticated original disposition required'; END IF;
  SELECT * INTO original FROM public.communication_dispatch_intents WHERE id=intent AND organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id AND binding_id=route.binding_id;
  IF (SELECT count(*) FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)<>1 OR original.id IS NULL OR original.contact_id IS DISTINCT FROM conv.contact_id OR original.operation IS DISTINCT FROM 'message' OR NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=intent AND proof_digest=expected_proof_digest) THEN RAISE EXCEPTION 'Recorded original disposition required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','intentId',intent,'proofDigest',expected_proof_digest,'operationKey',original.operation_key);
 ELSE
  IF current_setting('role',true)='acquire_agent_user' AND expected_proof_digest IS NULL AND op.state='failed' AND op.result->'delivery'=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent') THEN RETURN op.result->'delivery'; END IF;
  IF current_run IS NOT NULL OR current_event IS NOT NULL OR current_lease_owner IS NOT NULL OR current_fence IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.agent_runs r JOIN public.agent_events e ON e.id=r.trigger_event_id WHERE r.id=current_run AND e.id=current_event AND r.thread_id=op.thread_id AND e.thread_id=op.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='running' AND e.state='leased' AND r.lease_owner=current_lease_owner AND e.lease_owner=current_lease_owner AND r.fence=current_fence AND e.fence=current_fence AND r.lease_until>clock_timestamp() AND e.lease_until>clock_timestamp() AND r.created_at+interval '45 seconds'>clock_timestamp() AND e.kind=route.channel||'.reconcile' AND e.payload->>'operationId'=op.id::text) THEN RAISE EXCEPTION 'Current lookup-only reconcile fence required'; END IF;
  END IF;
  -- Absence of a receipt is never proof. Only an expired original operation
  -- with no committed application intent and no live thread run may close.
  IF current_setting('role',true)<>'acquire_agent_user' OR expected_proof_digest IS NOT NULL OR op.lease_until IS NULL OR op.lease_until>clock_timestamp()
   OR EXISTS(SELECT 1 FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)
   OR EXISTS(SELECT 1 FROM public.agent_runs WHERE thread_id=op.thread_id AND state='running' AND lease_until>clock_timestamp() AND id IS DISTINCT FROM current_run) THEN RAISE EXCEPTION 'Expired unprepared operation proof required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent');
 END IF;
 IF op.state='failed' AND op.result->'delivery'=evidence THEN RETURN evidence; END IF;
 IF op.state NOT IN('running','uncertain') THEN RAISE EXCEPTION 'Original operation cannot be resolved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_authority_uses WHERE operation_id=op.id AND conversation_id=conv.id AND organization_id=org AND owner_user_id=actor AND binding_digest=route.binding_digest AND operation_revision=op.revision AND operation_fence=op.fence AND operation_digest=op.input_digest AND context_revision=op.input->>'contextRevision' AND state IN('reserved','admitted','uncertain')) THEN RAISE EXCEPTION 'Original authority use required'; END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=op.id)<>4
 OR (SELECT count(DISTINCT a.scope_key) FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id AND r.organization_id=org AND r.owner_user_id=actor AND r.amount=1 AND r.state IN('reserved','uncertain') AND a.organization_id=org AND a.unit='sends' AND a.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||conv.mandate_id::text||':sends','binding:'||route.binding_digest||':sends']))<>4 THEN RAISE EXCEPTION 'Exact original sending reservations required'; END IF;
 FOR reservation IN SELECT r.*,a.reserved AS account_reserved FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id ORDER BY r.account_id FOR UPDATE OF r,a LOOP
  IF reservation.account_reserved<reservation.amount THEN RAISE EXCEPTION 'Original reservation ledger inconsistent'; END IF;
  UPDATE public.agent_budget_accounts SET reserved=reserved-reservation.amount WHERE id=reservation.account_id;
  UPDATE public.agent_budget_reservations SET state='settled',actual=0,updated_at=clock_timestamp() WHERE id=reservation.id;
 END LOOP;
 UPDATE public.agent_authority_uses SET state='released',outcome=evidence,updated_at=clock_timestamp() WHERE operation_id=op.id AND organization_id=org AND owner_user_id=actor;
 -- Delegated used_sends remains monotonic. A proven no-send releases this
 -- operation, never silently restores or expands a grant's capacity.
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('delivery',evidence),lease_until=NULL,updated_at=clock_timestamp() WHERE id=op.id;
 UPDATE public.agent_conversations SET phase=CASE WHEN driver_kind='agent' THEN 'held' ELSE phase END,history_complete=false,pause_reason=CASE WHEN driver_kind='agent' THEN 'provider_no_submission_confirmed' ELSE pause_reason END,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND id<>op.id AND name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up') AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=op.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id=(item->>'operationId')::uuid WHERE o.conversation_id=conv.id);
 content:=jsonb_build_object('text','The original channel message was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.','operationId',op.id);
 message_key:='no-submission:'||op.id::text;
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(op.thread_id,org,op.mandate_id,actor,message_key,'assistant',content,encode(sha256(convert_to(content::text,'UTF8')),'hex')) ON CONFLICT(thread_id,request_key) DO NOTHING;
 RETURN evidence;
END $_$;

-- Name: agent_channel_communications_source(uuid, uuid, bigint, bigint, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;coverage jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE id=operation AND name='linkedin.invitation' AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)) THEN RETURN public.agent_channel_source_before_invitations(operation,conversation,expected_epoch,expected_fence,binding);END IF;
 IF public.agent_communications_source_kind(operation,conversation,expected_epoch,expected_fence,binding) IS DISTINCT FROM 'recorded_channel' OR NOT public.agent_operation_authorised(operation) THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation;
 SELECT * INTO c FROM public.agent_conversations WHERE id=conversation;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId';
 SELECT jsonb_agg(jsonb_build_object('bindingId',x.binding_id,'channel',x.channel,'recipient',jsonb_build_object('kind',x.recipient_kind,'value',x.recipient_value)) ORDER BY x.channel) INTO coverage FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id;
 RETURN jsonb_build_object('effect','invitation','routeId',r.id,'channel',r.channel,'contactId',c.contact_id,'recipient',jsonb_build_object('kind',r.recipient_kind,'value',r.recipient_value),'subject','','body',o.input->>'body','contextDigest',o.input_digest,'requiredSince','1970-01-01T00:00:00.000Z','replyParent',NULL,'conversation',NULL,'coverageRoutes',coverage);
END $$;

-- Name: agent_channel_due_reassessment(uuid, uuid, integer, timestamp with time zone); Type: FUNCTION
CREATE FUNCTION public.agent_channel_due_reassessment(p_thread uuid, p_route uuid, p_policy_revision integer, p_scheduled_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE t public.agent_threads%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id FOR UPDATE;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=t.id;
 IF t.id IS NULL OR r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_policy_revision IS NULL OR p.revision IS DISTINCT FROM p_policy_revision
 OR p_scheduled_at IS NULL OR r.next_allowed_at IS NULL
 OR date_trunc('milliseconds',r.next_allowed_at) IS DISTINCT FROM p_scheduled_at OR r.next_allowed_at>public.agent_business_now()
 OR r.cold_cancelled_at IS NOT NULL OR c.engagement IS DISTINCT FROM 'cold' OR c.phase IS DISTINCT FROM 'active' OR c.driver_kind IS DISTINCT FROM 'agent'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='inbound')
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels peer,jsonb_array_elements(peer.history) m WHERE peer.conversation_id=c.id AND m->>'direction'='inbound')
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.thread_id=t.id AND s.organization_id=t.organization_id AND s.owner_user_id=t.owner_user_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR NOT public.agent_event_eligible(t.id,'channel.due') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('conversationId',c.id,'epoch',c.epoch,'reminderGeneration',c.reminder_generation);
END $$;

-- Name: agent_channel_grant_immutable(); Type: FUNCTION
CREATE FUNCTION public.agent_channel_grant_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN IF NEW.route_ids IS DISTINCT FROM OLD.route_ids THEN RAISE EXCEPTION 'Exact approved routes are immutable';END IF;RETURN NEW;END $$;

-- Name: agent_channel_local_binding(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_local_binding(p_binding uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 RETURN false;
END $$;

-- Name: agent_channel_local_binding_before_execution_context(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_local_binding_before_execution_context(p_binding uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 RETURN false;
END $$;

-- Name: agent_channel_operation_authorised(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_operation_authorised(p_operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE cid uuid;
BEGIN
 IF NOT public.agent_channel_operation_before_company_projection(p_operation) THEN RETURN false;END IF;
 SELECT conversation_id INTO cid FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 RETURN public.agent_company_conversation_permitted(cid);
END $$;

-- Name: agent_channel_operation_before_company_projection(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_operation_before_company_projection(p_operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_operation AND name='linkedin.invitation' AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)) THEN RETURN public.agent_invitation_operation_authorised(p_operation);END IF;
 RETURN public.agent_channel_operation_before_invitations(p_operation);
END $$;

-- Name: agent_channel_operation_before_invitations(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_operation_before_invitations(p_operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
 -- Legacy operations retain their existing strict ordering; a legacy tie
 -- cannot borrow a new context proof. New captured replies must still equal
 -- the exact current protected snapshot at the final admission boundary.
 IF stage='reply' THEN
  IF o.input ? 'replyCausality' THEN
   IF o.input->'replyCausality' IS DISTINCT FROM public.agent_channel_reply_causality(r.id) THEN RETURN false;END IF;
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) outgoing WHERE outgoing->>'direction'='outbound'
   AND (outgoing->>'at')::timestamptz>=(SELECT max((incoming->>'at')::timestamptz) FROM jsonb_array_elements(c.history) incoming WHERE incoming->>'direction'='inbound')) THEN RETURN false;END IF;
 END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.agent_business_now()) AND NOT public.agent_gui_testing_send_window_exempt(r.id) THEN RETURN false;END IF;
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
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>public.agent_business_now() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
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
END $_$;

-- Name: agent_channel_outbound_consumed_turn(uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_channel_outbound_consumed_turn(p_conversation uuid, p_message jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;o public.agent_operations%ROWTYPE;
 proof jsonb;consumed jsonb;at_time timestamptz;candidate_operations uuid[];parent jsonb;peer jsonb;coverage jsonb;original_proof jsonb;parent_message jsonb;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current causal scope required';END IF;
 SELECT * INTO c FROM public.agent_conversations WHERE id=p_conversation AND organization_id=org AND owner_user_id=actor;
 IF c.id IS NULL OR jsonb_typeof(p_message) IS DISTINCT FROM 'object' OR p_message->>'direction' IS DISTINCT FROM 'outbound'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=p_message) THEN RETURN NULL;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=p_message->>'routeId' AND conversation_id=c.id AND thread_id=c.thread_id AND organization_id=org AND owner_user_id=actor;
 IF r.id IS NULL OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id)
 OR p_message->>'channel' IS DISTINCT FROM r.channel OR p_message->>'bindingDigest' IS DISTINCT FROM r.binding_digest
 OR coalesce(p_message->>'providerMessageId','')='' OR r.channel<>'email' AND coalesce(p_message->>'providerConversationId','')=''
 OR p_message->>'id' IS DISTINCT FROM 'channel-message:'||encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(r.binding_digest,p_message->>'providerMessageId')),'UTF8')),'hex')
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) x WHERE x=p_message) THEN RETURN NULL;END IF;
 at_time:=(p_message->>'at')::timestamptz;
 IF at_time IS NULL OR at_time>public.agent_business_now() THEN RETURN NULL;END IF;
 -- The immutable authenticated receipt, its private original permit, the exact
 -- operation result and settled authority/four budgets must all agree.
 SELECT array_agg(op.id) INTO candidate_operations FROM public.agent_operations op
 JOIN public.communication_submission_receipts receipt ON receipt.source_kind='agent' AND receipt.source_id=op.id
 JOIN public.communication_dispatch_intents i ON i.id=receipt.intent_id
 JOIN public.communication_dispatch_permits permit ON permit.intent_id=i.id
 JOIN public.agent_authority_uses a ON a.operation_id=op.id
 WHERE op.conversation_id=c.id AND op.thread_id=c.thread_id AND op.mandate_id=c.mandate_id AND op.organization_id=org AND op.owner_user_id=actor
 AND op.name IN(r.channel||'.initial',r.channel||'.reply',r.channel||'.follow_up') AND op.input->>'kind'=split_part(op.name,'.',2)||'_'||r.channel
 AND op.input->>'routeId'=r.id::text AND op.input->>'bindingDigest'=r.binding_digest AND op.input->>'identityRevision'=r.identity_revision
 AND op.input->>'recipientKey'=r.channel||':'||r.recipient_value
 AND op.input_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('name',op.name,'input',op.input)),'UTF8')),'hex')
 AND op.state='complete' AND op.result->'delivery'->>'status'='submitted'
 AND op.result->'delivery'->>'providerMessageId'=p_message->>'providerMessageId' AND (op.result->'delivery'->>'submittedAt')::timestamptz=at_time AND op.result->'delivery'->>'intentId'=i.id::text
 AND receipt.organization_id=org AND receipt.owner_user_id=actor AND receipt.binding_id=r.binding_id AND receipt.operation='message'
 AND receipt.provider_reference=p_message->>'providerMessageId' AND ((r.channel='email' AND NOT(p_message ? 'providerConversationId')) OR (coalesce(p_message->>'providerConversationId','')<>'' AND receipt.provider_conversation_reference=p_message->>'providerConversationId')) AND receipt.submitted_at=at_time
 AND receipt.origin_status='sealed' AND receipt.origin_conversation_id=c.id AND receipt.origin_mandate_id=c.mandate_id
 AND i.organization_id=org AND i.owner_user_id=actor AND i.binding_id=r.binding_id AND i.contact_id=c.contact_id AND i.source_kind='agent' AND i.source_id=op.id AND i.operation='message'
 AND receipt.operation_key=i.operation_key AND receipt.payload_digest=i.payload_digest AND receipt.source_digest=i.source_digest AND receipt.original_intent_digest=i.intent_digest
 AND NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions x WHERE x.intent_id=i.id)
 AND a.organization_id=org AND a.owner_user_id=actor AND a.conversation_id=c.id AND a.thread_id=c.thread_id AND a.mandate_id=c.mandate_id AND a.context_revision=op.input->>'contextRevision' AND a.state='settled'
 AND a.operation_revision=op.revision AND a.operation_fence=op.fence AND a.operation_digest=op.input_digest AND a.binding_digest=r.binding_digest AND a.outcome=op.result->'delivery'
 AND (SELECT count(DISTINCT account.scope_key) FROM public.agent_budget_reservations reservation JOIN public.agent_budget_accounts account ON account.id=reservation.account_id AND account.organization_id=reservation.organization_id
 WHERE reservation.operation_id=op.id AND reservation.organization_id=org AND reservation.owner_user_id=actor AND reservation.state='settled' AND reservation.actual=1 AND reservation.amount=1 AND account.unit='sends'
 AND account.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']))=4;
 IF coalesce(cardinality(candidate_operations),0)<>1 THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=candidate_operations[1];
 IF o.name NOT IN(r.channel||'.initial',r.channel||'.reply') THEN RETURN NULL;END IF;
 IF o.name=r.channel||'.reply' THEN
 proof:=o.input->'replyCausality';consumed:=proof->'consumedInboundHistoryIds';
 IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(proof))<>6 OR proof->'version' IS DISTINCT FROM '1'::jsonb
 OR proof->>'historyRevision' IS DISTINCT FROM o.input->>'historyRevision' OR proof->>'routeHistoryRevision' IS DISTINCT FROM o.input->>'routeHistoryRevision'
 OR jsonb_typeof(consumed) IS DISTINCT FROM 'array' OR jsonb_array_length(consumed) NOT BETWEEN 1 AND 200
 OR NOT consumed ? (proof->>'answeredInboundHistoryId') OR (proof->>'inboundAt')::timestamptz>at_time
 OR consumed IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY v COLLATE "C") FROM(SELECT DISTINCT jsonb_array_elements_text(consumed) v)s)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(consumed) x WHERE jsonb_typeof(x)<>'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'id'=x#>>'{}' AND m->>'direction'='inbound' AND (m->>'at')::timestamptz=(proof->>'inboundAt')::timestamptz)) THEN RETURN NULL;END IF;
 -- The original insertion trigger authenticated the complete snapshot; this
 -- read must still find its exact selected route parent, never a hash fallback.
 SELECT value INTO parent_message FROM jsonb_array_elements(r.history) WHERE value->>'id'=proof->>'answeredInboundHistoryId' AND value->>'direction'='inbound' AND (value->>'at')::timestamptz=(proof->>'inboundAt')::timestamptz;
 IF parent_message IS NULL THEN RETURN NULL;END IF;
 IF r.channel='email' THEN parent:=jsonb_build_object('id',coalesce(parent_message->>'providerMessageId',parent_message->>'id'),'contentDigest',encode(sha256(convert_to(coalesce(parent_message->>'subject','')||E'\n'||(parent_message->>'text'),'UTF8')),'hex'));
 ELSE IF coalesce(parent_message->>'providerConversationId','')='' THEN RETURN NULL;END IF;peer:=jsonb_build_object('id',parent_message->>'providerConversationId');END IF;
 ELSE consumed:='[]'::jsonb;END IF;
 SELECT jsonb_agg(jsonb_build_object('bindingId',x.binding_id,'channel',x.channel,'recipient',jsonb_build_object('kind',x.recipient_kind,'value',x.recipient_value)) ORDER BY x.channel) INTO coverage FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id;
 original_proof:=jsonb_build_object('routeId',r.id,'channel',r.channel,'contactId',c.contact_id,'recipient',jsonb_build_object('kind',r.recipient_kind,'value',r.recipient_value),'subject',o.input->>'subject','body',o.input->>'body','contextDigest',o.input_digest,'requiredSince','1970-01-01T00:00:00.000Z','replyParent',parent,'conversation',peer,'coverageRoutes',coverage);
 IF NOT EXISTS(SELECT 1 FROM public.communication_submission_receipts receipt WHERE receipt.intent_id::text=o.result->'delivery'->>'intentId' AND receipt.source_id=o.id
 AND receipt.source_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('source',jsonb_build_object('kind','agent','operationId',o.id,'conversationId',c.id,'epoch',(o.input->>'epoch')::bigint,'fence',o.fence::text),'proof',original_proof)),'UTF8')),'hex')) THEN RETURN NULL;END IF;
 RETURN consumed;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;

-- Name: agent_channel_proposal_before_execution_context(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_channel_proposal_before_execution_context(p_route uuid, p_stage text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE last_out timestamptz;delay integer;c public.agent_conversations%ROWTYPE;
BEGIN
 IF NOT public.agent_channel_proposal_permitted_before_history_quiet(p_route,p_stage) THEN RETURN false;END IF;
 SELECT person.* INTO c FROM public.agent_conversations person JOIN public.agent_conversation_channels r ON r.conversation_id=person.id WHERE r.id=p_route;
 IF c.engagement='cold' AND p_stage IN('initial','follow_up','invitation') THEN
  SELECT max((m->>'at')::timestamptz) INTO last_out FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='outbound';
  SELECT delay_seconds INTO delay FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
  IF last_out IS NOT NULL AND (delay IS NULL OR last_out+make_interval(secs=>delay)>public.agent_business_now()) THEN RETURN false;END IF;
 END IF;RETURN true;
END $$;

-- Name: agent_channel_proposal_before_invitations(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_channel_proposal_before_invitations(p_route uuid, p_stage text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;latest_in jsonb;latest_out jsonb;reply_candidate jsonb;person_out jsonb;last_sent record;next_index integer;source_revision text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel proposal scope required';END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=r.thread_id;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_stage IS NULL OR p_stage NOT IN('initial','reply','follow_up') OR c.phase<>'active' OR c.driver_kind<>'agent' OR c.engagement IN('handoff','stopped') OR NOT c.history_complete OR c.history_source<>'communications' THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities WHERE id=c.responsibility_id AND state IN('ready','waiting')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'bindingId'=r.binding_id::text AND x->>'channel'=r.channel AND x->>'bindingDigest'=r.binding_digest) OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND (NOT x.history_complete OR x.history_observed_at IS NULL OR x.history_observed_at>public.agent_business_now() OR x.history_observed_at<public.agent_business_now()-interval '5 minutes')) OR (SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id)<>cardinality(p.channel_order) THEN RETURN false;END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=c.contact_id AND organization_id=c.organization_id AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false';
 IF source_revision IS NULL OR r.identity_source->>'revision' IS DISTINCT FROM source_revision THEN RETURN false;END IF;
 IF p.accelerated_simulation AND (NOT public.agent_channel_local_binding(r.binding_id) OR NOT public.agent_channel_reserved_recipient(r.channel,r.recipient_value)) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 SELECT value INTO latest_out FROM jsonb_array_elements(r.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND p_stage='reply' THEN
  -- Shared original-causality kernel also drives protected context and admission.
  RETURN public.agent_channel_reply_causality(p_route) IS NOT NULL;
 END IF;
 IF latest_in IS NOT NULL THEN
  -- Cold introductions stay cancelled. Warm continuity follows the latest
  -- actual person answer, not the hash order of simultaneous incoming IDs.
  IF p_stage<>'follow_up' THEN RETURN false;END IF;
  SELECT value INTO person_out FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF person_out IS NULL OR (person_out->>'at')::timestamptz<=(latest_in->>'at')::timestamptz
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) x WHERE x=person_out)
   OR (CASE WHEN person_out->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(person_out->>'channel','email')<>'email' ELSE person_out->>'routeId' IS DISTINCT FROM r.id::text OR person_out->>'channel' IS DISTINCT FROM r.channel OR person_out->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  -- Equal-time answers on multiple routes are ambiguous; never pick by hash.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='outbound' AND (x->>'at')::timestamptz=(person_out->>'at')::timestamptz
   AND (CASE WHEN x->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(x->>'channel','email')<>'email' ELSE x->>'routeId' IS DISTINCT FROM r.id::text OR x->>'channel' IS DISTINCT FROM r.channel OR x->>'bindingDigest' IS DISTINCT FROM r.binding_digest END)) THEN RETURN false;END IF;
  SELECT value INTO reply_candidate FROM jsonb_array_elements(r.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=(latest_in->>'at')::timestamptz ORDER BY value->>'id' DESC LIMIT 1;
  IF reply_candidate IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=reply_candidate)
   OR (CASE WHEN reply_candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(reply_candidate->>'channel','email')<>'email' ELSE reply_candidate->>'routeId' IS DISTINCT FROM r.id::text OR reply_candidate->>'channel' IS DISTINCT FROM r.channel OR reply_candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  RETURN r.next_allowed_at IS NOT NULL AND r.next_allowed_at<=public.agent_business_now();
 END IF;
 IF r.cold_cancelled_at IS NOT NULL OR c.engagement<>'cold' OR p_stage='reply' OR r.next_allowed_at IS NULL OR r.next_allowed_at>public.agent_business_now() THEN RETURN false;END IF;
 SELECT o.input->>'routeId' AS route_id,public.agent_operation_business_anchor(o) AS updated_at INTO last_sent FROM public.agent_operations o WHERE o.conversation_id=c.id AND o.state='complete' AND o.result->'delivery'->>'status'='submitted' ORDER BY CASE WHEN nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN o.updated_at ELSE public.agent_operation_business_anchor(o) END DESC,o.id DESC LIMIT 1;
 IF last_sent.route_id IS NULL THEN next_index:=1;
 ELSE SELECT coalesce(array_position(p.channel_order,x.channel),0)%cardinality(p.channel_order)+1 INTO next_index FROM public.agent_conversation_channels x WHERE x.id::text=last_sent.route_id AND x.conversation_id=c.id;
  IF next_index IS NULL OR public.agent_business_now()<last_sent.updated_at+make_interval(secs=>p.delay_seconds) THEN RETURN false;END IF;
 END IF;
 IF p.channel_order[next_index]<>r.channel THEN RETURN false;END IF;
 RETURN CASE p_stage WHEN 'initial' THEN latest_out IS NULL WHEN 'follow_up' THEN latest_out IS NOT NULL ELSE false END;
END $$;

-- Name: agent_channel_proposal_permitted(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_channel_proposal_permitted(p_route uuid, p_stage text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF NOT public.agent_route_execution_permitted(p_route) THEN RETURN false;END IF;
 RETURN public.agent_channel_proposal_before_execution_context(p_route,p_stage);
END $$;

-- Name: agent_channel_proposal_permitted_before_history_quiet(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_channel_proposal_permitted_before_history_quiet(p_route uuid, p_stage text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;relationship public.agent_linkedin_relationships%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF r.id IS NULL THEN RETURN false;END IF;
 IF r.channel<>'linkedin' THEN RETURN public.agent_channel_proposal_before_invitations(p_route,p_stage);END IF;
 SELECT * INTO relationship FROM public.agent_linkedin_relationships WHERE route_id=r.id AND binding_digest=r.binding_digest AND identity_revision=r.identity_revision;
 IF relationship.route_id IS NULL OR relationship.observed_at>public.agent_business_now() OR relationship.observed_at<public.agent_business_now()-interval '5 minutes' THEN RETURN false;END IF;
 IF p_stage='invitation' THEN
  IF relationship.status<>'not_connected' OR relationship.can_message IS TRUE OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations WHERE route_id=r.id AND state IN('unknown','pending','accepted')) OR EXISTS(SELECT 1 FROM public.agent_operations WHERE conversation_id=r.conversation_id AND name='linkedin.invitation' AND state IN('running','uncertain','complete')) THEN RETURN false;END IF;
  RETURN public.agent_channel_proposal_before_invitations(p_route,'initial');
 END IF;
 IF relationship.status<>'connected' OR relationship.can_message IS DISTINCT FROM true THEN RETURN false;END IF;
 RETURN public.agent_channel_proposal_before_invitations(p_route,p_stage);
END $$;

-- Name: agent_channel_record_submission(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_record_submission(p_operation uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;anchor timestamptz;due timestamptz;next_channel text;latest_in timestamptz;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND binding_digest=o.input->>'bindingDigest';
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF o.id IS NULL OR r.id IS NULL OR p.thread_id IS NULL OR o.state<>'complete' OR o.result->'delivery'->>'status' IS DISTINCT FROM 'submitted' OR NOT EXISTS(SELECT 1 FROM public.agent_authority_uses a WHERE a.operation_id=o.id AND a.state='settled' AND a.binding_digest=r.binding_digest) OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits v ON v.intent_id=i.id WHERE i.source_kind='agent' AND i.source_id=o.id AND i.binding_id=r.binding_id AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id) THEN RAISE EXCEPTION 'Positive original admitted routed receipt required';END IF;
 anchor:=public.agent_operation_business_anchor(o);IF anchor IS NULL OR anchor>public.agent_business_now() THEN RAISE EXCEPTION 'Original submitted timestamp required';END IF;
 due:=anchor+make_interval(secs=>p.delay_seconds);
 SELECT max((value->>'at')::timestamptz) INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound';
 IF latest_in IS NULL AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels WHERE conversation_id=c.id AND cold_cancelled_at IS NOT NULL) THEN
  next_channel:=p.channel_order[array_position(p.channel_order,r.channel)%cardinality(p.channel_order)+1];
  UPDATE public.agent_conversation_channels SET next_allowed_at=CASE WHEN channel=next_channel THEN due ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id;
 ELSE
  UPDATE public.agent_conversation_channels SET next_allowed_at=CASE WHEN id=r.id THEN due ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id;
 END IF;RETURN due;
END $$;

-- Name: agent_channel_reply_causality(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_reply_causality(p_route uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;m jsonb;outbound jsonb;ids jsonb;consumed jsonb:='[]';turn jsonb;candidate jsonb;latest timestamptz;candidate_count integer;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current causal scope required';END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF r.id IS NULL OR c.id IS NULL OR c.history_source<>'communications' OR NOT c.history_complete OR NOT r.history_complete
 OR c.history_observed_at IS NULL OR c.history_observed_at NOT BETWEEN public.agent_business_now()-interval '5 minutes' AND public.agent_business_now()
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND (NOT x.history_complete OR x.history_observed_at IS NULL OR x.history_observed_at NOT BETWEEN public.agent_business_now()-interval '5 minutes' AND public.agent_business_now())) THEN RETURN NULL;END IF;
 SELECT max((x->>'at')::timestamptz) INTO latest FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='inbound';
 IF latest IS NULL OR latest>public.agent_business_now() OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='outbound' AND (x->>'at')::timestamptz>latest) THEN RETURN NULL;END IF;
 SELECT jsonb_agg(x->>'id' ORDER BY (x->>'id') COLLATE "C") INTO turn FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='inbound' AND (x->>'at')::timestamptz=latest;
 -- Every member of the turn must retain its exact original verified route.
 FOR m IN SELECT value FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=latest LOOP
  IF NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND x.thread_id=c.thread_id AND x.organization_id=org AND x.owner_user_id=actor
   AND x.binding_digest=public.agent_recorded_binding_digest(x.binding_id)
   AND (CASE WHEN m->>'routeId' IS NULL THEN x.channel='email' AND x.binding_id=c.binding_id AND coalesce(m->>'channel','email')='email' ELSE m->>'routeId'=x.id::text AND m->>'channel'=x.channel AND m->>'bindingDigest'=x.binding_digest END)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(x.history) h WHERE h=m)) THEN RETURN NULL;END IF;
 END LOOP;
 FOR outbound IN SELECT value FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' AND (value->>'at')::timestamptz=latest LOOP
  ids:=public.agent_channel_outbound_consumed_turn(c.id,outbound);
  IF ids IS NULL THEN RETURN NULL;END IF;
  consumed:=consumed||ids;
 END LOOP;
 SELECT count(*) INTO candidate_count FROM jsonb_array_elements(r.history) x WHERE x->>'direction'='inbound' AND (x->>'at')::timestamptz=latest AND NOT consumed ? (x->>'id') AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) h WHERE h=x);
 IF candidate_count<>1 THEN RETURN NULL;END IF;
 SELECT value INTO candidate FROM jsonb_array_elements(r.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=latest AND NOT consumed ? (value->>'id') AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) h WHERE h=value);
 IF (CASE WHEN candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(candidate->>'channel','email')<>'email' ELSE candidate->>'routeId' IS DISTINCT FROM r.id::text OR candidate->>'channel' IS DISTINCT FROM r.channel OR candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'answeredInboundHistoryId',candidate->>'id','consumedInboundHistoryIds',turn,'historyRevision',c.history_revision,'routeHistoryRevision',r.history_revision,'inboundAt',candidate->>'at');
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END $$;

-- Name: agent_channel_reserved_recipient(text, text); Type: FUNCTION
CREATE FUNCTION public.agent_channel_reserved_recipient(p_channel text, p_value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
 SELECT CASE p_channel WHEN 'email' THEN p_value~'^lead-[0-9]{3}@agent-(multichannel-20261017|real-research-demos|deep-gui-20261020)[.]leads[.]acquire[.]test$'
 WHEN 'whatsapp' THEN p_value~'^[+]999[0-9]{12}$'
 WHEN 'linkedin' THEN p_value~'^https://www[.]linkedin[.]com/in/sim-agent-(multichannel-20261017|real-research-demos|deep-gui-20261020)-lead-[0-9]{3}$' ELSE false END;
$_$;

-- Name: agent_channel_source_before_invitations(uuid, uuid, bigint, bigint, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_channel_source_before_invitations(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;parent jsonb;peer jsonb;coverage jsonb;latest jsonb;stage text;
BEGIN
 IF public.agent_communications_source_kind(operation,conversation,expected_epoch,expected_fence,binding) IS DISTINCT FROM 'recorded_channel' OR NOT public.agent_operation_authorised(operation) THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation;
 SELECT * INTO c FROM public.agent_conversations WHERE id=conversation;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId';stage:=split_part(o.name,'.',2);
 SELECT jsonb_agg(jsonb_build_object('bindingId',x.binding_id,'channel',x.channel,'recipient',jsonb_build_object('kind',x.recipient_kind,'value',x.recipient_value)) ORDER BY x.channel) INTO coverage FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id;
 IF stage<>'initial' THEN
  IF stage='reply' AND o.input ? 'replyCausality' THEN
   SELECT value INTO latest FROM jsonb_array_elements(r.history) WHERE value->>'id'=o.input->'replyCausality'->>'answeredInboundHistoryId' AND value->>'direction'='inbound';
  ELSE
  SELECT value INTO latest FROM jsonb_array_elements(r.history) WHERE coalesce(value->>'providerMessageId',value->>'id') IS NOT NULL ORDER BY (value->>'direction'='inbound') DESC,(value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  END IF;
  IF latest IS NULL THEN RETURN NULL;END IF;
  IF r.channel='email' THEN parent:=jsonb_build_object('id',coalesce(latest->>'providerMessageId',latest->>'id'),'contentDigest',encode(sha256(convert_to(coalesce(latest->>'subject','')||E'\n'||(latest->>'text'),'UTF8')),'hex'));
  ELSE IF coalesce(latest->>'providerConversationId','')='' THEN RETURN NULL;END IF;peer:=jsonb_build_object('id',latest->>'providerConversationId');END IF;
 ELSIF jsonb_array_length(r.history)>0 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('routeId',r.id,'channel',r.channel,'contactId',c.contact_id,'recipient',jsonb_build_object('kind',r.recipient_kind,'value',r.recipient_value),'subject',o.input->>'subject','body',o.input->>'body','contextDigest',o.input_digest,'requiredSince','1970-01-01T00:00:00.000Z','replyParent',parent,'conversation',peer,'coverageRoutes',coverage);
END $$;

-- Name: agent_communications_bounce(uuid, text, text, text, text, text, timestamp with time zone, text); Type: FUNCTION
CREATE FUNCTION public.agent_communications_bounce(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_recipient text, p_message text, p_occurred timestamp with time zone, p_receipt_preimage text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);candidate record;conv public.agent_conversations%ROWTYPE;bounce_key text;notice jsonb;payload jsonb;affected integer:=0;frame jsonb;recorded public.communication_bindings%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current delivery-failure scope required'; END IF;
 IF p_event IS NULL OR p_receipt_fingerprint IS NULL OR p_change_fingerprint IS NULL OR p_receipt_fingerprint IS DISTINCT FROM p_change_fingerprint OR p_recipient IS NULL OR p_message IS NULL OR length(p_event) NOT BETWEEN 1 AND 200 OR p_receipt_fingerprint!~'^[a-f0-9]{64}$' OR p_change_fingerprint!~'^[a-f0-9]{64}$' OR p_recipient IS DISTINCT FROM lower(btrim(p_recipient)) OR p_recipient!~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' OR length(p_message) NOT BETWEEN 1 AND 2048 OR p_occurred IS NULL OR p_occurred>public.agent_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Verified delivery-failure metadata required'; END IF;
 SELECT * INTO recorded FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service';
 IF recorded.id IS NULL THEN RAISE EXCEPTION 'Original owned email account required'; END IF;
 IF p_receipt_preimage IS NULL OR octet_length(p_receipt_preimage)>12000 OR encode(sha256(convert_to(p_receipt_preimage,'UTF8')),'hex') IS DISTINCT FROM p_receipt_fingerprint THEN RAISE EXCEPTION 'Original delivery-failure receipt preimage required'; END IF;
 frame:=p_receipt_preimage::jsonb;
 IF jsonb_typeof(frame) IS DISTINCT FROM 'array' OR jsonb_array_length(frame)<>8 OR frame->>0 IS DISTINCT FROM 'acquire.reply.delivery.v1' OR frame->1 IS DISTINCT FROM jsonb_build_array(recorded.application_id,recorded.organization_id,recorded.owner_user_id,recorded.service_connection_id,recorded.service_account_id,recorded.generation,recorded.channel,recorded.platform,recorded.backend) OR frame->>2 IS DISTINCT FROM p_binding::text OR frame->>3 IS DISTINCT FROM p_event OR COALESCE(frame->>4,'') !~ '^[a-f0-9]{64}$' OR COALESCE(frame->>5,'') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(frame->7) IS DISTINCT FROM 'array' OR jsonb_array_length(frame->7)<>5 OR frame->7->>0 IS DISTINCT FROM 'bounce' OR frame->7->>1 IS DISTINCT FROM p_message OR frame->7->>2 IS DISTINCT FROM 'email' OR frame->7->>3 IS DISTINCT FROM p_recipient OR (frame->7->>4)::timestamptz IS DISTINCT FROM p_occurred OR jsonb_typeof(frame->6) IS DISTINCT FROM 'string' OR (frame->>6)::timestamptz< p_occurred OR (frame->>6)::timestamptz>public.agent_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Original delivery-failure metadata differs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_event_receipts r WHERE r.binding_id=p_binding AND r.service_event_id=p_event AND r.organization_id=org AND r.owner_user_id=actor AND r.event_type='email_change' AND r.payload_fingerprint=p_receipt_fingerprint AND r.occurred_at=p_occurred) THEN RAISE EXCEPTION 'Original delivery-failure receipt required'; END IF;
 IF (SELECT count(*) FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_recipient)>100 THEN RAISE EXCEPTION 'Delivery-failure conversation bound exceeded'; END IF;
 FOR candidate IN SELECT id,thread_id FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_recipient ORDER BY thread_id,id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.id FOR UPDATE;
  bounce_key:='email-bounce:'||encode(sha256(convert_to(jsonb_build_array(p_binding,p_event,p_change_fingerprint,conv.id)::text,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=conv.thread_id AND e.event_key=bounce_key) THEN CONTINUE; END IF;
  -- Preserve real provider submission receipts/reservations: bounced does not
  -- mean not submitted and never authorises a retry or releases paid sends.
  UPDATE public.agent_conversations SET history_complete=false,engagement='stopped',phase=CASE WHEN phase='complete' THEN phase ELSE 'held' END,pause_reason='delivery_failure',pending_driver=NULL,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','delivery_failure'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND thread_id=conv.thread_id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
  UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=conv.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=(item->>'operationId') WHERE o.conversation_id=conv.id AND o.thread_id=conv.thread_id AND o.result->>'reason'='delivery_failure');
  UPDATE public.agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE thread_id=conv.thread_id AND revoked_at IS NULL AND recipient_keys ? ('email:'||conv.recipient_email);
  UPDATE public.agent_handoffs h SET revision=revision+1,updated_at=clock_timestamp() WHERE h.conversation_id=conv.id AND h.state IN('pending','acknowledged','link_sent') AND EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=org AND m.user_id=h.assignee_user_id);
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,bounce_key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text','The email provider reported a delivery failure. Outreach to this address is stopped. Review the recipient and original account; no follow-up or replacement send was created.','details',jsonb_build_object('conversationId',conv.id,'bindingId',p_binding,'serviceEventId',p_event,'providerMessageId',p_message,'occurredAt',p_occurred,'deliveryFailure',true));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,bounce_key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.delivery_failure','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',p_event,'providerMessageId',p_message));
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $_$;

-- Name: agent_communications_change(uuid, text, text, text, text, text, timestamp with time zone, boolean); Type: FUNCTION
CREATE FUNCTION public.agent_communications_change(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_sender text, p_message text, p_occurred timestamp with time zone, p_review boolean) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);candidate record;conv public.agent_conversations%ROWTYPE;incoming_key text;base_key text;notice jsonb;payload jsonb;affected integer:=0;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current incoming-message scope required'; END IF;
 IF p_event IS NULL OR p_receipt_fingerprint IS NULL OR p_change_fingerprint IS NULL OR p_sender IS NULL OR p_message IS NULL OR length(p_event) NOT BETWEEN 1 AND 200 OR p_receipt_fingerprint!~'^[a-f0-9]{64}$' OR p_change_fingerprint!~'^[a-f0-9]{64}$' OR p_sender IS DISTINCT FROM lower(btrim(p_sender)) OR p_sender!~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' OR length(p_message) NOT BETWEEN 1 AND 2048 OR p_occurred IS NULL OR p_occurred>public.agent_business_now()+interval '1 minute' OR p_review IS NULL THEN RAISE EXCEPTION 'Verified incoming metadata required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service') THEN RAISE EXCEPTION 'Original owned email account required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_event_receipts r WHERE r.binding_id=p_binding AND r.service_event_id=p_event AND r.organization_id=org AND r.owner_user_id=actor AND r.event_type='message' AND r.payload_fingerprint=p_receipt_fingerprint) OR (p_receipt_fingerprint<>p_change_fingerprint AND NOT p_review) THEN RAISE EXCEPTION 'Committed-in-this-transaction application receipt required'; END IF;
 base_key:='incoming-email:'||encode(sha256(convert_to(jsonb_build_array(p_binding,p_event,p_change_fingerprint)::text,'UTF8')),'hex');
 IF (SELECT count(*) FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_sender AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id))>100 THEN RAISE EXCEPTION 'Incoming conversation bound exceeded'; END IF;
 FOR candidate IN SELECT id,thread_id FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_sender AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id) ORDER BY thread_id,id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.id FOR UPDATE;
  incoming_key:=base_key||':'||conv.id::text;
  -- Preserve replay of an already-processed0022 event only for the exact
  -- conversation in its saved payload. A retired row cannot swallow another.
  IF EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=conv.thread_id AND (e.event_key=incoming_key OR e.event_key=base_key AND e.payload->>'conversationId'=conv.id::text)) THEN CONTINUE; END IF;
  -- Never fabricate a body or certify complete history from webhook metadata.
  UPDATE public.agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,
   phase=CASE WHEN p_review AND driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,
   pause_reason=CASE WHEN driver_kind<>'agent' OR phase<>'active' THEN pause_reason WHEN p_review THEN 'incoming_email_review_required' ELSE 'provider_history_changed' END,updated_at=clock_timestamp()
  WHERE id=conv.id;
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND thread_id=conv.thread_id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
  UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=conv.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=(item->>'operationId') WHERE o.conversation_id=conv.id AND o.thread_id=conv.thread_id AND o.name IN('email.initial','email.reply','email.follow_up') AND o.state='failed' AND o.result->>'reason'='context_changed');
  -- Source/context is immutable; bump only the task revision. Conversation epoch
  -- also invalidates every older handoff context token, including retired assignees.
  UPDATE public.agent_handoffs h SET revision=revision+1,updated_at=clock_timestamp() WHERE h.conversation_id=conv.id AND h.state IN('pending','acknowledged','link_sent') AND EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=org AND m.user_id=h.assignee_user_id);
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
  VALUES(conv.thread_id,org,conv.mandate_id,actor,incoming_key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text',CASE WHEN p_review THEN 'A new email needs human review. Automation remains paused.' WHEN conv.phase='complete' THEN 'A new email arrived on a stopped conversation. Automation remains stopped.' WHEN conv.driver_kind<>'agent' OR conv.phase<>'active' THEN 'A new email arrived for a conversation you are handling. Automation remains paused.' ELSE 'A new email arrived. I am checking the full conversation before deciding what to do next.' END,'details',jsonb_build_object('conversationId',conv.id,'serviceEventId',p_event,'providerMessageId',p_message,'occurredAt',p_occurred,'reviewRequired',p_review));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
  VALUES(conv.thread_id,org,conv.mandate_id,actor,incoming_key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.incoming_email','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',p_event,'reviewRequired',p_review));
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $_$;

-- Name: agent_communications_intent_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_communications_intent_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;proof jsonb;kind text;
BEGIN
 IF NEW.source_kind<>'agent' THEN RETURN NEW;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=NEW.source_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Current native source required';END IF;
 kind:=public.agent_communications_source_kind(o.id,o.conversation_id,(o.input->>'epoch')::bigint,o.fence,NEW.binding_id);
 IF kind='recorded_channel' THEN proof:=public.agent_channel_communications_source(o.id,o.conversation_id,(o.input->>'epoch')::bigint,o.fence,NEW.binding_id);
 ELSIF kind='legacy_email' THEN proof:=public.agent_communications_source(o.id,o.conversation_id,(o.input->>'epoch')::bigint,o.fence,NEW.binding_id);END IF;
 IF proof IS NULL OR proof->>'contactId' IS DISTINCT FROM NEW.contact_id::text OR NEW.operation IS DISTINCT FROM (CASE WHEN proof->>'effect'='invitation' AND o.name='linkedin.invitation' THEN 'invitation' ELSE 'message' END) THEN RAISE EXCEPTION 'Current native source required';END IF;RETURN NEW;
END $$;

-- Name: agent_communications_no_submission(uuid, uuid, text, uuid, uuid, uuid, bigint); Type: FUNCTION
CREATE FUNCTION public.agent_communications_no_submission(operation uuid, intent uuid DEFAULT NULL::uuid, expected_proof_digest text DEFAULT NULL::text, current_run uuid DEFAULT NULL::uuid, current_event uuid DEFAULT NULL::uuid, current_lease_owner uuid DEFAULT NULL::uuid, current_fence bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.agent_operations WHERE id=operation AND name='linkedin.invitation' AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)) THEN RETURN public.agent_invitation_no_submission(operation,intent,expected_proof_digest,current_run,current_event,current_lease_owner,current_fence);END IF;
 RETURN public.agent_no_submission_before_invitations(operation,intent,expected_proof_digest,current_run,current_event,current_lease_owner,current_fence);
END $$;

-- Name: agent_communications_no_submission_before_channels(uuid, uuid, text, uuid, uuid, uuid, bigint); Type: FUNCTION
CREATE FUNCTION public.agent_communications_no_submission_before_channels(operation uuid, intent uuid DEFAULT NULL::uuid, expected_proof_digest text DEFAULT NULL::text, current_run uuid DEFAULT NULL::uuid, current_event uuid DEFAULT NULL::uuid, current_lease_owner uuid DEFAULT NULL::uuid, current_fence bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;original public.communication_dispatch_intents%ROWTYPE;reservation record;evidence jsonb;content jsonb;message_key text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up') THEN RAISE EXCEPTION 'Owned original email operation required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id FOR UPDATE;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF conv.id IS NULL OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Original communications conversation required'; END IF;
 IF intent IS NOT NULL THEN
  IF expected_proof_digest IS NULL OR expected_proof_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Authenticated original disposition required'; END IF;
  SELECT * INTO original FROM public.communication_dispatch_intents WHERE id=intent AND organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id AND binding_id=conv.binding_id;
  IF (SELECT count(*) FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)<>1 OR original.id IS NULL OR original.contact_id<>conv.contact_id OR original.operation<>'message' OR NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=intent AND proof_digest=expected_proof_digest) THEN RAISE EXCEPTION 'Recorded original disposition required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','intentId',intent,'proofDigest',expected_proof_digest,'operationKey',original.operation_key);
 ELSE
  IF current_setting('role',true)='acquire_agent_user' AND expected_proof_digest IS NULL AND op.state='failed' AND op.result->'delivery'=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent') THEN RETURN op.result->'delivery'; END IF;
  IF current_run IS NOT NULL OR current_event IS NOT NULL OR current_lease_owner IS NOT NULL OR current_fence IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.agent_runs r JOIN public.agent_events e ON e.id=r.trigger_event_id WHERE r.id=current_run AND e.id=current_event AND r.thread_id=op.thread_id AND e.thread_id=op.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='running' AND e.state='leased' AND r.lease_owner=current_lease_owner AND e.lease_owner=current_lease_owner AND r.fence=current_fence AND e.fence=current_fence AND r.lease_until>clock_timestamp() AND e.lease_until>clock_timestamp() AND r.created_at+interval '45 seconds'>clock_timestamp() AND e.kind='email.reconcile' AND e.payload->>'operationId'=op.id::text) THEN RAISE EXCEPTION 'Current lookup-only reconcile fence required'; END IF;
  END IF;
  -- Absence of a receipt is never proof. Only an expired original operation
  -- with no committed application intent and no live thread run may close.
  IF current_setting('role',true)<>'acquire_agent_user' OR expected_proof_digest IS NOT NULL OR op.lease_until IS NULL OR op.lease_until>clock_timestamp()
   OR EXISTS(SELECT 1 FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)
   OR EXISTS(SELECT 1 FROM public.agent_runs WHERE thread_id=op.thread_id AND state='running' AND lease_until>clock_timestamp() AND id IS DISTINCT FROM current_run) THEN RAISE EXCEPTION 'Expired unprepared operation proof required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent');
 END IF;
 IF op.state='failed' AND op.result->'delivery'=evidence THEN RETURN evidence; END IF;
 IF op.state NOT IN('running','uncertain') THEN RAISE EXCEPTION 'Original operation cannot be resolved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_authority_uses WHERE operation_id=op.id AND conversation_id=conv.id AND organization_id=org AND owner_user_id=actor AND binding_digest=conv.binding_digest AND state IN('reserved','admitted','uncertain')) THEN RAISE EXCEPTION 'Original authority use required'; END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=op.id)<>3
 OR (SELECT count(DISTINCT a.scope_key) FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id AND r.organization_id=org AND r.owner_user_id=actor AND r.amount=1 AND r.state IN('reserved','uncertain') AND a.organization_id=org AND a.unit='sends' AND a.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||conv.mandate_id::text||':sends']))<>3 THEN RAISE EXCEPTION 'Exact original sending reservations required'; END IF;
 FOR reservation IN SELECT r.*,a.reserved AS account_reserved FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id ORDER BY r.account_id FOR UPDATE OF r,a LOOP
  IF reservation.account_reserved<reservation.amount THEN RAISE EXCEPTION 'Original reservation ledger inconsistent'; END IF;
  UPDATE public.agent_budget_accounts SET reserved=reserved-reservation.amount WHERE id=reservation.account_id;
  UPDATE public.agent_budget_reservations SET state='settled',actual=0,updated_at=clock_timestamp() WHERE id=reservation.id;
 END LOOP;
 UPDATE public.agent_authority_uses SET state='released',outcome=evidence,updated_at=clock_timestamp() WHERE operation_id=op.id AND organization_id=org AND owner_user_id=actor;
 -- Delegated used_sends remains monotonic. A proven no-send releases this
 -- operation, never silently restores or expands a grant's capacity.
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('delivery',evidence),lease_until=NULL,updated_at=clock_timestamp() WHERE id=op.id;
 UPDATE public.agent_conversations SET phase=CASE WHEN driver_kind='agent' THEN 'held' ELSE phase END,history_complete=false,pause_reason=CASE WHEN driver_kind='agent' THEN 'provider_no_submission_confirmed' ELSE pause_reason END,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND id<>op.id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=op.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id=(item->>'operationId')::uuid WHERE o.conversation_id=conv.id);
 content:=jsonb_build_object('text','The original email was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.','operationId',op.id);
 message_key:='no-submission:'||op.id::text;
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(op.thread_id,org,op.mandate_id,actor,message_key,'assistant',content,encode(sha256(convert_to(content::text,'UTF8')),'hex')) ON CONFLICT(thread_id,request_key) DO NOTHING;
 RETURN evidence;
END $_$;

-- Name: agent_communications_receipt_wake(uuid, uuid, text, text, text); Type: FUNCTION
CREATE FUNCTION public.agent_communications_receipt_wake(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;intent public.communication_dispatch_intents%ROWTYPE;wake_key text;payload jsonb;prior public.agent_events%ROWTYPE;route public.agent_conversation_channels%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current receipt-recovery scope required'; END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_payload IS NULL OR p_payload!~'^[a-f0-9]{64}$' OR p_evidence IS NULL OR p_evidence!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Verified original association metadata required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NOT NULL AND NOT(op.input ? 'routeId') THEN RETURN public.agent_communications_receipt_wake_before_channel_routes(p_binding,p_operation,p_key,p_payload,p_evidence);END IF;
 IF op.id IS NULL OR jsonb_typeof(op.input->'routeId') IS DISTINCT FROM 'string' OR (op.input->>'routeId')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Original owned routed native intent required';END IF;
 SELECT * INTO route FROM public.agent_conversation_channels WHERE id=(op.input->>'routeId')::uuid AND conversation_id=op.conversation_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO intent FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=p_operation AND operation_key=p_key AND binding_id=p_binding AND payload_digest=p_payload;
 IF op.id IS NULL OR conv.id IS NULL OR intent.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up') OR conv.delivery_mode<>'communications' OR intent.operation IS DISTINCT FROM 'message' OR intent.contact_id IS DISTINCT FROM conv.contact_id OR route.id IS NULL OR route.channel IS DISTINCT FROM 'email' OR route.binding_id IS DISTINCT FROM p_binding OR route.binding_digest IS DISTINCT FROM op.input->>'bindingDigest' OR route.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(p_binding) OR NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service') THEN RAISE EXCEPTION 'Original owned routed native intent required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 wake_key:='provider-association:'||intent.id::text;
 payload:=jsonb_build_object('operationId',op.id,'intentId',intent.id,'associationEvidenceDigest',p_evidence);
 SELECT * INTO prior FROM public.agent_events WHERE thread_id=op.thread_id AND agent_events.event_key=wake_key;
 IF prior.id IS NOT NULL THEN
  IF prior.kind<>'email.reconcile' OR prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Original association wake changed'; END IF;
  RETURN 0;
 END IF;
 IF op.state NOT IN('running','uncertain') THEN RETURN 0; END IF;
 INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(op.thread_id,org,op.mandate_id,actor,wake_key,'email.reconcile',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 RETURN 1;
END $_$;

-- Name: agent_communications_receipt_wake_before_channel_routes(uuid, uuid, text, text, text); Type: FUNCTION
CREATE FUNCTION public.agent_communications_receipt_wake_before_channel_routes(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;intent public.communication_dispatch_intents%ROWTYPE;wake_key text;payload jsonb;prior public.agent_events%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current receipt-recovery scope required'; END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_payload IS NULL OR p_payload!~'^[a-f0-9]{64}$' OR p_evidence IS NULL OR p_evidence!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Verified original association metadata required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO intent FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=p_operation AND operation_key=p_key AND binding_id=p_binding AND payload_digest=p_payload;
 IF op.id IS NULL OR conv.id IS NULL OR intent.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up') OR conv.delivery_mode<>'communications' OR conv.binding_id IS DISTINCT FROM p_binding OR NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service') THEN RAISE EXCEPTION 'Original owned native intent required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 wake_key:='provider-association:'||intent.id::text;
 payload:=jsonb_build_object('operationId',op.id,'intentId',intent.id,'associationEvidenceDigest',p_evidence);
 SELECT * INTO prior FROM public.agent_events WHERE thread_id=op.thread_id AND agent_events.event_key=wake_key;
 IF prior.id IS NOT NULL THEN
  IF prior.kind<>'email.reconcile' OR prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Original association wake changed'; END IF;
  RETURN 0;
 END IF;
 IF op.state NOT IN('running','uncertain') THEN RETURN 0; END IF;
 INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(op.thread_id,org,op.mandate_id,actor,wake_key,'email.reconcile',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 RETURN 1;
END $_$;

-- Name: agent_communications_source(uuid, uuid, bigint, bigint, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE proof jsonb;op public.agent_operations%ROWTYPE;parent jsonb;
BEGIN
 proof:=public.agent_communications_source_before_reply_parent(operation,conversation,expected_epoch,expected_fence,binding);
 IF proof IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT op FROM public.agent_operations WHERE id=operation;
 IF op.name='email.initial' THEN RETURN proof||jsonb_build_object('replyParent',NULL); END IF;
 SELECT public.agent_email_reply_parent(c.history) INTO parent FROM public.agent_conversations c WHERE c.id=conversation;
 IF parent IS NULL THEN RETURN NULL; END IF;
 RETURN proof||jsonb_build_object('replyParent',parent);
END $$;

-- Name: agent_communications_source_before_reply_parent(uuid, uuid, bigint, bigint, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_communications_source_before_reply_parent(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user'
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=conversation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR conv.id IS NULL OR op.conversation_id<>conv.id OR op.fence<>expected_fence OR conv.epoch<>expected_epoch
 OR op.name NOT IN('email.initial','email.reply','email.follow_up') OR conv.delivery_mode<>'communications' OR conv.history_source<>'communications'
 OR conv.binding_id IS DISTINCT FROM binding OR NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.backend='unipile' AND b.authority='service' AND b.channel='email')
 OR NOT public.agent_operation_authorised(operation) THEN RETURN NULL; END IF;
 -- The generic native admission historically needed one reservation. Actual
 -- communications dispatch additionally requires all three exact send scopes.
 IF (SELECT count(DISTINCT a.scope_key) FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id AND a.organization_id=r.organization_id WHERE r.operation_id=operation AND r.organization_id=org AND r.state='reserved' AND r.amount=1 AND a.unit='sends' AND a.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||conv.mandate_id::text||':sends']) AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap)<>3 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('contactId',conv.contact_id,'recipient',conv.recipient_email,'subject',op.input->>'subject','body',op.input->>'body','contextDigest',op.input_digest,'requiredSince',to_char(LEAST('1970-01-01T00:00:00Z'::timestamptz,COALESCE((SELECT min((item->>'since')::timestamptz) FROM jsonb_array_elements(conv.coverage_bindings) item WHERE item->>'bindingId'=binding::text AND item->>'channel'='email'),'1970-01-01T00:00:00Z'::timestamptz)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $$;

-- Name: agent_communications_source_kind(uuid, uuid, bigint, bigint, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_communications_source_kind(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current source scope required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 SELECT * INTO c FROM public.agent_conversations WHERE id=conversation AND organization_id=o.organization_id AND owner_user_id=o.owner_user_id;
 IF o.id IS NULL OR c.id IS NULL OR o.conversation_id<>c.id OR o.fence IS DISTINCT FROM expected_fence OR c.epoch IS DISTINCT FROM expected_epoch THEN RETURN NULL;END IF;
 IF o.input ? 'routeId' THEN
  IF EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.id::text=o.input->>'routeId' AND r.conversation_id=c.id AND r.binding_id=binding AND r.binding_digest=o.input->>'bindingDigest') THEN RETURN 'recorded_channel';END IF;RETURN NULL;
 END IF;
 IF o.name IN('email.initial','email.reply','email.follow_up') AND c.binding_id=binding AND NOT EXISTS(SELECT 1 FROM public.agent_channel_policies WHERE thread_id=c.thread_id) THEN RETURN 'legacy_email';END IF;RETURN NULL;
END $$;

-- Name: agent_company_continuation_job_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_company_continuation_job_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE operation uuid;approved boolean;
BEGIN
 -- A company profile child inherits the envelope but its original root owns
 -- review/dispatch. Do not treat the child's insert as a second root launch.
 IF NEW.config ? 'companyContinuation' AND (NEW.config->>'researchTask' IS DISTINCT FROM 'company' OR NEW.id::text=NEW.config->>'researchRunId') THEN
  IF NEW.config->'nativeAgent'->>'operationId' IS NULL THEN RAISE EXCEPTION 'Native reviewed company continuation required';END IF;
  operation:=(NEW.config->'nativeAgent'->>'operationId')::uuid;
  PERFORM public.agent_assert_company_continuation(operation);
  SELECT o.state IN('approved','running') AND o.organization_id=NEW.organization_id AND o.owner_user_id=NEW.created_by AND o.mandate_id=NEW.mandate_id
   AND o.input->'config'->>'requestId'=NEW.id::text AND o.input->'config'->'companyContinuation'=NEW.config->'companyContinuation'
   AND EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=o.organization_id AND b.owner_user_id=o.owner_user_id AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')))
  INTO approved FROM public.agent_operations o WHERE o.id=operation;
  IF approved IS DISTINCT FROM true THEN RAISE EXCEPTION 'Exact approved company continuation root required';END IF;
 END IF;
 RETURN NEW;
END $$;

-- Name: agent_company_continuation_operation_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_company_continuation_operation_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.name='research.start' AND OLD.input->'config' ? 'companyContinuation'
 AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.input->'config'->'companyContinuation' IS DISTINCT FROM OLD.input->'config'->'companyContinuation') THEN RAISE EXCEPTION 'Original company continuation claim cannot be removed or changed';END IF;
 IF NEW.name='research.start' AND NEW.input->'config' ? 'companyContinuation'
 AND (TG_OP='INSERT' OR NEW.input IS DISTINCT FROM OLD.input OR (OLD.state='proposed' AND NEW.state IN('approved','running')))
 THEN PERFORM public.agent_assert_company_continuation(NEW.id);END IF;
 RETURN NEW;
END $$;

-- Name: agent_company_continuation_sources(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_company_continuation_sources(p_thread uuid, p_source uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 t public.agent_threads%ROWTYPE;s public.research_jobs%ROWTYPE;cfg jsonb;manifest jsonb;claims jsonb;children jsonb;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Owned company continuation thread required';END IF;
 -- Ten is the intentional newest-source options window, never a child/effect
 -- truncation. An exact source lookup must either return that source or fail.
 FOR s IN SELECT j.* FROM public.research_jobs j JOIN public.agent_operations original
  ON original.id::text=j.config->'nativeAgent'->>'operationId' AND original.organization_id=org AND original.owner_user_id=actor
  AND original.thread_id=t.id AND original.mandate_id=t.mandate_id AND original.name='research.start' AND original.state='complete'
  AND original.input->>'nativeResearchPlanVersion'='1' AND original.input->'config'->>'requestId'=j.id::text
  AND original.input->'config'->'companyDiscoveryPolicy'=j.config->'companyDiscoveryPolicy'
 WHERE j.organization_id=org AND j.created_by=actor AND j.mandate_id=t.mandate_id AND (p_source IS NULL OR j.id=p_source)
 AND j.status='partial' AND j.config->>'pipelineDesign'='hybrid-firmable-v1' AND j.config->>'researchRunId'=j.id::text
 AND NOT(j.config ? 'companyContinuation') AND j.config->'companyDiscoveryPolicy'->>'version'='4'
 AND j.config->'companyIdentityPolicyVersion'='1'::jsonb AND j.config->'companyOnly'='true'::jsonb
 AND j.config->'findPeople'='false'::jsonb AND j.config->'includeCompanyPeople'='false'::jsonb AND j.config->'includePhones'='false'::jsonb
 AND j.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1'
 ORDER BY j.updated_at DESC,j.id DESC LIMIT 10 FOR SHARE OF j,original
 LOOP
  manifest:=s.config->'hybridResult'->'selection';
  IF jsonb_typeof(manifest) IS DISTINCT FROM 'array' OR jsonb_array_length(manifest)>800 THEN RAISE EXCEPTION 'Bounded original company manifest required';END IF;
  cfg:=jsonb_build_object('pipelineDesign',s.config->'pipelineDesign','researchRunId',s.config->'researchRunId',
   'companyDiscoveryPolicy',s.config->'companyDiscoveryPolicy','companyIdentityPolicyVersion',s.config->'companyIdentityPolicyVersion',
   'companyOnly',s.config->'companyOnly','findPeople',s.config->'findPeople','includeCompanyPeople',s.config->'includeCompanyPeople','includePhones',s.config->'includePhones','hybridResult',s.config->'hybridResult');
  IF s.config ? 'firmableSearchPages' THEN cfg:=cfg||jsonb_build_object('firmableSearchPages',s.config->'firmableSearchPages');END IF;
  IF s.config ? 'webSearchPages' THEN cfg:=cfg||jsonb_build_object('webSearchPages',s.config->'webSearchPages');END IF;
  IF octet_length(cfg::text)>4194304 THEN RAISE EXCEPTION 'Saved continuation evidence exceeds bounded snapshot';END IF;
  -- Include rejected claims if any root or dispatch/provider effect remains.
  -- Never omit uncertainty or infer that a missing child means no attempt.
  IF EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.organization_id=org AND o.mandate_id=t.mandate_id AND o.name='research.start'
   AND o.input->'config'->'companyContinuation'->>'sourceRootId'=s.id::text
   AND (jsonb_typeof(o.input->'config'->'companyContinuation'->'candidateKeys') IS DISTINCT FROM 'array'
    OR jsonb_array_length(o.input->'config'->'companyContinuation'->'candidateKeys')>800))
  THEN RAISE EXCEPTION 'Bounded continuation claims required';END IF;
  SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO claims FROM(
   SELECT DISTINCT x.key FROM public.agent_operations o CROSS JOIN LATERAL jsonb_array_elements_text(o.input->'config'->'companyContinuation'->'candidateKeys')x(key)
   WHERE o.organization_id=org AND o.mandate_id=t.mandate_id AND o.name='research.start'
   AND o.input->'config'->'companyContinuation'->>'sourceRootId'=s.id::text
   AND (o.state<>'rejected'
    OR EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.organization_id=org AND j.config->'nativeAgent'->>'operationId'=o.id::text)
    OR EXISTS(SELECT 1 FROM public.agent_operations effect WHERE effect.organization_id=org AND effect.input->>'researchOperationId'=o.id::text AND effect.name IN('research.worker_dispatch','research.provider')))
  )claimed;
  IF jsonb_array_length(claims)>800 THEN RAISE EXCEPTION 'Bounded continuation claims required';END IF;
  WITH roots AS(
   SELECT j.id,j.config->'nativeAgent'->>'operationId' operation_id FROM public.research_jobs j
   WHERE j.organization_id=org AND j.mandate_id=t.mandate_id AND (j.id=s.id OR j.config->'companyContinuation'->>'sourceRootId'=s.id::text)
  ),ids AS(
   SELECT encode(sha256(convert_to(root.id::text||':firmable:'||(item->>'candidateKey'),'UTF8')),'hex') h,root.id root_id,root.operation_id
   FROM roots root CROSS JOIN LATERAL jsonb_array_elements(manifest)item
  ),expected AS(
   SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid id,root_id,operation_id FROM ids
  ),observed AS(
   SELECT DISTINCT ON(child.id) child.id,child.config,coalesce(root.operation_id,expected.operation_id) operation_id
   FROM public.research_jobs child LEFT JOIN roots root ON child.config->>'parentJobId'=root.id::text LEFT JOIN expected ON child.id=expected.id
   WHERE child.organization_id=org AND child.mandate_id=t.mandate_id AND (root.id IS NOT NULL OR expected.id IS NOT NULL)
   ORDER BY child.id,root.id,expected.root_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'config',jsonb_strip_nulls(jsonb_build_object(
   'parentJobId',config->'parentJobId','firmableCompanyId',config->'firmableCompanyId','hybridFirmableId',config->'hybridFirmableId',
   'hybridExpectedDomain',config->'hybridExpectedDomain','companyDomain',config->'companyDomain','nativeAgent',jsonb_build_object('operationId',operation_id)))) ORDER BY id),'[]'::jsonb)
  INTO children FROM observed;
  IF jsonb_array_length(children)>1600 OR octet_length(children::text)>4194304 THEN RAISE EXCEPTION 'Company continuation effects exceed bounded snapshot';END IF;
  result:=result||jsonb_build_array(jsonb_build_object('id',s.id,'status',s.status,'config',cfg,'claimedKeys',claims,'children',children));
 END LOOP;
 IF p_source IS NOT NULL AND jsonb_array_length(result)<>1 THEN RAISE EXCEPTION 'Owned original partial company-only V4 source required';END IF;
 RETURN result;
END $$;

-- Name: agent_company_conversation_permitted(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_company_conversation_permitted(p_conversation uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE c record;projection jsonb;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) THEN RAISE EXCEPTION 'Current company admission scope required';END IF;
 SELECT v.mandate_id,p.target_id INTO c FROM public.agent_conversations v JOIN public.contacts p ON p.id=v.contact_id AND p.organization_id=v.organization_id WHERE v.id=p_conversation AND v.organization_id=current_setting('app.acquire_org',true) AND v.owner_user_id=current_setting('app.acquire_user',true);
 IF NOT FOUND THEN RETURN false;END IF;
 IF c.target_id IS NULL THEN RETURN true;END IF;
 projection:=public.agent_company_membership_projection(c.mandate_id,c.target_id);
 RETURN projection IS NULL OR jsonb_array_length(projection->'blockedReasons')=0;
END $$;

-- Name: agent_company_findings_digest(text, uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_company_findings_digest(p_org text, p_mandate uuid, p_target uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(f.id,f.revision) ORDER BY f.observed_at DESC,f.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM(SELECT id,xmin::text AS revision,observed_at FROM public.research_findings WHERE organization_id=p_org AND mandate_id=p_mandate AND target_id=p_target ORDER BY observed_at DESC,id LIMIT 100)f
$$;

-- Name: agent_company_membership_projection(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_company_membership_projection(p_mandate uuid, p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.agent_threads WHERE organization_id=org AND mandate_id=p_mandate AND owner_user_id=actor) THEN RAISE EXCEPTION 'Owned current company projection scope required';END IF;
 RETURN public.agent_current_company_projection(org,p_mandate,p_target);
END $$;

-- Name: agent_company_projection_writer_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_company_projection_writer_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
BEGIN
 IF current_setting('role',true) IN('acquire_agent_user','acquire_campaign_user','acquire_agent_worker') OR current_user IN('acquire_agent_user','acquire_campaign_user','acquire_agent_worker')
 OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=(7426619361492031::bigint>>32)::oid AND objid=(7426619361492031::bigint&4294967295::bigint)::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Trusted global-first company publication required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;

-- Name: agent_configure_budget(text, text, timestamp with time zone, timestamp with time zone, bigint, integer); Type: FUNCTION
CREATE FUNCTION public.agent_configure_budget(scope_key text, unit text, window_start timestamp with time zone, window_end timestamp with time zone, cap bigint, expected_revision integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);prior public.agent_budget_accounts%ROWTYPE;result public.agent_budget_accounts%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor AND role IN('owner','admin')) THEN RAISE EXCEPTION 'Human workspace administrator required'; END IF;
 IF length(scope_key) NOT BETWEEN 1 AND 200 OR unit NOT IN('usd_micro','calls','sends') OR cap NOT BETWEEN 0 AND 1000000000000 OR window_end<=window_start OR window_end>window_start+interval '31 days' THEN RAISE EXCEPTION 'Invalid bounded budget'; END IF;
 SELECT * INTO prior FROM public.agent_budget_accounts a WHERE a.organization_id=org AND a.scope_key=agent_configure_budget.scope_key AND a.window_start=agent_configure_budget.window_start FOR UPDATE;
 IF prior.id IS NULL THEN
  IF expected_revision<>0 THEN RAISE EXCEPTION 'Budget changed'; END IF;
  INSERT INTO public.agent_budget_accounts(organization_id,scope_key,unit,window_start,window_end,cap,approved_by) VALUES(org,scope_key,unit,window_start,window_end,cap,actor) RETURNING * INTO result;
 ELSE
  IF prior.revision<>expected_revision OR prior.unit<>unit THEN RAISE EXCEPTION 'Budget changed or unit differs'; END IF;
  UPDATE public.agent_budget_accounts a SET cap=agent_configure_budget.cap,window_end=agent_configure_budget.window_end,revision=a.revision+1,approved_by=actor,approved_at=clock_timestamp() WHERE a.id=prior.id RETURNING * INTO result;
 END IF;
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.budget_configured','agent_budget',result.id::text,jsonb_build_object('revision',result.revision,'cap',result.cap::text,'previousCap',prior.cap::text,'unit',result.unit,'scopeKey',result.scope_key,'windowStart',result.window_start,'windowEnd',result.window_end));
 RETURN to_jsonb(result)||jsonb_build_object('cap',result.cap::text,'spent',result.spent::text,'reserved',result.reserved::text);
END $$;

-- Name: agent_consume_delegation(); Type: FUNCTION
CREATE FUNCTION public.agent_consume_delegation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;kind text;
BEGIN
 IF NEW.grant_id IS NULL THEN RETURN NEW;END IF;
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=NEW.operation_id AND thread_id=NEW.thread_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF o.input ? 'routeId' THEN
  SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND thread_id=o.thread_id;
  kind:=split_part(o.name,'.',2)||'_'||r.channel;
  IF r.id IS NULL OR o.name<>r.channel||'.'||split_part(o.name,'.',2) OR split_part(o.name,'.',2) NOT IN('initial','reply','follow_up') OR o.input->>'requiresHumanReview'='true' OR NEW.binding_digest IS DISTINCT FROM r.binding_digest THEN RAISE EXCEPTION 'Current exact delegated route required';END IF;
 ELSE
  SELECT CASE o.name WHEN 'email.initial' THEN 'initial_email' WHEN 'email.reply' THEN 'reply_email' WHEN 'email.follow_up' THEN 'follow_up_email' END INTO kind;
  IF EXISTS(SELECT 1 FROM public.agent_channel_policies WHERE thread_id=o.thread_id) OR NEW.binding_digest IS DISTINCT FROM (SELECT binding_digest FROM public.agent_conversations WHERE id=o.conversation_id) THEN RAISE EXCEPTION 'Reviewed route required';END IF;
 END IF;
 IF kind IS NULL OR o.state<>'running' OR o.fence<>NEW.operation_fence OR o.revision<>NEW.operation_revision OR o.input_digest<>NEW.operation_digest OR NEW.state<>'reserved' THEN RAISE EXCEPTION 'Current delegated operation required';END IF;
 UPDATE public.agent_authority_grants g SET used_sends=used_sends+1 WHERE g.id=NEW.grant_id AND g.thread_id=NEW.thread_id AND g.organization_id=NEW.organization_id AND g.owner_user_id=NEW.owner_user_id AND g.revision=NEW.grant_revision AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND g.approved_at<=clock_timestamp() AND g.used_sends<g.max_sends AND g.binding_digest=NEW.binding_digest AND g.actions ? kind AND (r.id IS NOT NULL AND g.channel=r.channel AND g.route_ids ? r.id::text AND g.recipient_keys ? (r.channel||':'||r.recipient_value) OR r.id IS NULL AND g.channel='email' AND g.route_ids='[]'::jsonb AND g.recipient_keys ? ('email:'||(SELECT recipient_email FROM public.agent_conversations WHERE id=o.conversation_id)));
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegated grant expired, revoked, changed or at cap';END IF;RETURN NEW;
END $$;

-- Name: agent_consume_delegation_before_channels(); Type: FUNCTION
CREATE FUNCTION public.agent_consume_delegation_before_channels() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;kind text;
BEGIN
 IF NEW.grant_id IS NULL THEN RETURN NEW; END IF;
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=NEW.operation_id AND thread_id=NEW.thread_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=NEW.conversation_id AND thread_id=NEW.thread_id;
 kind:=CASE op.name WHEN 'email.initial' THEN 'initial_email' WHEN 'email.reply' THEN 'reply_email' WHEN 'email.follow_up' THEN 'follow_up_email' ELSE NULL END;
 IF kind IS NULL OR op.state<>'running' OR op.fence<>NEW.operation_fence OR op.revision<>NEW.operation_revision OR op.input_digest<>NEW.operation_digest OR NEW.state<>'reserved' OR conv.binding_digest IS DISTINCT FROM NEW.binding_digest THEN RAISE EXCEPTION 'Current delegated operation required'; END IF;
 UPDATE public.agent_authority_grants SET used_sends=used_sends+1
 WHERE id=NEW.grant_id AND thread_id=NEW.thread_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id
 AND revision=NEW.grant_revision AND revoked_at IS NULL AND expires_at>clock_timestamp() AND approved_at<=clock_timestamp()
 AND used_sends<max_sends AND binding_digest=conv.binding_digest AND actions ? kind AND recipient_keys ? ('email:'||conv.recipient_email);
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegated grant expired, revoked, changed or at cap'; END IF;
 RETURN NEW;
END $$;

-- Name: agent_contact_delivery_recipients(jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_contact_delivery_recipients(p_data jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE phone text:=regexp_replace(btrim(p_data->>'phone'),'[[:space:]().-]','','g');profile text:=btrim(coalesce(nullif(p_data->>'linkedinUrl',''),nullif(p_data->>'linkedin',''),p_data->>'linkedin_url'));parts text[];linkedin text;
BEGIN
 -- URL's hostname is case-insensitive; preserve path case just as new URL().
 parts:=regexp_match(profile,'^https://(?:[^/?#]*@)?(?:[A-Za-z0-9-]+[.])*linkedin[.]com(?::([0-9]+))?(/in/[^/?#[:space:]]+?)/?(?:[?#].*)?$','i');
 IF parts IS NOT NULL AND parts[2]~'^/in/' AND (parts[1] IS NULL OR (length(parts[1])<=5 AND parts[1]::integer<=65535)) THEN linkedin:='https://www.linkedin.com'||parts[2];END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('email',CASE WHEN btrim(p_data->>'email')~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' THEN lower(btrim(p_data->>'email')) END,'whatsapp',CASE WHEN phone~'^[+][1-9][0-9]{6,14}$' THEN phone END,'linkedin',linkedin));
END $_$;

-- Name: agent_contact_identity_batch(text, uuid[]); Type: FUNCTION
CREATE FUNCTION public.agent_contact_identity_batch(p_org text, p_contacts uuid[]) RETURNS TABLE(contact_id uuid, identity_keys text[], contact_aliases uuid[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR p_org IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=current_setting('app.acquire_user',true))
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=p_org AND writer_xid=txid_current())
 THEN RAISE EXCEPTION 'Held canonical identity scope required';END IF;
 IF p_contacts IS NULL OR cardinality(p_contacts)>10000 OR array_position(p_contacts,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Bounded canonical contacts required';END IF;
 RETURN QUERY
 WITH people AS MATERIALIZED(SELECT c.id,c.personal_data,c.firmable_person_id FROM public.contacts c WHERE c.organization_id=p_org),
 -- Matching keys intentionally retain the old raw comparison semantics. Only
 -- seed keys are length-bounded, as in the original agent_person_keys function.
 raw_keys AS MATERIALIZED(
  SELECT p.id,'contact:'||p.id::text AS key,true AS contact_key,true AS seedable FROM people p
  UNION ALL SELECT p.id,'email:'||lower(btrim(p.personal_data->>'email')),false,length(btrim(p.personal_data->>'email'))>0 FROM people p
  UNION ALL SELECT p.id,'firmable:'||p.firmable_person_id,false,true FROM people p WHERE p.firmable_person_id IS NOT NULL
  UNION ALL SELECT p.id,'whatsapp:'||(p.personal_data->>'phone'),false,true FROM people p WHERE p.personal_data->>'phone'~'^[+][1-9][0-9]{6,14}$'
  UNION ALL SELECT p.id,'linkedin:'||regexp_replace(p.personal_data->>'linkedinUrl','/$',''),false,true FROM people p WHERE p.personal_data->>'linkedinUrl'~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$'
  UNION ALL SELECT i.contact_id,i.channel||':'||i.identity,false,length(i.identity)>0 FROM public.campaign_reply_identities i JOIN people p ON p.id=i.contact_id WHERE i.organization_id=p_org
  UNION ALL SELECT i.contact_id,i.channel||':'||i.source_identity,false,length(i.source_identity)>0 FROM public.campaign_reply_identities i JOIN people p ON p.id=i.contact_id WHERE i.organization_id=p_org
 ),
 requested AS MATERIALIZED(SELECT p.id FROM people p WHERE p.id=ANY(p_contacts)),
 seeds AS MATERIALIZED(
  SELECT DISTINCT r.id,k.key FROM requested r JOIN raw_keys k ON k.id=r.id
  WHERE k.seedable AND length(k.key) BETWEEN 3 AND 400
 ),
 expanded AS MATERIALIZED(
  SELECT s.id,s.key FROM seeds s
  UNION SELECT s.id,'contact:'||k.id::text FROM seeds s JOIN raw_keys k ON k.key=s.key AND NOT k.contact_key
 ),
 aliases AS MATERIALIZED(SELECT DISTINCT e.id,k.id AS alias_id FROM expanded e JOIN raw_keys k ON k.key=e.key),
 key_sets AS(SELECT e.id,array_agg(e.key ORDER BY e.key) AS keys FROM expanded e GROUP BY e.id),
 alias_sets AS(SELECT a.id,array_agg(a.alias_id ORDER BY a.alias_id) AS ids FROM aliases a GROUP BY a.id)
 SELECT r.id,k.keys,a.ids FROM requested r JOIN key_sets k ON k.id=r.id JOIN alias_sets a ON a.id=r.id;
END $_$;

-- Name: agent_context_revision(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_context_revision(p_conversation uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE base text;mid uuid;target uuid;org text:=current_setting('app.acquire_org',true);projection jsonb;frame jsonb;
BEGIN
 -- This original chain still proves the owned conversation/current member and
 -- carries all person, account, policy, history and invitation context.
 base:=public.agent_context_revision_before_company_projection(p_conversation);
 SELECT c.mandate_id,p.target_id INTO mid,target FROM public.agent_conversations c JOIN public.contacts p ON p.id=c.contact_id AND p.organization_id=c.organization_id WHERE c.id=p_conversation AND c.organization_id=org AND c.owner_user_id=current_setting('app.acquire_user',true);
 IF target IS NULL THEN RETURN base;END IF;
 BEGIN
  projection:=public.agent_current_company_projection(org,mid,target);
 EXCEPTION WHEN raise_exception THEN
  -- A stale/missing publication must not erase the normal Pause/Resume/history
  -- controls. Do not suppress ownership, membership or other database errors.
  IF SQLERRM IS DISTINCT FROM 'Current company source projection requires refresh' THEN RAISE;END IF;
  SELECT jsonb_build_object(
   'kind','stale-company-source-v1',
   'accepted',(SELECT jsonb_build_array(o.id,o.input_digest) FROM public.company_identity_accepted_observations o WHERE o.organization_id=org AND o.mandate_id=mid AND o.target_id=target ORDER BY o.observed_at DESC,o.created_at DESC,o.id DESC LIMIT 1),
   'current',(SELECT jsonb_build_array(m.xmin::text,mt.version,mt.xmin::text,g.xmin::text) FROM public.mandates m JOIN public.mandate_targets mt ON mt.organization_id=m.organization_id AND mt.mandate_id=m.id JOIN public.targets g ON g.organization_id=m.organization_id AND g.id=mt.target_id WHERE m.organization_id=org AND m.id=mid AND g.id=target),
   'findings',public.agent_company_findings_digest(org,mid,target),
   'published',(SELECT jsonb_build_array(p.mandate_revision,p.membership_version,p.membership_revision,p.target_revision,p.observation_id,p.observation_digest,p.findings_digest,p.projection_digest,encode(sha256(convert_to(p.projection::text,'UTF8')),'hex')) FROM public.company_membership_projections p WHERE p.organization_id=org AND p.mandate_id=mid AND p.target_id=target)
  ) INTO frame;
  RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,frame)),'UTF8')),'hex');
 END;
 -- Preserve the exact existing CAS for fresh accepted sources and for all
 -- legacy/no-observation handles. No new authority is implied by this digest.
 IF projection IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,projection->>'digest')),'UTF8')),'hex');
END $$;

-- Name: agent_context_revision_before_channels(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_context_revision_before_channels(conversation uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE result text;org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Current member scope required'; END IF;
 SELECT encode(sha256(convert_to(jsonb_build_object('conversation',c.id,'revision',c.revision,'epoch',c.epoch,'history',c.history_revision,'coverage',c.history_complete,'mandate',m.xmin::text,'buyer',g.xmin::text,'contact',person.xmin::text,'company',company.xmin::text,
 'evidence',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id,'revision',f.version) ORDER BY f.id),'[]'::jsonb) FROM(SELECT id,xmin::text AS version FROM public.research_findings WHERE organization_id=c.organization_id AND target_id=person.target_id ORDER BY observed_at DESC,id LIMIT 100)f),
 'guidance',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'revision',o.revision) ORDER BY o.id),'[]'::jsonb) FROM public.agent_operations o WHERE o.thread_id=c.thread_id AND o.name='guidance.memory' AND o.state='approved'))::text,'UTF8')),'hex') INTO result
 FROM public.agent_conversations c JOIN public.mandates m ON m.id=c.mandate_id AND m.organization_id=c.organization_id JOIN public.organization g ON g.id=c.organization_id JOIN public.contacts person ON person.id=c.contact_id AND person.organization_id=c.organization_id LEFT JOIN public.targets company ON company.id=person.target_id AND company.organization_id=c.organization_id
 WHERE c.id=conversation AND c.organization_id=org AND c.owner_user_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;RETURN result;
END $$;

-- Name: agent_context_revision_before_company_projection(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_context_revision_before_company_projection(p_conversation uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE base text;relationships jsonb;
BEGIN
 base:=public.agent_context_revision_before_invitations(p_conversation);
 SELECT jsonb_agg(jsonb_build_object('routeId',route_id,'bindingDigest',binding_digest,'identityRevision',identity_revision,'status',status,'canMessage',can_message,'revision',revision) ORDER BY route_id) INTO relationships FROM public.agent_linkedin_relationships WHERE conversation_id=p_conversation;
 IF relationships IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(jsonb_build_object('base',base,'relationships',relationships)::text,'UTF8')),'hex');
END $$;

-- Name: agent_context_revision_before_invitations(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_context_revision_before_invitations(p_conversation uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE base text;frame jsonb;
BEGIN
 base:=public.agent_context_revision_before_channels(p_conversation);
 SELECT jsonb_build_object('policy',jsonb_build_object('revision',p.revision,'order',p.channel_order,'delay',p.delay_seconds,'bindings',p.bindings,'simulation',p.accelerated_simulation),'routes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'binding',r.binding_digest,'identity',r.identity_revision,'history',r.history_revision,'complete',r.history_complete,'nextAllowedAt',r.next_allowed_at,'coldCancelledAt',r.cold_cancelled_at) ORDER BY r.id) FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id),'[]')) INTO frame
 FROM public.agent_conversations c JOIN public.agent_channel_policies p ON p.thread_id=c.thread_id WHERE c.id=p_conversation AND c.organization_id=current_setting('app.acquire_org',true) AND c.owner_user_id=current_setting('app.acquire_user',true);
 IF frame IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,frame)),'UTF8')),'hex');
END $$;

-- Name: agent_control_handoff(uuid, uuid, jsonb, text); Type: FUNCTION
CREATE FUNCTION public.agent_control_handoff(p_mandate uuid, p_key uuid, p_input jsonb, p_digest text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 task public.agent_handoffs%ROWTYPE;conv public.agent_conversations%ROWTYPE;prior public.agent_operations%ROWTYPE;op uuid;new_revision integer;action text:=p_input->>'action';next_state text;receipt jsonb;notice jsonb;proof jsonb;request text:='handoff:'||actor||':'||p_key::text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF p_digest!~'^[a-f0-9]{64}$' OR octet_length(p_input::text)>6000 THEN RAISE EXCEPTION 'Invalid task command'; END IF;
 SELECT * INTO task FROM public.agent_handoffs h WHERE h.id=(p_input->>'taskId')::uuid AND h.organization_id=org AND h.mandate_id=p_mandate AND (h.owner_user_id=actor OR h.assignee_user_id=actor);
 IF task.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=task.owner_user_id) THEN RAISE EXCEPTION 'Task unavailable'; END IF;
 -- Same lock order as ordinary owner commands; serialises owner and assignee.
 PERFORM 1 FROM public.agent_threads WHERE id=task.thread_id FOR UPDATE;
 SELECT * INTO task FROM public.agent_handoffs WHERE id=task.id FOR UPDATE;
 IF actor<>task.owner_user_id AND actor<>task.assignee_user_id THEN RAISE EXCEPTION 'Task assignment changed'; END IF;
 SELECT * INTO prior FROM public.agent_operations WHERE thread_id=task.thread_id AND request_key=request;
 IF prior.id IS NOT NULL THEN
  IF prior.input_digest<>p_digest OR prior.input IS DISTINCT FROM p_input OR prior.state<>'complete' THEN RAISE EXCEPTION 'Task command key reused'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=task.conversation_id FOR UPDATE;
 IF task.revision<>(p_input->>'revision')::integer OR public.agent_handoff_context(task.id) IS DISTINCT FROM p_input->>'contextRevision' THEN RAISE EXCEPTION 'Task or conversation changed'; END IF;
 IF task.state IN('dismissed','meeting_confirmed') THEN RAISE EXCEPTION 'Task already closed'; END IF;
 IF jsonb_array_length(coalesce(task.human_evidence->'events','[]'::jsonb))>=100 OR octet_length(task.human_evidence::text)+octet_length(p_input::text)>58000 THEN RAISE EXCEPTION 'Task evidence limit reached; manual review required'; END IF;
 next_state:=task.state;
 IF action='acknowledge' THEN
  IF task.state<>'pending' THEN RAISE EXCEPTION 'Task is not pending'; END IF;next_state:='acknowledged';
 ELSIF action='reassign' THEN
  IF actor<>task.owner_user_id OR coalesce(length(p_input->>'assigneeUserId'),0) NOT BETWEEN 1 AND 200 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=p_input->>'assigneeUserId') THEN RAISE EXCEPTION 'Current member assignment requires owner'; END IF;
  IF task.assignee_user_id=p_input->>'assigneeUserId' THEN RAISE EXCEPTION 'Task already assigned'; END IF;
 ELSIF action='remind' THEN
  IF jsonb_typeof(p_input->'reminder')<>'object' OR coalesce(length(trim(p_input->'reminder'->>'reason')),0) NOT BETWEEN 1 AND 2000
   OR (p_input->'reminder'->>'wakeAt') IS NULL OR (p_input->'reminder'->>'wakeAt')::timestamptz<=public.agent_business_now()
   OR (p_input->'reminder'->>'wakeAt')::timestamptz>public.agent_business_now()+interval '30 days'
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_input->'reminder'->>'timeZone') THEN RAISE EXCEPTION 'Bounded internal reminder required'; END IF;
 ELSIF action='dismiss' THEN
  IF coalesce(length(trim(p_input->>'reason')),0) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Dismissal reason required'; END IF;next_state:='dismissed';
 ELSIF action IN('link_sent','meeting_confirmed') THEN
  proof:=p_input->'evidence';
  IF jsonb_typeof(proof)<>'object' OR coalesce(length(trim(proof->>'note')),0) NOT BETWEEN 5 AND 2000 OR coalesce(length(trim(proof->>'externalReference')),0) NOT BETWEEN 3 AND 1000 OR (proof->>'occurredAt') IS NULL OR (proof->>'occurredAt')::timestamptz>public.agent_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Past external evidence required'; END IF;
  IF action='link_sent' AND (task.state NOT IN('pending','acknowledged') OR conv.driver_kind<>'human' OR conv.phase<>'paused' OR conv.engagement<>'handoff') THEN RAISE EXCEPTION 'Booking-link record unavailable for current conversation'; END IF;
  IF action='meeting_confirmed' AND task.state<>'link_sent' THEN RAISE EXCEPTION 'Link sent is not a confirmed meeting'; END IF;
  next_state:=action;
 ELSE RAISE EXCEPTION 'Invalid task action';END IF;
 INSERT INTO public.agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,request,'human.handoff.'||action,p_input,p_digest,'running') RETURNING id INTO op;
 proof:=jsonb_build_object('action',action,'actorId',actor,'recordedAt',clock_timestamp(),'evidence',p_input->'evidence','reason',p_input->'reason','previousAssignee',task.assignee_user_id,'reminder',p_input->'reminder');
 UPDATE public.agent_handoffs SET state=next_state,assignee_user_id=CASE WHEN action='reassign' THEN p_input->>'assigneeUserId' ELSE assignee_user_id END,
  revision=revision+1,human_evidence=jsonb_set(human_evidence,'{events}',coalesce(human_evidence->'events','[]'::jsonb)||jsonb_build_array(proof)),updated_at=clock_timestamp()
 WHERE id=task.id RETURNING revision INTO new_revision;
 receipt:=jsonb_build_object('id',task.id,'revision',new_revision,'status',next_state);
 UPDATE public.agent_operations SET state='complete',result=receipt,updated_at=clock_timestamp() WHERE id=op;
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
 VALUES(org,actor,'agent.handoff.'||action,'agent_handoff',task.id::text,jsonb_build_object('revision',new_revision,'commandId',op,'previousState',task.state,'state',next_state));
 notice:=jsonb_build_object('text',CASE action WHEN 'acknowledge' THEN 'The human handoff was acknowledged.' WHEN 'reassign' THEN 'The human handoff was reassigned.' WHEN 'remind' THEN 'An internal human-task reminder was saved. Automation remains paused.' WHEN 'dismiss' THEN 'The human handoff was dismissed. Automation remains paused.' WHEN 'link_sent' THEN 'A human recorded sending the booking link externally. This does not confirm a meeting. Automation remains paused.' ELSE 'A human recorded a confirmed meeting with external evidence. Automation remains paused.' END,'details',receipt||jsonb_build_object('actorId',actor));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-notice:'||op,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
 INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-control:'||op,'human.handoff_updated',receipt,encode(sha256(convert_to(receipt::text,'UTF8')),'hex'));
 IF action='remind' THEN
  proof:=jsonb_build_object('taskId',task.id,'revision',new_revision,'assigneeUserId',task.assignee_user_id,'reminder',p_input->'reminder');
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,available_at)
  VALUES(task.thread_id,org,p_mandate,task.owner_user_id,'handoff-reminder:'||op,'human.handoff_reminder',proof,encode(sha256(convert_to(proof::text,'UTF8')),'hex'),(p_input->'reminder'->>'wakeAt')::timestamptz);
 END IF;
 RETURN receipt;
END $_$;

-- Name: agent_conversation_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_conversation_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.organization_id=NEW.organization_id AND (c.mandate_id=NEW.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.target_id=c.target_id AND mt.mandate_id=NEW.mandate_id))) THEN RAISE EXCEPTION 'Contact must belong to the mandate'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.thread_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.responsibility_id,NEW.contact_id,NEW.delivery_mode,NEW.binding_id,NEW.binding_digest,NEW.recipient_email) IS DISTINCT FROM ROW(OLD.id,OLD.thread_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.responsibility_id,OLD.contact_id,OLD.delivery_mode,OLD.binding_id,OLD.binding_digest,OLD.recipient_email)
  THEN RAISE EXCEPTION 'Conversation identity/account is immutable'; END IF;
  IF (to_jsonb(NEW)-'history_observed_at'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'history_observed_at'-'updated_at') AND NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Current conversation revision required'; END IF;
 END IF;RETURN NEW;
END $$;

-- Name: agent_create_fields_job(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_create_fields_job(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE receipt jsonb;o public.agent_operations%ROWTYPE;s jsonb;source jsonb;
BEGIN
 -- The unchanged 0071 kernel establishes exact HIL, scope, supervision,
 -- budget escrow and immutable job handles before any saved config is extended.
 receipt:=public.agent_fields_job_before_company_projection(operation);
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR s IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  source:=public.agent_fields_current_source(o.organization_id,o.mandate_id,(s->>'targetId')::uuid);
  IF s->'companyIdentityPolicyVersion' IS DISTINCT FROM (CASE WHEN source->'projection' IS NULL THEN NULL ELSE '1'::jsonb END) THEN RAISE EXCEPTION 'Exact reviewed company identity policy required';END IF;
  IF s->>'companyIdentityPolicyVersion'='1' THEN
   UPDATE public.research_jobs SET config=config||jsonb_build_object('companyIdentityPolicyVersion',1) WHERE id=(s->>'childJobId')::uuid AND organization_id=o.organization_id AND mandate_id=o.mandate_id AND created_by=o.owner_user_id AND config->'nativeAgent'->>'operationId'=o.id::text AND config->>'companyIdentityPolicyVersion' IS DISTINCT FROM '1';
  END IF;
 END LOOP;
 RETURN receipt;
END $$;

-- Name: agent_create_people_job(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_create_people_job(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;snapshot jsonb;item jsonb;current_item jsonb;ids uuid[];job uuid;scope_count integer;cfg jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.people' AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL OR o.input->>'nativePeoplePlanVersion' IS DISTINCT FROM '1' OR o.input->>'includePhones' IS DISTINCT FROM 'false' OR o.input->>'maxContactsPerCompany' IS DISTINCT FROM '3' OR jsonb_array_length(o.input->'selected') NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Reviewed bounded people plan required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact people approval required';END IF;
 SELECT array_agg((v->>'targetId')::uuid) INTO ids FROM jsonb_array_elements(o.input->'selected') v;
 snapshot:=public.agent_people_company_snapshot(o.thread_id,ids,o.id);
 IF snapshot->>'mandateRevision' IS DISTINCT FROM o.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM o.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM o.input->>'responsibilityRevision' THEN RAISE EXCEPTION 'People goal changed';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  SELECT value INTO current_item FROM jsonb_array_elements(snapshot->'companies') WHERE value->>'targetId'=item->>'targetId';
  IF current_item IS NULL OR current_item->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR current_item->>'firmableId' IS DISTINCT FROM item->>'firmableId' OR jsonb_array_length(current_item->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Company facts or outreach need review';END IF;
 END LOOP;
 job:=(o.input->'config'->>'requestId')::uuid;
 SELECT * INTO j FROM public.research_jobs WHERE id=job FOR UPDATE;
 IF j.id IS NOT NULL AND (j.organization_id IS DISTINCT FROM org OR j.mandate_id IS DISTINCT FROM o.mandate_id OR j.created_by IS DISTINCT FROM actor OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text) THEN RAISE EXCEPTION 'People job handle belongs to different work';END IF;
 IF j.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.research_jobs WHERE organization_id=org AND mandate_id=o.mandate_id AND status NOT IN('complete','partial','failed','cancelled') AND config->'companyBackgroundResearch' IS NULL) THEN RAISE EXCEPTION 'Research already active';END IF;
  cfg:=jsonb_build_object('approved',true,'workflow','business','mode','automatic','discover',false,'findPeople',false,'includeCompanyPeople',false,'seeds','[]'::jsonb,'searchTerms','[]'::jsonb,'geography','Australia','researchScope','Reviewed email contact enrichment','researchRunId',job,'executionSlot','agent-people:'||o.thread_id,'automaticDeadline',0,'budget',jsonb_build_object('maxPages',5,'maxDomains',5,'maxMinutes',10,'maxModelCalls',0),'nativeAgent',jsonb_build_object('version',1,'operationId',o.id,'threadId',o.thread_id,'responsibilityId',o.input->>'responsibilityId','responsibilityRevision',(o.input->>'responsibilityRevision')::integer,'mandateRevision',o.input->>'mandateRevision','contextRevision',o.input->>'contextRevision','providerAdmission','required'));
  INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message) VALUES(job,org,o.mandate_id,actor,'queued',cfg,'[]','Reviewed email contact enrichment saved');
 ELSE
  cfg:=j.config;
 END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id)a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',job,'status',coalesce(j.status,'queued'),'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 IF cfg->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'firmable-people-v1' THEN UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+600000),'{nativeAgent,providerAdmission}','"firmable-people-v1"'),message='Reviewed contact enrichment ready' WHERE id=job;END IF;
 RETURN jsonb_build_object('jobId',job,'status',coalesce(j.status,'queued'),'dispatchReady',true);
END $$;

-- Name: agent_create_research_job(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_create_research_job(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 op public.agent_operations%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mrev text;job uuid;cfg jsonb;saved public.research_jobs%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF op.id IS NULL OR op.name<>'research.start' OR op.state NOT IN('approved','running') OR op.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Approved native research operation required';END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE id=(op.input->>'responsibilityId')::uuid AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 SELECT xmin::text INTO mrev FROM public.mandates WHERE id=op.mandate_id AND organization_id=org;
 IF r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.revision::text IS DISTINCT FROM (op.input->>'responsibilityRevision') OR r.mandate_revision IS DISTINCT FROM (op.input->>'mandateRevision') OR mrev IS DISTINCT FROM r.mandate_revision THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=op.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 job:=(op.input->'config'->>'requestId')::uuid;
 cfg:=(op.input->'config')-'requestId'||jsonb_build_object('researchRunId',job,'executionSlot','agent:'||op.thread_id::text,'automaticDeadline',0,'nativeAgent',jsonb_build_object('version',1,'operationId',op.id,'threadId',op.thread_id,'responsibilityId',r.id,'responsibilityRevision',r.revision,'mandateRevision',mrev,'contextRevision',op.input->>'contextRevision','providerAdmission','required'));
 SELECT * INTO saved FROM public.research_jobs WHERE id=job FOR UPDATE;
 IF saved.id IS NOT NULL THEN
  IF saved.organization_id<>org OR saved.mandate_id<>op.mandate_id OR saved.created_by<>actor OR saved.config->'nativeAgent'->>'operationId' IS DISTINCT FROM op.id::text THEN RAISE EXCEPTION 'Research handle belongs to different work';END IF;
  RETURN jsonb_build_object('jobId',saved.id,'status',saved.status,'dispatchReady',false,'blockedReason','budgeted_provider_adapter_required');
 END IF;
 IF EXISTS(SELECT 1 FROM public.research_jobs WHERE organization_id=org AND mandate_id=op.mandate_id AND status NOT IN('complete','partial','failed','cancelled') AND config->'companyBackgroundResearch' IS NULL) THEN RAISE EXCEPTION 'Research already active for this mandate';END IF;
 INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message)
 VALUES(job,org,op.mandate_id,actor,'queued',cfg,COALESCE(cfg->'seeds','[]'::jsonb),'Approved research saved; awaiting per-request provider budget admission');
 RETURN jsonb_build_object('jobId',job,'status','queued','dispatchReady',false,'blockedReason','budgeted_provider_adapter_required');
END $$;

-- Name: agent_current_company_projection(text, uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_current_company_projection(p_org text, p_mandate uuid, p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o record;p public.company_membership_projections%ROWTYPE;stamp record;
BEGIN
 SELECT id,input_digest INTO o FROM public.company_identity_accepted_observations WHERE organization_id=p_org AND mandate_id=p_mandate AND target_id=p_target ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT g.xmin::text AS target_revision,m.xmin::text AS mandate_revision,mt.version AS membership_version,mt.xmin::text AS membership_revision INTO stamp
 FROM public.mandates m JOIN public.mandate_targets mt ON mt.organization_id=m.organization_id AND mt.mandate_id=m.id JOIN public.targets g ON g.id=mt.target_id AND g.organization_id=m.organization_id WHERE m.id=p_mandate AND m.organization_id=p_org AND g.id=p_target;
 SELECT * INTO p FROM public.company_membership_projections WHERE organization_id=p_org AND mandate_id=p_mandate AND target_id=p_target;
 IF stamp.mandate_revision IS NULL OR p.target_id IS NULL OR p.mandate_revision IS DISTINCT FROM stamp.mandate_revision OR p.membership_version IS DISTINCT FROM stamp.membership_version OR p.membership_revision IS DISTINCT FROM stamp.membership_revision OR p.target_revision IS DISTINCT FROM stamp.target_revision OR p.observation_id IS DISTINCT FROM o.id OR p.observation_digest IS DISTINCT FROM o.input_digest OR p.findings_digest IS DISTINCT FROM public.agent_company_findings_digest(p_org,p_mandate,p_target)
 OR p.projection->>'digest' IS DISTINCT FROM p.projection_digest OR p.projection->'observation'->>'id' IS DISTINCT FROM o.id::text OR p.projection->'observation'->>'digest' IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Current company source projection requires refresh';END IF;
 RETURN p.projection;
END $$;

-- Name: agent_delivery_candidate_projection(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_delivery_candidate_projection(p_mandate uuid, p_contact uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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


SET default_tablespace = '';

SET default_table_access_method = heap;

-- Name: agent_delivery_contact_projection(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_delivery_contact_projection(p_mandate uuid, p_contact uuid) RETURNS public.contacts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE result public.contacts%ROWTYPE;effective jsonb;recipients jsonb;
BEGIN
 effective:=public.agent_effective_contact(p_mandate,p_contact);
 SELECT * INTO result FROM public.contacts WHERE id=p_contact AND organization_id=current_setting('app.acquire_org',true);
 recipients:=CASE WHEN effective->>'mode'='demo' THEN effective->'demoProjection'->'recipients' ELSE public.agent_contact_delivery_recipients(result.personal_data) END;
 SELECT * INTO result FROM jsonb_populate_record(result,jsonb_build_object('personal_data',coalesce(result.personal_data,'{}')||jsonb_build_object('email',recipients->>'email','phone',recipients->>'whatsapp','linkedinUrl',recipients->>'linkedin')));
 RETURN result;
END $$;

-- Name: agent_demo_contact_fingerprint(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_demo_contact_fingerprint(p_contact uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);person record;source_revision text;
BEGIN
 IF org IS NULL OR org='' OR actor IS NULL OR actor='' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Current owned contact required';END IF;
 SELECT c.*,c.xmin::text AS source_revision INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=org FOR SHARE OF c;
 source_revision:=person.source_revision;
 IF person.id IS NULL THEN RAISE EXCEPTION 'Current owned contact required';END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('contactId',person.id,'revision',source_revision,'personalData',person.personal_data,'provenance',person.provenance,'displayName',person.display_name,'role',person.role,'firmablePersonId',person.firmable_person_id,'fictionalised',person.fictionalised)),'UTF8')),'hex');
END $$;

-- Name: agent_demo_evidence_immutable(); Type: FUNCTION
CREATE FUNCTION public.agent_demo_evidence_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN RAISE EXCEPTION 'Demo mapping evidence is immutable';END $$;

-- Name: agent_demo_evidence_insert_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_demo_evidence_insert_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE run public.agent_demo_runs%ROWTYPE;request public.agent_demo_mapping_requests%ROWTYPE;receipt public.agent_demo_mapping_receipts%ROWTYPE;item jsonb;wire jsonb;seen uuid[]:='{}';ordinal integer:=0;
BEGIN
 IF TG_TABLE_NAME='agent_demo_runs' THEN
  IF current_setting('app.acquire_org',true) IS DISTINCT FROM NEW.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM NEW.owner_user_id
  OR NOT public.agent_demo_run_bindings_match(NEW.organization_id,NEW.owner_user_id,NEW.run_id,NEW.integration_id,NEW.configuration_ref,NEW.senders) THEN RAISE EXCEPTION 'Exact current owned demo sender registry required';END IF;
  RETURN NEW;
 END IF;
 IF current_setting('app.acquire_org',true) IS DISTINCT FROM NEW.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'Current owned demo evidence scope required';END IF;
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=NEW.demo_run_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.created_by;
 IF run.id IS NULL OR NOT public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 OR NOT EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes m JOIN public.member x ON x.organization_id=m.organization_id AND x.user_id=m.created_by
  WHERE m.mandate_id=NEW.mandate_id AND m.organization_id=NEW.organization_id AND m.created_by=NEW.created_by AND m.mode='demo' AND m.demo_id=NEW.demo_id)
 THEN RAISE EXCEPTION 'Current owned demo source and registry required';END IF;
 IF TG_TABLE_NAME='agent_demo_mapping_requests' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.manifest))<>7 OR NEW.manifest->>'version' IS DISTINCT FROM '1' OR NEW.manifest->>'demoId' IS DISTINCT FROM NEW.demo_id::text OR NEW.manifest->>'mandateId' IS DISTINCT FROM NEW.mandate_id::text
  OR NEW.manifest->>'organizationId' IS DISTINCT FROM NEW.organization_id OR NEW.manifest->>'userId' IS DISTINCT FROM NEW.created_by OR NEW.manifest->>'requestKey' IS DISTINCT FROM NEW.request_key::text
  OR jsonb_typeof(NEW.manifest->'people') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.manifest->'people') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Exact immutable demo request manifest required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.manifest->'people') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3
   OR item->>'sourcePersonId' IS NULL OR item->>'sourcePersonId'!~'^[a-f0-9-]{36}$' OR item->>'sourceFingerprint' IS NULL OR item->>'sourceFingerprint'!~'^[a-f0-9]{64}$'
   OR item->>'sourcePersonId'=ANY(seen::text[]) THEN RAISE EXCEPTION 'Exact unique demo source metadata required';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text=item->>'sourcePersonId' AND c.organization_id=NEW.organization_id AND c.xmin::text=item->>'sourceRevision'
    AND (c.mandate_id=NEW.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.mandate_id=NEW.mandate_id AND mt.organization_id=c.organization_id AND mt.target_id=c.target_id)))
   THEN RAISE EXCEPTION 'Current mandate contact revision required';END IF;
   IF item->>'sourceFingerprint' IS DISTINCT FROM public.agent_demo_contact_fingerprint((item->>'sourcePersonId')::uuid) THEN RAISE EXCEPTION 'Current canonical contact fingerprint required';END IF;
   seen:=seen||ARRAY[(item->>'sourcePersonId')::uuid];
  END LOOP;
 ELSIF TG_TABLE_NAME='agent_demo_mapping_receipts' THEN
  SELECT * INTO request FROM public.agent_demo_mapping_requests WHERE request_key=NEW.request_key AND organization_id=NEW.organization_id AND mandate_id=NEW.mandate_id AND created_by=NEW.created_by AND demo_id=NEW.demo_id AND demo_run_id=NEW.demo_run_id;
  IF request.request_key IS NULL OR (SELECT count(*) FROM jsonb_object_keys(NEW.result))<>9 OR NEW.result->>'version' IS DISTINCT FROM '1' OR NEW.result->>'demoId' IS DISTINCT FROM NEW.demo_id::text OR NEW.result->>'runId' IS DISTINCT FROM run.run_id
   OR NEW.result->>'mappingDigest' IS NULL OR NEW.result->>'mappingDigest'!~'^[a-f0-9]{64}$'
   OR jsonb_typeof(NEW.result->'mappings') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'mappings')<>jsonb_array_length(request.manifest->'people')
   OR jsonb_typeof(NEW.result->'accounts') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'accounts')<>3
  THEN RAISE EXCEPTION 'Exact verified demo batch receipt required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(run.senders) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result->'accounts') a WHERE a->>'channel'=item->>'channel' AND a->>'providerAccountId'=item->>'providerAccountId' AND a->>'sourceId'=item->>'sourceId') THEN RAISE EXCEPTION 'Demo receipt sender differs from registry';END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(request.manifest->'people') LOOP
   wire:=NEW.result->'mappings'->ordinal;ordinal:=ordinal+1;
   IF NOT public.agent_demo_wire_valid(run.run_id,wire) OR wire->>'sourcePersonId' IS DISTINCT FROM item->>'sourcePersonId' OR wire->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR wire->>'sourceFingerprint' IS DISTINCT FROM item->>'sourceFingerprint' THEN RAISE EXCEPTION 'Ordered verified demo batch differs from source manifest';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result->'mappings') m WHERE m->>'sourcePersonId'=item->>'sourcePersonId' AND m->>'sourceRevision'=item->>'sourceRevision' AND m->>'sourceFingerprint'=item->>'sourceFingerprint') THEN RAISE EXCEPTION 'Demo batch changed its source manifest';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text=item->>'sourcePersonId' AND c.organization_id=NEW.organization_id AND c.xmin::text=item->>'sourceRevision') OR item->>'sourceFingerprint' IS DISTINCT FROM public.agent_demo_contact_fingerprint((item->>'sourcePersonId')::uuid) THEN RAISE EXCEPTION 'Demo source changed before receipt persistence';END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='agent_demo_contact_mappings' THEN
  SELECT * INTO receipt FROM public.agent_demo_mapping_receipts WHERE request_key=NEW.request_key AND organization_id=NEW.organization_id AND mandate_id=NEW.mandate_id AND demo_id=NEW.demo_id AND created_by=NEW.created_by AND demo_run_id=NEW.demo_run_id;
  wire:=NEW.wire;
  IF receipt.request_key IS NULL OR NOT public.agent_demo_wire_valid(run.run_id,wire)
   OR wire->>'sourcePersonId' IS DISTINCT FROM NEW.contact_id::text OR wire->>'sourceRevision' IS DISTINCT FROM NEW.source_revision OR wire->>'sourceFingerprint' IS DISTINCT FROM NEW.source_fingerprint
   OR wire->>'simulatorLeadId' IS NULL OR wire->>'simulatorLeadId'!~'^lead-[0-9]{3}$' OR wire->>'email' IS DISTINCT FROM (wire->>'simulatorLeadId')||'@'||run.run_id||'.leads.acquire.test'
   OR wire->>'phone' IS NULL OR wire->>'phone'!~'^[+]999[0-9]{12}$' OR wire->>'linkedin' IS DISTINCT FROM 'https://www.linkedin.com/in/sim-'||run.run_id||'-'||(wire->>'simulatorLeadId')
   OR wire->>'providerId' IS DISTINCT FROM 'ACo_sim_'||run.run_id||'_'||(wire->>'simulatorLeadId') OR NEW.mapping_digest IS DISTINCT FROM receipt.result->>'mappingDigest'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt.result->'mappings') m WHERE m=wire)
   OR NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.organization_id=NEW.organization_id AND c.xmin::text=NEW.source_revision)
   OR NEW.source_fingerprint IS DISTINCT FROM public.agent_demo_contact_fingerprint(NEW.contact_id)
  THEN RAISE EXCEPTION 'Exact current immutable demo contact mapping required';END IF;
 ELSE RAISE EXCEPTION 'Unsupported demo evidence table';END IF;
 RETURN NEW;
END $_$;

-- Name: agent_demo_execution_readiness(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_demo_execution_readiness(p_thread uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_demo_manual_outreach_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_demo_manual_outreach_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE old_mandate uuid;new_mandate uuid;old_org text;new_org text;
BEGIN
 IF TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') THEN
  IF TG_OP='UPDATE' THEN old_mandate:=OLD.mandate_id;old_org:=OLD.organization_id;END IF;
  new_mandate:=NEW.mandate_id;new_org:=NEW.organization_id;
 ELSIF TG_TABLE_NAME='messages' THEN
  IF TG_OP='UPDATE' THEN SELECT mandate_id,organization_id INTO old_mandate,old_org FROM public.sequence_enrolments WHERE id=OLD.enrolment_id AND organization_id=OLD.organization_id;END IF;
  SELECT mandate_id,organization_id INTO new_mandate,new_org FROM public.sequence_enrolments WHERE id=NEW.enrolment_id AND organization_id=NEW.organization_id;
 ELSE RAISE EXCEPTION 'Unsupported manual outreach guard';END IF;
 -- Check OLD as well: changing/reparenting a demo record cannot launder its
 -- origin. Real/historical records keep existing writes and ownership guards.
 IF EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes m WHERE m.mode='demo'
  AND ((m.mandate_id=old_mandate AND m.organization_id=old_org) OR (m.mandate_id=new_mandate AND m.organization_id=new_org)))
 THEN
  -- Exact terminal projection only. V1 lacks sealed origin; retain its
  -- authenticated receipt in the ledger but hold ambiguous materialization.
  IF TG_TABLE_NAME='messages' AND TG_OP='UPDATE' THEN
   IF NEW.state='sent' AND OLD.state IN('approved','sent') AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id AND NEW.enrolment_id=OLD.enrolment_id
   AND to_jsonb(NEW)-ARRAY['state','provider_message_id','provider_thread_id','sent_at','updated_at'] = to_jsonb(OLD)-ARRAY['state','provider_message_id','provider_thread_id','sent_at','updated_at']
   AND EXISTS(SELECT 1 FROM public.communication_submission_receipts r JOIN public.sequence_enrolments e ON e.id=OLD.enrolment_id AND e.organization_id=OLD.organization_id
    WHERE r.source_kind='draft' AND r.source_id=OLD.id AND r.operation='message' AND r.organization_id=OLD.organization_id
    AND r.owner_user_id=current_setting('app.acquire_user',true) AND r.organization_id=current_setting('app.acquire_org',true)
    AND r.origin_status='sealed' AND r.origin_mandate_id=e.mandate_id AND r.origin_enrolment_id=e.id AND r.source_revision IS NOT NULL
    AND r.source_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('source',jsonb_build_object('kind','draft','messageId',OLD.id,'revision',r.source_revision),'subject',OLD.subject,'body',OLD.body,'approvedBy',OLD.approved_by,'approvedAt',to_char(OLD.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'UTF8')),'hex')
    AND (OLD.state='sent' OR r.source_revision=to_char(OLD.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND r.provider_reference=NEW.provider_message_id AND r.provider_conversation_reference IS NOT DISTINCT FROM NEW.provider_thread_id AND r.submitted_at=NEW.sent_at
    AND (OLD.provider_message_id IS NULL OR OLD.provider_message_id=NEW.provider_message_id) AND (OLD.provider_thread_id IS NULL OR OLD.provider_thread_id IS NOT DISTINCT FROM NEW.provider_thread_id) AND (OLD.sent_at IS NULL OR OLD.sent_at=NEW.sent_at)
    AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=r.organization_id AND user_id=r.owner_user_id)
    AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=r.organization_id AND writer_xid=txid_current()))
   THEN RETURN NEW;END IF;
  END IF;
  RAISE EXCEPTION 'Manual outreach is disabled for demo mandates; use reviewed demo agent routes.';
 END IF;
 RETURN NEW;
END $$;

-- Name: agent_demo_original_effect_identity_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_demo_original_effect_identity_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE body_changed boolean;
BEGIN
 IF NOT (OLD.name~'^(email|whatsapp|linkedin)[.]' OR NEW.name~'^(email|whatsapp|linkedin)[.]')
 OR NOT (public.agent_is_demo_origin(OLD.mandate_id) OR public.agent_is_demo_origin(NEW.mandate_id)) THEN RETURN NEW;END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name
 OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
 OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.request_key IS DISTINCT FROM OLD.request_key
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR (NEW.input-'body') IS DISTINCT FROM (OLD.input-'body') THEN
  RAISE EXCEPTION 'Original demo effect source is immutable';
 END IF;
 body_changed:=NEW.input IS DISTINCT FROM OLD.input;
 IF (body_changed OR NEW.input_digest IS DISTINCT FROM OLD.input_digest)
 AND NOT (body_changed AND OLD.state='proposed' AND NEW.state='proposed' AND OLD.fence=0 AND NEW.fence=0) THEN
  RAISE EXCEPTION 'Original demo effect body requires a current pending human review';
 END IF;
 RETURN NEW;
END $$;

-- Name: agent_demo_run_bindings_match(text, text, text, text, text, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_demo_run_bindings_match(p_org text, p_owner text, p_run text, p_integration text, p_config text, p_senders jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
BEGIN
 RETURN false;
END $_$;

-- Name: agent_demo_runtime_ready(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_demo_runtime_ready(p_run uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 RETURN false;
END $$;

-- Name: agent_demo_wire_valid(text, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_demo_wire_valid(p_run text, p_wire jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
 SELECT coalesce(CASE WHEN jsonb_typeof(p_wire)='object' THEN
  (SELECT count(*) FROM jsonb_object_keys(p_wire))=8
  AND p_wire->>'sourcePersonId'~'^[a-f0-9-]{36}$' AND p_wire->>'sourceRevision'~'^[0-9]{1,30}$' AND p_wire->>'sourceFingerprint'~'^[a-f0-9]{64}$'
  AND p_wire->>'simulatorLeadId'~'^lead-[0-9]{3}$'
  AND p_wire->>'email'=(p_wire->>'simulatorLeadId')||'@'||p_run||'.leads.acquire.test'
  AND p_wire->>'phone'~'^[+]999[0-9]{12}$'
  AND p_wire->>'linkedin'='https://www.linkedin.com/in/sim-'||p_run||'-'||(p_wire->>'simulatorLeadId')
  AND p_wire->>'providerId'='ACo_sim_'||p_run||'_'||(p_wire->>'simulatorLeadId')
 ELSE false END,false);
$_$;

-- Name: agent_driver_allows(text, text, uuid, text, text, uuid, bigint); Type: FUNCTION
CREATE FUNCTION public.agent_driver_allows(org text, actor text, contact uuid, address text, source_kind text, source_ref uuid, expected_epoch bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE candidates uuid[];identities text[];current public.agent_conversations%ROWTYPE;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR org IS DISTINCT FROM current_setting('app.acquire_org',true) OR actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held authenticated dispatch authority required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 SELECT array_agg(DISTINCT conversation_id) INTO candidates FROM public.agent_person_claims WHERE organization_id=org AND identity_key=ANY(identities);
 IF candidates IS NULL THEN RETURN source_kind IN('campaign','draft'); END IF;
 IF cardinality(candidates)<>1 THEN RETURN false; END IF;
 SELECT * INTO current FROM public.agent_conversations WHERE id=candidates[1] AND organization_id=org;
 IF current.owner_user_id<>actor OR current.phase<>'active' THEN RETURN false; END IF;
 IF source_kind='campaign' THEN RETURN current.driver_kind='sequence' AND current.sequence_enrolment_id=source_ref AND NOT source_ref=ANY(current.retired_enrolments); END IF;
 IF source_kind='draft' THEN RETURN current.driver_kind='human' AND current.human_user_id=actor; END IF;
 IF source_kind='agent' THEN RETURN current.driver_kind='agent' AND current.id=source_ref AND expected_epoch IS NOT NULL AND current.epoch=expected_epoch AND EXISTS(SELECT 1 FROM public.agent_responsibilities r WHERE r.id=current.responsibility_id AND r.state IN('ready','waiting')); END IF;
 RETURN false;
END $$;

-- Name: agent_effective_contact(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_effective_contact(p_mandate uuid, p_contact uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);person public.contacts%ROWTYPE;intent public.agent_mandate_execution_modes%ROWTYPE;mapping public.agent_demo_contact_mappings%ROWTYPE;run public.agent_demo_runs%ROWTYPE;source_revision text;source_fingerprint text;source jsonb;
BEGIN
 IF org IS NULL OR org='' OR actor IS NULL OR actor='' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org) THEN RAISE EXCEPTION 'Current owned mandate contact required';END IF;
 SELECT * INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=org
 AND (c.mandate_id=p_mandate OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.mandate_id=p_mandate AND mt.organization_id=org AND mt.target_id=c.target_id)) FOR SHARE OF c;
 IF person.id IS NULL THEN RAISE EXCEPTION 'Current owned mandate contact required';END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id AND organization_id=org;
 source_fingerprint:=public.agent_demo_contact_fingerprint(person.id);
 source:=jsonb_build_object('id',person.id,'targetId',person.target_id,'displayName',person.display_name,'role',person.role,'personalData',person.personal_data,'provenance',person.provenance,'firmablePersonId',person.firmable_person_id,'fictionalised',person.fictionalised,'revision',source_revision,'fingerprint',source_fingerprint);
 SELECT * INTO intent FROM public.agent_mandate_execution_modes WHERE mandate_id=p_mandate AND organization_id=org;
 IF intent.mode IS DISTINCT FROM 'demo' THEN RETURN jsonb_build_object('mode','real','sourceContact',source,'demoProjection',NULL);END IF;
 IF intent.created_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Current owned demo mapping required';END IF;
 SELECT * INTO mapping FROM public.agent_demo_contact_mappings WHERE mandate_id=p_mandate AND organization_id=org AND created_by=actor AND contact_id=person.id AND demo_id=intent.demo_id;
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=mapping.demo_run_id AND organization_id=org AND owner_user_id=actor;
 IF mapping.id IS NULL OR mapping.source_revision IS DISTINCT FROM source_revision OR mapping.source_fingerprint IS DISTINCT FROM source_fingerprint OR run.id IS NULL
 OR NOT public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 THEN RAISE EXCEPTION 'Current immutable demo recipients are unavailable; real contact fallback is disabled.';END IF;
 RETURN jsonb_build_object('mode','demo','sourceContact',source,'demoProjection',jsonb_build_object('mappingId',mapping.id,'demoId',mapping.demo_id,'demoRunId',run.id,'runId',run.run_id,'integrationId',run.integration_id,'configurationRef',run.configuration_ref,'sourceRevision',mapping.source_revision,'sourceFingerprint',mapping.source_fingerprint,'mappingDigest',mapping.mapping_digest,'requestKey',mapping.request_key,'recipients',jsonb_build_object('email',mapping.wire->>'email','whatsapp',mapping.wire->>'phone','linkedin',mapping.wire->>'linkedin'),'providerId',mapping.wire->>'providerId','simulatorLeadId',mapping.wire->>'simulatorLeadId','senders',run.senders));
END $$;

-- Name: agent_email_reply_parent(jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_email_reply_parent(history jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT jsonb_build_object('id',message->>'id','contentDigest',encode(sha256(convert_to(COALESCE(message->>'subject','')||E'\n'||(message->>'text'),'UTF8')),'hex')) FROM jsonb_array_elements(history) message WHERE message->>'id' IS NOT NULL AND message->>'text' IS NOT NULL ORDER BY (message->>'direction'='inbound') DESC,(message->>'at')::timestamptz DESC,message->>'id' DESC LIMIT 1;
$$;

-- Name: agent_email_window_open(timestamp with time zone); Type: FUNCTION
CREATE FUNCTION public.agent_email_window_open(at_time timestamp with time zone) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT extract(isodow FROM at_time AT TIME ZONE 'Australia/Melbourne') BETWEEN 1 AND 5
 AND extract(hour FROM at_time AT TIME ZONE 'Australia/Melbourne')>=9
 AND extract(hour FROM at_time AT TIME ZONE 'Australia/Melbourne')<17;
$$;

-- Name: agent_enrol_reviewed_sequence(uuid, uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_enrol_reviewed_sequence(p_thread uuid, p_operation uuid, p_contact uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;op public.agent_operations%ROWTYPE;v public.campaign_sequence_versions%ROWTYPE;b public.communication_bindings%ROWTYPE;e public.campaign_enrolments%ROWTYPE;selected jsonb;snapshot jsonb;candidate jsonb;recipient text;binding_snapshot jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND thread_id=t.id AND organization_id=org AND owner_user_id=actor AND name='sequence.enrol' AND state IN('approved','running');
 IF op.id IS NULL OR op.input->>'nativeSequenceEnrolmentVersion'<>'1' OR jsonb_array_length(op.input->'selected') NOT BETWEEN 1 AND 5 OR NOT EXISTS(SELECT 1 FROM public.agent_review_batches r WHERE r.thread_id=t.id AND r.state='approved' AND r.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact current sequence enrolment approval required'; END IF;
 SELECT x INTO selected FROM jsonb_array_elements(op.input->'selected') x WHERE x->>'contactId'=p_contact::text;
 IF selected IS NULL THEN RAISE EXCEPTION 'Contact was not in the reviewed enrolment'; END IF;
 SELECT version.* INTO v FROM public.campaign_sequence_versions version JOIN public.campaign_sequences s ON s.id=version.sequence_id AND s.organization_id=org AND s.owner_user_id=actor AND s.mandate_id=t.mandate_id WHERE version.id=(op.input->>'versionId')::uuid AND version.sequence_id=(op.input->>'sequenceId')::uuid AND version.organization_id=org AND version.owner_user_id=actor AND version.version=(op.input->>'version')::integer;
 IF v.id IS NULL OR v.definition IS DISTINCT FROM op.input->'definition' OR v.n8n_workflow_id IS DISTINCT FROM op.input->>'workflowId' OR op.input->>'runtime' IS DISTINCT FROM (CASE WHEN v.n8n_workflow_id IS NULL THEN 'legacy' ELSE 'n8n' END) THEN RAISE EXCEPTION 'Original published version or runtime changed'; END IF;
 SELECT * INTO b FROM public.communication_bindings WHERE id=(op.input->>'bindingId')::uuid AND organization_id=org AND owner_user_id=actor AND channel='email' AND backend='unipile' AND authority='service';
 binding_snapshot:=jsonb_build_object('applicationId',b.application_id,'tenantId',b.organization_id,'ownerId',b.owner_user_id,'connectionId',b.service_connection_id,'accountId',b.service_account_id,'generation',b.generation,'channel',b.channel,'platform',b.platform,'backend',b.backend);
 IF b.id IS NULL OR binding_snapshot IS DISTINCT FROM op.input->'bindingSnapshot' THEN RAISE EXCEPTION 'Original approved email account changed'; END IF;
 -- A committed receipt may be read after the contact's source changes. It never
 -- creates another enrolment or resets a later human pause/stop/step transition.
 SELECT * INTO e FROM public.campaign_enrolments WHERE id=(selected->>'enrolmentId')::uuid AND organization_id=org AND owner_user_id=actor AND version_id=v.id AND contact_id=p_contact AND mandate_id=t.mandate_id;
 IF e.id IS NOT NULL THEN RETURN jsonb_build_object('id',e.id,'contactId',p_contact,'versionId',v.id,'state',e.state,'runtime',e.runtime,'sent',false); END IF;
 snapshot:=public.agent_target_snapshot(t.id,ARRAY[p_contact]);candidate:=snapshot->'candidates'->0;
 IF snapshot->>'mandateRevision' IS DISTINCT FROM op.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM op.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM op.input->>'responsibilityRevision' OR candidate IS NULL OR candidate->>'sourceRevision' IS DISTINCT FROM selected->>'sourceRevision' OR jsonb_array_length(candidate->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Contact evidence, suppression, ownership or supervision changed'; END IF;
 recipient:=lower(btrim(candidate->>'email'));
 IF recipient IS DISTINCT FROM selected->>'recipient' OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(public.agent_canonical_contact_aliases(p_contact))) THEN RAISE EXCEPTION 'Canonical contact requires review'; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND lower(btrim(h.email))=recipient)
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches l WHERE l.organization_id=org AND l.resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.campaign_contact_assignments a WHERE a.organization_id=org AND a.owner_user_id<>actor AND (a.contact_id=ANY(public.agent_canonical_contact_aliases(p_contact)) OR lower(btrim(a.email))=recipient)) THEN RAISE EXCEPTION 'Canonical contact hold or original sender requires review'; END IF;
 INSERT INTO public.campaign_contact_assignments(organization_id,contact_id,email,owner_user_id) VALUES(org,p_contact,recipient,actor) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_contact_assignments WHERE organization_id=org AND contact_id=p_contact AND email IS NOT DISTINCT FROM recipient AND owner_user_id=actor) THEN RAISE EXCEPTION 'Contact belongs to another sender'; END IF;
 INSERT INTO public.campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,mailbox_connection_id,recipient_email,recipient_phone,recipient_linkedin,state,stop_reason,step_index,next_step_at,runtime)
 VALUES((selected->>'enrolmentId')::uuid,org,actor,v.sequence_id,v.id,t.mandate_id,p_contact,NULL,recipient,NULL,NULL,'needs_review','initial_conversation_requires_review',(selected->>'stepIndex')::integer,NULL,op.input->>'runtime') RETURNING * INTO e;
 INSERT INTO public.campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id) VALUES(e.id,org,actor,'email',b.id);
 INSERT INTO public.campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES(org,actor,p_contact,'email',recipient,recipient,recipient,e.started_at) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.sequence_enrolled','campaign_enrolment',e.id,jsonb_build_object('operationId',op.id,'sequenceId',v.sequence_id,'versionId',v.id,'contactId',p_contact,'bindingId',b.id,'initialState','needs_review','runtime',e.runtime));
 RETURN jsonb_build_object('id',e.id,'contactId',p_contact,'versionId',v.id,'state',e.state,'runtime',e.runtime,'sent',false);
END $_$;

-- Name: agent_event_eligible(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_event_eligible(p_thread uuid, p_kind text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 RETURN public.agent_event_eligible_before_channel_due(p_thread,CASE WHEN p_kind IN('whatsapp.reconcile','linkedin.reconcile') THEN 'email.reconcile' WHEN p_kind='channel.due' THEN 'conversation.reminder' ELSE p_kind END);
END $$;

-- Name: agent_event_eligible_before_channel_due(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_event_eligible_before_channel_due(p_thread uuid, p_kind text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE runtime text:=nullif(current_setting('app.acquire_runtime_id',true),'');
BEGIN
 IF runtime IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.agent_runtime_registrations g JOIN public.agent_responsibilities r ON r.id=g.responsibility_id AND r.thread_id=g.thread_id
  JOIN public.member m ON m.organization_id=g.organization_id AND m.user_id=g.owner_user_id
  WHERE g.thread_id=p_thread AND g.runtime_id=runtime AND g.responsibility_revision=r.revision
  AND g.organization_id=r.organization_id AND g.owner_user_id=r.owner_user_id AND g.mandate_id=r.mandate_id
 ) THEN RETURN false;END IF;
 RETURN public.agent_event_eligible_before_registry(p_thread,p_kind);
END $$;

-- Name: agent_event_eligible_before_registry(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_event_eligible_before_registry(p_thread uuid, p_kind text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;invoker text:=current_setting('role',true);
BEGIN
 IF invoker NOT IN('acquire_agent_user','acquire_agent_worker') THEN RAISE EXCEPTION 'Authenticated native event scope required'; END IF;
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread;
 IF t.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=t.organization_id AND m.user_id=t.owner_user_id) THEN RETURN false; END IF;
 IF invoker='acquire_agent_user' AND (t.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR t.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)) THEN RETURN false; END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id;
 -- Generic saved-conversation events predate native responsibilities. Only the
 -- scoped user claimer retains that compatibility; worker enumeration below
 -- always joins a persisted responsibility.
 IF r.id IS NULL THEN RETURN invoker='acquire_agent_user' AND NOT EXISTS(SELECT 1 FROM public.agent_responsibilities WHERE thread_id=t.id); END IF;
 IF r.state IN('ready','waiting') THEN RETURN true; END IF;
 RETURN r.state IN('paused','human_owned','complete') AND p_kind IN('human.handoff_reminder','email.reconcile','conversation.history_changed','human.handoff_required','human.handoff_updated','agent.review_required');
END $$;

-- Name: agent_fields_company_snapshot(uuid, uuid, uuid[], uuid); Type: FUNCTION
CREATE FUNCTION public.agent_fields_company_snapshot(p_thread uuid, p_root uuid, p_targets uuid[] DEFAULT NULL::uuid[], p_ignore uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE snapshot jsonb;item jsonb;items jsonb:='[]';mid uuid;source jsonb;projection jsonb;reasons jsonb;
BEGIN
 snapshot:=public.agent_fields_snapshot_before_company_projection(p_thread,p_root,p_targets,p_ignore);
 SELECT mandate_id INTO mid FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'companies') LOOP
  source:=public.agent_fields_current_source(current_setting('app.acquire_org',true),mid,(item->>'targetId')::uuid);projection:=source->'projection';
  IF projection IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(reason),'[]') INTO reasons FROM jsonb_array_elements(item->'blockedReasons')reason WHERE reason<>'"company_excluded"'::jsonb;
   item:=item||jsonb_build_object('target',projection->'target','sourceRevision',source->>'sourceRevision','blockedReasons',reasons||(projection->'blockedReasons'),'companyIdentityPolicyVersion',1);
  END IF;items:=items||jsonb_build_array(item);
 END LOOP;RETURN snapshot||jsonb_build_object('companies',items);
END $$;

-- Name: agent_fields_current_source(text, uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_fields_current_source(p_org text, p_mandate uuid, p_target uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE base text;projection jsonb;
BEGIN
 SELECT encode(sha256(convert_to(jsonb_build_object('target',g.xmin::text,'membership',mt.version,'assessment',mt.assessment)::text,'UTF8')),'hex') INTO base FROM public.targets g JOIN public.mandate_targets mt ON mt.target_id=g.id AND mt.organization_id=g.organization_id AND mt.mandate_id=p_mandate WHERE g.id=p_target AND g.organization_id=p_org;
 IF base IS NULL THEN RAISE EXCEPTION 'Owned public company membership required';END IF;
 projection:=public.agent_current_company_projection(p_org,p_mandate,p_target);
 IF projection IS NULL THEN RETURN jsonb_build_object('sourceRevision',base);END IF;
 RETURN jsonb_build_object('sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,projection->>'digest')),'UTF8')),'hex'),'projection',projection);
END $$;

-- Name: agent_fields_job_before_company_projection(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_fields_job_before_company_projection(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;child public.research_jobs%ROWTYPE;snapshot jsonb;item jsonb;current_item jsonb;ids uuid[];job uuid;cfg jsonb;child_cfg jsonb;scope_count integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.fields' AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL OR o.input->>'nativeFieldsPlanVersion' IS DISTINCT FROM '1' OR o.input->'execution' IS DISTINCT FROM '{"pipeline":"public-fields-v1","peopleResearch":false,"ai":false}'::jsonb OR o.input->'providerPolicy' IS DISTINCT FROM '{"version":1,"requestCeilingMicroUsd":"1000000","perCompany":{"search":12,"page":64},"maxAttempts":{"search":60,"page":320,"ai":0,"firmable":0}}'::jsonb OR jsonb_typeof(o.input->'selected') IS DISTINCT FROM 'array' OR coalesce(jsonb_array_length(o.input->'selected'),0) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Exact reviewed bounded public-field plan required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact public-field approval required';END IF;
 SELECT array_agg((s->>'targetId')::uuid) INTO ids FROM jsonb_array_elements(o.input->'selected') s;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids)x) THEN RAISE EXCEPTION 'Distinct company selection required';END IF;
 snapshot:=public.agent_fields_company_snapshot(o.thread_id,(o.input->>'sourceRootId')::uuid,ids,o.id);
 IF snapshot->>'mandateRevision' IS DISTINCT FROM o.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM o.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM o.input->>'responsibilityRevision' THEN RAISE EXCEPTION 'Public-field supervision changed';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  SELECT value INTO current_item FROM jsonb_array_elements(snapshot->'companies') WHERE value->>'targetId'=item->>'targetId';
  IF current_item IS NULL OR current_item->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR current_item->>'domain' IS DISTINCT FROM item->>'domain' OR jsonb_array_length(current_item->'blockedReasons')<>0 OR jsonb_typeof(item->'verifyAbn') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'fields')>9 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'fields')f WHERE f NOT IN('description','company_emails','company_phones','year_founded','acn','website_address','employee_count','revenue','accreditations')) OR (jsonb_array_length(item->'fields')=0 AND item->>'verifyAbn'<>'true') THEN RAISE EXCEPTION 'Saved public company or field scope changed';END IF;
 END LOOP;
 job:=(o.input->'config'->>'requestId')::uuid;
 SELECT * INTO j FROM public.research_jobs WHERE id=job FOR UPDATE;
 IF j.id IS NOT NULL AND (j.organization_id IS DISTINCT FROM org OR j.mandate_id IS DISTINCT FROM o.mandate_id OR j.created_by IS DISTINCT FROM actor OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text) THEN RAISE EXCEPTION 'Public-field handle belongs to different work';END IF;
 cfg:=jsonb_build_object('approved',true,'workflow','business','mode','automatic','discover',false,'findPeople',false,'includeCompanyPeople',false,'seeds','[]'::jsonb,'searchTerms','[]'::jsonb,'geography','Australia','researchScope','Reviewed public company fields','researchRunId',job,'executionSlot','agent-fields:'||o.thread_id,'automaticDeadline',0,'nativeFieldsSourceRootId',o.input->>'sourceRootId','budget',jsonb_build_object('maxPages',320,'maxDomains',50,'maxMinutes',10,'maxModelCalls',0),'nativeAgent',jsonb_build_object('version',1,'operationId',o.id,'threadId',o.thread_id,'responsibilityId',o.input->>'responsibilityId','responsibilityRevision',(o.input->>'responsibilityRevision')::integer,'mandateRevision',o.input->>'mandateRevision','contextRevision',o.input->>'contextRevision','providerAdmission','required'));
 IF j.id IS NULL THEN INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message) VALUES(job,org,o.mandate_id,actor,'queued',cfg,'[]','Reviewed public company fields saved');ELSE cfg:=j.config;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  SELECT * INTO child FROM public.research_jobs WHERE id=(item->>'childJobId')::uuid FOR UPDATE;
  IF child.id IS NOT NULL AND (child.organization_id IS DISTINCT FROM org OR child.mandate_id IS DISTINCT FROM o.mandate_id OR child.created_by IS DISTINCT FROM actor OR child.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text OR child.config->>'targetId' IS DISTINCT FROM item->>'targetId' OR child.config->>'parentJobId' IS DISTINCT FROM job::text OR child.config->>'executionSlot' IS DISTINCT FROM 'company-background:'||(item->>'childJobId') OR child.config->>'nativeFieldsSourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR child.config->'companyBackgroundResearch'->'fields' IS DISTINCT FROM item->'fields' OR child.config->'companyBackgroundResearch'->'verifyAbn' IS DISTINCT FROM item->'verifyAbn') THEN RAISE EXCEPTION 'Public-field child handle belongs to different work';END IF;
  child_cfg:=cfg||jsonb_build_object('executionSlot','company-background:'||(item->>'childJobId'),'researchTask','field','purpose','firmographics','parentJobId',job,'targetId',item->>'targetId','companyName',item->>'name','companyDomain',item->>'domain','nativeFieldsSourceRevision',item->>'sourceRevision','companyBackgroundResearch',jsonb_build_object('version',1,'fields',item->'fields','sourceRootId',o.input->>'sourceRootId','profileCapturedAt',clock_timestamp(),'verifyAbn',(item->>'verifyAbn')::boolean));
  IF child.id IS NULL THEN INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message) VALUES((item->>'childJobId')::uuid,org,o.mandate_id,actor,'queued',child_cfg,'[]','Exact public-field child saved; separate native root dispatch required');END IF;
 END LOOP;
 SELECT count(*) INTO scope_count FROM(SELECT DISTINCT ON(scope_key)scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro'])ORDER BY scope_key,window_start DESC,id)a WHERE scope_key LIKE '%:'||unit AND((unit='calls' AND cap-spent-reserved>=1)OR(unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',job,'status',coalesce(j.status,'queued'),'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 IF cfg->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'public-fields-v1' THEN UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+600000),'{nativeAgent,providerAdmission}','"public-fields-v1"'),message='Exact public company fields ready' WHERE id=job;END IF;
 RETURN jsonb_build_object('jobId',job,'status',coalesce(j.status,'queued'),'dispatchReady',true);
END $$;

-- Name: agent_fields_persistence_permitted(uuid, text, uuid, text, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_fields_persistence_permitted(p_job uuid, p_org text, p_mandate uuid, p_actor text, p_config jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE j public.research_jobs%ROWTYPE;o public.agent_operations%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mr text;s jsonb;source jsonb;
BEGIN
 IF current_setting('role',true) IN('acquire_agent_user','acquire_campaign_user','acquire_agent_worker') THEN RAISE EXCEPTION 'Trusted public-field persistence required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=p_job AND organization_id=p_org AND mandate_id=p_mandate AND created_by=p_actor AND config=p_config FOR SHARE;
 IF j.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=j.organization_id AND user_id=j.created_by)
 OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=(7426619361492031::bigint>>32)::oid AND objid=(7426619361492031::bigint&4294967295::bigint)::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=j.organization_id AND writer_xid=txid_current()) THEN RETURN false;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id::text=j.config->'nativeAgent'->>'operationId' AND organization_id=j.organization_id AND mandate_id=j.mandate_id AND owner_user_id=j.created_by AND name='research.fields' AND state='running' FOR SHARE;
 SELECT * INTO r FROM public.agent_responsibilities WHERE id::text=j.config->'nativeAgent'->>'responsibilityId' AND thread_id=o.thread_id AND organization_id=j.organization_id AND mandate_id=j.mandate_id AND owner_user_id=j.created_by FOR SHARE;
 SELECT xmin::text INTO mr FROM public.mandates WHERE id=j.mandate_id AND organization_id=j.organization_id FOR SHARE;
 IF o.id IS NULL OR r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.revision::text IS DISTINCT FROM j.config->'nativeAgent'->>'responsibilityRevision' OR r.mandate_revision IS DISTINCT FROM j.config->'nativeAgent'->>'mandateRevision' OR mr IS DISTINCT FROM r.mandate_revision OR o.input->'config'->>'requestId' IS DISTINCT FROM j.config->>'parentJobId' THEN RETURN false;END IF;
 SELECT value INTO s FROM jsonb_array_elements(o.input->'selected') WHERE value->>'targetId'=j.config->>'targetId' AND value->>'childJobId'=j.id::text;
 IF s IS NULL OR s->>'sourceRevision' IS DISTINCT FROM j.config->>'nativeFieldsSourceRevision' OR s->'fields' IS DISTINCT FROM j.config->'companyBackgroundResearch'->'fields' OR s->>'verifyAbn' IS DISTINCT FROM j.config->'companyBackgroundResearch'->>'verifyAbn' OR s->'companyIdentityPolicyVersion' IS DISTINCT FROM j.config->'companyIdentityPolicyVersion' THEN RETURN false;END IF;
 source:=public.agent_fields_current_source(j.organization_id,j.mandate_id,(s->>'targetId')::uuid);
 RETURN s->>'sourceRevision'=source->>'sourceRevision' AND (source->'projection' IS NULL OR jsonb_array_length(source->'projection'->'blockedReasons')=0);
END $$;

-- Name: agent_fields_snapshot_before_company_projection(uuid, uuid, uuid[], uuid); Type: FUNCTION
CREATE FUNCTION public.agent_fields_snapshot_before_company_projection(p_thread uuid, p_root uuid, p_targets uuid[] DEFAULT NULL::uuid[], p_ignore uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mr text;c record;items jsonb:='[]';reasons jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id;
 SELECT xmin::text INTO mr FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF t.id IS NULL OR r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mr OR cardinality(p_targets)>50 THEN RAISE EXCEPTION 'Current owned public-field scope required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.research_jobs j JOIN public.agent_operations o ON o.id::text=j.config->'nativeAgent'->>'operationId' AND o.thread_id=t.id AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.start' AND o.state='complete' AND o.input->>'nativeResearchPlanVersion'='1' WHERE j.id=p_root AND j.organization_id=org AND j.mandate_id=t.mandate_id AND j.created_by=actor AND j.config->'nativeAgent'->>'version'='1' AND j.config->'nativeAgent'->>'providerAdmission' IN('firmable-company-v1','hybrid-company-v1') AND j.status IN('complete','partial')) THEN RAISE EXCEPTION 'Saved owned native company result required';END IF;
 IF p_ignore IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_ignore AND thread_id=t.id AND organization_id=org AND owner_user_id=actor AND name='research.fields' AND input->>'sourceRootId'=p_root::text) THEN RAISE EXCEPTION 'Owned public-field operation required';END IF;
 FOR c IN SELECT g.*,g.xmin::text source_xmin,mt.version membership_version,mt.assessment FROM public.targets g JOIN public.mandate_targets mt ON mt.target_id=g.id AND mt.organization_id=g.organization_id AND mt.mandate_id=t.mandate_id WHERE g.organization_id=org AND (p_targets IS NULL OR g.id=ANY(p_targets)) AND EXISTS(SELECT 1 FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=t.mandate_id AND child.created_by=actor AND child.config->>'parentJobId'=p_root::text AND child.config->>'targetId'=g.id::text) ORDER BY g.id LIMIT 50 FOR SHARE OF g,mt LOOP
  reasons:='[]';
  IF c.qualification::text='excluded' OR c.band::text='excluded' OR c.firmographics->'screening'->>'eligibility'='excluded' OR c.assessment->>'stage' IN('excluded','parked') THEN reasons:=reasons||'"company_excluded"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.thread_id=t.id AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.fields' AND o.input->>'sourceRootId'=p_root::text AND o.state IN('proposed','approved','running','complete') AND (p_ignore IS NULL OR o.id<>p_ignore) AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.input->'selected') s WHERE s->>'targetId'=c.id::text)) THEN reasons:=reasons||'"already_attempted"'::jsonb;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('targetId',c.id,'name',left(c.company_name,300),'domain',lower(c.domain),'sourceRevision',encode(sha256(convert_to(jsonb_build_object('target',c.source_xmin,'membership',c.membership_version,'assessment',c.assessment)::text,'UTF8')),'hex'),'target',to_jsonb(c)-'source_xmin'-'membership_version'-'assessment','blockedReasons',reasons));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mr,'responsibilityId',r.id,'responsibilityRevision',r.revision,'sourceRootId',p_root,'companies',items);
END $$;

-- Name: agent_grant_immutable_scope(); Type: FUNCTION
CREATE FUNCTION public.agent_grant_immutable_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF ROW(NEW.id,NEW.thread_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.channel,NEW.actions,NEW.recipient_keys,NEW.binding_digest,NEW.max_sends,NEW.expires_at,NEW.approved_by,NEW.approved_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.thread_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.channel,OLD.actions,OLD.recipient_keys,OLD.binding_digest,OLD.max_sends,OLD.expires_at,OLD.approved_by,OLD.approved_at) THEN RAISE EXCEPTION 'Grant scope is immutable; approve a new grant'; END IF;
 IF NEW.used_sends<>OLD.used_sends THEN
  IF pg_trigger_depth()<2 OR NEW.used_sends<>OLD.used_sends+1 OR NEW.revision<>OLD.revision OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION 'Only an atomic authority use can consume a grant'; END IF;
 ELSIF NOT(OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND NEW.revision=OLD.revision+1) THEN
  RAISE EXCEPTION 'Only explicit revocation can change a grant';
 END IF;
 RETURN NEW;
END $$;

-- Name: agent_gui_testing_send_window_exempt(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_gui_testing_send_window_exempt(p_route uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
BEGIN
 RETURN false;
END $_$;

-- Name: agent_handoff_assignee_current(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_handoff_assignee_current(p_task uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 PERFORM public.agent_assert_control_scope();
 RETURN EXISTS(SELECT 1 FROM public.agent_handoffs h JOIN public.member m ON m.organization_id=h.organization_id AND m.user_id=h.assignee_user_id
 WHERE h.id=p_task AND h.organization_id=current_setting('app.acquire_org',true) AND (h.owner_user_id=current_setting('app.acquire_user',true) OR h.assignee_user_id=current_setting('app.acquire_user',true)));
END $$;

-- Name: agent_handoff_context(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_handoff_context(p_task uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE result text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT encode(sha256(convert_to(jsonb_build_object('conversation',c.id,'revision',c.revision,'epoch',c.epoch,'history',c.history_revision,'coverage',c.history_complete,'mandate',m.xmin::text,'buyer',g.xmin::text,'contact',p.xmin::text,
  'guidance',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'revision',o.revision) ORDER BY o.id),'[]'::jsonb) FROM public.agent_operations o WHERE o.thread_id=c.thread_id AND o.name='guidance.memory' AND o.state='approved'))::text,'UTF8')),'hex') INTO result
 FROM public.agent_handoffs h JOIN public.agent_conversations c ON c.id=h.conversation_id JOIN public.mandates m ON m.id=c.mandate_id JOIN public.organization g ON g.id=c.organization_id JOIN public.contacts p ON p.id=c.contact_id
 WHERE h.id=p_task AND h.organization_id=current_setting('app.acquire_org',true) AND (h.owner_user_id=current_setting('app.acquire_user',true) OR h.assignee_user_id=current_setting('app.acquire_user',true));
 IF result IS NULL THEN RAISE EXCEPTION 'Task unavailable'; END IF;RETURN result;
END $$;

-- Name: agent_handoff_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_handoff_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.assignee_user_id) THEN RAISE EXCEPTION 'Handoff assignee must be a current member'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.conversation_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.thread_id,NEW.source_history_revision,NEW.context) IS DISTINCT FROM ROW(OLD.id,OLD.conversation_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.thread_id,OLD.source_history_revision,OLD.context)
  OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Handoff source is immutable; current revision required'; END IF;
  IF actor IS DISTINCT FROM OLD.owner_user_id AND (actor IS DISTINCT FROM OLD.assignee_user_id OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) THEN RAISE EXCEPTION 'Handoff assignment authority unavailable'; END IF;
 END IF;RETURN NEW;
END $$;

-- Name: agent_handoff_inbox(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_handoff_inbox(p_mandate uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);tasks jsonb;members jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC),'[]'::jsonb) INTO tasks FROM (
  SELECT h.created_at,jsonb_build_object('id',h.id,'revision',h.revision,'state',h.state,'assignee_user_id',h.assignee_user_id,'owner_user_id',h.owner_user_id,'context_revision',public.agent_handoff_context(h.id),'context',h.context,'human_evidence',h.human_evidence,'can_reassign',h.owner_user_id=actor) item
  FROM public.agent_handoffs h WHERE h.organization_id=org AND h.mandate_id=p_mandate AND (h.owner_user_id=actor OR h.assignee_user_id=actor)
   AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=h.owner_user_id)
  ORDER BY h.created_at DESC LIMIT 100
 ) visible;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.name,u.id),'[]'::jsonb) INTO members
 FROM public.member m JOIN public."user" u ON u.id=m.user_id WHERE m.organization_id=org
 AND EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.organization_id=org AND h.mandate_id=p_mandate AND h.owner_user_id=actor);
 RETURN jsonb_build_object('tasks',tasks,'members',members,'observedAt',clock_timestamp());
END $$;

-- Name: agent_history_accounts_clear(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_history_accounts_clear(operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_ingest_channel_relationship(uuid, text, text, text, boolean, timestamp with time zone); Type: FUNCTION
CREATE FUNCTION public.agent_ingest_channel_relationship(p_route uuid, p_binding_digest text, p_identity_revision text, p_status text, p_can_message boolean, p_observed_at timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;old public.agent_linkedin_relationships%ROWTYPE;saved public.agent_linkedin_relationships%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 IF r.id IS NULL OR r.channel<>'linkedin' OR r.binding_digest IS DISTINCT FROM p_binding_digest OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) OR r.identity_revision IS DISTINCT FROM p_identity_revision OR p_status IS NULL OR p_observed_at IS NULL OR p_observed_at>public.agent_business_now() OR p_observed_at<public.agent_business_now()-interval '5 minutes'
 OR NOT(p_status='connected' AND p_can_message IS TRUE OR p_status='invitation_pending' AND p_can_message IS FALSE OR p_status='not_connected' AND p_can_message IS NOT TRUE OR p_status='unknown' AND p_can_message IS NULL) THEN RAISE EXCEPTION 'Fresh exact recorded LinkedIn relationship proof required';END IF;
 SELECT * INTO old FROM public.agent_linkedin_relationships WHERE route_id=r.id FOR UPDATE;
 IF old.route_id IS NOT NULL AND old.observed_at>p_observed_at THEN RAISE EXCEPTION 'Relationship observation is older than saved proof';END IF;
 INSERT INTO public.agent_linkedin_relationships(route_id,conversation_id,thread_id,organization_id,owner_user_id,binding_digest,identity_revision,status,can_message,observed_at)
 VALUES(r.id,r.conversation_id,r.thread_id,r.organization_id,r.owner_user_id,r.binding_digest,r.identity_revision,p_status,p_can_message,p_observed_at)
 ON CONFLICT(route_id) DO UPDATE SET status=EXCLUDED.status,can_message=EXCLUDED.can_message,observed_at=EXCLUDED.observed_at,
 revision=agent_linkedin_relationships.revision+CASE WHEN agent_linkedin_relationships.status IS DISTINCT FROM EXCLUDED.status OR agent_linkedin_relationships.can_message IS DISTINCT FROM EXCLUDED.can_message THEN 1 ELSE 0 END,updated_at=clock_timestamp() RETURNING * INTO saved;
 IF p_status='connected' AND p_can_message IS TRUE THEN UPDATE public.agent_linkedin_invitations SET state='accepted',accepted_observed_at=p_observed_at,updated_at=clock_timestamp() WHERE route_id=r.id AND binding_digest=r.binding_digest AND identity_revision=r.identity_revision AND state='pending';END IF;
 IF old.route_id IS NULL OR old.revision<>saved.revision THEN PERFORM public.agent_invalidate_person_reviews(r.conversation_id);END IF;
 PERFORM public.agent_assert_control_scope();
 RETURN jsonb_build_object('revision',saved.revision,'changed',old.route_id IS NULL OR old.revision<>saved.revision);
END $$;

-- Name: agent_intent_execution_context_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_intent_execution_context_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_invalidate_person_reviews(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_invalidate_person_reviews(p_conversation uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 PERFORM public.agent_invalidate_person_reviews_before_invitations(p_conversation);
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=p_conversation AND name='linkedin.invitation' AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=item->>'operationId' WHERE o.conversation_id=p_conversation AND o.name='linkedin.invitation' AND o.state='failed' AND o.result->>'reason'='context_changed');
END $$;

-- Name: agent_invalidate_person_reviews_before_invitations(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_invalidate_person_reviews_before_invitations(p_conversation uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp()
 WHERE conversation_id=p_conversation AND name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up') AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=item->>'operationId' WHERE o.conversation_id=p_conversation AND o.state='failed' AND o.result->>'reason'='context_changed');
END $$;

-- Name: agent_invitation_before_company_projection(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_invitation_before_company_projection(p_operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
 IF NOT EXISTS(SELECT 1 FROM public.agent_linkedin_relationships relationship WHERE relationship.route_id=r.id AND relationship.binding_digest=r.binding_digest AND relationship.identity_revision=r.identity_revision AND relationship.status='not_connected' AND relationship.can_message IS NOT TRUE AND relationship.observed_at<=public.agent_business_now() AND relationship.observed_at>=public.agent_business_now()-interval '5 minutes')
 OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations invitation WHERE invitation.route_id=r.id AND invitation.state IN('unknown','pending','accepted'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.conversation_id=r.conversation_id AND other.name='linkedin.invitation' AND other.id<>o.id AND other.state IN('running','uncertain','complete')) THEN RETURN false;END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.agent_business_now()) AND NOT public.agent_gui_testing_send_window_exempt(r.id) THEN RETURN false;END IF;
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
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>public.agent_business_now() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NOT NULL OR a.review_batch_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=o.id)<>4 THEN RETURN false;END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $_$;

-- Name: agent_invitation_no_submission(uuid, uuid, text, uuid, uuid, uuid, bigint); Type: FUNCTION
CREATE FUNCTION public.agent_invitation_no_submission(operation uuid, intent uuid DEFAULT NULL::uuid, expected_proof_digest text DEFAULT NULL::text, current_run uuid DEFAULT NULL::uuid, current_event uuid DEFAULT NULL::uuid, current_lease_owner uuid DEFAULT NULL::uuid, current_fence bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;original public.communication_dispatch_intents%ROWTYPE;reservation record;evidence jsonb;content jsonb;message_key text;route public.agent_conversation_channels%ROWTYPE;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user')
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name IS DISTINCT FROM 'linkedin.invitation' OR op.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Owned original channel operation required'; END IF;
 PERFORM 1 FROM public.agent_threads WHERE id=op.thread_id FOR UPDATE;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF conv.id IS NULL OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Original communications conversation required'; END IF;
 IF jsonb_typeof(op.input->'routeId') IS DISTINCT FROM 'string' OR op.input->>'routeId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Original recorded channel route required';END IF;
 SELECT * INTO route FROM public.agent_conversation_channels WHERE id=(op.input->>'routeId')::uuid AND conversation_id=conv.id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
 IF route.id IS NULL OR split_part(op.name,'.',1) IS DISTINCT FROM route.channel OR op.input->>'bindingDigest' IS DISTINCT FROM route.binding_digest OR op.input->>'identityRevision' IS DISTINCT FROM route.identity_revision THEN RAISE EXCEPTION 'Exact immutable original channel account required';END IF;
 IF op.result->'delivery'->>'status'='submitted' THEN RAISE EXCEPTION 'A positive original receipt cannot be closed as not submitted';END IF;

 IF intent IS NOT NULL THEN
  IF expected_proof_digest IS NULL OR expected_proof_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Authenticated original disposition required'; END IF;
  SELECT * INTO original FROM public.communication_dispatch_intents WHERE id=intent AND organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id AND binding_id=route.binding_id;
  IF (SELECT count(*) FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)<>1 OR original.id IS NULL OR original.contact_id IS DISTINCT FROM conv.contact_id OR original.operation IS DISTINCT FROM 'invitation' OR NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=intent AND proof_digest=expected_proof_digest) THEN RAISE EXCEPTION 'Recorded original disposition required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','intentId',intent,'proofDigest',expected_proof_digest,'operationKey',original.operation_key);
 ELSE
  IF current_setting('role',true)='acquire_agent_user' AND expected_proof_digest IS NULL AND op.state='failed' AND op.result->'delivery'=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent') THEN RETURN op.result->'delivery'; END IF;
  IF current_run IS NOT NULL OR current_event IS NOT NULL OR current_lease_owner IS NOT NULL OR current_fence IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.agent_runs r JOIN public.agent_events e ON e.id=r.trigger_event_id WHERE r.id=current_run AND e.id=current_event AND r.thread_id=op.thread_id AND e.thread_id=op.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='running' AND e.state='leased' AND r.lease_owner=current_lease_owner AND e.lease_owner=current_lease_owner AND r.fence=current_fence AND e.fence=current_fence AND r.lease_until>clock_timestamp() AND e.lease_until>clock_timestamp() AND r.created_at+interval '45 seconds'>clock_timestamp() AND e.kind=route.channel||'.reconcile' AND e.payload->>'operationId'=op.id::text) THEN RAISE EXCEPTION 'Current lookup-only reconcile fence required'; END IF;
  END IF;
  -- Absence of a receipt is never proof. Only an expired original operation
  -- with no committed application intent and no live thread run may close.
  IF current_setting('role',true)<>'acquire_agent_user' OR expected_proof_digest IS NOT NULL OR op.lease_until IS NULL OR op.lease_until>clock_timestamp()
   OR EXISTS(SELECT 1 FROM public.communication_dispatch_intents WHERE organization_id=org AND owner_user_id=actor AND source_kind='agent' AND source_id=op.id)
   OR EXISTS(SELECT 1 FROM public.agent_runs WHERE thread_id=op.thread_id AND state='running' AND lease_until>clock_timestamp() AND id IS DISTINCT FROM current_run) THEN RAISE EXCEPTION 'Expired unprepared operation proof required'; END IF;
  evidence:=jsonb_build_object('status','not_submitted','reason','expired_without_application_intent');
 END IF;
 IF op.state='failed' AND op.result->'delivery'=evidence THEN RETURN evidence; END IF;
 IF op.state NOT IN('running','uncertain') THEN RAISE EXCEPTION 'Original operation cannot be resolved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_authority_uses WHERE operation_id=op.id AND conversation_id=conv.id AND organization_id=org AND owner_user_id=actor AND binding_digest=route.binding_digest AND operation_revision=op.revision AND operation_fence=op.fence AND operation_digest=op.input_digest AND context_revision=op.input->>'contextRevision' AND grant_id IS NULL AND review_batch_id IS NOT NULL AND state IN('reserved','admitted','uncertain')) THEN RAISE EXCEPTION 'Original authority use required'; END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=op.id)<>4
 OR (SELECT count(DISTINCT a.scope_key) FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id AND r.organization_id=org AND r.owner_user_id=actor AND r.amount=1 AND r.state IN('reserved','uncertain') AND a.organization_id=org AND a.unit='sends' AND a.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||conv.mandate_id::text||':sends','binding:'||route.binding_digest||':sends']))<>4 THEN RAISE EXCEPTION 'Exact original sending reservations required'; END IF;
 FOR reservation IN SELECT r.*,a.reserved AS account_reserved FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=op.id ORDER BY r.account_id FOR UPDATE OF r,a LOOP
  IF reservation.account_reserved<reservation.amount THEN RAISE EXCEPTION 'Original reservation ledger inconsistent'; END IF;
  UPDATE public.agent_budget_accounts SET reserved=reserved-reservation.amount WHERE id=reservation.account_id;
  UPDATE public.agent_budget_reservations SET state='settled',actual=0,updated_at=clock_timestamp() WHERE id=reservation.id;
 END LOOP;
 UPDATE public.agent_authority_uses SET state='released',outcome=evidence,updated_at=clock_timestamp() WHERE operation_id=op.id AND organization_id=org AND owner_user_id=actor;
 -- Delegated used_sends remains monotonic. A proven no-send releases this
 -- operation, never silently restores or expands a grant's capacity.
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('delivery',evidence),lease_until=NULL,updated_at=clock_timestamp() WHERE id=op.id;
 UPDATE public.agent_linkedin_invitations SET state='not_submitted',updated_at=clock_timestamp() WHERE operation_id=op.id AND route_id=route.id AND binding_digest=route.binding_digest AND state='unknown';
 UPDATE public.agent_conversations SET phase=CASE WHEN driver_kind='agent' THEN 'held' ELSE phase END,history_complete=false,pause_reason=CASE WHEN driver_kind='agent' THEN 'provider_no_submission_confirmed' ELSE pause_reason END,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND id<>op.id AND name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','linkedin.invitation') AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=op.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id=(item->>'operationId')::uuid WHERE o.conversation_id=conv.id);
 content:=jsonb_build_object('text','The original LinkedIn invitation was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.','operationId',op.id);
 message_key:='no-submission:'||op.id::text;
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(op.thread_id,org,op.mandate_id,actor,message_key,'assistant',content,encode(sha256(convert_to(content::text,'UTF8')),'hex')) ON CONFLICT(thread_id,request_key) DO NOTHING;
 RETURN evidence;
END $_$;

-- Name: agent_invitation_operation_authorised(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE cid uuid;
BEGIN
 IF NOT public.agent_invitation_before_company_projection(p_operation) THEN RETURN false;END IF;
 SELECT conversation_id INTO cid FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 RETURN public.agent_company_conversation_permitted(cid);
END $$;

-- Name: agent_is_demo_origin(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_is_demo_origin(p_mandate uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT EXISTS(SELECT 1 FROM public.agent_mandate_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=current_setting('app.acquire_org',true) AND x.mode='demo');
$$;

-- Name: agent_is_original_demo_source(text, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_is_original_demo_source(p_kind text, p_source uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.organization_id=current_setting('app.acquire_org',true) AND i.source_kind=p_kind AND i.source_id=p_source AND i.execution_mode='demo' AND i.execution_mandate_id IS NOT NULL AND i.execution_context_digest IS NOT NULL);
$$;

-- Name: agent_legacy_sequence_conflicts(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_legacy_sequence_conflicts(contact uuid, allowed_enrolment uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);identities text[];
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF NOT EXISTS(SELECT 1 FROM public.campaign_enrolments WHERE id=allowed_enrolment AND organization_id=org AND owner_user_id=actor) THEN RAISE EXCEPTION 'Owned source enrolment required'; END IF;
 identities:=public.agent_person_keys(org,contact);
 RETURN EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.id<>allowed_enrolment AND e.state IN('active','paused','needs_review') AND public.agent_person_keys(org,e.contact_id)&&identities);
END $$;

-- Name: agent_legacy_sequence_occupied(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_legacy_sequence_occupied(contact uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);
BEGIN
 PERFORM public.agent_assert_control_scope();
 RETURN EXISTS(SELECT 1 FROM public.campaign_enrolments e JOIN public.contacts c ON c.id=e.contact_id AND c.organization_id=e.organization_id WHERE e.organization_id=org AND e.state IN('active','paused','needs_review') AND (e.contact_id=contact OR public.agent_person_keys(org,e.contact_id)&&public.agent_person_keys(org,contact)));
END $$;

-- Name: agent_load_mandate_execution_context(jsonb, text, text); Type: FUNCTION
CREATE FUNCTION public.agent_load_mandate_execution_context(p_origin jsonb, p_org text, p_actor text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_load_mandate_research_context(uuid, text, text); Type: FUNCTION
CREATE FUNCTION public.agent_load_mandate_research_context(p_mandate uuid, p_org text, p_actor text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE mode text;
BEGIN
 IF p_org IS DISTINCT FROM current_setting('app.acquire_org',true) OR p_actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=p_org) THEN RAISE EXCEPTION 'Current owned research mandate required';END IF;
 SELECT x.mode INTO mode FROM public.agent_mandate_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=p_org;
 mode:=coalesce(mode,'real');
 RETURN jsonb_build_object('version',1,'mandateId',p_mandate,'mode',mode,'identityScope',jsonb_build_object('kind',CASE WHEN mode='demo' THEN 'demo' ELSE 'organization' END,'id',CASE WHEN mode='demo' THEN p_mandate::text ELSE p_org END));
END $$;

-- Name: agent_local_business_completion_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_business_completion_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.business_completed_at IS NOT NULL THEN RAISE EXCEPTION 'Business completion is server recorded';END IF;
 ELSIF NEW.business_completed_at IS DISTINCT FROM OLD.business_completed_at THEN RAISE EXCEPTION 'Original business completion is immutable';
 END IF;
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NOT NULL
 AND NEW.state IN('complete','failed') AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state)
 AND NEW.business_completed_at IS NULL THEN
  IF NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true) THEN RAISE EXCEPTION 'Original business completion scope differs';END IF;
  NEW.business_completed_at:=public.agent_business_now();
 END IF;
 RETURN NEW;
END $$;

-- Name: agent_lock_member(); Type: FUNCTION
CREATE FUNCTION public.agent_lock_member() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 PERFORM public.agent_business_now();
 PERFORM 1 FROM public.member
 WHERE organization_id=current_setting('app.acquire_org',true)
 AND user_id=current_setting('app.acquire_user',true) FOR SHARE;
 RETURN FOUND;
END $$;

-- Name: agent_lock_send_gate(); Type: FUNCTION
CREATE FUNCTION public.agent_lock_send_gate() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result bigint;
BEGIN
 IF current_setting('role',true)<>'acquire_agent_user' OR org IS NULL OR actor IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Authenticated agent scope required'; END IF;
 PERFORM pg_advisory_xact_lock_shared(7426619361492031::bigint);
 INSERT INTO public.communication_send_gates(organization_id,writer_xid) VALUES(org,txid_current()) ON CONFLICT(organization_id) DO UPDATE SET writer_xid=txid_current();
 SELECT g.revision INTO STRICT result FROM public.communication_send_gates g WHERE organization_id=org FOR UPDATE;
 RETURN result;
END $$;

-- Name: agent_mandate_execution_mode_immutable(); Type: FUNCTION
CREATE FUNCTION public.agent_mandate_execution_mode_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 RAISE EXCEPTION 'Mandate execution mode is immutable';
END $$;

-- Name: agent_mandate_identity_scope(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_mandate_identity_scope(p_mandate uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);mode text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org) THEN RAISE EXCEPTION 'Owned mandate identity scope required';END IF;
 SELECT x.mode INTO mode FROM public.agent_mandate_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=org;
 RETURN CASE WHEN mode='demo' THEN 'demo:'||p_mandate::text ELSE 'organization:'||org END;
END $$;

-- Name: agent_mandate_legacy_sequence_occupied(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_mandate_legacy_sequence_occupied(p_mandate uuid, p_contact uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);aliases uuid[];
BEGIN
 PERFORM public.agent_assert_control_scope();aliases:=public.agent_canonical_contact_aliases(p_contact);
 RETURN EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review') AND public.agent_same_execution_identity_scope(p_mandate,e.mandate_id));
END $$;

-- Name: agent_mandate_outreach_mode_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_mandate_outreach_mode_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
END $_$;

-- Name: agent_mandate_person_has_unresolved_sends(uuid, uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_mandate_person_has_unresolved_sends(p_mandate uuid, p_contact uuid, p_ignored_operation uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_mandate_person_keys(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_mandate_person_keys(p_mandate uuid, p_contact uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE research jsonb;keys text[];prefix text;projected jsonb;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 keys:=public.agent_person_keys(current_setting('app.acquire_org',true),p_contact);
 IF research->>'mode'='real' THEN RETURN keys;END IF;
 projected:=public.agent_delivery_candidate_projection(p_mandate,p_contact);prefix:='demo:'||p_mandate::text||':';
 RETURN ARRAY(SELECT prefix||k FROM unnest(keys) k)||ARRAY(SELECT prefix||key||':'||value FROM jsonb_each_text(projected->'recipients'));
END $$;

-- Name: agent_manual_feedback_source(uuid, text, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_manual_feedback_source(p_thread uuid, p_kind text, p_entity uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;result jsonb;c record;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Owned feedback conversation required';END IF;
 IF p_kind='target_review' THEN
  SELECT mt.version,mt.assessment,g.company_name,g.domain INTO c
   FROM public.mandate_targets mt JOIN public.targets g ON g.id=mt.target_id AND g.organization_id=mt.organization_id
   WHERE mt.organization_id=org AND mt.mandate_id=t.mandate_id AND mt.target_id=p_entity FOR SHARE OF mt,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saved company review unavailable';END IF;
  result:=jsonb_build_object('kind',p_kind,'id',p_entity,'revision',c.version,'companyName',c.company_name,'domain',c.domain,'assessment',c.assessment);
 ELSIF p_kind='sequence_draft' THEN
  SELECT s.xmin::text AS revision,s.name,s.draft INTO c FROM public.campaign_sequences s
   WHERE s.id=p_entity AND s.organization_id=org AND s.owner_user_id=actor AND s.mandate_id=t.mandate_id FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned saved sequence draft unavailable';END IF;
  result:=jsonb_build_object('kind',p_kind,'id',p_entity,'revision',c.revision,'name',c.name,'draft',c.draft);
 ELSE RAISE EXCEPTION 'Unsupported manual feedback source';END IF;
 IF octet_length(result::text)>60000 THEN RAISE EXCEPTION 'Saved feedback source exceeds bounded snapshot';END IF;
 RETURN result;
END $$;

-- Name: agent_manual_target_snapshot(uuid, uuid[]); Type: FUNCTION
CREATE FUNCTION public.agent_manual_target_snapshot(p_thread uuid, p_contacts uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
END $$;

-- Name: agent_native_research_status(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_native_research_status(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('jobId',j.id,'status',j.status,'nativeAgent',j.config->'nativeAgent','updatedAt',j.updated_at,
 'companies',(SELECT count(DISTINCT t.id) FROM public.research_jobs child JOIN public.targets t ON t.id::text=child.config->>'targetId' AND t.organization_id=org AND (t.mandate_id=o.mandate_id OR (o.name='research.fields' AND EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=org AND mt.mandate_id=o.mandate_id AND mt.target_id=t.id))) WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.config->>'parentJobId'=j.id::text),
 'contacts',(SELECT count(*) FROM public.contacts c WHERE c.organization_id=org AND c.mandate_id=o.mandate_id AND EXISTS(SELECT 1 FROM public.research_jobs child JOIN public.targets t ON t.id=c.target_id AND t.id::text=child.config->>'targetId' AND t.organization_id=org AND (t.mandate_id=o.mandate_id OR (o.name='research.fields' AND EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=org AND mt.mandate_id=o.mandate_id AND mt.target_id=t.id))) WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.config->>'parentJobId'=j.id::text))) INTO result
 FROM public.agent_operations o JOIN public.research_jobs j ON j.id=(o.input->'config'->>'requestId')::uuid
 WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND ((o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1') OR (o.name='research.people' AND o.input->>'nativePeoplePlanVersion'='1') OR (o.name='research.fields' AND o.input->>'nativeFieldsPlanVersion'='1'))
 AND j.organization_id=org AND j.mandate_id=o.mandate_id AND j.created_by=actor AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 RETURN result;
END $$;

-- Name: agent_native_sending_policy(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_native_sending_policy(operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;inbound_at timestamptz;outbound_at timestamptz;
BEGIN
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF op.id IS NULL THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN RETURN true; END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id;
 IF conv.id IS NULL OR (conv.delivery_mode<>'local_sink' AND NOT public.agent_email_window_open(public.agent_business_now()) AND NOT public.agent_simulator_window_exception(conv.mandate_id,conv.binding_id,conv.binding_digest,conv.recipient_email,clock_timestamp())) THEN RETURN false; END IF;
 SELECT max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='inbound'),max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='outbound') INTO inbound_at,outbound_at FROM jsonb_array_elements(conv.history);
 IF op.name='email.initial' THEN RETURN jsonb_array_length(conv.history)=0;
 ELSIF op.name='email.reply' THEN RETURN inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at);
 ELSIF op.name='email.follow_up' THEN RETURN outbound_at IS NOT NULL AND outbound_at<=public.agent_business_now()-interval '24 hours' AND (inbound_at IS NULL OR inbound_at<outbound_at);
 END IF;
 RETURN false;
END $$;

-- Name: agent_no_submission_before_invitations(uuid, uuid, text, uuid, uuid, uuid, bigint); Type: FUNCTION
CREATE FUNCTION public.agent_no_submission_before_invitations(operation uuid, intent uuid DEFAULT NULL::uuid, expected_proof_digest text DEFAULT NULL::text, current_run uuid DEFAULT NULL::uuid, current_event uuid DEFAULT NULL::uuid, current_lease_owner uuid DEFAULT NULL::uuid, current_fence bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE op public.agent_operations%ROWTYPE;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current application authority required';END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF op.id IS NULL THEN RAISE EXCEPTION 'Owned original operation required';END IF;
 IF op.input?'routeId' THEN RETURN public.agent_channel_communications_no_submission(operation,intent,expected_proof_digest,current_run,current_event,current_lease_owner,current_fence);END IF;
 IF op.name NOT IN('email.initial','email.reply','email.follow_up') THEN RAISE EXCEPTION 'A social operation requires its original recorded route';END IF;
 RETURN public.agent_communications_no_submission_before_channels(operation,intent,expected_proof_digest,current_run,current_event,current_lease_owner,current_fence);
END $$;

-- Name: agent_operation_authorised(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_operation_authorised(operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE cid uuid;
BEGIN
 IF NOT public.agent_operation_before_company_projection(operation) THEN RETURN false;END IF;
 SELECT conversation_id INTO cid FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 RETURN public.agent_company_conversation_permitted(cid);
END $$;

-- Name: agent_operation_authorised_before_channels(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_operation_authorised_before_channels(operation uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT public.agent_operation_authorised_before_history_accounts(operation) AND public.agent_history_accounts_clear(operation);
$$;

-- Name: agent_operation_authorised_before_history_accounts(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_operation_authorised_before_history_accounts(operation uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT public.agent_operation_authorised_before_sending_policy(operation) AND public.agent_native_sending_policy(operation);
$$;

-- Name: agent_operation_authorised_before_sending_policy(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_operation_authorised_before_sending_policy(operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);latest_inbound timestamptz;latest_body text;op public.agent_operations%ROWTYPE;conversation public.agent_conversations%ROWTYPE;authority public.agent_authority_uses%ROWTYPE;delegation public.agent_authority_grants%ROWTYPE;batch public.agent_review_batches%ROWTYPE;kind text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current dispatch authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up','email.manual_link') OR op.state<>'running' OR op.lease_until IS NULL OR op.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO conversation FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor;
 IF conversation.id IS NULL OR conversation.phase<>'active' OR NOT conversation.history_complete OR conversation.history_observed_at IS NULL OR conversation.history_observed_at>public.agent_business_now() OR conversation.history_observed_at<public.agent_business_now()-interval '5 minutes'
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
 IF latest_inbound>public.agent_business_now() OR latest_body~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))' THEN RETURN false; END IF;
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

-- Name: agent_operation_before_company_projection(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_operation_before_company_projection(operation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF o.id IS NULL THEN RETURN false;END IF;
 IF o.input ? 'routeId' THEN RETURN public.agent_channel_operation_authorised(operation);END IF;
 IF o.name<>'email.manual_link' AND EXISTS(SELECT 1 FROM public.agent_channel_policies WHERE thread_id=o.thread_id) THEN RETURN false;END IF;
 RETURN public.agent_operation_authorised_before_channels(operation);
END $$;

-- Name: agent_origin_mandate(text, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_origin_mandate(p_kind text, p_source uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT CASE p_kind WHEN 'agent' THEN (SELECT o.mandate_id FROM public.agent_operations o WHERE o.id=p_source AND o.organization_id=current_setting('app.acquire_org',true))
 WHEN 'campaign' THEN (SELECT e.mandate_id FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.id=p_source AND a.organization_id=current_setting('app.acquire_org',true))
 WHEN 'draft' THEN (SELECT e.mandate_id FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=p_source AND m.organization_id=current_setting('app.acquire_org',true)) END;
$$;

-- Name: agent_owned_target_snapshot(uuid, uuid[]); Type: FUNCTION
CREATE FUNCTION public.agent_owned_target_snapshot(p_thread uuid, p_contacts uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE researched jsonb;manual jsonb;items jsonb;
BEGIN
 researched:=public.agent_target_snapshot(p_thread,p_contacts);
 manual:=public.agent_manual_target_snapshot(p_thread,p_contacts);
 IF researched->>'mandateRevision' IS DISTINCT FROM manual->>'mandateRevision' OR researched->>'responsibilityId' IS DISTINCT FROM manual->>'responsibilityId' OR researched->>'responsibilityRevision' IS DISTINCT FROM manual->>'responsibilityRevision' THEN RAISE EXCEPTION 'Target context changed during projection'; END IF;
 SELECT coalesce(jsonb_agg(candidate ORDER BY blocked,contact),'[]') INTO items FROM(SELECT candidate,jsonb_array_length(candidate->'blockedReasons')<>0 AS blocked,candidate->>'contactId' AS contact FROM jsonb_array_elements((researched->'candidates')||(manual->'candidates'))candidate ORDER BY blocked,contact LIMIT 50)bounded;
 RETURN researched||jsonb_build_object('candidates',items,'contacts',(researched->>'contacts')::integer+(manual->>'contacts')::integer);
END $$;

-- Name: agent_people_company_evidence(uuid, uuid[]); Type: FUNCTION
CREATE FUNCTION public.agent_people_company_evidence(p_thread uuid, p_targets uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;result jsonb:='{}';c record;findings jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL OR p_targets IS NULL OR cardinality(p_targets)>50 THEN RAISE EXCEPTION 'Owned bounded company evidence scope required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.thread_id=t.id AND r.owner_user_id=actor AND r.organization_id=org AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text) THEN RAISE EXCEPTION 'Current company planning supervision required';END IF;
 FOR c IN SELECT g.id,g.company_name,g.domain,g.firmographics FROM public.targets g JOIN public.mandate_targets mt ON mt.target_id=g.id AND mt.organization_id=g.organization_id WHERE g.organization_id=org AND mt.mandate_id=t.mandate_id AND g.id=ANY(p_targets) ORDER BY g.id LIMIT 50 LOOP
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'evidence',f.evidence) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT id,evidence,observed_at FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.id ORDER BY observed_at DESC,id LIMIT 20)f;
  result:=result||jsonb_build_object(c.id::text,jsonb_build_object('companyName',c.company_name,'domain',c.domain,'firmographics',c.firmographics,'findings',findings));
 END LOOP;
 RETURN result;
END $$;

-- Name: agent_people_company_snapshot(uuid, uuid[], uuid); Type: FUNCTION
CREATE FUNCTION public.agent_people_company_snapshot(p_thread uuid, p_targets uuid[] DEFAULT NULL::uuid[], p_ignore_operation uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE snapshot jsonb;item jsonb;items jsonb:='[]';projection jsonb;reasons jsonb;mid uuid;
BEGIN
 snapshot:=public.agent_people_company_snapshot_before_company_projection(p_thread,p_targets,p_ignore_operation);
 SELECT mandate_id INTO mid FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'companies') LOOP
  projection:=public.agent_company_membership_projection(mid,(item->>'targetId')::uuid);
  IF projection IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(reason),'[]') INTO reasons FROM jsonb_array_elements(item->'blockedReasons')reason WHERE reason<>'"company_excluded"'::jsonb;
   item:=item||jsonb_build_object('name',projection->'target'->>'companyName','firmableId',coalesce(projection->'target'->>'firmableCompanyId',''),'blockedReasons',reasons||(projection->'blockedReasons'),'sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(item->>'sourceRevision',projection->>'digest')),'UTF8')),'hex'));
  END IF;
  items:=items||jsonb_build_array(item);
 END LOOP;RETURN snapshot||jsonb_build_object('companies',items);
END $$;

-- Name: agent_people_company_snapshot_before_company_projection(uuid, uuid[], uuid); Type: FUNCTION
CREATE FUNCTION public.agent_people_company_snapshot_before_company_projection(p_thread uuid, p_targets uuid[] DEFAULT NULL::uuid[], p_ignore_operation uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mr text;c record;items jsonb:='[]';reasons jsonb;source text;findings jsonb;aliases uuid[];company_person_keys text[];company_person_aliases uuid[];
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id;
 SELECT xmin::text INTO mr FROM public.mandates WHERE id=t.mandate_id AND organization_id=org;
 IF t.id IS NULL OR cardinality(p_targets)>50 OR r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.mandate_revision IS DISTINCT FROM mr THEN RAISE EXCEPTION 'Current owned people research scope required';END IF;
 IF p_ignore_operation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_ignore_operation AND thread_id=t.id AND organization_id=org AND owner_user_id=actor AND name='research.people') THEN RAISE EXCEPTION 'Owned people operation required';END IF;
 FOR c IN SELECT g.*,g.xmin::text source_xmin,mt.version membership_version,mt.assessment FROM public.targets g JOIN public.mandate_targets mt ON mt.organization_id=g.organization_id AND mt.target_id=g.id AND mt.mandate_id=t.mandate_id WHERE g.organization_id=org AND (p_targets IS NULL OR g.id=ANY(p_targets)) ORDER BY EXISTS(SELECT 1 FROM public.contacts cached WHERE cached.organization_id=org AND cached.target_id=g.id AND NOT cached.fictionalised AND coalesce(cached.personal_data->>'email','')<>''),g.id LIMIT 50 LOOP
  reasons:='[]';
  IF coalesce(c.firmable_company_id,'')!~'^f[0-9]+$' THEN reasons:=reasons||'"missing_firmable_company"'::jsonb;END IF;
  IF c.qualification::text='excluded' OR c.band::text='excluded' OR c.firmographics->'screening'->>'eligibility'='excluded' OR c.assessment->>'stage' IN('excluded','parked') THEN reasons:=reasons||'"company_excluded"'::jsonb;END IF;
  SELECT array_agg(p.id) INTO aliases FROM public.contacts p JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org WHERE p.organization_id=org AND (g.id=c.id OR lower(regexp_replace(g.domain,'^www[.]',''))=lower(regexp_replace(c.domain,'^www[.]','')));
  WITH batch AS MATERIALIZED(SELECT * FROM public.agent_contact_identity_batch(org,coalesce(aliases,'{}'::uuid[])))
  SELECT ARRAY(SELECT DISTINCT unnest(b.identity_keys) FROM batch b),ARRAY(SELECT DISTINCT unnest(b.contact_aliases) FROM batch b) INTO company_person_keys,company_person_aliases;
  IF c.assessment->>'stage' IN('contacted','in-conversation') OR EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases)) OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_inbound_events e WHERE e.organization_id=org AND e.contact_id=ANY(aliases)) OR EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key=ANY(company_person_keys)) THEN reasons:=reasons||'"previous_outreach_or_owned_company"'::jsonb;END IF;
  IF (EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') OR public.agent_aliases_have_unresolved_sends(company_person_aliases,NULL::uuid,true)) OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(regexp_replace(s.domain,'^www[.]',''))=lower(regexp_replace(c.domain,'^www[.]','')) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND lower(s.address)=lower(p.personal_data->>'email')))) THEN reasons:=reasons||'"suppressed_or_unresolved"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND NOT p.fictionalised AND coalesce(p.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AND (p_ignore_operation IS NULL OR p.provenance->>'nativePeopleOperationId' IS DISTINCT FROM p_ignore_operation::text)) THEN reasons:=reasons||'"usable_cached_contact"'::jsonb;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'evidence',f.evidence,'observedAt',f.observed_at) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT * FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.id ORDER BY observed_at DESC,id LIMIT 20)f;
  source:=encode(sha256(convert_to(jsonb_build_object('target',c.source_xmin,'membership',c.membership_version,'assessment',c.assessment,'findings',findings)::text,'UTF8')),'hex');
  items:=items||jsonb_build_array(jsonb_build_object('targetId',c.id,'name',left(c.company_name,300),'firmableId',coalesce(c.firmable_company_id,''),'sourceRevision',source,'blockedReasons',reasons));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mr,'responsibilityId',r.id,'responsibilityRevision',r.revision,'companies',items);
END $_$;

-- Name: agent_person_has_unresolved_sends(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_person_has_unresolved_sends(contact uuid, ignored_operation uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN RETURN public.agent_aliases_have_unresolved_sends(public.agent_canonical_contact_aliases(contact),ignored_operation,true);END $$;

-- Name: agent_person_keys(text, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_person_keys(org text, contact uuid) RETURNS text[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE result text[];BEGIN
 SELECT b.identity_keys INTO result FROM public.agent_contact_identity_batch(org,ARRAY[contact]) b;
 IF result IS NULL THEN RAISE EXCEPTION 'Canonical contact not found';END IF;RETURN result;END $$;

-- Name: agent_person_unresolved_before_invitations(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_person_unresolved_before_invitations(contact uuid, ignored_operation uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN RETURN public.agent_aliases_have_unresolved_sends(public.agent_canonical_contact_aliases(contact),ignored_operation,false);END $$;

-- Name: agent_prepare_firmable_research(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_prepare_firmable_research(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;scope_count integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL OR o.input->'execution'->>'pipeline' IS DISTINCT FROM 'firmable-company-v1' OR o.input->'execution'->>'backgroundResearch' IS DISTINCT FROM 'false' OR o.input->'execution'->>'peopleResearch' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reviewed supported research execution plan required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision) THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF j.id IS NULL OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 IF j.config->'nativeAgent'->>'providerAdmission'='firmable-company-v1' THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id) a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('pipelineDesign','firmable-v1','findPeople',false,'includeCompanyPeople',false,'parallelBusinessResearch',false,'automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+600000),'{nativeAgent,providerAdmission}','"firmable-company-v1"'::jsonb),message='Approved native company research ready',updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);
END $$;

-- Name: agent_prepare_hybrid_native_research(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_prepare_hybrid_native_research(operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;scope_count integer;company_v4 boolean;company_v5 boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state IN('approved','running') FOR UPDATE;
 company_v5:=o.name='research.start' AND public.agent_research_v5_scope(o.input);
 company_v4:=coalesce(o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
  AND o.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND o.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND o.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND o.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND o.input->'config'->'companyOnly'='true'::jsonb AND o.input->'config'->'targetBusinesses'='20'::jsonb
  AND o.input->'config'->'findPeople'='false'::jsonb AND o.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND o.input->'config'->'includePhones'='false'::jsonb AND o.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(o.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND NOT company_v5 AND (o.input->'providerPolicy'->>'version' IN('2','3') OR o.input->'config'->'companyDiscoveryPolicy'->>'version' IN('4','5')) THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF NOT company_v4 AND NOT company_v5 THEN IF o.id IS NULL OR o.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1' OR o.input->'providerPolicy'->>'version' IS DISTINCT FROM '1' OR o.input->'execution'->>'productionPipeline' IS DISTINCT FROM 'hybrid-firmable-v1' OR o.input->'config'->>'targetBusinesses' IS DISTINCT FROM '20' OR o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' OR o.input->'providerPolicy'->'maxAttempts' IS DISTINCT FROM '{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb OR o.input->'execution'->>'pipeline' IS DISTINCT FROM 'hybrid-company-v1' OR o.input->'execution'->>'backgroundResearch' IS DISTINCT FROM 'false' OR o.input->'execution'->>'peopleResearch' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reviewed supported research execution plan required';END IF; END IF;
 PERFORM 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision FOR SHARE OF r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF j.id IS NULL OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 IF company_v4 AND (j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config->>'companyOnly' IS DISTINCT FROM 'true' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'false') THEN RAISE EXCEPTION 'Saved company-only job scope changed';END IF;
 IF company_v5 AND (j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config ? 'companyOnly' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Saved combined research scope changed';END IF;
 IF j.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1' THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id) a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('pipelineDesign','hybrid-firmable-v1','findPeople',false,'includeCompanyPeople',company_v5,'parallelBusinessResearch',false,'automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+CASE WHEN company_v4 OR company_v5 THEN 900000 ELSE 600000 END),'{nativeAgent,providerAdmission}','"hybrid-company-v1"'::jsonb),message=CASE WHEN company_v5 THEN 'Approved company and basic People research ready; phone reveal and outreach require separate review' ELSE 'Approved native hybrid company research ready; background fields and people require separate review' END,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);
END $$;

-- Name: agent_public_conversation_facts(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_public_conversation_facts(conversation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;metadata text;profile jsonb;buyer jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('goal',m.natural_language,'contactId',person.id,'contactName',left(person.display_name,300),'companyName',left(COALESCE(company.company_name,CASE WHEN person.target_id IS NULL AND person.provenance->>'source'='Manual entry' THEN person.personal_data->>'companyName' END),300),'companySource',CASE WHEN company.id IS NOT NULL THEN 'saved_company_record' WHEN person.target_id IS NULL AND person.provenance->>'source'='Manual entry' THEN 'operator_entered_unverified' ELSE 'unavailable' END),g.metadata
 INTO result,metadata FROM public.agent_conversations c
 JOIN public.mandates m ON m.id=c.mandate_id AND m.organization_id=c.organization_id
 JOIN public.organization g ON g.id=c.organization_id
 JOIN public.contacts person ON person.id=c.contact_id AND person.organization_id=c.organization_id
 LEFT JOIN public.targets company ON company.id=person.target_id AND company.organization_id=c.organization_id
 WHERE c.id=conversation AND c.organization_id=org AND c.owner_user_id=actor;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned conversation required'; END IF;
 BEGIN profile:=COALESCE(metadata,'{}')::jsonb->'buyerProfile';EXCEPTION WHEN invalid_text_representation THEN profile:=NULL;END;
 -- Public approval is distinct from having saved private buyer financial data.
 -- Copy only this explicit allow-list; never return all organisation metadata.
 IF profile->>'publicProfileApproved'='true' AND length(profile->>'senderName') BETWEEN 2 AND 100 AND length(profile->>'signature') BETWEEN 2 AND 300 THEN
  buyer:=jsonb_strip_nulls(jsonb_build_object('senderName',profile->>'senderName','about',left(COALESCE(profile->>'about',profile->>'background'),1500),'investmentThesis',left(profile->>'investmentThesis',500),'operatingIntent',left(profile->>'operatingIntent',500),'signature',profile->>'signature'));
 END IF;
 RETURN result||jsonb_build_object('buyerProfile',buyer);
END $$;

-- Name: agent_record_automatic_people_candidates(uuid, uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_record_automatic_people_candidates(operation uuid, target uuid, candidates jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);scope jsonb;jid uuid;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF candidates IS NULL OR jsonb_typeof(candidates)<>'array' OR jsonb_array_length(candidates)>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(candidates)p WHERE jsonb_typeof(p)<>'string' OR (p#>>'{}')!~'^fp[0-9]+$') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(candidates))<>jsonb_array_length(candidates) THEN RAISE EXCEPTION 'Bounded automatic People candidates required';END IF;
 scope:=public.agent_assert_automatic_people_target(operation,target);
 IF scope ? 'candidates' THEN IF scope->'candidates' IS DISTINCT FROM candidates THEN RAISE EXCEPTION 'Saved automatic People candidates changed';END IF;RETURN;END IF;
 SELECT (o.input->'config'->>'requestId')::uuid INTO jid FROM public.agent_operations o WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor;
 UPDATE public.research_jobs SET config=jsonb_set(config,ARRAY['automaticPeopleCompanies',target::text],scope||jsonb_build_object('candidates',candidates)),updated_at=clock_timestamp() WHERE id=jid AND organization_id=org;
END $_$;

-- Name: agent_record_invitation_outcome(uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_record_invitation_outcome(p_operation uuid, p_delivery jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;prior public.agent_linkedin_invitations%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND name='linkedin.invitation' FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND thread_id=o.thread_id;
 IF o.id IS NULL OR r.id IS NULL OR r.channel<>'linkedin' OR r.binding_digest IS DISTINCT FROM o.input->>'bindingDigest' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR o.result->'delivery' IS DISTINCT FROM p_delivery
 OR NOT EXISTS(SELECT 1 FROM public.agent_authority_uses a WHERE a.operation_id=o.id AND a.grant_id IS NULL AND a.review_batch_id IS NOT NULL AND a.operation_digest=o.input_digest AND a.operation_revision=o.revision AND a.operation_fence=o.fence AND a.binding_digest=r.binding_digest AND a.state IN('settled','uncertain')) THEN RAISE EXCEPTION 'Original human-reviewed invitation authority and outcome required';END IF;
 IF p_delivery->>'status'='submitted' THEN
  IF o.state<>'complete' OR p_delivery->>'effect' IS DISTINCT FROM 'invitation' OR p_delivery->>'providerOperationId' IS NULL OR p_delivery->>'intentId' IS NULL OR length(p_delivery->>'providerOperationId') NOT BETWEEN 1 AND 2048 OR p_delivery->>'submittedAt' IS NULL OR (p_delivery->>'submittedAt')::timestamptz>public.agent_business_now()
  OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits p ON p.intent_id=i.id WHERE i.id::text=p_delivery->>'intentId' AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id AND i.source_kind='agent' AND i.source_id=o.id AND i.binding_id=r.binding_id AND i.operation='invitation') THEN RAISE EXCEPTION 'Exact original admitted invitation action receipt required';END IF;
 ELSIF p_delivery IS DISTINCT FROM '{"status":"unknown"}'::jsonb OR o.state<>'uncertain' THEN RAISE EXCEPTION 'Conservative invitation outcome required';END IF;
 SELECT * INTO prior FROM public.agent_linkedin_invitations WHERE operation_id=o.id FOR UPDATE;
 IF prior.operation_id IS NOT NULL AND (prior.route_id<>r.id OR prior.binding_digest<>r.binding_digest OR prior.identity_revision<>r.identity_revision OR prior.state<>'unknown' AND (p_delivery->>'status'<>'submitted' OR prior.provider_operation_id IS DISTINCT FROM p_delivery->>'providerOperationId' OR prior.intent_id::text IS DISTINCT FROM p_delivery->>'intentId' OR prior.submitted_at IS DISTINCT FROM (p_delivery->>'submittedAt')::timestamptz)) THEN RAISE EXCEPTION 'Original invitation outcome is immutable';END IF;
 INSERT INTO public.agent_linkedin_invitations(operation_id,route_id,conversation_id,thread_id,organization_id,owner_user_id,binding_digest,identity_revision,state,provider_operation_id,submitted_at,intent_id)
 VALUES(o.id,r.id,r.conversation_id,r.thread_id,r.organization_id,r.owner_user_id,r.binding_digest,r.identity_revision,CASE WHEN p_delivery->>'status'='submitted' THEN 'pending' ELSE 'unknown' END,p_delivery->>'providerOperationId',(p_delivery->>'submittedAt')::timestamptz,(p_delivery->>'intentId')::uuid)
 ON CONFLICT(operation_id) DO UPDATE SET state=CASE WHEN agent_linkedin_invitations.state='accepted' THEN 'accepted' ELSE EXCLUDED.state END,provider_operation_id=EXCLUDED.provider_operation_id,submitted_at=EXCLUDED.submitted_at,intent_id=EXCLUDED.intent_id,updated_at=clock_timestamp();
 PERFORM public.agent_assert_control_scope();
END $$;

-- Name: agent_record_people_candidates(uuid, uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_record_people_candidates(operation uuid, target uuid, candidates jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;job uuid;existing jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.people' AND state='running';
 IF o.id IS NULL OR jsonb_array_length(candidates)>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(candidates) p WHERE p!~'^fp[0-9]+$') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.input->'selected') s WHERE s->>'targetId'=target::text) THEN RAISE EXCEPTION 'Approved bounded people candidates required';END IF;
 job:=(o.input->'config'->>'requestId')::uuid;
 SELECT config->'nativePeopleCandidates'->target::text INTO existing FROM public.research_jobs WHERE id=job AND organization_id=org FOR UPDATE;
 IF existing IS NOT NULL AND existing IS DISTINCT FROM candidates THEN RAISE EXCEPTION 'Saved candidate selection changed';END IF;
 UPDATE public.research_jobs SET config=config||jsonb_build_object('nativePeopleCandidates',coalesce(config->'nativePeopleCandidates','{}')||jsonb_build_object(target::text,candidates)),updated_at=now() WHERE id=job AND organization_id=org;
END $_$;

-- Name: agent_recorded_binding_digest(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_recorded_binding_digest(p_binding uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('applicationId',application_id,'tenantId',organization_id,'ownerId',owner_user_id,'connectionId',service_connection_id,'accountId',service_account_id,'generation',generation,'channel',channel,'platform',platform,'backend',backend)),'UTF8')),'hex') FROM public.communication_bindings WHERE id=p_binding;
$$;

-- Name: agent_recorded_demo_route_matches(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_recorded_demo_route_matches(p_route uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
  WHERE public.agent_demo_runtime_ready(run.id) AND r.id=p_route AND r.organization_id=org AND r.owner_user_id=actor AND r.binding_digest=public.agent_recorded_binding_digest(b.id)
   AND r.recipient_value=CASE r.channel WHEN 'email' THEN m.wire->>'email' WHEN 'whatsapp' THEN m.wire->>'phone' WHEN 'linkedin' THEN m.wire->>'linkedin' END
   AND r.recipient_kind=CASE r.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END
   AND r.identity_source->>'revision'=m.source_revision
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(run.senders) s WHERE s->>'bindingId'=b.id::text AND s->>'bindingDigest'=r.binding_digest AND s->>'channel'=r.channel));
END $$;

-- Name: agent_recorded_reply_execution_scope(uuid, text, text); Type: FUNCTION
CREATE FUNCTION public.agent_recorded_reply_execution_scope(p_binding uuid, p_kind text, p_sender text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);registered boolean;scope text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held recorded reply scope required';END IF;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run JOIN LATERAL jsonb_array_elements(run.senders) s ON s->>'bindingId'=p_binding::text JOIN public.communication_bindings b ON b.id=p_binding AND b.organization_id=run.organization_id AND b.owner_user_id=run.owner_user_id AND public.agent_recorded_binding_digest(b.id)=s->>'bindingDigest' WHERE run.organization_id=org AND run.owner_user_id=actor) INTO registered;
 IF NOT registered THEN RETURN jsonb_build_object('registered',false,'scope',NULL);END IF;
 SELECT min(r.mandate_id::text) INTO scope FROM public.agent_conversation_channels r WHERE r.organization_id=org AND r.owner_user_id=actor AND r.binding_id=p_binding AND r.recipient_kind=p_kind AND r.recipient_value=p_sender AND public.agent_recorded_demo_route_matches(r.id)
 HAVING count(DISTINCT r.mandate_id)=1;
 RETURN jsonb_build_object('registered',true,'scope',CASE WHEN scope IS NULL THEN NULL ELSE jsonb_build_object('kind','demo','id',scope) END);
END $$;

-- Name: agent_recorded_reply_identity_registration(uuid, uuid, uuid, uuid, text, text, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_recorded_reply_identity_registration(p_thread uuid, p_conversation uuid, p_route uuid, p_binding uuid, p_channel text, p_identity text, p_contact uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_register_channel(uuid, uuid, integer, text, uuid, text, text, text, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_register_channel(p_thread uuid, p_conversation uuid, p_revision integer, p_context text, p_binding uuid, p_channel text, p_kind text, p_value text, p_source jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
 VALUES(conv.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,p_channel,binding.id,public.agent_recorded_binding_digest(binding.id),p_kind,p_value,p_source,identity_hash,encode(sha256(convert_to('[]','UTF8')),'hex'),public.agent_business_now()+((array_position(policy.channel_order,p_channel)-1)*policy.delay_seconds)*interval '1 second') RETURNING * INTO route;
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
END $_$;

-- Name: agent_register_runtime(uuid, integer, text); Type: FUNCTION
CREATE FUNCTION public.agent_register_runtime(p_thread uuid, p_responsibility_revision integer, p_runtime_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;prior public.agent_runtime_registrations%ROWTYPE;
 scope_prefix text;budget_unit text;budget_key text;budget_cap bigint;account public.agent_budget_accounts%ROWTYPE;
 started timestamptz:=clock_timestamp();created_defaults jsonb:='[]';notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF p_runtime_id IS NULL OR p_runtime_id!~'^[a-z][a-z0-9-]{2,99}$' OR p_runtime_id IS DISTINCT FROM current_setting('app.acquire_runtime_id',true) OR p_responsibility_revision IS NULL THEN RAISE EXCEPTION 'Configured registered runtime required';END IF;
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Owned runtime thread required';END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE thread_id=t.id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF r.id IS NULL OR r.revision<>p_responsibility_revision OR r.state NOT IN('ready','waiting','paused') THEN RAISE EXCEPTION 'Current controlled responsibility required';END IF;
 SELECT * INTO prior FROM public.agent_runtime_registrations WHERE thread_id=t.id FOR UPDATE;
 IF prior.thread_id IS NOT NULL AND (prior.runtime_id<>p_runtime_id OR prior.responsibility_id<>r.id OR prior.organization_id<>org OR prior.owner_user_id<>actor OR prior.mandate_id<>t.mandate_id) THEN RAISE EXCEPTION 'Runtime migration requires a separate reconciled handover';END IF;
 INSERT INTO public.agent_runtime_registrations(thread_id,organization_id,owner_user_id,mandate_id,responsibility_id,responsibility_revision,runtime_id,state)
 VALUES(t.id,org,actor,t.mandate_id,r.id,r.revision,p_runtime_id,CASE WHEN r.state='paused' THEN 'paused' ELSE 'enabled' END)
 ON CONFLICT(thread_id) DO UPDATE SET responsibility_revision=EXCLUDED.responsibility_revision,state=EXCLUDED.state,updated_at=clock_timestamp();
 -- Only current administrators may provision workspace budget authority. A
 -- member can register a runtime and sees missing limits until an admin acts.
 -- An existing current OR future window is never reset, extended or increased.
 IF r.state IN('ready','waiting') AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor AND role IN('owner','admin')) THEN
  FOREACH scope_prefix IN ARRAY ARRAY['organization','user:'||actor,'mandate:'||t.mandate_id::text] LOOP
   FOREACH budget_unit IN ARRAY ARRAY['calls','sends','usd_micro'] LOOP
    budget_key:=scope_prefix||':'||budget_unit;
    IF NOT EXISTS(SELECT 1 FROM public.agent_budget_accounts WHERE organization_id=org AND scope_key=budget_key AND window_end>started) THEN
     budget_cap:=CASE budget_unit WHEN 'calls' THEN 100 WHEN 'sends' THEN 30 ELSE 10000000 END;
     INSERT INTO public.agent_budget_accounts(organization_id,scope_key,unit,window_start,window_end,cap,approved_by)
     VALUES(org,budget_key,budget_unit,started,started+interval '24 hours',budget_cap,actor) RETURNING * INTO account;
     created_defaults:=created_defaults||jsonb_build_array(jsonb_build_object('id',account.id,'scopeKey',budget_key,'unit',budget_unit,'cap',budget_cap::text,'windowEnd',account.window_end));
     INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
     VALUES(org,actor,'agent.budget_default_created','agent_budget',account.id::text,jsonb_build_object('scopeKey',budget_key,'cap',budget_cap::text,'unit',budget_unit,'windowStart',started,'windowEnd',account.window_end,'runtimeId',p_runtime_id));
    END IF;
   END LOOP;
  END LOOP;
 END IF;
 IF prior.thread_id IS NULL OR prior.responsibility_revision<>r.revision THEN
  notice:=jsonb_build_object('text',CASE WHEN r.state='paused' THEN 'This mandate is paused in its registered background runtime.' ELSE 'This mandate is registered for background work. Budget limits do not approve messages; outreach still requires its current review and exact account.' END,'details',jsonb_build_object('runtimeId',p_runtime_id,'responsibilityId',r.id,'responsibilityRevision',r.revision,'createdDefaultBudgets',created_defaults));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
  VALUES(t.id,org,t.mandate_id,actor,'runtime-registration:'||r.id::text||':'||r.revision::text,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex')) ON CONFLICT(thread_id,request_key) DO NOTHING;
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
  VALUES(org,actor,'agent.runtime_registered','agent_responsibility',r.id::text,jsonb_build_object('runtimeId',p_runtime_id,'revision',r.revision,'state',r.state));
 END IF;
 RETURN jsonb_build_object('runtimeId',p_runtime_id,'responsibilityRevision',r.revision,'createdDefaultBudgets',created_defaults);
END $_$;

-- Name: agent_registered_review_recovery_scopes(integer, text); Type: FUNCTION
CREATE FUNCTION public.agent_registered_review_recovery_scopes(p_max integer, p_runtime_id text) RETURNS TABLE(organization_id text, owner_user_id text, review_request_key uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
 JOIN public.communication_reply_review_latches resolved ON resolved.organization_id=g.organization_id AND resolved.owner_user_id=g.owner_user_id AND resolved.binding_id::text=a.metadata->>'bindingId' AND resolved.service_event_id=a.metadata->>'serviceEventId' AND resolved.resolved_at IS NOT NULL AND resolved.resolution_reference=a.metadata->>'resolutionReference'
 JOIN public.communication_event_receipts receipt ON receipt.binding_id=resolved.binding_id AND receipt.service_event_id=resolved.service_event_id AND receipt.organization_id=g.organization_id AND receipt.owner_user_id=g.owner_user_id AND receipt.result='review' AND ((resolved.code='identity_pending' AND receipt.event_type='message') OR (resolved.code='protocol' AND receipt.event_type='account')) AND receipt.fingerprint_version='acquire.reply.delivery.v1' AND receipt.payload_fingerprint=a.metadata->>'expectedFingerprint'
 JOIN public.communication_bindings original_binding ON original_binding.id=resolved.binding_id AND original_binding.organization_id=g.organization_id AND original_binding.owner_user_id=g.owner_user_id

 WHERE g.runtime_id=p_runtime_id AND g.state='enabled' AND g.responsibility_revision=r.revision
 AND r.state IN('ready','waiting') AND r.mandate_revision=mandate.xmin::text
 AND v.driver_kind='agent' AND v.phase='active' AND NOT v.history_complete AND v.engagement NOT IN('stopped','handoff')
 AND a.entity_id=resolved.binding_id::text||':'||resolved.service_event_id
 AND ((resolved.code='identity_pending' AND a.metadata->>'originalCode'='identity_pending') OR (
 resolved.code='protocol' AND a.metadata->>'originalCode'='protocol'
 AND a.metadata->'provenance'->>'kind'='untracked_authenticated_outbound'
 AND a.metadata->'provenance'->>'serviceEventId'=resolved.service_event_id
 AND a.metadata->'provenance'->'noAssociation'='true'::jsonb
 AND a.metadata->'provenance'->>'sourceKey' ~ '^[a-f0-9]{64}$'
 AND a.metadata->'provenance'->>'originalPayloadDigest' ~ '^[a-f0-9]{64}$'
 AND a.metadata->'provenance'->>'bindingDigest'=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(original_binding.application_id,original_binding.organization_id,original_binding.owner_user_id,original_binding.service_connection_id,original_binding.service_account_id,original_binding.generation,original_binding.channel,original_binding.platform,original_binding.backend)),'UTF8')),'hex')
 ))
 AND a.metadata->>'decision'='reviewed_unrelated' AND a.metadata->>'noReplyCredit'='true'
 AND a.metadata->>'requestKey' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 AND a.metadata->>'resolutionReference'='human-unrelated:'||(a.metadata->>'requestKey')
 AND NOT EXISTS(SELECT 1 FROM public.communication_reply_review_latches l WHERE l.organization_id=g.organization_id AND l.resolved_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=v.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 AND NOT EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=v.thread_id AND e.event_key='channel-review-wake:'||(a.metadata->>'requestKey')||':'||v.id::text)
 GROUP BY g.organization_id,g.owner_user_id,a.metadata->>'requestKey'
 ) candidate ORDER BY candidate.reviewed_at,candidate.organization_id,candidate.owner_user_id,candidate.request_key LIMIT p_max;
END $_$;

-- Name: agent_registered_worker_scopes(integer, text); Type: FUNCTION
CREATE FUNCTION public.agent_registered_worker_scopes(p_max integer, p_runtime_id text) RETURNS TABLE(organization_id text, owner_user_id text, mandate_id uuid, thread_id uuid, responsibility_id uuid, responsibility_revision integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 100 OR p_runtime_id IS NULL OR p_runtime_id!~'^[a-z][a-z0-9-]{2,99}$' OR p_runtime_id IS DISTINCT FROM current_setting('app.acquire_runtime_id',true) THEN RAISE EXCEPTION 'Configured registered worker runtime required';END IF;
 RETURN QUERY SELECT g.organization_id,g.owner_user_id,g.mandate_id,g.thread_id,g.responsibility_id,g.responsibility_revision
 FROM public.agent_runtime_registrations g JOIN public.agent_responsibilities r ON r.id=g.responsibility_id AND r.thread_id=g.thread_id
 JOIN public.member m ON m.organization_id=g.organization_id AND m.user_id=g.owner_user_id
 JOIN public.agent_events e ON e.thread_id=g.thread_id AND e.organization_id=g.organization_id AND e.owner_user_id=g.owner_user_id AND e.mandate_id=g.mandate_id
 WHERE g.runtime_id=p_runtime_id AND g.responsibility_revision=r.revision AND public.agent_event_eligible(e.thread_id,e.kind)
 AND e.available_at<=public.agent_business_now() AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()) AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL OR e.organization_id=current_setting('app.acquire_org',true) AND e.owner_user_id=current_setting('app.acquire_user',true)) AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=g.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY g.organization_id,g.owner_user_id,g.mandate_id,g.thread_id,g.responsibility_id,g.responsibility_revision
 ORDER BY min(e.available_at),g.organization_id,g.owner_user_id,g.mandate_id LIMIT p_max;
END $_$;

-- Name: agent_release_changed_research_budget(); Type: FUNCTION
CREATE FUNCTION public.agent_release_changed_research_budget() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE o record;
BEGIN FOR o IN SELECT p.operation_id FROM public.agent_research_phase_budgets p JOIN public.agent_operations op ON op.id=p.operation_id WHERE p.organization_id=NEW.organization_id AND p.state='active' AND op.thread_id=NEW.thread_id AND op.input->>'responsibilityId'=NEW.id::text AND (NEW.state NOT IN('ready','waiting') OR op.input->>'responsibilityRevision' IS DISTINCT FROM NEW.revision::text OR op.input->>'mandateRevision' IS DISTINCT FROM NEW.mandate_revision) LOOP PERFORM public.agent_release_research_phase_internal(o.operation_id,'supervision_changed');END LOOP;RETURN NEW;END $$;

-- Name: agent_release_finished_research_budget(); Type: FUNCTION
CREATE FUNCTION public.agent_release_finished_research_budget() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN PERFORM public.agent_release_research_phase_internal(NEW.id,'phase_'||NEW.state);RETURN NEW;END $$;

-- Name: agent_release_research_phase_internal(uuid, text); Type: FUNCTION
CREATE FUNCTION public.agent_release_research_phase_internal(p_operation uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE p public.agent_research_phase_budgets%ROWTYPE;x record;
BEGIN
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=p_operation FOR UPDATE;IF p.operation_id IS NULL OR p.state='released' THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=p.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held research budget writer required';END IF;
 FOR x IN SELECT a.account_id,a.remaining_amount FROM public.agent_research_phase_allocations a WHERE a.operation_id=p_operation ORDER BY a.account_id FOR UPDATE LOOP UPDATE public.agent_budget_accounts SET reserved=reserved-x.remaining_amount WHERE id=x.account_id AND organization_id=p.organization_id;UPDATE public.agent_research_phase_allocations SET remaining_amount=0 WHERE operation_id=p_operation AND account_id=x.account_id;END LOOP;
 UPDATE public.agent_research_phase_budgets SET state='released',released_reason=left(p_reason,100),updated_at=clock_timestamp() WHERE operation_id=p_operation;
END $$;

-- Name: agent_reply_causality_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_reply_causality_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;expected jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.input->'replyCausality' IS DISTINCT FROM OLD.input->'replyCausality' THEN RAISE EXCEPTION 'Original reply causal snapshot is immutable';END IF;
  IF NOT OLD.input ? 'replyCausality' THEN RETURN NEW;END IF;
  IF ROW(NEW.id,NEW.thread_id,NEW.organization_id,NEW.mandate_id,NEW.owner_user_id,NEW.conversation_id,NEW.name,NEW.request_key,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.thread_id,OLD.organization_id,OLD.mandate_id,OLD.owner_user_id,OLD.conversation_id,OLD.name,OLD.request_key,OLD.created_at)
   OR (NEW.input-'body') IS DISTINCT FROM (OLD.input-'body') THEN RAISE EXCEPTION 'Original causal reply source is immutable';END IF;
  IF NEW.input IS NOT DISTINCT FROM OLD.input AND NEW.input_digest IS NOT DISTINCT FROM OLD.input_digest THEN RETURN NEW;END IF;
  IF OLD.state<>'proposed' OR NEW.state<>'proposed' OR OLD.fence<>0 OR NEW.fence<>0 THEN RAISE EXCEPTION 'Causal reply body requires pending human review';END IF;
 END IF;
 IF NOT NEW.input ? 'replyCausality' THEN RETURN NEW;END IF;
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.owner_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current causal reply required';END IF;
 SELECT * INTO c FROM public.agent_conversations WHERE id=NEW.conversation_id AND thread_id=NEW.thread_id AND mandate_id=NEW.mandate_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=NEW.input->>'routeId' AND conversation_id=c.id AND thread_id=c.thread_id AND organization_id=c.organization_id AND owner_user_id=c.owner_user_id;
 IF c.id IS NULL OR r.id IS NULL OR NEW.name IS DISTINCT FROM r.channel||'.reply' OR NEW.input->>'kind' IS DISTINCT FROM 'reply_'||r.channel
 OR NEW.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR NEW.input->>'historyRevision' IS DISTINCT FROM c.history_revision OR NEW.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR NEW.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR NEW.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR NEW.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR NEW.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR NOT public.agent_channel_proposal_permitted(r.id,'reply') THEN RAISE EXCEPTION 'Exact current causal reply source required';END IF;
 expected:=public.agent_channel_reply_causality(r.id);
 IF expected IS NULL OR NEW.input->'replyCausality' IS DISTINCT FROM expected
 OR NEW.input_digest IS DISTINCT FROM encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('name',NEW.name,'input',NEW.input)),'UTF8')),'hex') THEN RAISE EXCEPTION 'Exact server-derived causal snapshot and digest required';END IF;
 RETURN NEW;
END $$;

-- Name: agent_research_phase_budget_status(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_research_phase_budget_status(p_operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);p public.agent_research_phase_budgets%ROWTYPE;valid integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields')) THEN RAISE EXCEPTION 'Owned research phase required';END IF;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF p.operation_id IS NULL THEN RETURN jsonb_build_object('ready',false,'reason','phase_funding_required');END IF;
 SELECT count(*) INTO valid FROM public.agent_research_phase_allocations x JOIN public.agent_budget_accounts a ON a.id=x.account_id AND a.organization_id=x.organization_id WHERE x.operation_id=p_operation AND x.organization_id=org AND x.owner_user_id=actor AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap;
 RETURN jsonb_build_object('ready',p.state='active' AND p.deadline>clock_timestamp() AND valid=6 AND EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=p_operation AND o.input_digest=p.input_digest AND EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision)),'state',p.state,'reason',CASE WHEN p.state<>'active' THEN 'phase_closed' WHEN p.deadline<=clock_timestamp() THEN 'phase_expired_review_required' WHEN valid<>6 THEN 'phase_limits_changed' ELSE NULL END,'calls',p.calls_ceiling::text,'usdMicro',p.usd_ceiling::text,'deadline',p.deadline);
END $$;

-- Name: agent_research_v5_scope(jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_research_v5_scope(p_input jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT coalesce(p_input->>'nativeResearchPlanVersion'='1'
 AND p_input->'providerPolicy'='{"version":3,"callAdmission":"per_request","usdAdmission":"company_phase_people_per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"1000000","search":"1000000","page":"1000000","ai":"1000000"},"firmableCompanyRequestCeilingMicroUsd":"0","pricingBasis":"configured_company_plus_metered_people","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
 AND p_input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":true}'::jsonb
 AND p_input->'config'->'companyDiscoveryPolicy'='{"version":5,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":false},"automaticPeople":{"version":1,"maxCompanies":800,"maxSearchPagesPerCompany":1,"searchPageSize":50,"maxContactsPerCompany":3,"includePhones":false}}'::jsonb
 AND p_input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
 AND NOT(p_input->'config' ? 'companyOnly') AND NOT(p_input->'config' ? 'companyContinuation')
 AND p_input->'config'->'targetBusinesses'='20'::jsonb
 AND p_input->'config'->'findPeople'='false'::jsonb
 AND p_input->'config'->'includeCompanyPeople'='true'::jsonb
 AND p_input->'config'->'includePhones'='false'::jsonb
 AND p_input->'config'->'budget'->'maxMinutes'='15'::jsonb
 AND coalesce(p_input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false)
$$;

-- Name: agent_reserve_budget(uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_reserve_budget(operation uuid, requests jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);entry jsonb;account public.agent_budget_accounts%ROWTYPE;prior public.agent_budget_reservations%ROWTYPE;amount bigint;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF jsonb_typeof(requests)<>'array' OR jsonb_array_length(requests) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Bounded reservation group required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.state IN('approved','running')) THEN RAISE EXCEPTION 'Current admitted operation required'; END IF;
 PERFORM 1 FROM public.agent_operations WHERE id=operation FOR UPDATE;
 IF (SELECT count(DISTINCT value->>'accountId') FROM jsonb_array_elements(requests))<>jsonb_array_length(requests) THEN RAISE EXCEPTION 'Duplicate budget account'; END IF;
 -- The shared organisation gate and stable account order cover manual/agent races.
 FOR entry IN SELECT value FROM jsonb_array_elements(requests) ORDER BY value->>'accountId' LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT entry ?& ARRAY['accountId','amount'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) AS keys(key) WHERE key NOT IN('accountId','amount')) OR (entry->>'amount')!~'^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  amount:=(entry->>'amount')::bigint;
  SELECT * INTO STRICT account FROM public.agent_budget_accounts a WHERE a.id=(entry->>'accountId')::uuid AND a.organization_id=org FOR UPDATE;
  SELECT * INTO prior FROM public.agent_budget_reservations r WHERE r.operation_id=operation AND r.account_id=account.id;
  IF prior.id IS NOT NULL THEN
   IF prior.amount<>amount OR prior.owner_user_id<>actor THEN RAISE EXCEPTION 'Reservation key reused with different scope'; END IF;
   IF prior.state IN('reserved','uncertain') AND (account.window_start>clock_timestamp() OR account.window_end<=clock_timestamp()) THEN RAISE EXCEPTION 'Budget window expired; reconcile before reauthorising work'; END IF;
  ELSE
   IF account.window_start>clock_timestamp() OR account.window_end<=clock_timestamp() OR account.spent+account.reserved+amount>account.cap THEN RAISE EXCEPTION 'Shared budget exhausted or expired'; END IF;
   INSERT INTO public.agent_budget_reservations(operation_id,account_id,organization_id,owner_user_id,amount,state) VALUES(operation,account.id,org,actor,amount,'reserved') RETURNING * INTO prior;
   UPDATE public.agent_budget_accounts SET reserved=reserved+amount WHERE id=account.id;
  END IF;result:=result||jsonb_build_array(to_jsonb(prior)||jsonb_build_object('amount',prior.amount::text,'actual',prior.actual::text));
 END LOOP;RETURN result;
END $_$;

-- Name: agent_reserve_research_phase(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_reserve_research_phase(p_operation uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;j public.research_jobs%ROWTYPE;a public.agent_budget_accounts%ROWTYPE;entry record;count_scopes integer:=0;calls bigint;usd bigint;n integer;deadline timestamptz;accounts uuid[]:='{}';shortfalls jsonb:='[]';needed bigint;company_v4 boolean;company_v5 boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Approved owned research phase required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision) THEN RAISE EXCEPTION 'Current research phase supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research phase approval required';END IF;
 company_v5:=o.name='research.start' AND public.agent_research_v5_scope(o.input);
 company_v4:=coalesce(o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
  AND o.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND o.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND o.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND o.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND o.input->'config'->'companyOnly'='true'::jsonb AND o.input->'config'->'targetBusinesses'='20'::jsonb
  AND o.input->'config'->'findPeople'='false'::jsonb AND o.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND o.input->'config'->'includePhones'='false'::jsonb AND o.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(o.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND NOT company_v5 AND (o.input->'providerPolicy'->>'version' IN('2','3') OR o.input->'config'->'companyDiscoveryPolicy'->>'version' IN('4','5')) THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF company_v4 OR company_v5 THEN calls:=24035;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'  AND o.input->'execution'->>'productionPipeline'='hybrid-firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb THEN calls:=71;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->'execution'->>'productionPipeline'='firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":5,"firmable":60}'::jsonb THEN calls:=76;
 ELSIF o.name='research.people' AND o.input->>'nativePeoplePlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":0,"page":0,"ai":0,"firmable":60}'::jsonb THEN calls:=60;
 ELSIF o.name='research.fields' AND o.input->>'nativeFieldsPlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":60,"page":320,"ai":0,"firmable":0}'::jsonb AND o.input->'providerPolicy'->'perCompany'='{"search":12,"page":64}'::jsonb THEN n:=jsonb_array_length(o.input->'selected');IF n IS NULL OR n NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Exact bounded public-field selection required';END IF;calls:=n*76;
 ELSE RAISE EXCEPTION 'Frozen physical research policy required';END IF;
 IF o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' THEN RAISE EXCEPTION 'Frozen request reservation ceiling required';END IF;usd:=CASE WHEN company_v4 OR company_v5 THEN 11000000 ELSE calls*1000000 END;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=o.id FOR UPDATE;
 IF p.operation_id IS NOT NULL THEN IF p.input_digest IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Research funding belongs to another manifest';END IF;RETURN public.agent_research_phase_budget_status(o.id);END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') THEN RAISE EXCEPTION 'Saved unfinished research job required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations child WHERE child.thread_id=o.thread_id AND child.input->>'researchOperationId'=o.id::text AND child.name IN('research.provider','research.worker_dispatch')) THEN RAISE EXCEPTION 'Original research attempts require reconciliation before phase funding';END IF;
 deadline:=clock_timestamp()+CASE WHEN company_v4 OR company_v5 THEN interval '15 minutes' ELSE interval '10 minutes' END;
 FOR entry IN SELECT scope_key,unit FROM(VALUES('organization:calls','calls'),('organization:usd_micro','usd_micro'),('user:'||actor||':calls','calls'),('user:'||actor||':usd_micro','usd_micro'),('mandate:'||o.mandate_id::text||':calls','calls'),('mandate:'||o.mandate_id::text||':usd_micro','usd_micro'))x(scope_key,unit) ORDER BY scope_key LOOP
  SELECT * INTO a FROM public.agent_budget_accounts b WHERE b.organization_id=org AND b.scope_key=entry.scope_key AND b.unit=entry.unit AND b.window_start<=clock_timestamp() AND b.window_end>clock_timestamp() ORDER BY b.window_start DESC,b.id LIMIT 1 FOR UPDATE;
  needed:=CASE WHEN entry.unit='calls' THEN CASE WHEN company_v4 OR company_v5 THEN 1 ELSE calls END ELSE usd END;
  IF a.id IS NULL OR a.window_end<deadline+interval '2 minutes' OR a.cap-a.spent-a.reserved<needed THEN shortfalls:=shortfalls||jsonb_build_array(jsonb_build_object('scopeKey',entry.scope_key,'unit',entry.unit,'needed',needed::text,'available',greatest(coalesce(a.cap-a.spent-a.reserved,0),0)::text,'windowCoversPhase',coalesce(a.window_end>=deadline+interval '2 minutes',false)));ELSE accounts:=array_append(accounts,a.id);count_scopes:=count_scopes+1;END IF;
 END LOOP;
 IF count_scopes<>6 THEN RETURN jsonb_build_object('ready',false,'reason','phase_funding_required','calls',calls::text,'usdMicro',usd::text,'shortfalls',shortfalls);END IF;
 INSERT INTO public.agent_research_phase_budgets(operation_id,organization_id,owner_user_id,input_digest,calls_ceiling,usd_ceiling,deadline)VALUES(o.id,org,actor,o.input_digest,calls,usd,deadline);
 FOR a IN SELECT * FROM public.agent_budget_accounts WHERE id=ANY(accounts) ORDER BY id LOOP needed:=CASE WHEN a.unit='calls' THEN CASE WHEN company_v4 OR company_v5 THEN 0 ELSE calls END ELSE usd END;INSERT INTO public.agent_research_phase_allocations(operation_id,account_id,organization_id,owner_user_id,initial_amount,remaining_amount)VALUES(o.id,a.id,org,actor,needed,needed);UPDATE public.agent_budget_accounts SET reserved=reserved+needed WHERE id=a.id;END LOOP;
 UPDATE public.research_jobs SET config=config||jsonb_build_object('automaticDeadline',(extract(epoch FROM deadline)*1000)::bigint),updated_at=clock_timestamp() WHERE id=j.id;
 RETURN public.agent_research_phase_budget_status(o.id);
END $$;

-- Name: agent_review_history_holds_clear(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_review_history_holds_clear(p_conversation uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
END $_$;

-- Name: agent_route_execution_permitted(uuid); Type: FUNCTION
CREATE FUNCTION public.agent_route_execution_permitted(p_route uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_same_execution_identity_scope(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_same_execution_identity_scope(p_left uuid, p_right uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF p_left IS NULL AND p_right IS NULL THEN RETURN true;END IF;
 IF p_left IS NULL THEN RETURN public.agent_mandate_identity_scope(p_right)='organization:'||current_setting('app.acquire_org',true);END IF;
 IF p_right IS NULL THEN RETURN public.agent_mandate_identity_scope(p_left)='organization:'||current_setting('app.acquire_org',true);END IF;
 RETURN public.agent_mandate_identity_scope(p_left)=public.agent_mandate_identity_scope(p_right);
END $$;

-- Name: agent_save_automatic_people_profile(uuid, uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_save_automatic_people_profile(operation uuid, target uuid, profile jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);scope jsonb;o public.agent_operations%ROWTYPE;pid text:=profile->>'id';email text:=lower(btrim(profile->>'email'));linkedin text:=profile->>'linkedinUrl';contact uuid;existing public.contacts%ROWTYPE;person_data jsonb;proof jsonb;fictional boolean;dnc boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR pid IS NULL OR pid!~'^fp[0-9]+$' OR length(coalesce(profile->>'name',''))>300 OR length(coalesce(profile->>'position',''))>300 OR length(coalesce(email,''))>300 OR jsonb_typeof(profile->'fictionalised') IS DISTINCT FROM 'boolean' OR jsonb_typeof(profile->'doNotContact') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Bounded nonphone automatic People profile required';END IF;
 scope:=public.agent_assert_automatic_people_target(operation,target);
 IF NOT coalesce(scope->'candidates' @> jsonb_build_array(pid),false) THEN RAISE EXCEPTION 'Person is outside saved automatic People selection';END IF;
 IF scope->'outcomes' ? pid THEN RETURN (scope->'outcomes'->pid->>'contactId')::uuid;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.organization_id=org AND p.firmable_person_id=pid AND p.target_id<>target) THEN RAISE EXCEPTION 'Person company identity requires review';END IF;
 IF email IS NULL OR email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN email:=NULL;END IF;
 IF linkedin IS NULL OR linkedin!~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' THEN linkedin:=NULL;END IF;
 fictional:=(profile->>'fictionalised')::boolean;dnc:=(profile->>'doNotContact')::boolean;
 SELECT * INTO existing FROM public.contacts p WHERE p.organization_id=org AND p.target_id=target AND p.firmable_person_id=pid FOR UPDATE;
 IF existing.id IS NOT NULL AND existing.fictionalised THEN RAISE EXCEPTION 'Existing person privacy requires review';END IF;
 person_data:=jsonb_strip_nulls(jsonb_build_object('email',email,'linkedinUrl',linkedin,'emailLookupStatus',CASE WHEN email IS NULL THEN 'not_reported' ELSE 'reported' END,'phoneLookupStatus','not_requested','doNotContact',coalesce((existing.personal_data->>'doNotContact')::boolean,false) OR dnc));
 proof:=jsonb_build_object('source','Firmable','nativeAutomaticPeopleOperationId',o.id,'capturedAt',clock_timestamp(),'phoneLookupStatus','not_requested');
 INSERT INTO public.firmable_people(id,name) VALUES(pid,left(profile->>'name',300)) ON CONFLICT(id) DO NOTHING;
 IF existing.id IS NULL THEN
  INSERT INTO public.contacts(organization_id,mandate_id,target_id,firmable_person_id,display_name,role,personal_data,provenance,fictionalised) VALUES(org,o.mandate_id,target,pid,coalesce(nullif(profile->>'name',''),pid),profile->>'position',person_data,proof,fictional) RETURNING id INTO contact;
 ELSE
  UPDATE public.contacts SET display_name=coalesce(nullif(display_name,''),nullif(profile->>'name',''),pid),role=coalesce(nullif(role,''),profile->>'position'),fictionalised=existing.fictionalised OR fictional,personal_data=coalesce(personal_data,'{}'::jsonb)||person_data,provenance=coalesce(provenance,'{}'::jsonb)||(proof-'source'-'capturedAt')||jsonb_build_object('nativeAutomaticPeopleCapturedAt',clock_timestamp()) WHERE id=existing.id RETURNING id INTO contact;
 END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config,ARRAY['automaticPeopleCompanies',target::text],scope||jsonb_build_object('outcomes',coalesce(scope->'outcomes','{}'::jsonb)||jsonb_build_object(pid,jsonb_build_object('contactId',contact)))),updated_at=clock_timestamp() WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org;
 RETURN contact;
END $_$;

-- Name: agent_save_channel_history(uuid, integer, jsonb, timestamp with time zone, boolean); Type: FUNCTION
CREATE FUNCTION public.agent_save_channel_history(p_route uuid, p_revision integer, p_history jsonb, p_observed timestamp with time zone, p_complete boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;message jsonb;history_hash text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id FOR UPDATE;
 IF r.id IS NULL OR p_revision IS NULL OR r.revision<>p_revision OR p_observed IS NULL OR p_observed>public.agent_business_now() OR p_observed<r.history_observed_at OR p_complete IS NULL OR jsonb_typeof(p_history) IS DISTINCT FROM 'array' OR jsonb_array_length(p_history)>200 OR octet_length(p_history::text)>1500000 THEN RAISE EXCEPTION 'Current bounded original-account history required';END IF;
 FOR message IN SELECT value FROM jsonb_array_elements(p_history) LOOP
  IF message->>'id' IS NULL OR message->>'direction' NOT IN('inbound','outbound') OR message->>'text' IS NULL OR (message->>'at')::timestamptz>p_observed THEN RAISE EXCEPTION 'Verified message metadata required';END IF;
  IF message->>'routeId' IS NULL THEN
   IF r.channel<>'email' OR r.binding_id<>c.binding_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) old WHERE old=message AND old->>'routeId' IS NULL) THEN RAISE EXCEPTION 'Only an unchanged original email source ID may be preserved';END IF;
  ELSIF message->>'routeId' IS DISTINCT FROM r.id::text OR message->>'channel' IS DISTINCT FROM r.channel OR message->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR coalesce(message->>'providerMessageId','')='' OR message->>'id' IS DISTINCT FROM 'channel-message:'||encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(r.binding_digest,message->>'providerMessageId')),'UTF8')),'hex') THEN RAISE EXCEPTION 'Original route-scoped provider identity required';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_history))<>jsonb_array_length(p_history) OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) old WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_history) fresh WHERE fresh=old)) THEN RAISE EXCEPTION 'Complete immutable prior history required';END IF;
 history_hash:=encode(sha256(convert_to(public.agent_channel_canonical_json(p_history),'UTF8')),'hex');
 UPDATE public.agent_conversation_channels SET history=p_history,history_revision=history_hash,history_complete=p_complete,history_observed_at=p_observed,revision=revision+CASE WHEN history_revision<>history_hash OR history_complete<>p_complete THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE id=r.id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_history) x WHERE x->>'direction'='inbound') THEN
  UPDATE public.agent_conversation_channels SET cold_cancelled_at=coalesce(cold_cancelled_at,clock_timestamp()),next_allowed_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id AND cold_cancelled_at IS NULL;
 END IF;
END $$;

-- Name: agent_save_channel_policy(uuid, integer, jsonb, integer, jsonb, boolean); Type: FUNCTION
CREATE FUNCTION public.agent_save_channel_policy(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE t public.agent_threads%ROWTYPE;ref jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF t.id IS NULL OR jsonb_typeof(p_bindings) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Exact owned channel policy required';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(p_bindings) LOOP
  IF coalesce(ref->>'bindingId','')!~'^[a-f0-9-]{36}$' OR NOT public.agent_allowed_mandate_binding(t.mandate_id,(ref->>'bindingId')::uuid) THEN RAISE EXCEPTION 'The selected account belongs to another execution context';END IF;
 END LOOP;
 RETURN public.agent_save_channel_policy_before_execution_context(p_thread,p_revision,p_order,p_delay,p_bindings,p_accelerated);
END $_$;

-- Name: agent_save_channel_policy_before_execution_context(uuid, integer, jsonb, integer, jsonb, boolean); Type: FUNCTION
CREATE FUNCTION public.agent_save_channel_policy_before_execution_context(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE t public.agent_threads%ROWTYPE;prior public.agent_channel_policies%ROWTYPE;binding public.communication_bindings%ROWTYPE;item jsonb;resolved jsonb:='[]';channels text[];candidate record;notice jsonb;next_revision integer;budget_started timestamptz:=clock_timestamp();
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 IF t.id IS NULL OR p_revision IS NULL OR p_revision<0 OR jsonb_typeof(p_order) IS DISTINCT FROM 'array' OR jsonb_typeof(p_bindings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_order) NOT BETWEEN 1 AND 3 OR jsonb_array_length(p_order)<>jsonb_array_length(p_bindings) OR p_accelerated IS NULL OR p_delay IS NULL OR NOT(p_accelerated AND p_delay BETWEEN 3 AND 60 OR NOT p_accelerated AND p_delay BETWEEN 86400 AND 31622400) THEN RAISE EXCEPTION 'Exact bounded channel policy required';END IF;
 SELECT array_agg(value ORDER BY ordinality) INTO channels FROM jsonb_array_elements_text(p_order) WITH ORDINALITY;
 IF cardinality(channels)<>(SELECT count(DISTINCT x) FROM unnest(channels) x) OR EXISTS(SELECT 1 FROM unnest(channels) x WHERE x IS NULL OR x NOT IN('email','whatsapp','linkedin')) THEN RAISE EXCEPTION 'Unique known channel order required';END IF;
 SELECT * INTO prior FROM public.agent_channel_policies WHERE thread_id=t.id FOR UPDATE;
 IF coalesce(prior.revision,0)<>p_revision THEN RAISE EXCEPTION 'Channel policy changed; review again';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.thread_id=t.id AND public.agent_person_has_unresolved_sends(c.contact_id,NULL)) THEN RAISE EXCEPTION 'Original in-flight outcomes must be reconciled before policy changes';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bindings) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR item->>'channel' IS NULL OR NOT coalesce(item->>'channel'=ANY(channels),false) OR (item->>'bindingId')!~'^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Exact reviewed account selection required';END IF;
  SELECT * INTO binding FROM public.communication_bindings WHERE id=(item->>'bindingId')::uuid AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id AND channel=item->>'channel' AND application_id='acquire' AND authority='service' AND backend='unipile';
  IF binding.id IS NULL OR p_accelerated AND NOT public.agent_channel_local_binding(binding.id) THEN RAISE EXCEPTION 'Current owned account and verified simulation profile required';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(resolved) x WHERE x->>'channel'=binding.channel OR x->>'bindingId'=binding.id::text) THEN RAISE EXCEPTION 'One exact account per channel required';END IF;
  resolved:=resolved||jsonb_build_array(jsonb_build_object('channel',binding.channel,'bindingId',binding.id,'bindingDigest',public.agent_recorded_binding_digest(binding.id)));
  IF EXISTS(SELECT 1 FROM public.member WHERE organization_id=t.organization_id AND user_id=t.owner_user_id AND role IN('owner','admin')) AND NOT EXISTS(SELECT 1 FROM public.agent_budget_accounts WHERE organization_id=t.organization_id AND scope_key='binding:'||public.agent_recorded_binding_digest(binding.id)||':sends' AND window_end>budget_started) THEN
   PERFORM public.agent_configure_budget('binding:'||public.agent_recorded_binding_digest(binding.id)||':sends','sends',budget_started,budget_started+interval '24 hours',30,0);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.thread_id=t.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(resolved) x WHERE x->>'channel'=r.channel AND x->>'bindingId'=r.binding_id::text)) THEN RAISE EXCEPTION 'Existing route account cannot be silently replaced; use an explicit reconciled handover';END IF;
 next_revision:=coalesce(prior.revision,0)+1;
 INSERT INTO public.agent_channel_policies(thread_id,organization_id,owner_user_id,mandate_id,revision,channel_order,delay_seconds,bindings,accelerated_simulation) VALUES(t.id,t.organization_id,t.owner_user_id,t.mandate_id,next_revision,channels,p_delay,resolved,p_accelerated)
 ON CONFLICT(thread_id) DO UPDATE SET revision=EXCLUDED.revision,channel_order=EXCLUDED.channel_order,delay_seconds=EXCLUDED.delay_seconds,bindings=EXCLUDED.bindings,accelerated_simulation=EXCLUDED.accelerated_simulation,updated_at=clock_timestamp();
 FOR candidate IN SELECT id FROM public.agent_conversations WHERE thread_id=t.id ORDER BY id FOR UPDATE LOOP
  UPDATE public.agent_conversations SET revision=revision+1,epoch=epoch+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=candidate.id;
  PERFORM public.agent_invalidate_person_reviews(candidate.id);
 END LOOP;
 UPDATE public.agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE thread_id=t.id AND revoked_at IS NULL;
 notice:=jsonb_build_object('text',CASE WHEN p_accelerated THEN 'You reviewed an accelerated local simulation channel policy. No provider message is approved by this setting.' ELSE 'You reviewed the channel order, exact accounts and delay between unanswered outreach. Any reply cancels pending cold outreach on every channel. Messages still require approval.' END,'details',jsonb_build_object('policyRevision',next_revision,'channelOrder',p_order,'delaySeconds',p_delay,'bindings',resolved,'acceleratedSimulation',p_accelerated));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,'channel-policy:'||next_revision,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(t.organization_id,t.owner_user_id,'agent.channel_policy_reviewed','agent_thread',t.id::text,notice->'details');
 RETURN jsonb_build_object('revision',next_revision);
END $_$;

-- Name: agent_save_people_profile(uuid, uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_save_people_profile(operation uuid, target uuid, profile jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;snapshot jsonb;current_item jsonb;selected jsonb;job uuid;pid text:=profile->>'id';email text:=lower(btrim(profile->>'email'));contact uuid;existing public.contacts%ROWTYPE;fictional boolean;dnc boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.people' AND state='running';
 IF o.id IS NULL OR pid!~'^fp[0-9]+$' OR length(coalesce(profile->>'name',''))>300 OR length(coalesce(profile->>'position',''))>300 THEN RAISE EXCEPTION 'Bounded owned people profile required';END IF;
 job:=(o.input->'config'->>'requestId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.id=job AND j.organization_id=org AND j.config->'nativePeopleCandidates'->target::text @> jsonb_build_array(pid)) THEN RAISE EXCEPTION 'Profile is not in the saved company search';END IF;
 SELECT value INTO selected FROM jsonb_array_elements(o.input->'selected') WHERE value->>'targetId'=target::text;
 snapshot:=public.agent_people_company_snapshot(o.thread_id,ARRAY[target],o.id);current_item:=snapshot->'companies'->0;
 IF selected IS NULL OR current_item->>'sourceRevision' IS DISTINCT FROM selected->>'sourceRevision' OR jsonb_array_length(current_item->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Company changed before profile persistence';END IF;
 IF email IS NULL OR email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RETURN NULL;END IF;
 fictional:=coalesce((profile->>'fictionalised')::boolean,true);dnc:=coalesce((profile->>'doNotContact')::boolean,true);
 SELECT * INTO existing FROM public.contacts WHERE organization_id=org AND target_id=target AND firmable_person_id=pid FOR UPDATE;
 IF existing.id IS NOT NULL THEN
  IF existing.fictionalised THEN RETURN NULL;END IF;
  IF coalesce(existing.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RETURN existing.id;END IF;
  IF (SELECT count(*) FROM public.contacts WHERE organization_id=org AND target_id=target AND provenance->>'nativePeopleOperationId'=o.id::text)>=3 THEN RAISE EXCEPTION 'Company contact limit reached';END IF;
  UPDATE public.contacts SET personal_data=coalesce(personal_data,'{}')||jsonb_build_object('email',email,'emailLookupStatus',coalesce(profile->>'emailLookupStatus','reported'),'doNotContact',coalesce((personal_data->>'doNotContact')::boolean,false) OR dnc),provenance=coalesce(provenance,'{}')||jsonb_build_object('nativePeopleOperationId',o.id,'nativeEmailCapturedAt',clock_timestamp(),'phoneLookupStatus','not_requested') WHERE id=existing.id;
  RETURN existing.id;
 END IF;
 IF (SELECT count(*) FROM public.contacts WHERE organization_id=org AND target_id=target AND provenance->>'nativePeopleOperationId'=o.id::text)>=3 THEN RAISE EXCEPTION 'Company contact limit reached';END IF;
 INSERT INTO public.firmable_people(id,name) VALUES(pid,left(profile->>'name',300)) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.contacts(organization_id,mandate_id,target_id,firmable_person_id,display_name,role,personal_data,provenance,fictionalised)
 VALUES(org,o.mandate_id,target,pid,coalesce(nullif(profile->>'name',''),pid),profile->>'position',jsonb_build_object('email',email,'emailLookupStatus',coalesce(profile->>'emailLookupStatus','reported'),'doNotContact',dnc),jsonb_build_object('source','Firmable','nativePeopleOperationId',o.id,'capturedAt',clock_timestamp(),'phoneLookupStatus','not_requested'),fictional) RETURNING id INTO contact;
 RETURN contact;
END $_$;

-- Name: agent_sequence_channel_handover_source(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_sequence_channel_handover_source(p_thread uuid, p_enrolment uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
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
END $_$;

-- Name: agent_sequence_driver_before_company_projection(uuid, uuid, text, integer); Type: FUNCTION
CREATE FUNCTION public.agent_sequence_driver_before_company_projection(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_sequence_driver_matches(uuid, uuid, text, integer); Type: FUNCTION
CREATE FUNCTION public.agent_sequence_driver_matches(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 RETURN public.agent_sequence_driver_before_company_projection(p_conversation,p_enrolment,p_runtime,p_generation) AND public.agent_company_conversation_permitted(p_conversation);
END $$;

-- Name: agent_sequence_driver_matches_before_channels(uuid, uuid, text, integer); Type: FUNCTION
CREATE FUNCTION public.agent_sequence_driver_matches_before_channels(conversation uuid, enrolment uuid, requested_runtime text, requested_generation integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_sequence_handover_source(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_sequence_handover_source(thread uuid, enrolment uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Name: agent_settle_budget(uuid, jsonb); Type: FUNCTION
CREATE FUNCTION public.agent_settle_budget(operation uuid, actuals jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);entry jsonb;reservation public.agent_budget_reservations%ROWTYPE;actual_units bigint;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF jsonb_typeof(actuals)<>'array' OR jsonb_array_length(actuals) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Bounded usage group required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor) THEN RAISE EXCEPTION 'Recorded operation required'; END IF;
 PERFORM 1 FROM public.agent_operations WHERE id=operation FOR UPDATE;
 IF (SELECT count(*) FROM public.agent_budget_reservations r WHERE r.operation_id=operation)<>jsonb_array_length(actuals) OR (SELECT count(DISTINCT value->>'accountId') FROM jsonb_array_elements(actuals))<>jsonb_array_length(actuals) THEN RAISE EXCEPTION 'Exact reservation usage required'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(actuals) ORDER BY value->>'accountId' LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT entry ?& ARRAY['accountId','actual'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) AS keys(key) WHERE key NOT IN('accountId','actual')) OR ((entry->>'actual') IS NOT NULL AND (entry->>'actual')!~'^(0|[1-9][0-9]{0,11})$') THEN RAISE EXCEPTION 'Invalid usage'; END IF;
  SELECT * INTO STRICT reservation FROM public.agent_budget_reservations r WHERE r.operation_id=operation AND r.account_id=(entry->>'accountId')::uuid AND r.organization_id=org AND r.owner_user_id=actor FOR UPDATE;
  IF reservation.state='released' THEN RAISE EXCEPTION 'Released reservation cannot be settled'; END IF;
  IF (entry->>'actual') IS NULL THEN
   IF reservation.state<>'settled' THEN UPDATE public.agent_budget_reservations SET state='uncertain',updated_at=clock_timestamp() WHERE id=reservation.id RETURNING * INTO reservation; END IF;
  ELSE
   actual_units:=(entry->>'actual')::bigint;
   IF reservation.state='settled' THEN IF reservation.actual<>actual_units THEN RAISE EXCEPTION 'Different usage replay'; END IF;
   ELSE
    UPDATE public.agent_budget_accounts SET reserved=reserved-reservation.amount,spent=spent+actual_units WHERE id=reservation.account_id;
    UPDATE public.agent_budget_reservations SET state='settled',actual=actual_units,updated_at=clock_timestamp() WHERE id=reservation.id RETURNING * INTO reservation;
   END IF;
  END IF;result:=result||jsonb_build_array(to_jsonb(reservation)||jsonb_build_object('amount',reservation.amount::text,'actual',reservation.actual::text));
 END LOOP;RETURN result;
END $_$;

-- Name: agent_simulator_window_exception(uuid, uuid, text, text, timestamp with time zone); Type: FUNCTION
CREATE FUNCTION public.agent_simulator_window_exception(mandate uuid, binding uuid, binding_hash text, recipient text, at_time timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
 SELECT false;
$$;

-- Name: agent_sink_guard(); Type: FUNCTION
CREATE FUNCTION public.agent_sink_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE op public.agent_operations%ROWTYPE;conversation public.agent_conversations%ROWTYPE;
BEGIN
 IF NOT public.agent_operation_authorised(NEW.operation_id) THEN RAISE EXCEPTION 'Current local simulation authority unavailable'; END IF;
 SELECT * INTO STRICT op FROM public.agent_operations WHERE id=NEW.operation_id;
 SELECT * INTO STRICT conversation FROM public.agent_conversations WHERE id=NEW.conversation_id;
 IF conversation.delivery_mode<>'local_sink' OR op.conversation_id<>conversation.id OR NEW.payload_digest<>op.input_digest OR NEW.recipient_email<>conversation.recipient_email OR NEW.body IS DISTINCT FROM op.input->>'body' OR NEW.subject IS DISTINCT FROM op.input->>'subject' THEN RAISE EXCEPTION 'Local simulation snapshot mismatch'; END IF;
 RETURN NEW;
END $$;

-- Name: agent_target_snapshot(uuid, uuid[]); Type: FUNCTION
CREATE FUNCTION public.agent_target_snapshot(p_thread uuid, p_contacts uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE snapshot jsonb;item jsonb;items jsonb:='[]';projection jsonb;mid uuid;
BEGIN
 snapshot:=public.agent_target_snapshot_before_company_projection(p_thread,p_contacts);
 SELECT mandate_id INTO mid FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'candidates') LOOP
  projection:=public.agent_company_membership_projection(mid,(item->>'targetId')::uuid);
  IF projection IS NOT NULL THEN item:=item||jsonb_build_object('target',projection->'target','assessment',projection->'assessment','blockedReasons',(item->'blockedReasons')||(projection->'blockedReasons'),'sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(item->>'sourceRevision',projection->>'digest')),'UTF8')),'hex'));END IF;
  items:=items||jsonb_build_array(item);
 END LOOP;RETURN snapshot||jsonb_build_object('candidates',items);
END $$;

-- Name: agent_target_snapshot_before_company_projection(uuid, uuid[]); Type: FUNCTION
CREATE FUNCTION public.agent_target_snapshot_before_company_projection(p_thread uuid, p_contacts uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
END $$;

-- Name: agent_transfer_research_phase_attempt(uuid, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_transfer_research_phase_attempt(p_parent uuid, p_attempt uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);parent public.agent_operations%ROWTYPE;child public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;x record;amount bigint;prior integer;result jsonb:='[]';company_v4 boolean;company_v5 boolean;request_usd bigint:=1000000;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO parent FROM public.agent_operations WHERE id=p_parent AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE;
 SELECT * INTO child FROM public.agent_operations WHERE id=p_attempt AND thread_id=parent.thread_id AND organization_id=org AND owner_user_id=actor AND name='research.provider' AND state='running' FOR UPDATE;
 IF parent.id IS NULL OR child.id IS NULL OR child.input->>'researchOperationId' IS DISTINCT FROM parent.id::text OR child.input->>'researchJobId' IS DISTINCT FROM parent.input->'config'->>'requestId' THEN RAISE EXCEPTION 'Exact current research attempt required';END IF;
 company_v5:=parent.name='research.start' AND public.agent_research_v5_scope(parent.input);
 company_v4:=coalesce(parent.name='research.start' AND parent.input->>'nativeResearchPlanVersion'='1'
  AND parent.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND parent.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND parent.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND parent.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND parent.input->'config'->'companyOnly'='true'::jsonb AND parent.input->'config'->'targetBusinesses'='20'::jsonb
  AND parent.input->'config'->'findPeople'='false'::jsonb AND parent.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND parent.input->'config'->'includePhones'='false'::jsonb AND parent.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(parent.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND NOT company_v5 AND (parent.input->'providerPolicy'->>'version' IN('2','3') OR parent.input->'config'->'companyDiscoveryPolicy'->>'version' IN('4','5')) THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF company_v4 AND child.input->>'provider'='firmable' AND coalesce(child.input->>'requestClass','') NOT IN('company_search','company_profile','auth') THEN RAISE EXCEPTION 'Exact company-only Firmable request class required';END IF;
 IF company_v4 THEN request_usd:=(parent.input->'providerPolicy'->'requestCeilingsMicroUsd'->>(child.input->>'provider'))::bigint;END IF;
 IF company_v5 THEN
  IF child.input->>'provider'='firmable' THEN
   IF coalesce(child.input->>'requestClass','') NOT IN('company_search','company_profile','auth','people_search','person_profile') THEN RAISE EXCEPTION 'Exact nonphone V5 request class required';END IF;
   IF child.input->>'requestClass' IN('people_search','person_profile') THEN
    PERFORM public.agent_assert_automatic_people_target(parent.id,(child.input->>'targetId')::uuid);
    IF (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'targetId'=child.input->>'targetId' AND a.input->>'requestClass'=child.input->>'requestClass')>(CASE WHEN child.input->>'requestClass'='people_search' THEN 2 ELSE 6 END) THEN RAISE EXCEPTION 'Bounded physical People attempts exhausted';END IF;
   ELSE request_usd:=0;
   END IF;
  END IF;
 END IF;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=parent.id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF p.operation_id IS NULL OR p.state<>'active' OR p.input_digest IS DISTINCT FROM parent.input_digest OR p.deadline<=clock_timestamp() OR NOT(public.agent_research_phase_budget_status(parent.id)->>'ready')::boolean THEN RAISE EXCEPTION 'Complete current phase funding required';END IF;
 IF child.input->>'provider' IS NULL OR child.input->>'provider' NOT IN('search','page','ai','firmable') OR NOT(parent.input->'providerPolicy'->'maxAttempts' ? (child.input->>'provider')) OR (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'provider'=child.input->>'provider')>(parent.input->'providerPolicy'->'maxAttempts'->>(child.input->>'provider'))::integer THEN RAISE EXCEPTION 'Frozen provider attempt ceiling required';END IF;
 IF parent.name='research.fields' AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.input->'selected')s WHERE s->>'targetId'=child.input->>'targetId') OR child.input->>'provider' NOT IN('search','page') OR (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'targetId'=child.input->>'targetId' AND a.input->>'provider'=child.input->>'provider')>(parent.input->'providerPolicy'->'perCompany'->>(child.input->>'provider'))::integer) THEN RAISE EXCEPTION 'Frozen public company attempt ceiling required';END IF;
 SELECT count(*) INTO prior FROM public.agent_budget_reservations WHERE operation_id=child.id;
 IF prior NOT IN(0,6) THEN RAISE EXCEPTION 'Partial research attempt reservation';END IF;
 IF prior=6 THEN IF(SELECT count(*) FROM public.agent_budget_reservations r JOIN public.agent_research_phase_allocations a ON a.operation_id=parent.id AND a.account_id=r.account_id JOIN public.agent_budget_accounts b ON b.id=r.account_id WHERE r.operation_id=child.id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='reserved' AND r.amount=CASE WHEN b.unit='calls' THEN 1 WHEN b.unit='usd_micro' THEN request_usd ELSE NULL END)<>6 THEN RAISE EXCEPTION 'Original research attempt allocation changed';END IF;RETURN jsonb_build_object('replay',true);END IF;
 IF(SELECT count(*) FROM public.agent_research_phase_allocations WHERE operation_id=parent.id)<>6 THEN RAISE EXCEPTION 'Exact six-account research allocation required';END IF;
 FOR x IN SELECT a.account_id,a.remaining_amount,b.unit,b.cap,b.spent,b.reserved,b.window_start,b.window_end FROM public.agent_research_phase_allocations a JOIN public.agent_budget_accounts b ON b.id=a.account_id AND b.organization_id=org WHERE a.operation_id=parent.id ORDER BY a.account_id FOR UPDATE OF a,b LOOP
  amount:=CASE WHEN x.unit='calls' THEN 1 WHEN x.unit='usd_micro' THEN request_usd ELSE NULL END;
  IF (company_v4 OR company_v5) AND x.unit='calls' OR company_v5 AND x.unit='usd_micro' AND child.input->>'provider'='firmable' AND child.input->>'requestClass' IN('people_search','person_profile') THEN
   IF x.window_start>clock_timestamp() OR x.window_end<=clock_timestamp() OR x.cap-x.spent-x.reserved<amount THEN RAISE EXCEPTION 'Current research request budget exhausted or expired';END IF;
   UPDATE public.agent_budget_accounts SET reserved=reserved+amount WHERE id=x.account_id;
  ELSE
   IF amount IS NULL OR x.remaining_amount<amount THEN RAISE EXCEPTION 'Research phase allocation exhausted';END IF;
   UPDATE public.agent_research_phase_allocations SET remaining_amount=remaining_amount-amount WHERE operation_id=parent.id AND account_id=x.account_id;
  END IF;
  INSERT INTO public.agent_budget_reservations(operation_id,account_id,organization_id,owner_user_id,amount,state)VALUES(child.id,x.account_id,org,actor,amount,'reserved');
  result:=result||jsonb_build_array(jsonb_build_object('accountId',x.account_id,'amount',amount::text));
 END LOOP;RETURN result;
END $$;

-- Name: agent_worker_scopes(integer); Type: FUNCTION
CREATE FUNCTION public.agent_worker_scopes(maximum integer) RETURNS TABLE(organization_id text, owner_user_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Authenticated agent worker scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE public.agent_event_eligible(e.thread_id,e.kind) AND e.available_at<=public.agent_business_now() AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()) AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL OR e.organization_id=current_setting('app.acquire_org',true) AND e.owner_user_id=current_setting('app.acquire_user',true))
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $$;

-- Name: agent_worker_scopes_for_mandate(integer, uuid); Type: FUNCTION
CREATE FUNCTION public.agent_worker_scopes_for_mandate(maximum integer, selected_mandate uuid) RETURNS TABLE(organization_id text, owner_user_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_agent_worker' OR maximum IS NULL OR maximum NOT BETWEEN 1 AND 10 OR selected_mandate IS NULL THEN RAISE EXCEPTION 'Exact authenticated native mandate scope required'; END IF;
 RETURN QUERY SELECT r.organization_id,r.owner_user_id FROM public.agent_responsibilities r
 JOIN public.member m ON m.organization_id=r.organization_id AND m.user_id=r.owner_user_id
 JOIN public.agent_events e ON e.thread_id=r.thread_id AND e.organization_id=r.organization_id AND e.owner_user_id=r.owner_user_id
 WHERE r.mandate_id=selected_mandate AND e.mandate_id=selected_mandate
 AND public.agent_event_eligible(e.thread_id,e.kind) AND e.available_at<=public.agent_business_now() AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp()) AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL OR e.organization_id=current_setting('app.acquire_org',true) AND e.owner_user_id=current_setting('app.acquire_user',true))
 AND (e.state='pending' OR e.state='leased' AND e.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.agent_runs run WHERE run.thread_id=r.thread_id AND run.state='running' AND (run.lease_until IS NULL OR run.lease_until>clock_timestamp()))
 GROUP BY r.organization_id,r.owner_user_id ORDER BY min(e.available_at),r.organization_id,r.owner_user_id LIMIT maximum;
END $$;

-- Name: communications_policy_statement_fence(); Type: FUNCTION
CREATE OR REPLACE FUNCTION public.communications_policy_statement_fence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE invoker text:=current_setting('role',true);org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF invoker='acquire_agent_user' AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME IN('contacts','campaign_sequences','campaign_sequence_versions','campaign_enrolments','campaign_contact_assignments','campaign_channel_bindings','campaign_reply_identities')
 AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current())
 AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RETURN NULL; END IF;
 IF invoker IN('acquire_campaign_user','acquire_communications_writer','acquire_campaign_worker') AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RETURN NULL; END IF;
 IF invoker NOT IN('none','acquire_campaign_worker') THEN RAISE EXCEPTION 'Registered scoped writer must acquire organization gate first'; END IF;
 PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 UPDATE public.communication_member_fence SET writer_xid=txid_current() WHERE singleton;
 RETURN NULL;
END $$;

-- Name: communications_resolve_untracked_outbound(uuid, uuid, text); Type: FUNCTION
CREATE FUNCTION public.communications_resolve_untracked_outbound(p_request uuid, p_binding uuid, p_event text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'communications'
    AS $_$
BEGIN
 RAISE EXCEPTION 'Remote untracked-outbound recovery requires service evidence; review remains held';
END $_$;

-- Name: communications_submission_receipt_guard(); Type: FUNCTION
CREATE FUNCTION public.communications_submission_receipt_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE i public.communication_dispatch_intents%ROWTYPE;
BEGIN
 IF NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true) OR NEW.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=NEW.organization_id AND user_id=NEW.owner_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current original receipt scope required';END IF;
 SELECT * INTO i FROM public.communication_dispatch_intents WHERE id=NEW.intent_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF i.id IS NULL OR i.binding_id IS DISTINCT FROM NEW.binding_id OR i.source_kind IS DISTINCT FROM NEW.source_kind OR i.source_id IS DISTINCT FROM NEW.source_id
 OR i.operation IS DISTINCT FROM NEW.operation OR i.operation_key IS DISTINCT FROM NEW.operation_key OR i.payload_digest IS DISTINCT FROM NEW.payload_digest
 OR i.source_digest IS DISTINCT FROM NEW.source_digest OR i.intent_digest IS DISTINCT FROM NEW.original_intent_digest
 OR NEW.submitted_at>public.agent_business_now() OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_permits WHERE intent_id=i.id)
 OR EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=i.id)
 THEN RAISE EXCEPTION 'Exact authenticated original submission receipt required';END IF;
 RETURN NEW;
END $$;

-- Name: communications_submission_receipt_immutable(); Type: FUNCTION
CREATE FUNCTION public.communications_submission_receipt_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN RAISE EXCEPTION 'Original submission receipt is immutable';END $$;

-- Name: company_identity_append_only(); Type: FUNCTION
CREATE FUNCTION public.company_identity_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN RAISE EXCEPTION 'Company identity evidence is immutable'; END $$;

-- Name: agent_operations; Type: TABLE
CREATE TABLE public.agent_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    request_key text NOT NULL,
    name text NOT NULL,
    input jsonb NOT NULL,
    input_digest text NOT NULL,
    state text DEFAULT 'proposed'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_until timestamp with time zone,
    fence bigint DEFAULT 0 NOT NULL,
    conversation_id uuid,
    business_completed_at timestamp with time zone,
    CONSTRAINT agent_operations_request_key_check CHECK (((length(request_key) >= 1) AND (length(request_key) <= 200))),
    CONSTRAINT agent_operations_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_operations_state_check CHECK ((state = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'running'::text, 'complete'::text, 'failed'::text, 'uncertain'::text])))
);

ALTER TABLE ONLY public.agent_operations FORCE ROW LEVEL SECURITY;

-- Name: local_simulator_operation_business_anchor(public.agent_operations); Type: FUNCTION
CREATE FUNCTION public.agent_operation_business_anchor(p_operation public.agent_operations) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
 PERFORM public.agent_business_now();
 RETURN greatest((p_operation.result->'delivery'->>'submittedAt')::timestamptz,p_operation.updated_at);
END $$;

-- Name: agent_authority_grants; Type: TABLE
CREATE TABLE public.agent_authority_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    channel text NOT NULL,
    actions jsonb NOT NULL,
    recipient_keys jsonb NOT NULL,
    binding_digest text NOT NULL,
    max_sends integer NOT NULL,
    used_sends integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    approved_by text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    route_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT agent_authority_grants_actions_check CHECK (((jsonb_typeof(actions) = 'array'::text) AND ((jsonb_array_length(actions) >= 1) AND (jsonb_array_length(actions) <= 3)) AND
CASE channel
    WHEN 'email'::text THEN (actions <@ '["initial_email", "reply_email", "follow_up_email"]'::jsonb)
    WHEN 'whatsapp'::text THEN ((jsonb_array_length(route_ids) > 0) AND (actions <@ '["initial_whatsapp", "reply_whatsapp", "follow_up_whatsapp"]'::jsonb))
    WHEN 'linkedin'::text THEN ((jsonb_array_length(route_ids) > 0) AND (actions <@ '["initial_linkedin", "reply_linkedin", "follow_up_linkedin"]'::jsonb))
    ELSE false
END)),
    CONSTRAINT agent_authority_grants_binding_digest_check CHECK ((length(binding_digest) = 64)),
    CONSTRAINT agent_authority_grants_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'linkedin'::text]))),
    CONSTRAINT agent_authority_grants_check CHECK (((used_sends >= 0) AND (used_sends <= max_sends))),
    CONSTRAINT agent_authority_grants_check1 CHECK (((expires_at > approved_at) AND (expires_at <= (approved_at + '7 days'::interval)))),
    CONSTRAINT agent_authority_grants_max_sends_check CHECK (((max_sends >= 1) AND (max_sends <= 100))),
    CONSTRAINT agent_authority_grants_recipient_keys_check CHECK (((jsonb_typeof(recipient_keys) = 'array'::text) AND ((jsonb_array_length(recipient_keys) >= 1) AND (jsonb_array_length(recipient_keys) <= 200)))),
    CONSTRAINT agent_authority_grants_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_authority_grants_route_ids_check CHECK (((jsonb_typeof(route_ids) = 'array'::text) AND (jsonb_array_length(route_ids) <= 200)))
);

ALTER TABLE ONLY public.agent_authority_grants FORCE ROW LEVEL SECURITY;

-- Name: agent_authority_uses; Type: TABLE
CREATE TABLE public.agent_authority_uses (
    operation_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    thread_id uuid NOT NULL,
    grant_id uuid,
    grant_revision integer,
    review_batch_id uuid,
    operation_revision integer NOT NULL,
    operation_fence bigint NOT NULL,
    operation_digest text NOT NULL,
    context_revision text NOT NULL,
    binding_digest text NOT NULL,
    state text NOT NULL,
    outcome jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_authority_uses_check CHECK (((grant_id IS NOT NULL) <> (review_batch_id IS NOT NULL))),
    CONSTRAINT agent_authority_uses_check1 CHECK (((grant_id IS NOT NULL) = (grant_revision IS NOT NULL))),
    CONSTRAINT agent_authority_uses_operation_digest_check CHECK ((operation_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_authority_uses_operation_fence_check CHECK ((operation_fence > 0)),
    CONSTRAINT agent_authority_uses_operation_revision_check CHECK ((operation_revision > 0)),
    CONSTRAINT agent_authority_uses_state_check CHECK ((state = ANY (ARRAY['reserved'::text, 'admitted'::text, 'settled'::text, 'uncertain'::text, 'released'::text])))
);

ALTER TABLE ONLY public.agent_authority_uses FORCE ROW LEVEL SECURITY;

-- Name: agent_budget_accounts; Type: TABLE
CREATE TABLE public.agent_budget_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id text NOT NULL,
    scope_key text NOT NULL,
    unit text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    cap bigint NOT NULL,
    spent bigint DEFAULT 0 NOT NULL,
    reserved bigint DEFAULT 0 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    approved_by text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_budget_accounts_cap_check CHECK (((cap >= 0) AND (cap <= '1000000000000'::bigint))),
    CONSTRAINT agent_budget_accounts_check CHECK (((window_end > window_start) AND (window_end <= (window_start + '31 days'::interval)))),
    CONSTRAINT agent_budget_accounts_reserved_check CHECK ((reserved >= 0)),
    CONSTRAINT agent_budget_accounts_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_budget_accounts_scope_key_check CHECK (((length(scope_key) >= 1) AND (length(scope_key) <= 200))),
    CONSTRAINT agent_budget_accounts_spent_check CHECK ((spent >= 0)),
    CONSTRAINT agent_budget_accounts_unit_check CHECK ((unit = ANY (ARRAY['usd_micro'::text, 'calls'::text, 'sends'::text])))
);

ALTER TABLE ONLY public.agent_budget_accounts FORCE ROW LEVEL SECURITY;

-- Name: agent_budget_reservations; Type: TABLE
CREATE TABLE public.agent_budget_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operation_id uuid NOT NULL,
    account_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    amount bigint NOT NULL,
    actual bigint,
    state text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_budget_reservations_actual_check CHECK ((actual >= 0)),
    CONSTRAINT agent_budget_reservations_amount_check CHECK ((amount >= 0)),
    CONSTRAINT agent_budget_reservations_check CHECK (((state = 'settled'::text) = (actual IS NOT NULL))),
    CONSTRAINT agent_budget_reservations_state_check CHECK ((state = ANY (ARRAY['reserved'::text, 'settled'::text, 'uncertain'::text, 'released'::text])))
);

ALTER TABLE ONLY public.agent_budget_reservations FORCE ROW LEVEL SECURITY;

-- Name: agent_channel_policies; Type: TABLE
CREATE TABLE public.agent_channel_policies (
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    mandate_id uuid NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    channel_order text[] NOT NULL,
    delay_seconds integer NOT NULL,
    bindings jsonb NOT NULL,
    accelerated_simulation boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_channel_policies_bindings_check CHECK (((jsonb_typeof(bindings) = 'array'::text) AND ((jsonb_array_length(bindings) >= 1) AND (jsonb_array_length(bindings) <= 3)))),
    CONSTRAINT agent_channel_policies_channel_order_check CHECK (((cardinality(channel_order) >= 1) AND (cardinality(channel_order) <= 3))),
    CONSTRAINT agent_channel_policies_check CHECK (((accelerated_simulation AND ((delay_seconds >= 3) AND (delay_seconds <= 60))) OR ((NOT accelerated_simulation) AND (delay_seconds >= 86400)))),
    CONSTRAINT agent_channel_policies_delay_seconds_check CHECK (((delay_seconds >= 3) AND (delay_seconds <= 31622400))),
    CONSTRAINT agent_channel_policies_revision_check CHECK ((revision > 0))
);

ALTER TABLE ONLY public.agent_channel_policies FORCE ROW LEVEL SECURITY;

-- Name: agent_conversation_channels; Type: TABLE
CREATE TABLE public.agent_conversation_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    thread_id uuid NOT NULL,
    mandate_id uuid NOT NULL,
    channel text NOT NULL,
    binding_id uuid NOT NULL,
    binding_digest text NOT NULL,
    recipient_kind text NOT NULL,
    recipient_value text NOT NULL,
    identity_source jsonb NOT NULL,
    identity_revision text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    history_revision text NOT NULL,
    history_complete boolean DEFAULT false NOT NULL,
    history_observed_at timestamp with time zone,
    next_allowed_at timestamp with time zone,
    cold_cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_conversation_channels_binding_digest_check CHECK ((binding_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_conversation_channels_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'linkedin'::text]))),
    CONSTRAINT agent_conversation_channels_check CHECK ((((channel = 'email'::text) AND (recipient_kind = 'email'::text)) OR ((channel = 'whatsapp'::text) AND (recipient_kind = 'phone'::text)) OR ((channel = 'linkedin'::text) AND (recipient_kind = 'linkedin_profile'::text)))),
    CONSTRAINT agent_conversation_channels_history_check CHECK (((jsonb_typeof(history) = 'array'::text) AND (jsonb_array_length(history) <= 200))),
    CONSTRAINT agent_conversation_channels_identity_revision_check CHECK ((identity_revision ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_conversation_channels_recipient_kind_check CHECK ((recipient_kind = ANY (ARRAY['email'::text, 'phone'::text, 'linkedin_profile'::text]))),
    CONSTRAINT agent_conversation_channels_recipient_value_check CHECK (((length(recipient_value) >= 3) AND (length(recipient_value) <= 500))),
    CONSTRAINT agent_conversation_channels_revision_check CHECK ((revision > 0))
);

ALTER TABLE ONLY public.agent_conversation_channels FORCE ROW LEVEL SECURITY;

-- Name: agent_conversations; Type: TABLE
CREATE TABLE public.agent_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    responsibility_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    delivery_mode text NOT NULL,
    binding_id uuid,
    binding_digest text NOT NULL,
    recipient_email text,
    driver_kind text NOT NULL,
    sequence_enrolment_id uuid,
    sequence_runtime text,
    human_user_id text,
    driver_generation integer DEFAULT 1 NOT NULL,
    epoch bigint DEFAULT 1 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    phase text DEFAULT 'paused'::text NOT NULL,
    pause_reason text,
    pending_driver jsonb,
    retired_enrolments uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    history_revision text NOT NULL,
    history_complete boolean DEFAULT false NOT NULL,
    history_observed_at timestamp with time zone,
    history_source text DEFAULT 'unavailable'::text NOT NULL,
    engagement text DEFAULT 'cold'::text NOT NULL,
    reminder_generation integer DEFAULT 1 NOT NULL,
    next_wakeup_at timestamp with time zone,
    wakeup_reason text,
    time_zone text DEFAULT 'UTC'::text NOT NULL,
    coverage_bindings jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_conversations_binding_digest_check CHECK ((binding_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_conversations_check CHECK (((delivery_mode = 'communications'::text) = (binding_id IS NOT NULL))),
    CONSTRAINT agent_conversations_check1 CHECK (((history_source <> 'local_fixture'::text) OR (delivery_mode = 'local_sink'::text))),
    CONSTRAINT agent_conversations_check2 CHECK (((driver_kind = 'sequence'::text) = (sequence_enrolment_id IS NOT NULL))),
    CONSTRAINT agent_conversations_check3 CHECK (((driver_kind = 'sequence'::text) = (sequence_runtime IS NOT NULL))),
    CONSTRAINT agent_conversations_check4 CHECK (((driver_kind = 'human'::text) = (human_user_id IS NOT NULL))),
    CONSTRAINT agent_conversations_check5 CHECK (((phase = 'quiescing'::text) = (pending_driver IS NOT NULL))),
    CONSTRAINT agent_conversations_coverage_bindings_check CHECK (((jsonb_typeof(coverage_bindings) = 'array'::text) AND (jsonb_array_length(coverage_bindings) <= 3))),
    CONSTRAINT agent_conversations_delivery_mode_check CHECK ((delivery_mode = ANY (ARRAY['local_sink'::text, 'communications'::text]))),
    CONSTRAINT agent_conversations_driver_generation_check CHECK ((driver_generation > 0)),
    CONSTRAINT agent_conversations_driver_kind_check CHECK ((driver_kind = ANY (ARRAY['agent'::text, 'sequence'::text, 'human'::text]))),
    CONSTRAINT agent_conversations_engagement_check CHECK ((engagement = ANY (ARRAY['cold'::text, 'engaged'::text, 'handoff'::text, 'stopped'::text]))),
    CONSTRAINT agent_conversations_epoch_check CHECK (((epoch >= 1) AND (epoch <= '9007199254740991'::bigint))),
    CONSTRAINT agent_conversations_history_check CHECK (((jsonb_typeof(history) = 'array'::text) AND (jsonb_array_length(history) <= 200) AND (octet_length((history)::text) <= 1500000))),
    CONSTRAINT agent_conversations_history_revision_check CHECK ((history_revision ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_conversations_history_source_check CHECK ((history_source = ANY (ARRAY['unavailable'::text, 'local_fixture'::text, 'communications'::text]))),
    CONSTRAINT agent_conversations_phase_check CHECK ((phase = ANY (ARRAY['active'::text, 'paused'::text, 'quiescing'::text, 'held'::text, 'complete'::text]))),
    CONSTRAINT agent_conversations_recipient_email_check CHECK (((recipient_email = lower(btrim(recipient_email))) AND ((length(recipient_email) >= 3) AND (length(recipient_email) <= 320)))),
    CONSTRAINT agent_conversations_reminder_generation_check CHECK ((reminder_generation > 0)),
    CONSTRAINT agent_conversations_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_conversations_sequence_runtime_check CHECK ((sequence_runtime = ANY (ARRAY['legacy'::text, 'n8n'::text])))
);

ALTER TABLE ONLY public.agent_conversations FORCE ROW LEVEL SECURITY;

-- Name: agent_demo_contact_mappings; Type: TABLE
CREATE TABLE public.agent_demo_contact_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    demo_id uuid NOT NULL,
    created_by text NOT NULL,
    contact_id uuid NOT NULL,
    source_revision text NOT NULL,
    source_fingerprint text NOT NULL,
    demo_run_id uuid NOT NULL,
    request_key uuid NOT NULL,
    wire jsonb NOT NULL,
    mapping_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_demo_contact_mappings_mapping_digest_check CHECK ((mapping_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_demo_contact_mappings_source_fingerprint_check CHECK ((source_fingerprint ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_demo_contact_mappings_source_revision_check CHECK ((source_revision ~ '^[0-9]{1,30}$'::text)),
    CONSTRAINT agent_demo_contact_mappings_wire_check CHECK (((jsonb_typeof(wire) = 'object'::text) AND (octet_length((wire)::text) <= 8000)))
);

ALTER TABLE ONLY public.agent_demo_contact_mappings FORCE ROW LEVEL SECURITY;

-- Name: agent_demo_mapping_receipts; Type: TABLE
CREATE TABLE public.agent_demo_mapping_receipts (
    request_key uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    demo_id uuid NOT NULL,
    created_by text NOT NULL,
    demo_run_id uuid NOT NULL,
    result jsonb NOT NULL,
    result_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_demo_mapping_receipts_result_check CHECK (((jsonb_typeof(result) = 'object'::text) AND (octet_length((result)::text) <= 100000))),
    CONSTRAINT agent_demo_mapping_receipts_result_digest_check CHECK ((result_digest ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE ONLY public.agent_demo_mapping_receipts FORCE ROW LEVEL SECURITY;

-- Name: agent_demo_mapping_requests; Type: TABLE
CREATE TABLE public.agent_demo_mapping_requests (
    request_key uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    demo_id uuid NOT NULL,
    created_by text NOT NULL,
    demo_run_id uuid NOT NULL,
    manifest jsonb NOT NULL,
    input_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_demo_mapping_requests_check CHECK ((demo_id = mandate_id)),
    CONSTRAINT agent_demo_mapping_requests_input_digest_check CHECK ((input_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_demo_mapping_requests_manifest_check CHECK (((jsonb_typeof(manifest) = 'object'::text) AND (jsonb_typeof((manifest -> 'people'::text)) = 'array'::text) AND ((jsonb_array_length((manifest -> 'people'::text)) >= 1) AND (jsonb_array_length((manifest -> 'people'::text)) <= 50)) AND (octet_length((manifest)::text) <= 64000)))
);

ALTER TABLE ONLY public.agent_demo_mapping_requests FORCE ROW LEVEL SECURITY;

-- Name: agent_demo_runs; Type: TABLE
CREATE TABLE public.agent_demo_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    run_id text NOT NULL,
    integration_id text NOT NULL,
    configuration_ref text NOT NULL,
    senders jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_demo_runs_check CHECK (((integration_id = ('sim-'::text || run_id)) AND (configuration_ref = (integration_id || '-v1'::text)))),
    CONSTRAINT agent_demo_runs_run_id_check CHECK ((run_id ~ '^[a-z][a-z0-9-]{2,63}$'::text)),
    CONSTRAINT agent_demo_runs_senders_check CHECK (((jsonb_typeof(senders) = 'array'::text) AND (jsonb_array_length(senders) = 3) AND (octet_length((senders)::text) <= 12000)))
);

ALTER TABLE ONLY public.agent_demo_runs FORCE ROW LEVEL SECURITY;

-- Name: agent_events; Type: TABLE
CREATE TABLE public.agent_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    event_key text NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    payload_digest text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    available_at timestamp with time zone DEFAULT public.agent_business_now() NOT NULL,
    lease_owner uuid,
    lease_until timestamp with time zone,
    fence bigint DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operational_not_before_at timestamp with time zone,
    CONSTRAINT agent_events_event_key_check CHECK (((length(event_key) >= 1) AND (length(event_key) <= 200))),
    CONSTRAINT agent_events_fence_check CHECK ((fence >= 0)),
    CONSTRAINT agent_events_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'leased'::text, 'done'::text])))
);

ALTER TABLE ONLY public.agent_events FORCE ROW LEVEL SECURITY;

-- Name: agent_handoffs; Type: TABLE
CREATE TABLE public.agent_handoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    thread_id uuid NOT NULL,
    assignee_user_id text NOT NULL,
    source_history_revision text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    context jsonb NOT NULL,
    human_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_handoffs_context_check CHECK ((octet_length((context)::text) <= 64000)),
    CONSTRAINT agent_handoffs_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_handoffs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'link_sent'::text, 'meeting_confirmed'::text, 'dismissed'::text])))
);

ALTER TABLE ONLY public.agent_handoffs FORCE ROW LEVEL SECURITY;

-- Name: agent_linkedin_invitations; Type: TABLE
CREATE TABLE public.agent_linkedin_invitations (
    operation_id uuid NOT NULL,
    route_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    binding_digest text NOT NULL,
    identity_revision text NOT NULL,
    state text NOT NULL,
    provider_operation_id text,
    submitted_at timestamp with time zone,
    intent_id uuid,
    accepted_observed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_linkedin_invitations_binding_digest_check CHECK ((binding_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_linkedin_invitations_check CHECK ((((state = ANY (ARRAY['unknown'::text, 'not_submitted'::text])) AND (provider_operation_id IS NULL) AND (submitted_at IS NULL)) OR ((state = ANY (ARRAY['pending'::text, 'accepted'::text])) AND (provider_operation_id IS NOT NULL) AND ((length(provider_operation_id) >= 1) AND (length(provider_operation_id) <= 2048)) AND (submitted_at IS NOT NULL) AND (intent_id IS NOT NULL)))),
    CONSTRAINT agent_linkedin_invitations_check1 CHECK (((state <> 'accepted'::text) OR (accepted_observed_at IS NOT NULL))),
    CONSTRAINT agent_linkedin_invitations_identity_revision_check CHECK ((identity_revision ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_linkedin_invitations_state_check CHECK ((state = ANY (ARRAY['unknown'::text, 'pending'::text, 'accepted'::text, 'not_submitted'::text])))
);

ALTER TABLE ONLY public.agent_linkedin_invitations FORCE ROW LEVEL SECURITY;

-- Name: agent_linkedin_relationships; Type: TABLE
CREATE TABLE public.agent_linkedin_relationships (
    route_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    binding_digest text NOT NULL,
    identity_revision text NOT NULL,
    status text NOT NULL,
    can_message boolean,
    observed_at timestamp with time zone NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_linkedin_relationships_binding_digest_check CHECK ((binding_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_linkedin_relationships_check CHECK ((((status = 'connected'::text) AND (can_message IS TRUE)) OR ((status = 'invitation_pending'::text) AND (can_message IS FALSE)) OR ((status = 'not_connected'::text) AND (can_message IS NOT TRUE)) OR ((status = 'unknown'::text) AND (can_message IS NULL)))),
    CONSTRAINT agent_linkedin_relationships_identity_revision_check CHECK ((identity_revision ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_linkedin_relationships_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_linkedin_relationships_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'invitation_pending'::text, 'not_connected'::text, 'unknown'::text])))
);

ALTER TABLE ONLY public.agent_linkedin_relationships FORCE ROW LEVEL SECURITY;

-- Name: agent_mandate_execution_modes; Type: TABLE
CREATE TABLE public.agent_mandate_execution_modes (
    mandate_id uuid NOT NULL,
    organization_id text NOT NULL,
    created_by text NOT NULL,
    mode text NOT NULL,
    demo_id uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_mandate_execution_modes_check CHECK ((((mode = 'demo'::text) AND (demo_id IS NOT NULL) AND (demo_id = mandate_id)) OR ((mode = 'real'::text) AND (demo_id IS NULL)))),
    CONSTRAINT agent_mandate_execution_modes_mode_check CHECK ((mode = ANY (ARRAY['real'::text, 'demo'::text])))
);

ALTER TABLE ONLY public.agent_mandate_execution_modes FORCE ROW LEVEL SECURITY;

-- Name: agent_messages; Type: TABLE
CREATE TABLE public.agent_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    sequence bigint NOT NULL,
    request_key text NOT NULL,
    role text NOT NULL,
    content jsonb NOT NULL,
    content_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_messages_content_check CHECK ((octet_length((content)::text) <= 64000)),
    CONSTRAINT agent_messages_request_key_check CHECK (((length(request_key) >= 1) AND (length(request_key) <= 200))),
    CONSTRAINT agent_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

ALTER TABLE ONLY public.agent_messages FORCE ROW LEVEL SECURITY;

-- Name: agent_messages_sequence_seq; Type: SEQUENCE
ALTER TABLE public.agent_messages ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.agent_messages_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

-- Name: agent_person_claims; Type: TABLE
CREATE TABLE public.agent_person_claims (
    organization_id text NOT NULL,
    identity_key text NOT NULL,
    conversation_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_person_claims_identity_key_check CHECK (((length(identity_key) >= 3) AND (length(identity_key) <= 400)))
);

ALTER TABLE ONLY public.agent_person_claims FORCE ROW LEVEL SECURITY;

-- Name: agent_research_phase_allocations; Type: TABLE
CREATE TABLE public.agent_research_phase_allocations (
    operation_id uuid NOT NULL,
    account_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    initial_amount bigint NOT NULL,
    remaining_amount bigint NOT NULL,
    CONSTRAINT agent_research_phase_allocations_check CHECK (((remaining_amount >= 0) AND (remaining_amount <= initial_amount))),
    CONSTRAINT agent_research_phase_allocations_initial_amount_check CHECK ((initial_amount >= 0))
);

ALTER TABLE ONLY public.agent_research_phase_allocations FORCE ROW LEVEL SECURITY;

-- Name: agent_research_phase_budgets; Type: TABLE
CREATE TABLE public.agent_research_phase_budgets (
    operation_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    input_digest text NOT NULL,
    calls_ceiling bigint NOT NULL,
    usd_ceiling bigint NOT NULL,
    deadline timestamp with time zone NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    released_reason text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_research_phase_budgets_calls_ceiling_check CHECK (((calls_ceiling >= 1) AND (calls_ceiling <= 24035))),
    CONSTRAINT agent_research_phase_budgets_input_digest_check CHECK ((input_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_research_phase_budgets_state_check CHECK ((state = ANY (ARRAY['active'::text, 'released'::text]))),
    CONSTRAINT agent_research_phase_budgets_usd_ceiling_check CHECK (((usd_ceiling >= 1) AND (usd_ceiling <= 1000000000)))
);

ALTER TABLE ONLY public.agent_research_phase_budgets FORCE ROW LEVEL SECURITY;

-- Name: agent_responsibilities; Type: TABLE
CREATE TABLE public.agent_responsibilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    state text DEFAULT 'paused'::text NOT NULL,
    milestone text DEFAULT 'research'::text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    mandate_revision text NOT NULL,
    authority_reference uuid,
    budget_reference uuid,
    sequence_id uuid,
    version_id uuid,
    next_wakeup_at timestamp with time zone,
    child_operations jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_responsibilities_state_check CHECK ((state = ANY (ARRAY['paused'::text, 'ready'::text, 'waiting'::text, 'human_owned'::text, 'complete'::text]))),
    CONSTRAINT agent_version_requires_sequence CHECK (((version_id IS NULL) OR (sequence_id IS NOT NULL)))
);

ALTER TABLE ONLY public.agent_responsibilities FORCE ROW LEVEL SECURITY;

-- Name: agent_review_batches; Type: TABLE
CREATE TABLE public.agent_review_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    request_key text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    manifest jsonb NOT NULL,
    manifest_digest text NOT NULL,
    decided_by text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_review_batches_check CHECK (((state = ANY (ARRAY['approved'::text, 'rejected'::text])) = ((decided_by IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT agent_review_batches_manifest_check CHECK (((jsonb_typeof(manifest) = 'array'::text) AND ((jsonb_array_length(manifest) >= 1) AND (jsonb_array_length(manifest) <= 50)))),
    CONSTRAINT agent_review_batches_manifest_digest_check CHECK ((length(manifest_digest) = 64)),
    CONSTRAINT agent_review_batches_request_key_check CHECK (((length(request_key) >= 1) AND (length(request_key) <= 200))),
    CONSTRAINT agent_review_batches_revision_check CHECK ((revision > 0)),
    CONSTRAINT agent_review_batches_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'invalidated'::text])))
);

ALTER TABLE ONLY public.agent_review_batches FORCE ROW LEVEL SECURITY;

-- Name: agent_runs; Type: TABLE
CREATE TABLE public.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    trigger_event_id uuid,
    state text NOT NULL,
    lease_owner uuid,
    lease_until timestamp with time zone,
    fence bigint DEFAULT 0 NOT NULL,
    model_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    stop_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_runs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'waiting'::text, 'complete'::text, 'failed'::text, 'uncertain'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.agent_runs FORCE ROW LEVEL SECURITY;

-- Name: agent_runtime_registrations; Type: TABLE
CREATE TABLE public.agent_runtime_registrations (
    thread_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    mandate_id uuid NOT NULL,
    responsibility_id uuid NOT NULL,
    responsibility_revision integer NOT NULL,
    runtime_id text NOT NULL,
    state text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT agent_runtime_registrations_responsibility_revision_check CHECK ((responsibility_revision > 0)),
    CONSTRAINT agent_runtime_registrations_runtime_id_check CHECK ((runtime_id ~ '^[a-z][a-z0-9-]{2,99}$'::text)),
    CONSTRAINT agent_runtime_registrations_state_check CHECK ((state = ANY (ARRAY['enabled'::text, 'paused'::text])))
);

ALTER TABLE ONLY public.agent_runtime_registrations FORCE ROW LEVEL SECURITY;

-- Name: agent_sink_messages; Type: TABLE
CREATE TABLE public.agent_sink_messages (
    operation_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    thread_id uuid NOT NULL,
    recipient_email text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    payload_digest text NOT NULL,
    simulated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE ONLY public.agent_sink_messages FORCE ROW LEVEL SECURITY;

-- Name: agent_threads; Type: TABLE
CREATE TABLE public.agent_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    owner_user_id text NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_threads_revision_check CHECK ((revision > 0))
);

ALTER TABLE ONLY public.agent_threads FORCE ROW LEVEL SECURITY;

-- Name: communication_submission_receipts; Type: TABLE
CREATE TABLE public.communication_submission_receipts (
    intent_id uuid NOT NULL,
    organization_id text NOT NULL,
    owner_user_id text NOT NULL,
    binding_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_id uuid NOT NULL,
    operation text NOT NULL,
    operation_key text NOT NULL,
    payload_digest text NOT NULL,
    source_digest text NOT NULL,
    original_intent_digest text NOT NULL,
    encrypted_receipt text NOT NULL,
    receipt_key_version text NOT NULL,
    receipt_digest text NOT NULL,
    recipient_digest text NOT NULL,
    provider_reference text NOT NULL,
    provider_conversation_reference text,
    submitted_at timestamp with time zone NOT NULL,
    origin_status text NOT NULL,
    origin_mandate_id uuid,
    origin_enrolment_id uuid,
    origin_conversation_id uuid,
    source_revision text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT communication_submission_receipts_check CHECK (((origin_status = 'sealed'::text) = (origin_mandate_id IS NOT NULL))),
    CONSTRAINT communication_submission_receipts_check1 CHECK (((origin_status = 'sealed'::text) OR ((origin_enrolment_id IS NULL) AND (origin_conversation_id IS NULL)))),
    CONSTRAINT communication_submission_receipts_check2 CHECK (((operation = 'message'::text) OR (provider_conversation_reference IS NULL))),
    CONSTRAINT communication_submission_receipts_encrypted_receipt_check CHECK (((length(encrypted_receipt) >= 1) AND (length(encrypted_receipt) <= 2200000))),
    CONSTRAINT communication_submission_receipts_operation_check CHECK ((operation = ANY (ARRAY['message'::text, 'invitation'::text]))),
    CONSTRAINT communication_submission_receipts_origin_status_check CHECK ((origin_status = ANY (ARRAY['sealed'::text, 'legacy_unsealed'::text]))),
    CONSTRAINT communication_submission_receipts_original_intent_digest_check CHECK ((original_intent_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_submission_receipts_payload_digest_check CHECK ((payload_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_submission_receipts_provider_reference_check CHECK (((length(provider_reference) >= 1) AND (length(provider_reference) <= 2000))),
    CONSTRAINT communication_submission_receipts_receipt_digest_check CHECK ((receipt_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_submission_receipts_receipt_key_version_check CHECK (((length(receipt_key_version) >= 1) AND (length(receipt_key_version) <= 64))),
    CONSTRAINT communication_submission_receipts_recipient_digest_check CHECK ((recipient_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_submission_receipts_source_digest_check CHECK ((source_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_submission_receipts_source_kind_check CHECK ((source_kind = ANY (ARRAY['draft'::text, 'campaign'::text, 'agent'::text]))),
    CONSTRAINT communication_submission_receipts_source_revision_check CHECK (((source_revision IS NULL) OR ((length(source_revision) >= 1) AND (length(source_revision) <= 100))))
);

ALTER TABLE ONLY public.communication_submission_receipts FORCE ROW LEVEL SECURITY;

-- Name: company_identity_decisions; Type: TABLE
CREATE TABLE public.company_identity_decisions (
    request_key uuid NOT NULL,
    review_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    decided_by text NOT NULL,
    input_digest text NOT NULL,
    preview jsonb NOT NULL,
    receipt jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT company_identity_decisions_input_digest_check CHECK ((input_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT company_identity_decisions_preview_check CHECK ((jsonb_typeof(preview) = 'object'::text)),
    CONSTRAINT company_identity_decisions_receipt_check CHECK ((jsonb_typeof(receipt) = 'object'::text))
);

-- Name: company_identity_observations; Type: TABLE
CREATE TABLE public.company_identity_observations (
    id uuid NOT NULL,
    request_key uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    job_id uuid,
    created_by text NOT NULL,
    source jsonb NOT NULL,
    source_facts jsonb NOT NULL,
    input_digest text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    source_kind text DEFAULT 'research_job'::text NOT NULL,
    firmable_sync_run_id uuid,
    source_provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT company_identity_observations_input_digest_check CHECK ((input_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT company_identity_observations_source_check CHECK ((jsonb_typeof(source) = 'object'::text)),
    CONSTRAINT company_identity_observations_source_facts_check CHECK ((jsonb_typeof(source_facts) = 'object'::text)),
    CONSTRAINT company_identity_source_origin CHECK (((jsonb_typeof(source_provenance) = 'object'::text) AND (octet_length((source_provenance)::text) <= 8000) AND (((source_kind = 'research_job'::text) AND (job_id IS NOT NULL) AND (firmable_sync_run_id IS NULL)) OR ((source_kind = 'firmable_sync'::text) AND (job_id IS NULL) AND (firmable_sync_run_id IS NOT NULL) AND ((source_provenance ->> 'runId'::text) IS NOT NULL) AND ((source_provenance ->> 'runId'::text) = (firmable_sync_run_id)::text) AND ((source_provenance ->> 'responseId'::text) IS NOT NULL) AND ((source_provenance ->> 'responseId'::text) ~ '^[a-f0-9-]{36}$'::text) AND ((source_provenance ->> 'responseHash'::text) IS NOT NULL) AND ((source_provenance ->> 'responseHash'::text) ~ '^[a-f0-9]{64}$'::text) AND ((source_provenance ->> 'generation'::text) IS NOT NULL) AND ((source_provenance ->> 'generation'::text) ~ '^[1-9][0-9]*$'::text)))))
);

-- Name: company_identity_resolutions; Type: TABLE
CREATE TABLE public.company_identity_resolutions (
    observation_id uuid NOT NULL,
    organization_id text NOT NULL,
    target_id uuid,
    review_id uuid,
    CONSTRAINT company_identity_resolutions_check CHECK ((((target_id IS NOT NULL) AND (review_id IS NULL)) OR ((target_id IS NULL) AND (review_id IS NOT NULL))))
);

-- Name: company_identity_reviews; Type: TABLE
CREATE TABLE public.company_identity_reviews (
    id uuid NOT NULL,
    observation_id uuid NOT NULL,
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT company_identity_reviews_revision_check CHECK ((revision > 0)),
    CONSTRAINT company_identity_reviews_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'adopted'::text, 'skipped'::text])))
);

-- Name: company_identity_accepted_observations; Type: VIEW
CREATE VIEW public.company_identity_accepted_observations WITH (security_invoker='true') AS
 SELECT o.id,
    o.request_key,
    o.organization_id,
    o.mandate_id,
    o.job_id,
    o.created_by,
    o.source,
    o.source_facts,
    o.input_digest,
    o.observed_at,
    o.created_at,
    r.target_id,
    o.source_kind,
    o.firmable_sync_run_id,
    o.source_provenance
   FROM (public.company_identity_observations o
     JOIN public.company_identity_resolutions r ON (((r.observation_id = o.id) AND (r.organization_id = o.organization_id))))
  WHERE (r.target_id IS NOT NULL)
UNION ALL
 SELECT o.id,
    o.request_key,
    o.organization_id,
    o.mandate_id,
    o.job_id,
    o.created_by,
    o.source,
    o.source_facts,
    o.input_digest,
    o.observed_at,
    o.created_at,
    ((d.receipt ->> 'targetId'::text))::uuid AS target_id,
    o.source_kind,
    o.firmable_sync_run_id,
    o.source_provenance
   FROM ((public.company_identity_observations o
     JOIN public.company_identity_reviews v ON (((v.observation_id = o.id) AND (v.organization_id = o.organization_id) AND (v.mandate_id = o.mandate_id))))
     JOIN public.company_identity_decisions d ON (((d.review_id = v.id) AND (d.organization_id = v.organization_id) AND (d.mandate_id = v.mandate_id))))
  WHERE ((d.receipt ->> 'status'::text) = 'adopted'::text);

-- Name: company_identity_claims; Type: TABLE
CREATE TABLE public.company_identity_claims (
    organization_id text NOT NULL,
    identity_key text NOT NULL,
    target_id uuid NOT NULL,
    observation_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT company_identity_claims_identity_key_check CHECK (((length(identity_key) >= 3) AND (length(identity_key) <= 1200)))
);

-- Name: company_membership_projections; Type: TABLE
CREATE TABLE public.company_membership_projections (
    organization_id text NOT NULL,
    mandate_id uuid NOT NULL,
    target_id uuid NOT NULL,
    mandate_revision text NOT NULL,
    membership_version integer NOT NULL,
    membership_revision text NOT NULL,
    target_revision text NOT NULL,
    observation_id uuid NOT NULL,
    observation_digest text NOT NULL,
    findings_digest text NOT NULL,
    projection_digest text NOT NULL,
    projection jsonb NOT NULL,
    published_by text NOT NULL,
    published_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT company_membership_projections_findings_digest_check CHECK ((findings_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT company_membership_projections_observation_digest_check CHECK ((observation_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT company_membership_projections_projection_check CHECK (((jsonb_typeof(projection) = 'object'::text) AND (octet_length((projection)::text) <= 512000))),
    CONSTRAINT company_membership_projections_projection_digest_check CHECK ((projection_digest ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE ONLY public.company_membership_projections FORCE ROW LEVEL SECURITY;

-- Name: agent_authority_grants agent_authority_grants_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_authority_grants
    ADD CONSTRAINT agent_authority_grants_pkey PRIMARY KEY (id);

-- Name: agent_authority_uses agent_authority_uses_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_authority_uses
    ADD CONSTRAINT agent_authority_uses_pkey PRIMARY KEY (operation_id);

-- Name: agent_budget_accounts agent_budget_accounts_id_organization_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_budget_accounts
    ADD CONSTRAINT agent_budget_accounts_id_organization_id_key UNIQUE (id, organization_id);

-- Name: agent_budget_accounts agent_budget_accounts_organization_id_scope_key_window_star_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_budget_accounts
    ADD CONSTRAINT agent_budget_accounts_organization_id_scope_key_window_star_key UNIQUE (organization_id, scope_key, window_start);

-- Name: agent_budget_accounts agent_budget_accounts_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_budget_accounts
    ADD CONSTRAINT agent_budget_accounts_pkey PRIMARY KEY (id);

-- Name: agent_budget_reservations agent_budget_reservations_operation_id_account_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_budget_reservations
    ADD CONSTRAINT agent_budget_reservations_operation_id_account_id_key UNIQUE (operation_id, account_id);

-- Name: agent_budget_reservations agent_budget_reservations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_budget_reservations
    ADD CONSTRAINT agent_budget_reservations_pkey PRIMARY KEY (id);

-- Name: agent_channel_policies agent_channel_policies_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_channel_policies
    ADD CONSTRAINT agent_channel_policies_pkey PRIMARY KEY (thread_id);

-- Name: agent_conversation_channels agent_conversation_channels_conversation_id_channel_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_conversation_id_channel_key UNIQUE (conversation_id, channel);

-- Name: agent_conversation_channels agent_conversation_channels_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_pkey PRIMARY KEY (id);

-- Name: agent_conversations agent_conversations_id_organization_id_mandate_id_owner_use_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_id_organization_id_mandate_id_owner_use_key UNIQUE (id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_conversations agent_conversations_id_organization_id_owner_user_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_id_organization_id_owner_user_id_key UNIQUE (id, organization_id, owner_user_id);

-- Name: agent_conversations agent_conversations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_pkey PRIMARY KEY (id);

-- Name: agent_demo_contact_mappings agent_demo_contact_mappings_demo_id_contact_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_contact_mappings
    ADD CONSTRAINT agent_demo_contact_mappings_demo_id_contact_id_key UNIQUE (demo_id, contact_id);

-- Name: agent_demo_contact_mappings agent_demo_contact_mappings_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_contact_mappings
    ADD CONSTRAINT agent_demo_contact_mappings_pkey PRIMARY KEY (id);

-- Name: agent_demo_mapping_receipts agent_demo_mapping_receipts_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_receipts
    ADD CONSTRAINT agent_demo_mapping_receipts_pkey PRIMARY KEY (request_key);

-- Name: agent_demo_mapping_receipts agent_demo_mapping_receipts_request_key_organization_id_man_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_receipts
    ADD CONSTRAINT agent_demo_mapping_receipts_request_key_organization_id_man_key UNIQUE (request_key, organization_id, mandate_id, demo_id, created_by, demo_run_id);

-- Name: agent_demo_mapping_requests agent_demo_mapping_requests_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_requests
    ADD CONSTRAINT agent_demo_mapping_requests_pkey PRIMARY KEY (request_key);

-- Name: agent_demo_mapping_requests agent_demo_mapping_requests_request_key_organization_id_man_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_requests
    ADD CONSTRAINT agent_demo_mapping_requests_request_key_organization_id_man_key UNIQUE (request_key, organization_id, mandate_id, demo_id, created_by, demo_run_id);

-- Name: agent_demo_runs agent_demo_runs_id_organization_id_owner_user_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_runs
    ADD CONSTRAINT agent_demo_runs_id_organization_id_owner_user_id_key UNIQUE (id, organization_id, owner_user_id);

-- Name: agent_demo_runs agent_demo_runs_organization_id_owner_user_id_run_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_runs
    ADD CONSTRAINT agent_demo_runs_organization_id_owner_user_id_run_id_key UNIQUE (organization_id, owner_user_id, run_id);

-- Name: agent_demo_runs agent_demo_runs_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_demo_runs
    ADD CONSTRAINT agent_demo_runs_pkey PRIMARY KEY (id);

-- Name: agent_events agent_events_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_events
    ADD CONSTRAINT agent_events_pkey PRIMARY KEY (id);

-- Name: agent_events agent_events_thread_id_event_key_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_events
    ADD CONSTRAINT agent_events_thread_id_event_key_key UNIQUE (thread_id, event_key);

-- Name: agent_handoffs agent_handoffs_conversation_id_source_history_revision_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_handoffs
    ADD CONSTRAINT agent_handoffs_conversation_id_source_history_revision_key UNIQUE (conversation_id, source_history_revision);

-- Name: agent_handoffs agent_handoffs_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_handoffs
    ADD CONSTRAINT agent_handoffs_pkey PRIMARY KEY (id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_pkey PRIMARY KEY (operation_id);

-- Name: agent_linkedin_relationships agent_linkedin_relationships_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_relationships
    ADD CONSTRAINT agent_linkedin_relationships_pkey PRIMARY KEY (route_id);

-- Name: agent_mandate_execution_modes agent_mandate_execution_modes_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_mandate_execution_modes
    ADD CONSTRAINT agent_mandate_execution_modes_pkey PRIMARY KEY (mandate_id);

-- Name: agent_messages agent_messages_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);

-- Name: agent_messages agent_messages_sequence_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_sequence_key UNIQUE (sequence);

-- Name: agent_messages agent_messages_thread_id_request_key_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_thread_id_request_key_key UNIQUE (thread_id, request_key);

-- Name: agent_operations agent_operations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_operations
    ADD CONSTRAINT agent_operations_pkey PRIMARY KEY (id);

-- Name: agent_operations agent_operations_thread_id_request_key_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_operations
    ADD CONSTRAINT agent_operations_thread_id_request_key_key UNIQUE (thread_id, request_key);

-- Name: agent_person_claims agent_person_claims_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_person_claims
    ADD CONSTRAINT agent_person_claims_pkey PRIMARY KEY (organization_id, identity_key);

-- Name: agent_research_phase_allocations agent_research_phase_allocations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_allocations
    ADD CONSTRAINT agent_research_phase_allocations_pkey PRIMARY KEY (operation_id, account_id);

-- Name: agent_research_phase_budgets agent_research_phase_budgets_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_budgets
    ADD CONSTRAINT agent_research_phase_budgets_pkey PRIMARY KEY (operation_id);

-- Name: agent_responsibilities agent_responsibilities_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_responsibilities
    ADD CONSTRAINT agent_responsibilities_pkey PRIMARY KEY (id);

-- Name: agent_responsibilities agent_responsibilities_thread_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_responsibilities
    ADD CONSTRAINT agent_responsibilities_thread_id_key UNIQUE (thread_id);

-- Name: agent_review_batches agent_review_batches_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_review_batches
    ADD CONSTRAINT agent_review_batches_pkey PRIMARY KEY (id);

-- Name: agent_review_batches agent_review_batches_thread_id_request_key_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_review_batches
    ADD CONSTRAINT agent_review_batches_thread_id_request_key_key UNIQUE (thread_id, request_key);

-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);

-- Name: agent_runtime_registrations agent_runtime_registrations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_runtime_registrations
    ADD CONSTRAINT agent_runtime_registrations_pkey PRIMARY KEY (thread_id);

-- Name: agent_sink_messages agent_sink_messages_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_sink_messages
    ADD CONSTRAINT agent_sink_messages_pkey PRIMARY KEY (operation_id);

-- Name: agent_threads agent_threads_id_organization_id_mandate_id_owner_user_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_id_organization_id_mandate_id_owner_user_id_key UNIQUE (id, organization_id, mandate_id, owner_user_id);

-- Name: agent_threads agent_threads_organization_id_mandate_id_owner_user_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_organization_id_mandate_id_owner_user_id_key UNIQUE (organization_id, mandate_id, owner_user_id);

-- Name: agent_threads agent_threads_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_pkey PRIMARY KEY (id);

-- Name: communication_submission_receipts communication_submission_receipts_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.communication_submission_receipts
    ADD CONSTRAINT communication_submission_receipts_pkey PRIMARY KEY (intent_id);

-- Name: company_identity_claims company_identity_claims_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_claims
    ADD CONSTRAINT company_identity_claims_pkey PRIMARY KEY (organization_id, identity_key);

-- Name: company_identity_decisions company_identity_decisions_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_decisions
    ADD CONSTRAINT company_identity_decisions_pkey PRIMARY KEY (request_key);

-- Name: company_identity_decisions company_identity_decisions_review_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_decisions
    ADD CONSTRAINT company_identity_decisions_review_id_key UNIQUE (review_id);

-- Name: company_identity_observations company_identity_observations_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_pkey PRIMARY KEY (id);

-- Name: company_identity_observations company_identity_observations_request_key_key; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_request_key_key UNIQUE (request_key);

-- Name: company_identity_resolutions company_identity_resolutions_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_resolutions
    ADD CONSTRAINT company_identity_resolutions_pkey PRIMARY KEY (observation_id);

-- Name: company_identity_reviews company_identity_reviews_observation_id_key; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_reviews
    ADD CONSTRAINT company_identity_reviews_observation_id_key UNIQUE (observation_id);

-- Name: company_identity_reviews company_identity_reviews_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.company_identity_reviews
    ADD CONSTRAINT company_identity_reviews_pkey PRIMARY KEY (id);

-- Name: company_membership_projections company_membership_projections_pkey; Type: CONSTRAINT
ALTER TABLE ONLY public.company_membership_projections
    ADD CONSTRAINT company_membership_projections_pkey PRIMARY KEY (organization_id, mandate_id, target_id);

-- Name: agent_authority_scope_idx; Type: INDEX
CREATE INDEX agent_authority_scope_idx ON public.agent_authority_grants USING btree (thread_id) WHERE (revoked_at IS NULL);

-- Name: agent_binding_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_binding_scope_idx ON public.communication_bindings USING btree (id, organization_id, owner_user_id);

-- Name: agent_contact_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_contact_scope_idx ON public.contacts USING btree (id, organization_id);

-- Name: agent_demo_email_unique; Type: INDEX
CREATE UNIQUE INDEX agent_demo_email_unique ON public.agent_demo_contact_mappings USING btree (((wire ->> 'email'::text)));

-- Name: agent_demo_linkedin_unique; Type: INDEX
CREATE UNIQUE INDEX agent_demo_linkedin_unique ON public.agent_demo_contact_mappings USING btree (((wire ->> 'linkedin'::text)));

-- Name: agent_demo_mode_creator_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_demo_mode_creator_scope_idx ON public.agent_mandate_execution_modes USING btree (mandate_id, organization_id, created_by, demo_id);

-- Name: agent_demo_phone_unique; Type: INDEX
CREATE UNIQUE INDEX agent_demo_phone_unique ON public.agent_demo_contact_mappings USING btree (((wire ->> 'phone'::text)));

-- Name: agent_demo_provider_unique; Type: INDEX
CREATE UNIQUE INDEX agent_demo_provider_unique ON public.agent_demo_contact_mappings USING btree (((wire ->> 'providerId'::text)));

-- Name: agent_enrolment_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_enrolment_scope_idx ON public.campaign_enrolments USING btree (id, organization_id, mandate_id, owner_user_id);

-- Name: agent_event_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_event_scope_idx ON public.agent_events USING btree (id, organization_id, mandate_id, owner_user_id);

-- Name: agent_events_due_idx; Type: INDEX
CREATE INDEX agent_events_due_idx ON public.agent_events USING btree (organization_id, owner_user_id, available_at) WHERE (state <> 'done'::text);

-- Name: agent_grant_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_grant_scope_idx ON public.agent_authority_grants USING btree (id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_handoff_one_active_idx; Type: INDEX
CREATE UNIQUE INDEX agent_handoff_one_active_idx ON public.agent_handoffs USING btree (conversation_id) WHERE (state = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'link_sent'::text]));

-- Name: agent_handoffs_assignee_idx; Type: INDEX
CREATE INDEX agent_handoffs_assignee_idx ON public.agent_handoffs USING btree (organization_id, assignee_user_id, state);

-- Name: agent_intent_contact_idx; Type: INDEX
CREATE INDEX agent_intent_contact_idx ON public.communication_dispatch_intents USING btree (organization_id, contact_id);

-- Name: agent_mandate_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_mandate_scope_idx ON public.mandates USING btree (id, organization_id);

-- Name: agent_operation_actor_idx; Type: INDEX
CREATE UNIQUE INDEX agent_operation_actor_idx ON public.agent_operations USING btree (id, organization_id, owner_user_id);

-- Name: agent_operation_conversation_state_idx; Type: INDEX
CREATE INDEX agent_operation_conversation_state_idx ON public.agent_operations USING btree (organization_id, conversation_id, state);

-- Name: agent_operation_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_operation_scope_idx ON public.agent_operations USING btree (id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_responsibility_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_responsibility_scope_idx ON public.agent_responsibilities USING btree (id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_review_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_review_scope_idx ON public.agent_review_batches USING btree (id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_runs_one_running_idx; Type: INDEX
CREATE UNIQUE INDEX agent_runs_one_running_idx ON public.agent_runs USING btree (thread_id) WHERE (state = 'running'::text);

-- Name: agent_sequence_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_sequence_scope_idx ON public.campaign_sequences USING btree (id, organization_id, mandate_id, owner_user_id);

-- Name: agent_version_scope_idx; Type: INDEX
CREATE UNIQUE INDEX agent_version_scope_idx ON public.campaign_sequence_versions USING btree (id, organization_id, owner_user_id, sequence_id);

-- Name: company_identity_observations_mandate; Type: INDEX
CREATE INDEX company_identity_observations_mandate ON public.company_identity_observations USING btree (organization_id, mandate_id, created_at, id);

-- Name: company_identity_one_sync_origin; Type: INDEX
CREATE UNIQUE INDEX company_identity_one_sync_origin ON public.company_identity_observations USING btree (firmable_sync_run_id) WHERE (source_kind = 'firmable_sync'::text);

-- Name: company_identity_reviews_pending; Type: INDEX
CREATE INDEX company_identity_reviews_pending ON public.company_identity_reviews USING btree (organization_id, mandate_id) WHERE (state = 'pending'::text);

-- Name: campaign_enrolments agent_00_demo_manual_outreach_guard; Type: TRIGGER
CREATE TRIGGER agent_00_demo_manual_outreach_guard BEFORE INSERT OR UPDATE ON public.campaign_enrolments FOR EACH ROW EXECUTE FUNCTION public.agent_demo_manual_outreach_guard();

-- Name: messages agent_00_demo_manual_outreach_guard; Type: TRIGGER
CREATE TRIGGER agent_00_demo_manual_outreach_guard BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.agent_demo_manual_outreach_guard();

-- Name: sequence_enrolments agent_00_demo_manual_outreach_guard; Type: TRIGGER
CREATE TRIGGER agent_00_demo_manual_outreach_guard BEFORE INSERT OR UPDATE ON public.sequence_enrolments FOR EACH ROW EXECUTE FUNCTION public.agent_demo_manual_outreach_guard();

-- Name: agent_operations agent_00_demo_original_effect_identity; Type: TRIGGER
CREATE TRIGGER agent_00_demo_original_effect_identity BEFORE UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_demo_original_effect_identity_guard();

-- Name: agent_conversations agent_00_mandate_outreach_mode_guard; Type: TRIGGER
CREATE TRIGGER agent_00_mandate_outreach_mode_guard BEFORE INSERT OR UPDATE ON public.agent_conversations FOR EACH ROW EXECUTE FUNCTION public.agent_mandate_outreach_mode_guard();

-- Name: agent_operations agent_00_mandate_outreach_mode_guard; Type: TRIGGER
CREATE TRIGGER agent_00_mandate_outreach_mode_guard BEFORE INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_mandate_outreach_mode_guard();

-- Name: agent_operations agent_01_reply_causality; Type: TRIGGER
CREATE TRIGGER agent_01_reply_causality BEFORE INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_reply_causality_guard();

-- Name: agent_authority_uses agent_authority_use_immutable; Type: TRIGGER
CREATE TRIGGER agent_authority_use_immutable BEFORE UPDATE ON public.agent_authority_uses FOR EACH ROW EXECUTE FUNCTION public.agent_authority_use_immutable();

-- Name: agent_operations agent_business_completion_guard; Type: TRIGGER
CREATE TRIGGER agent_business_completion_guard BEFORE INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_business_completion_guard();

-- Name: agent_authority_grants agent_channel_grant_scope; Type: TRIGGER
CREATE TRIGGER agent_channel_grant_scope BEFORE UPDATE ON public.agent_authority_grants FOR EACH ROW EXECUTE FUNCTION public.agent_channel_grant_immutable();

-- Name: agent_channel_policies agent_channel_writer; Type: TRIGGER
CREATE TRIGGER agent_channel_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_channel_policies FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_conversation_channels agent_channel_writer; Type: TRIGGER
CREATE TRIGGER agent_channel_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_conversation_channels FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: communication_dispatch_intents agent_communications_intent_admission; Type: TRIGGER
CREATE TRIGGER agent_communications_intent_admission BEFORE INSERT ON public.communication_dispatch_intents FOR EACH ROW EXECUTE FUNCTION public.agent_communications_intent_guard();

-- Name: research_jobs agent_company_continuation_job_guard; Type: TRIGGER
CREATE TRIGGER agent_company_continuation_job_guard AFTER INSERT ON public.research_jobs FOR EACH ROW EXECUTE FUNCTION public.agent_company_continuation_job_guard();

-- Name: agent_operations agent_company_continuation_operation_guard; Type: TRIGGER
CREATE TRIGGER agent_company_continuation_operation_guard AFTER INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_company_continuation_operation_guard();

-- Name: agent_authority_uses agent_consume_delegation; Type: TRIGGER
CREATE TRIGGER agent_consume_delegation AFTER INSERT ON public.agent_authority_uses FOR EACH ROW EXECUTE FUNCTION public.agent_consume_delegation();

-- Name: agent_authority_grants agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_authority_grants FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_authority_uses agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_authority_uses FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_budget_accounts agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_budget_accounts FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_budget_reservations agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_budget_reservations FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_conversations agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_conversations FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_handoffs agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_handoffs FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_operations agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_person_claims agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_person_claims FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_responsibilities agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_responsibilities FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_review_batches agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_review_batches FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_sink_messages agent_control_writer; Type: TRIGGER
CREATE TRIGGER agent_control_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_sink_messages FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_conversations agent_conversation_scope_guard; Type: TRIGGER
CREATE TRIGGER agent_conversation_scope_guard BEFORE INSERT OR UPDATE ON public.agent_conversations FOR EACH ROW EXECUTE FUNCTION public.agent_conversation_guard();

-- Name: agent_demo_contact_mappings agent_demo_evidence_immutable; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_immutable BEFORE DELETE OR UPDATE ON public.agent_demo_contact_mappings FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_immutable();

-- Name: agent_demo_mapping_receipts agent_demo_evidence_immutable; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_immutable BEFORE DELETE OR UPDATE ON public.agent_demo_mapping_receipts FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_immutable();

-- Name: agent_demo_mapping_requests agent_demo_evidence_immutable; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_immutable BEFORE DELETE OR UPDATE ON public.agent_demo_mapping_requests FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_immutable();

-- Name: agent_demo_runs agent_demo_evidence_immutable; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_immutable BEFORE DELETE OR UPDATE ON public.agent_demo_runs FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_immutable();

-- Name: agent_demo_contact_mappings agent_demo_evidence_insert_guard; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_insert_guard BEFORE INSERT ON public.agent_demo_contact_mappings FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_insert_guard();

-- Name: agent_demo_mapping_receipts agent_demo_evidence_insert_guard; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_insert_guard BEFORE INSERT ON public.agent_demo_mapping_receipts FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_insert_guard();

-- Name: agent_demo_mapping_requests agent_demo_evidence_insert_guard; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_insert_guard BEFORE INSERT ON public.agent_demo_mapping_requests FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_insert_guard();

-- Name: agent_demo_runs agent_demo_evidence_insert_guard; Type: TRIGGER
CREATE TRIGGER agent_demo_evidence_insert_guard BEFORE INSERT ON public.agent_demo_runs FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_insert_guard();

-- Name: agent_authority_grants agent_grant_immutable_scope; Type: TRIGGER
CREATE TRIGGER agent_grant_immutable_scope BEFORE UPDATE ON public.agent_authority_grants FOR EACH ROW EXECUTE FUNCTION public.agent_grant_immutable_scope();

-- Name: agent_handoffs agent_handoff_scope_guard; Type: TRIGGER
CREATE TRIGGER agent_handoff_scope_guard BEFORE INSERT OR UPDATE ON public.agent_handoffs FOR EACH ROW EXECUTE FUNCTION public.agent_handoff_guard();

-- Name: communication_dispatch_intents agent_intent_execution_context_guard; Type: TRIGGER
CREATE TRIGGER agent_intent_execution_context_guard BEFORE INSERT OR UPDATE ON public.communication_dispatch_intents FOR EACH ROW EXECUTE FUNCTION public.agent_intent_execution_context_guard();

-- Name: agent_linkedin_invitations agent_invitation_writer; Type: TRIGGER
CREATE TRIGGER agent_invitation_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_linkedin_invitations FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_linkedin_relationships agent_invitation_writer; Type: TRIGGER
CREATE TRIGGER agent_invitation_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_linkedin_relationships FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_mandate_execution_modes agent_mandate_execution_mode_immutable; Type: TRIGGER
CREATE TRIGGER agent_mandate_execution_mode_immutable BEFORE DELETE OR UPDATE ON public.agent_mandate_execution_modes FOR EACH ROW EXECUTE FUNCTION public.agent_mandate_execution_mode_immutable();

-- Name: agent_responsibilities agent_research_budget_supervision; Type: TRIGGER
CREATE TRIGGER agent_research_budget_supervision AFTER UPDATE OF state, revision, mandate_revision ON public.agent_responsibilities FOR EACH ROW EXECUTE FUNCTION public.agent_release_changed_research_budget();

-- Name: agent_operations agent_research_budget_terminal; Type: TRIGGER
CREATE TRIGGER agent_research_budget_terminal AFTER UPDATE OF state ON public.agent_operations FOR EACH ROW WHEN (((old.state IS DISTINCT FROM new.state) AND (new.name = ANY (ARRAY['research.start'::text, 'research.people'::text, 'research.fields'::text])) AND (new.state = ANY (ARRAY['complete'::text, 'failed'::text, 'cancelled'::text, 'rejected'::text])))) EXECUTE FUNCTION public.agent_release_finished_research_budget();

-- Name: agent_runtime_registrations agent_runtime_writer; Type: TRIGGER
CREATE TRIGGER agent_runtime_writer BEFORE INSERT OR DELETE OR UPDATE ON public.agent_runtime_registrations FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate();

-- Name: agent_sink_messages agent_sink_admission; Type: TRIGGER
CREATE TRIGGER agent_sink_admission BEFORE INSERT ON public.agent_sink_messages FOR EACH ROW EXECUTE FUNCTION public.agent_sink_guard();

-- Name: company_identity_claims company_identity_claims_immutable; Type: TRIGGER
CREATE TRIGGER company_identity_claims_immutable BEFORE DELETE OR UPDATE ON public.company_identity_claims FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();

-- Name: company_identity_decisions company_identity_decisions_immutable; Type: TRIGGER
CREATE TRIGGER company_identity_decisions_immutable BEFORE DELETE OR UPDATE ON public.company_identity_decisions FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();

-- Name: company_identity_observations company_identity_observations_immutable; Type: TRIGGER
CREATE TRIGGER company_identity_observations_immutable BEFORE DELETE OR UPDATE ON public.company_identity_observations FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();

-- Name: company_identity_resolutions company_identity_resolutions_immutable; Type: TRIGGER
CREATE TRIGGER company_identity_resolutions_immutable BEFORE DELETE OR UPDATE ON public.company_identity_resolutions FOR EACH ROW EXECUTE FUNCTION public.company_identity_append_only();

-- Name: company_membership_projections company_projection_writer; Type: TRIGGER
CREATE TRIGGER company_projection_writer BEFORE INSERT OR DELETE OR UPDATE ON public.company_membership_projections FOR EACH ROW EXECUTE FUNCTION public.agent_company_projection_writer_guard();

-- Name: communication_submission_receipts submission_receipt_immutable; Type: TRIGGER
CREATE TRIGGER submission_receipt_immutable BEFORE DELETE OR UPDATE ON public.communication_submission_receipts FOR EACH ROW EXECUTE FUNCTION public.communications_submission_receipt_immutable();

-- Name: communication_submission_receipts submission_receipt_insert_guard; Type: TRIGGER
CREATE TRIGGER submission_receipt_insert_guard BEFORE INSERT ON public.communication_submission_receipts FOR EACH ROW EXECUTE FUNCTION public.communications_submission_receipt_guard();

-- Name: agent_authority_grants agent_authority_grants_approved_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_authority_grants
    ADD CONSTRAINT agent_authority_grants_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public."user"(id);

-- Name: agent_authority_grants agent_authority_grants_thread_id_organization_id_mandate_i_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_authority_grants
    ADD CONSTRAINT agent_authority_grants_thread_id_organization_id_mandate_i_fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id);

-- Name: agent_authority_uses agent_authority_uses_conversation_id_organization_id_manda_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_authority_uses
    ADD CONSTRAINT agent_authority_uses_conversation_id_organization_id_manda_fkey FOREIGN KEY (conversation_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_conversations(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_authority_uses agent_authority_uses_grant_id_organization_id_mandate_id_o_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_authority_uses
    ADD CONSTRAINT agent_authority_uses_grant_id_organization_id_mandate_id_o_fkey FOREIGN KEY (grant_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_authority_grants(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_authority_uses agent_authority_uses_operation_id_organization_id_mandate__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_authority_uses
    ADD CONSTRAINT agent_authority_uses_operation_id_organization_id_mandate__fkey FOREIGN KEY (operation_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_operations(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_authority_uses agent_authority_uses_review_batch_id_organization_id_manda_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_authority_uses
    ADD CONSTRAINT agent_authority_uses_review_batch_id_organization_id_manda_fkey FOREIGN KEY (review_batch_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_review_batches(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_budget_accounts agent_budget_accounts_approved_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_budget_accounts
    ADD CONSTRAINT agent_budget_accounts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public."user"(id);

-- Name: agent_budget_accounts agent_budget_accounts_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_budget_accounts
    ADD CONSTRAINT agent_budget_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_budget_reservations agent_budget_reservations_account_id_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_budget_reservations
    ADD CONSTRAINT agent_budget_reservations_account_id_organization_id_fkey FOREIGN KEY (account_id, organization_id) REFERENCES public.agent_budget_accounts(id, organization_id);

-- Name: agent_budget_reservations agent_budget_reservations_operation_id_organization_id_own_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_budget_reservations
    ADD CONSTRAINT agent_budget_reservations_operation_id_organization_id_own_fkey FOREIGN KEY (operation_id, organization_id, owner_user_id) REFERENCES public.agent_operations(id, organization_id, owner_user_id);

-- Name: agent_channel_policies agent_channel_policies_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_channel_policies
    ADD CONSTRAINT agent_channel_policies_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: agent_channel_policies agent_channel_policies_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_channel_policies
    ADD CONSTRAINT agent_channel_policies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_channel_policies agent_channel_policies_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_channel_policies
    ADD CONSTRAINT agent_channel_policies_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_channel_policies agent_channel_policies_thread_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_channel_policies
    ADD CONSTRAINT agent_channel_policies_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id);

-- Name: agent_conversation_channels agent_conversation_channels_binding_id_organization_id_own_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_binding_id_organization_id_own_fkey FOREIGN KEY (binding_id, organization_id, owner_user_id, channel) REFERENCES public.communication_bindings(id, organization_id, owner_user_id, channel);

-- Name: agent_conversation_channels agent_conversation_channels_conversation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id);

-- Name: agent_conversation_channels agent_conversation_channels_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: agent_conversation_channels agent_conversation_channels_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_conversation_channels agent_conversation_channels_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_conversation_channels agent_conversation_channels_thread_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversation_channels
    ADD CONSTRAINT agent_conversation_channels_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id);

-- Name: agent_conversations agent_conversations_binding_id_organization_id_owner_user__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_binding_id_organization_id_owner_user__fkey FOREIGN KEY (binding_id, organization_id, owner_user_id) REFERENCES public.communication_bindings(id, organization_id, owner_user_id);

-- Name: agent_conversations agent_conversations_contact_id_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_contact_id_organization_id_fkey FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts(id, organization_id);

-- Name: agent_conversations agent_conversations_human_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_human_user_id_fkey FOREIGN KEY (human_user_id) REFERENCES public."user"(id);

-- Name: agent_conversations agent_conversations_responsibility_id_organization_id_mand_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_responsibility_id_organization_id_mand_fkey FOREIGN KEY (responsibility_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_responsibilities(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_conversations agent_conversations_sequence_enrolment_id_organization_id__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_sequence_enrolment_id_organization_id__fkey FOREIGN KEY (sequence_enrolment_id, organization_id, mandate_id, owner_user_id) REFERENCES public.campaign_enrolments(id, organization_id, mandate_id, owner_user_id);

-- Name: agent_conversations agent_conversations_thread_id_organization_id_mandate_id_o_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_thread_id_organization_id_mandate_id_o_fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id);

-- Name: agent_demo_contact_mappings agent_demo_contact_mappings_contact_id_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_contact_mappings
    ADD CONSTRAINT agent_demo_contact_mappings_contact_id_organization_id_fkey FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts(id, organization_id);

-- Name: agent_demo_contact_mappings agent_demo_contact_mappings_request_key_organization_id_ma_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_contact_mappings
    ADD CONSTRAINT agent_demo_contact_mappings_request_key_organization_id_ma_fkey FOREIGN KEY (request_key, organization_id, mandate_id, demo_id, created_by, demo_run_id) REFERENCES public.agent_demo_mapping_receipts(request_key, organization_id, mandate_id, demo_id, created_by, demo_run_id);

-- Name: agent_demo_mapping_receipts agent_demo_mapping_receipts_request_key_organization_id_ma_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_receipts
    ADD CONSTRAINT agent_demo_mapping_receipts_request_key_organization_id_ma_fkey FOREIGN KEY (request_key, organization_id, mandate_id, demo_id, created_by, demo_run_id) REFERENCES public.agent_demo_mapping_requests(request_key, organization_id, mandate_id, demo_id, created_by, demo_run_id);

-- Name: agent_demo_mapping_requests agent_demo_mapping_requests_demo_run_id_organization_id_cr_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_requests
    ADD CONSTRAINT agent_demo_mapping_requests_demo_run_id_organization_id_cr_fkey FOREIGN KEY (demo_run_id, organization_id, created_by) REFERENCES public.agent_demo_runs(id, organization_id, owner_user_id);

-- Name: agent_demo_mapping_requests agent_demo_mapping_requests_mandate_id_organization_id_cre_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_mapping_requests
    ADD CONSTRAINT agent_demo_mapping_requests_mandate_id_organization_id_cre_fkey FOREIGN KEY (mandate_id, organization_id, created_by, demo_id) REFERENCES public.agent_mandate_execution_modes(mandate_id, organization_id, created_by, demo_id);

-- Name: agent_demo_runs agent_demo_runs_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_runs
    ADD CONSTRAINT agent_demo_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_demo_runs agent_demo_runs_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_demo_runs
    ADD CONSTRAINT agent_demo_runs_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_events agent_events_thread_id_organization_id_mandate_id_owner_us_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_events
    ADD CONSTRAINT agent_events_thread_id_organization_id_mandate_id_owner_us_fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id) ON DELETE CASCADE;

-- Name: agent_handoffs agent_handoffs_assignee_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_handoffs
    ADD CONSTRAINT agent_handoffs_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public."user"(id);

-- Name: agent_handoffs agent_handoffs_conversation_id_organization_id_mandate_id__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_handoffs
    ADD CONSTRAINT agent_handoffs_conversation_id_organization_id_mandate_id__fkey FOREIGN KEY (conversation_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_conversations(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_conversation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_intent_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES public.communication_dispatch_intents(id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_operation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.agent_operations(id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_route_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.agent_conversation_channels(id);

-- Name: agent_linkedin_invitations agent_linkedin_invitations_thread_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_invitations
    ADD CONSTRAINT agent_linkedin_invitations_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id);

-- Name: agent_linkedin_relationships agent_linkedin_relationships_conversation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_relationships
    ADD CONSTRAINT agent_linkedin_relationships_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.agent_conversations(id);

-- Name: agent_linkedin_relationships agent_linkedin_relationships_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_relationships
    ADD CONSTRAINT agent_linkedin_relationships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_linkedin_relationships agent_linkedin_relationships_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_relationships
    ADD CONSTRAINT agent_linkedin_relationships_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_linkedin_relationships agent_linkedin_relationships_route_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_relationships
    ADD CONSTRAINT agent_linkedin_relationships_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.agent_conversation_channels(id);

-- Name: agent_linkedin_relationships agent_linkedin_relationships_thread_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_linkedin_relationships
    ADD CONSTRAINT agent_linkedin_relationships_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id);

-- Name: agent_mandate_execution_modes agent_mandate_execution_modes_created_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_mandate_execution_modes
    ADD CONSTRAINT agent_mandate_execution_modes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id);

-- Name: agent_mandate_execution_modes agent_mandate_execution_modes_mandate_id_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_mandate_execution_modes
    ADD CONSTRAINT agent_mandate_execution_modes_mandate_id_organization_id_fkey FOREIGN KEY (mandate_id, organization_id) REFERENCES public.mandates(id, organization_id);

-- Name: agent_messages agent_messages_thread_id_organization_id_mandate_id_owner__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_thread_id_organization_id_mandate_id_owner__fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id) ON DELETE CASCADE;

-- Name: agent_operations agent_operation_conversation_scope_fk; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_operations
    ADD CONSTRAINT agent_operation_conversation_scope_fk FOREIGN KEY (conversation_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_conversations(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_operations agent_operations_thread_id_organization_id_mandate_id_owne_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_operations
    ADD CONSTRAINT agent_operations_thread_id_organization_id_mandate_id_owne_fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id) ON DELETE CASCADE;

-- Name: agent_person_claims agent_person_claims_conversation_id_organization_id_owner__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_person_claims
    ADD CONSTRAINT agent_person_claims_conversation_id_organization_id_owner__fkey FOREIGN KEY (conversation_id, organization_id, owner_user_id) REFERENCES public.agent_conversations(id, organization_id, owner_user_id);

-- Name: agent_research_phase_allocations agent_research_phase_allocations_account_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_allocations
    ADD CONSTRAINT agent_research_phase_allocations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.agent_budget_accounts(id) ON DELETE CASCADE;

-- Name: agent_research_phase_allocations agent_research_phase_allocations_operation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_allocations
    ADD CONSTRAINT agent_research_phase_allocations_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.agent_research_phase_budgets(operation_id) ON DELETE CASCADE;

-- Name: agent_research_phase_budgets agent_research_phase_budgets_operation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_budgets
    ADD CONSTRAINT agent_research_phase_budgets_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.agent_operations(id) ON DELETE CASCADE;

-- Name: agent_research_phase_budgets agent_research_phase_budgets_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_budgets
    ADD CONSTRAINT agent_research_phase_budgets_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_research_phase_budgets agent_research_phase_budgets_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_research_phase_budgets
    ADD CONSTRAINT agent_research_phase_budgets_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_responsibilities agent_responsibilities_thread_id_organization_id_mandate_i_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_responsibilities
    ADD CONSTRAINT agent_responsibilities_thread_id_organization_id_mandate_i_fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id) ON DELETE CASCADE;

-- Name: agent_responsibilities agent_responsibility_sequence_scope_fk; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_responsibilities
    ADD CONSTRAINT agent_responsibility_sequence_scope_fk FOREIGN KEY (sequence_id, organization_id, mandate_id, owner_user_id) REFERENCES public.campaign_sequences(id, organization_id, mandate_id, owner_user_id);

-- Name: agent_responsibilities agent_responsibility_version_scope_fk; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_responsibilities
    ADD CONSTRAINT agent_responsibility_version_scope_fk FOREIGN KEY (version_id, organization_id, owner_user_id, sequence_id) REFERENCES public.campaign_sequence_versions(id, organization_id, owner_user_id, sequence_id);

-- Name: agent_review_batches agent_review_batches_decided_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_review_batches
    ADD CONSTRAINT agent_review_batches_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public."user"(id);

-- Name: agent_review_batches agent_review_batches_thread_id_organization_id_mandate_id__fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_review_batches
    ADD CONSTRAINT agent_review_batches_thread_id_organization_id_mandate_id__fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id);

-- Name: agent_runs agent_run_trigger_scope_fk; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_run_trigger_scope_fk FOREIGN KEY (trigger_event_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_events(id, organization_id, mandate_id, owner_user_id);

-- Name: agent_runs agent_runs_thread_id_organization_id_mandate_id_owner_user_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_thread_id_organization_id_mandate_id_owner_user_fkey FOREIGN KEY (thread_id, organization_id, mandate_id, owner_user_id) REFERENCES public.agent_threads(id, organization_id, mandate_id, owner_user_id) ON DELETE CASCADE;

-- Name: agent_runtime_registrations agent_runtime_registrations_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runtime_registrations
    ADD CONSTRAINT agent_runtime_registrations_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: agent_runtime_registrations agent_runtime_registrations_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runtime_registrations
    ADD CONSTRAINT agent_runtime_registrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: agent_runtime_registrations agent_runtime_registrations_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runtime_registrations
    ADD CONSTRAINT agent_runtime_registrations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: agent_runtime_registrations agent_runtime_registrations_responsibility_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runtime_registrations
    ADD CONSTRAINT agent_runtime_registrations_responsibility_id_fkey FOREIGN KEY (responsibility_id) REFERENCES public.agent_responsibilities(id);

-- Name: agent_runtime_registrations agent_runtime_registrations_thread_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_runtime_registrations
    ADD CONSTRAINT agent_runtime_registrations_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id);

-- Name: agent_sink_messages agent_sink_messages_conversation_id_organization_id_mandat_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_sink_messages
    ADD CONSTRAINT agent_sink_messages_conversation_id_organization_id_mandat_fkey FOREIGN KEY (conversation_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_conversations(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_sink_messages agent_sink_messages_operation_id_organization_id_mandate_i_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_sink_messages
    ADD CONSTRAINT agent_sink_messages_operation_id_organization_id_mandate_i_fkey FOREIGN KEY (operation_id, organization_id, mandate_id, owner_user_id, thread_id) REFERENCES public.agent_operations(id, organization_id, mandate_id, owner_user_id, thread_id);

-- Name: agent_threads agent_threads_mandate_id_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_mandate_id_organization_id_fkey FOREIGN KEY (mandate_id, organization_id) REFERENCES public.mandates(id, organization_id);

-- Name: agent_threads agent_threads_owner_user_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public."user"(id);

-- Name: communication_submission_receipts communication_submission_rece_binding_id_organization_id_o_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.communication_submission_receipts
    ADD CONSTRAINT communication_submission_rece_binding_id_organization_id_o_fkey FOREIGN KEY (binding_id, organization_id, owner_user_id) REFERENCES public.communication_bindings(id, organization_id, owner_user_id);

-- Name: communication_submission_receipts communication_submission_receipts_intent_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.communication_submission_receipts
    ADD CONSTRAINT communication_submission_receipts_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES public.communication_dispatch_intents(id);

-- Name: company_identity_claims company_identity_claims_observation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_claims
    ADD CONSTRAINT company_identity_claims_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.company_identity_observations(id);

-- Name: company_identity_claims company_identity_claims_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_claims
    ADD CONSTRAINT company_identity_claims_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: company_identity_claims company_identity_claims_target_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_claims
    ADD CONSTRAINT company_identity_claims_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.targets(id);

-- Name: company_identity_decisions company_identity_decisions_decided_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_decisions
    ADD CONSTRAINT company_identity_decisions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public."user"(id);

-- Name: company_identity_decisions company_identity_decisions_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_decisions
    ADD CONSTRAINT company_identity_decisions_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: company_identity_decisions company_identity_decisions_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_decisions
    ADD CONSTRAINT company_identity_decisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: company_identity_decisions company_identity_decisions_review_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_decisions
    ADD CONSTRAINT company_identity_decisions_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.company_identity_reviews(id);

-- Name: company_identity_observations company_identity_observations_created_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id);

-- Name: company_identity_observations company_identity_observations_firmable_sync_run_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_firmable_sync_run_id_fkey FOREIGN KEY (firmable_sync_run_id) REFERENCES public.firmable_sync_runs(id);

-- Name: company_identity_observations company_identity_observations_job_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.research_jobs(id);

-- Name: company_identity_observations company_identity_observations_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: company_identity_observations company_identity_observations_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_observations
    ADD CONSTRAINT company_identity_observations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: company_identity_resolutions company_identity_resolutions_observation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_resolutions
    ADD CONSTRAINT company_identity_resolutions_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.company_identity_observations(id);

-- Name: company_identity_resolutions company_identity_resolutions_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_resolutions
    ADD CONSTRAINT company_identity_resolutions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: company_identity_resolutions company_identity_resolutions_review_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_resolutions
    ADD CONSTRAINT company_identity_resolutions_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.company_identity_reviews(id);

-- Name: company_identity_resolutions company_identity_resolutions_target_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_resolutions
    ADD CONSTRAINT company_identity_resolutions_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.targets(id);

-- Name: company_identity_reviews company_identity_reviews_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_reviews
    ADD CONSTRAINT company_identity_reviews_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: company_identity_reviews company_identity_reviews_observation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_reviews
    ADD CONSTRAINT company_identity_reviews_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.company_identity_observations(id);

-- Name: company_identity_reviews company_identity_reviews_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_identity_reviews
    ADD CONSTRAINT company_identity_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: company_membership_projections company_membership_projections_mandate_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_membership_projections
    ADD CONSTRAINT company_membership_projections_mandate_id_fkey FOREIGN KEY (mandate_id) REFERENCES public.mandates(id);

-- Name: company_membership_projections company_membership_projections_observation_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_membership_projections
    ADD CONSTRAINT company_membership_projections_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.company_identity_observations(id);

-- Name: company_membership_projections company_membership_projections_organization_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_membership_projections
    ADD CONSTRAINT company_membership_projections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);

-- Name: company_membership_projections company_membership_projections_published_by_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_membership_projections
    ADD CONSTRAINT company_membership_projections_published_by_fkey FOREIGN KEY (published_by) REFERENCES public."user"(id);

-- Name: company_membership_projections company_membership_projections_target_id_fkey; Type: FK CONSTRAINT
ALTER TABLE ONLY public.company_membership_projections
    ADD CONSTRAINT company_membership_projections_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.targets(id);

-- Name: agent_authority_grants agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_authority_grants TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_events agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_events TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_messages agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_messages TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_operations agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_operations TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_responsibilities agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_responsibilities TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_review_batches agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_review_batches TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_runs agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_runs TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_threads agent_actor_scope; Type: POLICY
CREATE POLICY agent_actor_scope ON public.agent_threads TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_authority_grants; Type: ROW SECURITY
ALTER TABLE public.agent_authority_grants ENABLE ROW LEVEL SECURITY;

-- Name: agent_authority_uses; Type: ROW SECURITY
ALTER TABLE public.agent_authority_uses ENABLE ROW LEVEL SECURITY;

-- Name: agent_budget_accounts; Type: ROW SECURITY
ALTER TABLE public.agent_budget_accounts ENABLE ROW LEVEL SECURITY;

-- Name: agent_budget_accounts agent_budget_read; Type: POLICY
CREATE POLICY agent_budget_read ON public.agent_budget_accounts FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_budget_reservations agent_budget_read; Type: POLICY
CREATE POLICY agent_budget_read ON public.agent_budget_reservations FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_budget_reservations; Type: ROW SECURITY
ALTER TABLE public.agent_budget_reservations ENABLE ROW LEVEL SECURITY;

-- Name: agent_channel_policies agent_channel_definer; Type: POLICY
CREATE POLICY agent_channel_definer ON public.agent_channel_policies USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_channel_policies'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_channel_policies'::regclass)::oid)))));

-- Name: agent_conversation_channels agent_channel_definer; Type: POLICY
CREATE POLICY agent_channel_definer ON public.agent_conversation_channels USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_conversation_channels'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_conversation_channels'::regclass)::oid)))));

-- Name: agent_channel_policies agent_channel_owned_read; Type: POLICY
CREATE POLICY agent_channel_owned_read ON public.agent_channel_policies FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_conversation_channels agent_channel_owned_read; Type: POLICY
CREATE POLICY agent_channel_owned_read ON public.agent_conversation_channels FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_channel_policies; Type: ROW SECURITY
ALTER TABLE public.agent_channel_policies ENABLE ROW LEVEL SECURITY;

-- Name: contacts agent_control_contacts_read; Type: POLICY
CREATE POLICY agent_control_contacts_read ON public.contacts FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_authority_uses agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_authority_uses USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_authority_uses'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_authority_uses'::regclass)::oid)))));

-- Name: agent_budget_accounts agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_budget_accounts USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_budget_accounts'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_budget_accounts'::regclass)::oid)))));

-- Name: agent_budget_reservations agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_budget_reservations USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_budget_reservations'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_budget_reservations'::regclass)::oid)))));

-- Name: agent_conversations agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_conversations USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_conversations'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_conversations'::regclass)::oid)))));

-- Name: agent_handoffs agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_handoffs USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_handoffs'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_handoffs'::regclass)::oid)))));

-- Name: agent_operations agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_operations USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_operations'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_operations'::regclass)::oid)))));

-- Name: agent_person_claims agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_person_claims USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_person_claims'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_person_claims'::regclass)::oid)))));

-- Name: agent_responsibilities agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_responsibilities USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_responsibilities'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_responsibilities'::regclass)::oid)))));

-- Name: agent_sink_messages agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_sink_messages USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_sink_messages'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_sink_messages'::regclass)::oid)))));

-- Name: agent_threads agent_control_definer; Type: POLICY
CREATE POLICY agent_control_definer ON public.agent_threads USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_threads'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_threads'::regclass)::oid)))));

-- Name: communication_dispatch_permits agent_control_permit_read; Type: POLICY
CREATE POLICY agent_control_permit_read ON public.communication_dispatch_permits FOR SELECT TO acquire_agent_user USING ((EXISTS ( SELECT 1
   FROM public.communication_dispatch_intents i
  WHERE ((i.id = communication_dispatch_permits.intent_id) AND (i.organization_id = current_setting('app.acquire_org'::text, true)) AND (i.owner_user_id = current_setting('app.acquire_user'::text, true))))));

-- Name: campaign_contact_holds agent_control_policy_read; Type: POLICY
CREATE POLICY agent_control_policy_read ON public.campaign_contact_holds FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: campaign_reply_holds agent_control_policy_read; Type: POLICY
CREATE POLICY agent_control_policy_read ON public.campaign_reply_holds FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: communication_reply_review_latches agent_control_policy_read; Type: POLICY
CREATE POLICY agent_control_policy_read ON public.communication_reply_review_latches FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: suppressions agent_control_policy_read; Type: POLICY
CREATE POLICY agent_control_policy_read ON public.suppressions FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: communication_intent_resolutions agent_control_resolution_read; Type: POLICY
CREATE POLICY agent_control_resolution_read ON public.communication_intent_resolutions FOR SELECT TO acquire_agent_user USING ((EXISTS ( SELECT 1
   FROM public.communication_dispatch_intents i
  WHERE ((i.id = communication_intent_resolutions.intent_id) AND (i.organization_id = current_setting('app.acquire_org'::text, true)) AND (i.owner_user_id = current_setting('app.acquire_user'::text, true))))));

-- Name: agent_authority_uses agent_control_scope; Type: POLICY
CREATE POLICY agent_control_scope ON public.agent_authority_uses TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_conversations agent_control_scope; Type: POLICY
CREATE POLICY agent_control_scope ON public.agent_conversations TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_handoffs agent_control_scope; Type: POLICY
CREATE POLICY agent_control_scope ON public.agent_handoffs TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_person_claims agent_control_scope; Type: POLICY
CREATE POLICY agent_control_scope ON public.agent_person_claims TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_sink_messages agent_control_scope; Type: POLICY
CREATE POLICY agent_control_scope ON public.agent_sink_messages TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: campaign_enrolments agent_control_source_read; Type: POLICY
CREATE POLICY agent_control_source_read ON public.campaign_enrolments FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: campaign_send_attempts agent_control_source_read; Type: POLICY
CREATE POLICY agent_control_source_read ON public.campaign_send_attempts FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: communication_bindings agent_control_source_read; Type: POLICY
CREATE POLICY agent_control_source_read ON public.communication_bindings FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: communication_dispatch_intents agent_control_source_read; Type: POLICY
CREATE POLICY agent_control_source_read ON public.communication_dispatch_intents FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: agent_conversation_channels; Type: ROW SECURITY
ALTER TABLE public.agent_conversation_channels ENABLE ROW LEVEL SECURITY;

-- Name: agent_conversations; Type: ROW SECURITY
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

-- Name: agent_demo_contact_mappings; Type: ROW SECURITY
ALTER TABLE public.agent_demo_contact_mappings ENABLE ROW LEVEL SECURITY;

-- Name: agent_demo_contact_mappings agent_demo_definer; Type: POLICY
CREATE POLICY agent_demo_definer ON public.agent_demo_contact_mappings USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_contact_mappings'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_contact_mappings'::regclass)::oid)))));

-- Name: agent_demo_mapping_receipts agent_demo_definer; Type: POLICY
CREATE POLICY agent_demo_definer ON public.agent_demo_mapping_receipts USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_mapping_receipts'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_mapping_receipts'::regclass)::oid)))));

-- Name: agent_demo_mapping_requests agent_demo_definer; Type: POLICY
CREATE POLICY agent_demo_definer ON public.agent_demo_mapping_requests USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_mapping_requests'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_mapping_requests'::regclass)::oid)))));

-- Name: agent_demo_runs agent_demo_definer; Type: POLICY
CREATE POLICY agent_demo_definer ON public.agent_demo_runs USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_runs'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_demo_runs'::regclass)::oid)))));

-- Name: agent_demo_mapping_receipts; Type: ROW SECURITY
ALTER TABLE public.agent_demo_mapping_receipts ENABLE ROW LEVEL SECURITY;

-- Name: agent_demo_mapping_requests; Type: ROW SECURITY
ALTER TABLE public.agent_demo_mapping_requests ENABLE ROW LEVEL SECURITY;

-- Name: agent_demo_contact_mappings agent_demo_owned_read; Type: POLICY
CREATE POLICY agent_demo_owned_read ON public.agent_demo_contact_mappings FOR SELECT TO acquire_campaign_user, acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (created_by = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_demo_mapping_receipts agent_demo_owned_read; Type: POLICY
CREATE POLICY agent_demo_owned_read ON public.agent_demo_mapping_receipts FOR SELECT TO acquire_campaign_user, acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (created_by = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_demo_mapping_requests agent_demo_owned_read; Type: POLICY
CREATE POLICY agent_demo_owned_read ON public.agent_demo_mapping_requests FOR SELECT TO acquire_campaign_user, acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (created_by = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_demo_runs agent_demo_owned_read; Type: POLICY
CREATE POLICY agent_demo_owned_read ON public.agent_demo_runs FOR SELECT TO acquire_campaign_user, acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_demo_runs; Type: ROW SECURITY
ALTER TABLE public.agent_demo_runs ENABLE ROW LEVEL SECURITY;

-- Name: agent_events; Type: ROW SECURITY
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

-- Name: agent_handoffs agent_handoff_assignee_read; Type: POLICY
CREATE POLICY agent_handoff_assignee_read ON public.agent_handoffs FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (assignee_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_handoffs agent_handoff_assignee_update; Type: POLICY
CREATE POLICY agent_handoff_assignee_update ON public.agent_handoffs FOR UPDATE TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (assignee_user_id = current_setting('app.acquire_user'::text, true)))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (assignee_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: agent_handoffs; Type: ROW SECURITY
ALTER TABLE public.agent_handoffs ENABLE ROW LEVEL SECURITY;

-- Name: agent_linkedin_invitations agent_invitation_definer; Type: POLICY
CREATE POLICY agent_invitation_definer ON public.agent_linkedin_invitations USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_linkedin_invitations'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_linkedin_invitations'::regclass)::oid)))));

-- Name: agent_linkedin_relationships agent_invitation_definer; Type: POLICY
CREATE POLICY agent_invitation_definer ON public.agent_linkedin_relationships USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_linkedin_relationships'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_linkedin_relationships'::regclass)::oid)))));

-- Name: agent_linkedin_invitations agent_invitation_owned_read; Type: POLICY
CREATE POLICY agent_invitation_owned_read ON public.agent_linkedin_invitations FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_linkedin_relationships agent_invitation_owned_read; Type: POLICY
CREATE POLICY agent_invitation_owned_read ON public.agent_linkedin_relationships FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_linkedin_invitations; Type: ROW SECURITY
ALTER TABLE public.agent_linkedin_invitations ENABLE ROW LEVEL SECURITY;

-- Name: agent_linkedin_relationships; Type: ROW SECURITY
ALTER TABLE public.agent_linkedin_relationships ENABLE ROW LEVEL SECURITY;

-- Name: agent_mandate_execution_modes; Type: ROW SECURITY
ALTER TABLE public.agent_mandate_execution_modes ENABLE ROW LEVEL SECURITY;

-- Name: agent_mandate_execution_modes agent_mandate_mode_definer; Type: POLICY
CREATE POLICY agent_mandate_mode_definer ON public.agent_mandate_execution_modes USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_mandate_execution_modes'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_mandate_execution_modes'::regclass)::oid)))));

-- Name: agent_mandate_execution_modes agent_mandate_mode_member_read; Type: POLICY
CREATE POLICY agent_mandate_mode_member_read ON public.agent_mandate_execution_modes FOR SELECT TO acquire_campaign_user, acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: mandates agent_mandate_read; Type: POLICY
CREATE POLICY agent_mandate_read ON public.mandates FOR SELECT TO acquire_agent_user USING ((organization_id = current_setting('app.acquire_org'::text, true)));

-- Name: member agent_member_read; Type: POLICY
CREATE POLICY agent_member_read ON public.member FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (user_id = current_setting('app.acquire_user'::text, true))));

-- Name: agent_messages; Type: ROW SECURITY
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

-- Name: agent_operations; Type: ROW SECURITY
ALTER TABLE public.agent_operations ENABLE ROW LEVEL SECURITY;

-- Name: campaign_sequences agent_owned_sequence_drafts; Type: POLICY
CREATE POLICY agent_owned_sequence_drafts ON public.campaign_sequences AS RESTRICTIVE TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))) AND (EXISTS ( SELECT 1
   FROM public.mandates m
  WHERE ((m.id = campaign_sequences.mandate_id) AND (m.organization_id = campaign_sequences.organization_id)))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))) AND (EXISTS ( SELECT 1
   FROM public.mandates m
  WHERE ((m.id = campaign_sequences.mandate_id) AND (m.organization_id = campaign_sequences.organization_id))))));

-- Name: campaign_sequences agent_owned_sequence_drafts_permit; Type: POLICY
CREATE POLICY agent_owned_sequence_drafts_permit ON public.campaign_sequences TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: agent_person_claims; Type: ROW SECURITY
ALTER TABLE public.agent_person_claims ENABLE ROW LEVEL SECURITY;

-- Name: agent_research_phase_allocations agent_phase_allocation_read; Type: POLICY
CREATE POLICY agent_phase_allocation_read ON public.agent_research_phase_allocations FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_research_phase_budgets agent_phase_budget_read; Type: POLICY
CREATE POLICY agent_phase_budget_read ON public.agent_research_phase_budgets FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: agent_research_phase_allocations agent_phase_definer; Type: POLICY
CREATE POLICY agent_phase_definer ON public.agent_research_phase_allocations USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_research_phase_allocations'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_research_phase_allocations'::regclass)::oid)))));

-- Name: agent_research_phase_budgets agent_phase_definer; Type: POLICY
CREATE POLICY agent_phase_definer ON public.agent_research_phase_budgets USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_research_phase_budgets'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_research_phase_budgets'::regclass)::oid)))));

-- Name: agent_research_phase_allocations; Type: ROW SECURITY
ALTER TABLE public.agent_research_phase_allocations ENABLE ROW LEVEL SECURITY;

-- Name: agent_research_phase_budgets; Type: ROW SECURITY
ALTER TABLE public.agent_research_phase_budgets ENABLE ROW LEVEL SECURITY;

-- Name: agent_responsibilities; Type: ROW SECURITY
ALTER TABLE public.agent_responsibilities ENABLE ROW LEVEL SECURITY;

-- Name: agent_review_batches; Type: ROW SECURITY
ALTER TABLE public.agent_review_batches ENABLE ROW LEVEL SECURITY;

-- Name: agent_runs; Type: ROW SECURITY
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Name: agent_runtime_registrations agent_runtime_definer; Type: POLICY
CREATE POLICY agent_runtime_definer ON public.agent_runtime_registrations USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_runtime_registrations'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.agent_runtime_registrations'::regclass)::oid)))));

-- Name: agent_runtime_registrations agent_runtime_owned_read; Type: POLICY
CREATE POLICY agent_runtime_owned_read ON public.agent_runtime_registrations FOR SELECT TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member m
  WHERE ((m.organization_id = agent_runtime_registrations.organization_id) AND (m.user_id = agent_runtime_registrations.owner_user_id))))));

-- Name: agent_runtime_registrations; Type: ROW SECURITY
ALTER TABLE public.agent_runtime_registrations ENABLE ROW LEVEL SECURITY;

-- Name: campaign_sequence_versions agent_sequence_versions_fence; Type: POLICY
CREATE POLICY agent_sequence_versions_fence ON public.campaign_sequence_versions AS RESTRICTIVE TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))) AND (EXISTS ( SELECT 1
   FROM public.campaign_sequences s
  WHERE ((s.id = campaign_sequence_versions.sequence_id) AND (s.organization_id = campaign_sequence_versions.organization_id) AND (s.owner_user_id = campaign_sequence_versions.owner_user_id)))))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true))))) AND (EXISTS ( SELECT 1
   FROM public.campaign_sequences s
  WHERE ((s.id = campaign_sequence_versions.sequence_id) AND (s.organization_id = campaign_sequence_versions.organization_id) AND (s.owner_user_id = campaign_sequence_versions.owner_user_id))))));

-- Name: campaign_sequence_versions agent_sequence_versions_permit; Type: POLICY
CREATE POLICY agent_sequence_versions_permit ON public.campaign_sequence_versions TO acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)))) WITH CHECK (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true))));

-- Name: agent_sink_messages; Type: ROW SECURITY
ALTER TABLE public.agent_sink_messages ENABLE ROW LEVEL SECURITY;

-- Name: agent_threads; Type: ROW SECURITY
ALTER TABLE public.agent_threads ENABLE ROW LEVEL SECURITY;

-- Name: communication_submission_receipts; Type: ROW SECURITY
ALTER TABLE public.communication_submission_receipts ENABLE ROW LEVEL SECURITY;

-- Name: company_membership_projections; Type: ROW SECURITY
ALTER TABLE public.company_membership_projections ENABLE ROW LEVEL SECURITY;

-- Name: company_membership_projections company_projection_owner; Type: POLICY
CREATE POLICY company_projection_owner ON public.company_membership_projections USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.company_membership_projections'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.company_membership_projections'::regclass)::oid)))));

-- Name: communication_submission_receipts submission_receipt_owned_read; Type: POLICY
CREATE POLICY submission_receipt_owned_read ON public.communication_submission_receipts FOR SELECT TO acquire_campaign_user, acquire_agent_user USING (((organization_id = current_setting('app.acquire_org'::text, true)) AND (owner_user_id = current_setting('app.acquire_user'::text, true)) AND (EXISTS ( SELECT 1
   FROM public.member
  WHERE ((member.organization_id = current_setting('app.acquire_org'::text, true)) AND (member.user_id = current_setting('app.acquire_user'::text, true)))))));

-- Name: communication_submission_receipts submission_receipt_owner; Type: POLICY
CREATE POLICY submission_receipt_owner ON public.communication_submission_receipts USING ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.communication_submission_receipts'::regclass)::oid))))) WITH CHECK ((CURRENT_USER = pg_get_userbyid(( SELECT pg_class.relowner
   FROM pg_class
  WHERE (pg_class.oid = ('public.communication_submission_receipts'::regclass)::oid)))));

-- Name: FUNCTION agent_adopt_sequence_channels(p_thread uuid, p_review jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_adopt_sequence_channels(p_thread uuid, p_review jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_adopt_sequence_channels(p_thread uuid, p_review jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_aliases_have_unresolved_sends(p_aliases uuid[], ignored_operation uuid, p_invitations boolean); Type: ACL
REVOKE ALL ON FUNCTION public.agent_aliases_have_unresolved_sends(p_aliases uuid[], ignored_operation uuid, p_invitations boolean) FROM PUBLIC;

-- Name: FUNCTION agent_allocate_channel_target(p_thread uuid, p_operation uuid, p_contact uuid, p_source text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_allocate_channel_target(p_thread uuid, p_operation uuid, p_contact uuid, p_source text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_allocate_channel_target(p_thread uuid, p_operation uuid, p_contact uuid, p_source text) TO acquire_agent_user;

-- Name: FUNCTION agent_allowed_mandate_binding(p_mandate uuid, p_binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_allowed_mandate_binding(p_mandate uuid, p_binding uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_allowed_mandate_binding(p_mandate uuid, p_binding uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_allowed_mandate_binding(p_mandate uuid, p_binding uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_assert_automatic_people_target(operation uuid, target uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_automatic_people_target(operation uuid, target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_assert_automatic_people_target(operation uuid, target uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_assert_company_continuation(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_company_continuation(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_assert_company_continuation(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_assert_control_scope(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_control_scope() FROM PUBLIC;

-- Name: FUNCTION agent_assert_execution_context_scope(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_execution_context_scope() FROM PUBLIC;

-- Name: FUNCTION agent_assert_mandate_outreach_mode(p_mandate uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_mandate_outreach_mode(p_mandate uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_assert_mandate_outreach_mode(p_mandate uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_assert_mandate_outreach_mode(p_mandate uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_assert_manual_mandate_outreach_mode(p_mandate uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_manual_mandate_outreach_mode(p_mandate uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_assert_manual_mandate_outreach_mode(p_mandate uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_assert_manual_mandate_outreach_mode(p_mandate uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_assert_target_allocation(p_thread uuid, p_operation uuid, p_contact uuid, p_source text, p_mode text, p_binding uuid, p_binding_digest text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_assert_target_allocation(p_thread uuid, p_operation uuid, p_contact uuid, p_source text, p_mode text, p_binding uuid, p_binding_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_assert_target_allocation(p_thread uuid, p_operation uuid, p_contact uuid, p_source text, p_mode text, p_binding uuid, p_binding_digest text) TO acquire_agent_user;

-- Name: FUNCTION agent_audit_completed_sequence(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_audit_completed_sequence(p_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_audit_completed_sequence(p_operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_authority_use_immutable(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_authority_use_immutable() FROM PUBLIC;

-- Name: FUNCTION agent_automatic_people_context(operation uuid, target uuid, firmable_id text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_automatic_people_context(operation uuid, target uuid, firmable_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_automatic_people_context(operation uuid, target uuid, firmable_id text) TO acquire_agent_user;

-- Name: FUNCTION agent_canonical_contact_aliases(p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_canonical_contact_aliases(p_contact uuid) FROM PUBLIC;

-- Name: FUNCTION agent_channel_canonical_json(v jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_canonical_json(v jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_channel_communications_change(p jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_communications_change(p jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_communications_change(p jsonb) TO acquire_campaign_user;

-- Name: FUNCTION agent_channel_communications_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_communications_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) FROM PUBLIC;

-- Name: FUNCTION agent_channel_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_channel_due_reassessment(p_thread uuid, p_route uuid, p_policy_revision integer, p_scheduled_at timestamp with time zone); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_due_reassessment(p_thread uuid, p_route uuid, p_policy_revision integer, p_scheduled_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_due_reassessment(p_thread uuid, p_route uuid, p_policy_revision integer, p_scheduled_at timestamp with time zone) TO acquire_agent_user;

-- Name: FUNCTION agent_channel_grant_immutable(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_grant_immutable() FROM PUBLIC;

-- Name: FUNCTION agent_channel_local_binding(p_binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_local_binding(p_binding uuid) FROM PUBLIC;

-- Name: FUNCTION agent_channel_local_binding_before_execution_context(p_binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_local_binding_before_execution_context(p_binding uuid) FROM PUBLIC;

-- Name: FUNCTION agent_channel_operation_authorised(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_operation_authorised(p_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_operation_authorised(p_operation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_channel_operation_authorised(p_operation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_channel_operation_before_company_projection(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_operation_before_company_projection(p_operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_channel_operation_before_invitations(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_operation_before_invitations(p_operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_channel_outbound_consumed_turn(p_conversation uuid, p_message jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_outbound_consumed_turn(p_conversation uuid, p_message jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_channel_proposal_before_execution_context(p_route uuid, p_stage text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_execution_context(p_route uuid, p_stage text) FROM PUBLIC;

-- Name: FUNCTION agent_channel_proposal_before_invitations(p_route uuid, p_stage text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_invitations(p_route uuid, p_stage text) FROM PUBLIC;

-- Name: FUNCTION agent_channel_proposal_permitted(p_route uuid, p_stage text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted(p_route uuid, p_stage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_proposal_permitted(p_route uuid, p_stage text) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_channel_proposal_permitted(p_route uuid, p_stage text) TO acquire_campaign_user;

-- Name: FUNCTION agent_channel_proposal_permitted_before_history_quiet(p_route uuid, p_stage text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted_before_history_quiet(p_route uuid, p_stage text) FROM PUBLIC;

-- Name: FUNCTION agent_channel_record_submission(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_record_submission(p_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_record_submission(p_operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_channel_reply_causality(p_route uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_reply_causality(p_route uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_channel_reply_causality(p_route uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_channel_reply_causality(p_route uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_channel_reserved_recipient(p_channel text, p_value text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_reserved_recipient(p_channel text, p_value text) FROM PUBLIC;

-- Name: FUNCTION agent_channel_source_before_invitations(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_channel_source_before_invitations(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) FROM PUBLIC;

-- Name: FUNCTION agent_communications_bounce(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_recipient text, p_message text, p_occurred timestamp with time zone, p_receipt_preimage text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_bounce(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_recipient text, p_message text, p_occurred timestamp with time zone, p_receipt_preimage text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_communications_bounce(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_recipient text, p_message text, p_occurred timestamp with time zone, p_receipt_preimage text) TO acquire_campaign_user;

-- Name: FUNCTION agent_communications_change(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_sender text, p_message text, p_occurred timestamp with time zone, p_review boolean); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_change(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_sender text, p_message text, p_occurred timestamp with time zone, p_review boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_communications_change(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_sender text, p_message text, p_occurred timestamp with time zone, p_review boolean) TO acquire_campaign_user;

-- Name: FUNCTION agent_communications_intent_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_intent_guard() FROM PUBLIC;

-- Name: FUNCTION agent_communications_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_communications_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_communications_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) TO acquire_campaign_user;

-- Name: FUNCTION agent_communications_no_submission_before_channels(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_no_submission_before_channels(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) FROM PUBLIC;

-- Name: FUNCTION agent_communications_receipt_wake(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_receipt_wake(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_communications_receipt_wake(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text) TO acquire_campaign_user;

-- Name: FUNCTION agent_communications_receipt_wake_before_channel_routes(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_receipt_wake_before_channel_routes(p_binding uuid, p_operation uuid, p_key text, p_payload text, p_evidence text) FROM PUBLIC;

-- Name: FUNCTION agent_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_communications_source(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_communications_source_before_reply_parent(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_source_before_reply_parent(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) FROM PUBLIC;

-- Name: FUNCTION agent_communications_source_kind(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_communications_source_kind(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_communications_source_kind(operation uuid, conversation uuid, expected_epoch bigint, expected_fence bigint, binding uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_company_continuation_job_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_continuation_job_guard() FROM PUBLIC;

-- Name: FUNCTION agent_company_continuation_operation_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_continuation_operation_guard() FROM PUBLIC;

-- Name: FUNCTION agent_company_continuation_sources(p_thread uuid, p_source uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_continuation_sources(p_thread uuid, p_source uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_company_continuation_sources(p_thread uuid, p_source uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_company_conversation_permitted(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_conversation_permitted(p_conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_company_conversation_permitted(p_conversation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_company_conversation_permitted(p_conversation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_company_findings_digest(p_org text, p_mandate uuid, p_target uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_findings_digest(p_org text, p_mandate uuid, p_target uuid) FROM PUBLIC;

-- Name: FUNCTION agent_company_membership_projection(p_mandate uuid, p_target uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_membership_projection(p_mandate uuid, p_target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_company_membership_projection(p_mandate uuid, p_target uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_company_membership_projection(p_mandate uuid, p_target uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_company_projection_writer_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_company_projection_writer_guard() FROM PUBLIC;

-- Name: FUNCTION agent_configure_budget(scope_key text, unit text, window_start timestamp with time zone, window_end timestamp with time zone, cap bigint, expected_revision integer); Type: ACL
REVOKE ALL ON FUNCTION public.agent_configure_budget(scope_key text, unit text, window_start timestamp with time zone, window_end timestamp with time zone, cap bigint, expected_revision integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_configure_budget(scope_key text, unit text, window_start timestamp with time zone, window_end timestamp with time zone, cap bigint, expected_revision integer) TO acquire_agent_user;

-- Name: FUNCTION agent_consume_delegation(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_consume_delegation() FROM PUBLIC;

-- Name: FUNCTION agent_consume_delegation_before_channels(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_consume_delegation_before_channels() FROM PUBLIC;

-- Name: FUNCTION agent_contact_delivery_recipients(p_data jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_contact_delivery_recipients(p_data jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_contact_identity_batch(p_org text, p_contacts uuid[]); Type: ACL
REVOKE ALL ON FUNCTION public.agent_contact_identity_batch(p_org text, p_contacts uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_contact_identity_batch(p_org text, p_contacts uuid[]) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_contact_identity_batch(p_org text, p_contacts uuid[]) TO acquire_campaign_user;

-- Name: FUNCTION agent_context_revision(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_context_revision(p_conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_context_revision(p_conversation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_context_revision(p_conversation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_context_revision_before_channels(conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_context_revision_before_channels(conversation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_context_revision_before_company_projection(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_context_revision_before_company_projection(p_conversation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_context_revision_before_invitations(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_context_revision_before_invitations(p_conversation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_control_handoff(p_mandate uuid, p_key uuid, p_input jsonb, p_digest text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_control_handoff(p_mandate uuid, p_key uuid, p_input jsonb, p_digest text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_control_handoff(p_mandate uuid, p_key uuid, p_input jsonb, p_digest text) TO acquire_agent_user;

-- Name: FUNCTION agent_conversation_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_conversation_guard() FROM PUBLIC;

-- Name: FUNCTION agent_create_fields_job(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_create_fields_job(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_create_fields_job(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_create_people_job(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_create_people_job(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_create_people_job(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_create_research_job(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_create_research_job(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_create_research_job(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_current_company_projection(p_org text, p_mandate uuid, p_target uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_current_company_projection(p_org text, p_mandate uuid, p_target uuid) FROM PUBLIC;

-- Name: FUNCTION agent_delivery_candidate_projection(p_mandate uuid, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_delivery_candidate_projection(p_mandate uuid, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_delivery_candidate_projection(p_mandate uuid, p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_delivery_candidate_projection(p_mandate uuid, p_contact uuid) TO acquire_campaign_user;

-- Name: TABLE contacts; Type: ACL
GRANT SELECT ON TABLE public.contacts TO acquire_agent_user;

-- Name: FUNCTION agent_delivery_contact_projection(p_mandate uuid, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_delivery_contact_projection(p_mandate uuid, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_delivery_contact_projection(p_mandate uuid, p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_delivery_contact_projection(p_mandate uuid, p_contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_demo_contact_fingerprint(p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_contact_fingerprint(p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_demo_contact_fingerprint(p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_demo_contact_fingerprint(p_contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_demo_evidence_immutable(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_evidence_immutable() FROM PUBLIC;

-- Name: FUNCTION agent_demo_evidence_insert_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_evidence_insert_guard() FROM PUBLIC;

-- Name: FUNCTION agent_demo_execution_readiness(p_thread uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_execution_readiness(p_thread uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_demo_execution_readiness(p_thread uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_demo_manual_outreach_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_manual_outreach_guard() FROM PUBLIC;

-- Name: FUNCTION agent_demo_original_effect_identity_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_original_effect_identity_guard() FROM PUBLIC;

-- Name: FUNCTION agent_demo_run_bindings_match(p_org text, p_owner text, p_run text, p_integration text, p_config text, p_senders jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_run_bindings_match(p_org text, p_owner text, p_run text, p_integration text, p_config text, p_senders jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_demo_runtime_ready(p_run uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_runtime_ready(p_run uuid) FROM PUBLIC;

-- Name: FUNCTION agent_demo_wire_valid(p_run text, p_wire jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_demo_wire_valid(p_run text, p_wire jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_driver_allows(org text, actor text, contact uuid, address text, source_kind text, source_ref uuid, expected_epoch bigint); Type: ACL
REVOKE ALL ON FUNCTION public.agent_driver_allows(org text, actor text, contact uuid, address text, source_kind text, source_ref uuid, expected_epoch bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_driver_allows(org text, actor text, contact uuid, address text, source_kind text, source_ref uuid, expected_epoch bigint) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_driver_allows(org text, actor text, contact uuid, address text, source_kind text, source_ref uuid, expected_epoch bigint) TO acquire_campaign_user;

-- Name: FUNCTION agent_effective_contact(p_mandate uuid, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_effective_contact(p_mandate uuid, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_effective_contact(p_mandate uuid, p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_effective_contact(p_mandate uuid, p_contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_email_reply_parent(history jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_email_reply_parent(history jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_email_window_open(at_time timestamp with time zone); Type: ACL
REVOKE ALL ON FUNCTION public.agent_email_window_open(at_time timestamp with time zone) FROM PUBLIC;

-- Name: FUNCTION agent_enrol_reviewed_sequence(p_thread uuid, p_operation uuid, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_enrol_reviewed_sequence(p_thread uuid, p_operation uuid, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_enrol_reviewed_sequence(p_thread uuid, p_operation uuid, p_contact uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_event_eligible(p_thread uuid, p_kind text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_event_eligible(p_thread uuid, p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_event_eligible(p_thread uuid, p_kind text) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_event_eligible(p_thread uuid, p_kind text) TO acquire_agent_worker;

-- Name: FUNCTION agent_event_eligible_before_channel_due(p_thread uuid, p_kind text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_channel_due(p_thread uuid, p_kind text) FROM PUBLIC;

-- Name: FUNCTION agent_event_eligible_before_registry(p_thread uuid, p_kind text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_registry(p_thread uuid, p_kind text) FROM PUBLIC;

-- Name: FUNCTION agent_fields_company_snapshot(p_thread uuid, p_root uuid, p_targets uuid[], p_ignore uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_fields_company_snapshot(p_thread uuid, p_root uuid, p_targets uuid[], p_ignore uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_fields_company_snapshot(p_thread uuid, p_root uuid, p_targets uuid[], p_ignore uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_fields_current_source(p_org text, p_mandate uuid, p_target uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_fields_current_source(p_org text, p_mandate uuid, p_target uuid) FROM PUBLIC;

-- Name: FUNCTION agent_fields_job_before_company_projection(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_fields_job_before_company_projection(operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_fields_persistence_permitted(p_job uuid, p_org text, p_mandate uuid, p_actor text, p_config jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_fields_persistence_permitted(p_job uuid, p_org text, p_mandate uuid, p_actor text, p_config jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_fields_snapshot_before_company_projection(p_thread uuid, p_root uuid, p_targets uuid[], p_ignore uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_fields_snapshot_before_company_projection(p_thread uuid, p_root uuid, p_targets uuid[], p_ignore uuid) FROM PUBLIC;

-- Name: FUNCTION agent_grant_immutable_scope(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_grant_immutable_scope() FROM PUBLIC;

-- Name: FUNCTION agent_gui_testing_send_window_exempt(p_route uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_gui_testing_send_window_exempt(p_route uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_gui_testing_send_window_exempt(p_route uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_handoff_assignee_current(p_task uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_handoff_assignee_current(p_task uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_handoff_assignee_current(p_task uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_handoff_context(p_task uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_handoff_context(p_task uuid) FROM PUBLIC;

-- Name: FUNCTION agent_handoff_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_handoff_guard() FROM PUBLIC;

-- Name: FUNCTION agent_handoff_inbox(p_mandate uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_handoff_inbox(p_mandate uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_handoff_inbox(p_mandate uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_history_accounts_clear(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_history_accounts_clear(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_history_accounts_clear(operation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_history_accounts_clear(operation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_ingest_channel_relationship(p_route uuid, p_binding_digest text, p_identity_revision text, p_status text, p_can_message boolean, p_observed_at timestamp with time zone); Type: ACL
REVOKE ALL ON FUNCTION public.agent_ingest_channel_relationship(p_route uuid, p_binding_digest text, p_identity_revision text, p_status text, p_can_message boolean, p_observed_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_ingest_channel_relationship(p_route uuid, p_binding_digest text, p_identity_revision text, p_status text, p_can_message boolean, p_observed_at timestamp with time zone) TO acquire_agent_user;

-- Name: FUNCTION agent_intent_execution_context_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_intent_execution_context_guard() FROM PUBLIC;

-- Name: FUNCTION agent_invalidate_person_reviews(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews(p_conversation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_invalidate_person_reviews_before_invitations(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews_before_invitations(p_conversation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_invitation_before_company_projection(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_invitation_before_company_projection(p_operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_invitation_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint); Type: ACL
REVOKE ALL ON FUNCTION public.agent_invitation_no_submission(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) FROM PUBLIC;

-- Name: FUNCTION agent_invitation_operation_authorised(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_is_demo_origin(p_mandate uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_is_demo_origin(p_mandate uuid) FROM PUBLIC;

-- Name: FUNCTION agent_is_original_demo_source(p_kind text, p_source uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_is_original_demo_source(p_kind text, p_source uuid) FROM PUBLIC;

-- Name: FUNCTION agent_legacy_sequence_conflicts(contact uuid, allowed_enrolment uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_legacy_sequence_conflicts(contact uuid, allowed_enrolment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_legacy_sequence_conflicts(contact uuid, allowed_enrolment uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_legacy_sequence_occupied(contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_legacy_sequence_occupied(contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_legacy_sequence_occupied(contact uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_load_mandate_execution_context(p_origin jsonb, p_org text, p_actor text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_load_mandate_execution_context(p_origin jsonb, p_org text, p_actor text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_load_mandate_execution_context(p_origin jsonb, p_org text, p_actor text) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_load_mandate_execution_context(p_origin jsonb, p_org text, p_actor text) TO acquire_campaign_user;

-- Name: FUNCTION agent_load_mandate_research_context(p_mandate uuid, p_org text, p_actor text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_load_mandate_research_context(p_mandate uuid, p_org text, p_actor text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_load_mandate_research_context(p_mandate uuid, p_org text, p_actor text) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_load_mandate_research_context(p_mandate uuid, p_org text, p_actor text) TO acquire_campaign_user;

-- Name: FUNCTION agent_local_business_completion_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_business_completion_guard() FROM PUBLIC;

-- Name: FUNCTION agent_lock_member(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_lock_member() FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_lock_member() TO acquire_agent_user;

-- Name: FUNCTION agent_lock_send_gate(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_lock_send_gate() FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_lock_send_gate() TO acquire_agent_user;

-- Name: FUNCTION agent_mandate_execution_mode_immutable(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_mandate_execution_mode_immutable() FROM PUBLIC;

-- Name: FUNCTION agent_mandate_identity_scope(p_mandate uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_mandate_identity_scope(p_mandate uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_mandate_identity_scope(p_mandate uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_mandate_identity_scope(p_mandate uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_mandate_legacy_sequence_occupied(p_mandate uuid, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_mandate_legacy_sequence_occupied(p_mandate uuid, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_mandate_legacy_sequence_occupied(p_mandate uuid, p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_mandate_legacy_sequence_occupied(p_mandate uuid, p_contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_mandate_outreach_mode_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_mandate_outreach_mode_guard() FROM PUBLIC;

-- Name: FUNCTION agent_mandate_person_has_unresolved_sends(p_mandate uuid, p_contact uuid, p_ignored_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_mandate_person_has_unresolved_sends(p_mandate uuid, p_contact uuid, p_ignored_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_mandate_person_has_unresolved_sends(p_mandate uuid, p_contact uuid, p_ignored_operation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_mandate_person_has_unresolved_sends(p_mandate uuid, p_contact uuid, p_ignored_operation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_mandate_person_keys(p_mandate uuid, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_mandate_person_keys(p_mandate uuid, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_mandate_person_keys(p_mandate uuid, p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_mandate_person_keys(p_mandate uuid, p_contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_manual_feedback_source(p_thread uuid, p_kind text, p_entity uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_manual_feedback_source(p_thread uuid, p_kind text, p_entity uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_manual_feedback_source(p_thread uuid, p_kind text, p_entity uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_manual_target_snapshot(p_thread uuid, p_contacts uuid[]); Type: ACL
REVOKE ALL ON FUNCTION public.agent_manual_target_snapshot(p_thread uuid, p_contacts uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_manual_target_snapshot(p_thread uuid, p_contacts uuid[]) TO acquire_agent_user;

-- Name: FUNCTION agent_native_research_status(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_native_research_status(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_native_research_status(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_native_sending_policy(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_native_sending_policy(operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_no_submission_before_invitations(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint); Type: ACL
REVOKE ALL ON FUNCTION public.agent_no_submission_before_invitations(operation uuid, intent uuid, expected_proof_digest text, current_run uuid, current_event uuid, current_lease_owner uuid, current_fence bigint) FROM PUBLIC;

-- Name: FUNCTION agent_operation_authorised(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_operation_authorised(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_operation_authorised(operation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_operation_authorised(operation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_operation_authorised_before_channels(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_channels(operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_operation_authorised_before_history_accounts(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_history_accounts(operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_operation_authorised_before_sending_policy(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_sending_policy(operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_operation_before_company_projection(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_operation_before_company_projection(operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_origin_mandate(p_kind text, p_source uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_origin_mandate(p_kind text, p_source uuid) FROM PUBLIC;

-- Name: FUNCTION agent_owned_target_snapshot(p_thread uuid, p_contacts uuid[]); Type: ACL
REVOKE ALL ON FUNCTION public.agent_owned_target_snapshot(p_thread uuid, p_contacts uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_owned_target_snapshot(p_thread uuid, p_contacts uuid[]) TO acquire_agent_user;

-- Name: FUNCTION agent_people_company_evidence(p_thread uuid, p_targets uuid[]); Type: ACL
REVOKE ALL ON FUNCTION public.agent_people_company_evidence(p_thread uuid, p_targets uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_people_company_evidence(p_thread uuid, p_targets uuid[]) TO acquire_agent_user;

-- Name: FUNCTION agent_people_company_snapshot(p_thread uuid, p_targets uuid[], p_ignore_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_people_company_snapshot(p_thread uuid, p_targets uuid[], p_ignore_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_people_company_snapshot(p_thread uuid, p_targets uuid[], p_ignore_operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_people_company_snapshot_before_company_projection(p_thread uuid, p_targets uuid[], p_ignore_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_people_company_snapshot_before_company_projection(p_thread uuid, p_targets uuid[], p_ignore_operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_person_has_unresolved_sends(contact uuid, ignored_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_person_has_unresolved_sends(contact uuid, ignored_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_person_has_unresolved_sends(contact uuid, ignored_operation uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_person_has_unresolved_sends(contact uuid, ignored_operation uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_person_keys(org text, contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_person_keys(org text, contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_person_keys(org text, contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_person_keys(org text, contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_person_unresolved_before_invitations(contact uuid, ignored_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_person_unresolved_before_invitations(contact uuid, ignored_operation uuid) FROM PUBLIC;

-- Name: FUNCTION agent_prepare_firmable_research(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_prepare_firmable_research(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_prepare_firmable_research(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_prepare_hybrid_native_research(operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_prepare_hybrid_native_research(operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_prepare_hybrid_native_research(operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_public_conversation_facts(conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_public_conversation_facts(conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_public_conversation_facts(conversation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_record_automatic_people_candidates(operation uuid, target uuid, candidates jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_record_automatic_people_candidates(operation uuid, target uuid, candidates jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_record_automatic_people_candidates(operation uuid, target uuid, candidates jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_record_invitation_outcome(p_operation uuid, p_delivery jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_record_invitation_outcome(p_operation uuid, p_delivery jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_record_invitation_outcome(p_operation uuid, p_delivery jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_record_people_candidates(operation uuid, target uuid, candidates jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_record_people_candidates(operation uuid, target uuid, candidates jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_record_people_candidates(operation uuid, target uuid, candidates jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_recorded_binding_digest(p_binding uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_recorded_binding_digest(p_binding uuid) FROM PUBLIC;

-- Name: FUNCTION agent_recorded_demo_route_matches(p_route uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_recorded_demo_route_matches(p_route uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_recorded_demo_route_matches(p_route uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_recorded_demo_route_matches(p_route uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_recorded_reply_execution_scope(p_binding uuid, p_kind text, p_sender text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_recorded_reply_execution_scope(p_binding uuid, p_kind text, p_sender text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_recorded_reply_execution_scope(p_binding uuid, p_kind text, p_sender text) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_recorded_reply_execution_scope(p_binding uuid, p_kind text, p_sender text) TO acquire_campaign_user;

-- Name: FUNCTION agent_recorded_reply_identity_registration(p_thread uuid, p_conversation uuid, p_route uuid, p_binding uuid, p_channel text, p_identity text, p_contact uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_recorded_reply_identity_registration(p_thread uuid, p_conversation uuid, p_route uuid, p_binding uuid, p_channel text, p_identity text, p_contact uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_recorded_reply_identity_registration(p_thread uuid, p_conversation uuid, p_route uuid, p_binding uuid, p_channel text, p_identity text, p_contact uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_recorded_reply_identity_registration(p_thread uuid, p_conversation uuid, p_route uuid, p_binding uuid, p_channel text, p_identity text, p_contact uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_register_channel(p_thread uuid, p_conversation uuid, p_revision integer, p_context text, p_binding uuid, p_channel text, p_kind text, p_value text, p_source jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_register_channel(p_thread uuid, p_conversation uuid, p_revision integer, p_context text, p_binding uuid, p_channel text, p_kind text, p_value text, p_source jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_register_channel(p_thread uuid, p_conversation uuid, p_revision integer, p_context text, p_binding uuid, p_channel text, p_kind text, p_value text, p_source jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_register_runtime(p_thread uuid, p_responsibility_revision integer, p_runtime_id text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_register_runtime(p_thread uuid, p_responsibility_revision integer, p_runtime_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_register_runtime(p_thread uuid, p_responsibility_revision integer, p_runtime_id text) TO acquire_agent_user;

-- Name: FUNCTION agent_registered_review_recovery_scopes(p_max integer, p_runtime_id text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_registered_review_recovery_scopes(p_max integer, p_runtime_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_registered_review_recovery_scopes(p_max integer, p_runtime_id text) TO acquire_agent_worker;

-- Name: FUNCTION agent_registered_worker_scopes(p_max integer, p_runtime_id text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_registered_worker_scopes(p_max integer, p_runtime_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_registered_worker_scopes(p_max integer, p_runtime_id text) TO acquire_agent_worker;

-- Name: FUNCTION agent_release_changed_research_budget(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_release_changed_research_budget() FROM PUBLIC;

-- Name: FUNCTION agent_release_finished_research_budget(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_release_finished_research_budget() FROM PUBLIC;

-- Name: FUNCTION agent_release_research_phase_internal(p_operation uuid, p_reason text); Type: ACL
REVOKE ALL ON FUNCTION public.agent_release_research_phase_internal(p_operation uuid, p_reason text) FROM PUBLIC;

-- Name: FUNCTION agent_reply_causality_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_reply_causality_guard() FROM PUBLIC;

-- Name: FUNCTION agent_research_phase_budget_status(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_research_phase_budget_status(p_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_research_phase_budget_status(p_operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_research_v5_scope(p_input jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_research_v5_scope(p_input jsonb) FROM PUBLIC;

-- Name: FUNCTION agent_reserve_budget(operation uuid, requests jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_reserve_budget(operation uuid, requests jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_reserve_budget(operation uuid, requests jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_reserve_research_phase(p_operation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_reserve_research_phase(p_operation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_reserve_research_phase(p_operation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_review_history_holds_clear(p_conversation uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_review_history_holds_clear(p_conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_review_history_holds_clear(p_conversation uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_route_execution_permitted(p_route uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_route_execution_permitted(p_route uuid) FROM PUBLIC;

-- Name: FUNCTION agent_same_execution_identity_scope(p_left uuid, p_right uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_same_execution_identity_scope(p_left uuid, p_right uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_same_execution_identity_scope(p_left uuid, p_right uuid) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_same_execution_identity_scope(p_left uuid, p_right uuid) TO acquire_campaign_user;

-- Name: FUNCTION agent_save_automatic_people_profile(operation uuid, target uuid, profile jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_save_automatic_people_profile(operation uuid, target uuid, profile jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_save_automatic_people_profile(operation uuid, target uuid, profile jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_save_channel_history(p_route uuid, p_revision integer, p_history jsonb, p_observed timestamp with time zone, p_complete boolean); Type: ACL
REVOKE ALL ON FUNCTION public.agent_save_channel_history(p_route uuid, p_revision integer, p_history jsonb, p_observed timestamp with time zone, p_complete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_save_channel_history(p_route uuid, p_revision integer, p_history jsonb, p_observed timestamp with time zone, p_complete boolean) TO acquire_agent_user;

-- Name: FUNCTION agent_save_channel_policy(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean); Type: ACL
REVOKE ALL ON FUNCTION public.agent_save_channel_policy(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_save_channel_policy(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean) TO acquire_agent_user;

-- Name: FUNCTION agent_save_channel_policy_before_execution_context(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean); Type: ACL
REVOKE ALL ON FUNCTION public.agent_save_channel_policy_before_execution_context(p_thread uuid, p_revision integer, p_order jsonb, p_delay integer, p_bindings jsonb, p_accelerated boolean) FROM PUBLIC;

-- Name: FUNCTION agent_save_people_profile(operation uuid, target uuid, profile jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_save_people_profile(operation uuid, target uuid, profile jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_save_people_profile(operation uuid, target uuid, profile jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_sequence_channel_handover_source(p_thread uuid, p_enrolment uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_sequence_channel_handover_source(p_thread uuid, p_enrolment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_sequence_channel_handover_source(p_thread uuid, p_enrolment uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_sequence_driver_before_company_projection(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer); Type: ACL
REVOKE ALL ON FUNCTION public.agent_sequence_driver_before_company_projection(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer) FROM PUBLIC;

-- Name: FUNCTION agent_sequence_driver_matches(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer); Type: ACL
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_sequence_driver_matches(p_conversation uuid, p_enrolment uuid, p_runtime text, p_generation integer) TO acquire_agent_user;

-- Name: FUNCTION agent_sequence_driver_matches_before_channels(conversation uuid, enrolment uuid, requested_runtime text, requested_generation integer); Type: ACL
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches_before_channels(conversation uuid, enrolment uuid, requested_runtime text, requested_generation integer) FROM PUBLIC;

-- Name: FUNCTION agent_sequence_handover_source(thread uuid, enrolment uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_sequence_handover_source(thread uuid, enrolment uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_sequence_handover_source(thread uuid, enrolment uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_settle_budget(operation uuid, actuals jsonb); Type: ACL
REVOKE ALL ON FUNCTION public.agent_settle_budget(operation uuid, actuals jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_settle_budget(operation uuid, actuals jsonb) TO acquire_agent_user;

-- Name: FUNCTION agent_simulator_window_exception(mandate uuid, binding uuid, binding_hash text, recipient text, at_time timestamp with time zone); Type: ACL
REVOKE ALL ON FUNCTION public.agent_simulator_window_exception(mandate uuid, binding uuid, binding_hash text, recipient text, at_time timestamp with time zone) FROM PUBLIC;

-- Name: FUNCTION agent_sink_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.agent_sink_guard() FROM PUBLIC;

-- Name: FUNCTION agent_target_snapshot(p_thread uuid, p_contacts uuid[]); Type: ACL
REVOKE ALL ON FUNCTION public.agent_target_snapshot(p_thread uuid, p_contacts uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_target_snapshot(p_thread uuid, p_contacts uuid[]) TO acquire_agent_user;

-- Name: FUNCTION agent_target_snapshot_before_company_projection(p_thread uuid, p_contacts uuid[]); Type: ACL
REVOKE ALL ON FUNCTION public.agent_target_snapshot_before_company_projection(p_thread uuid, p_contacts uuid[]) FROM PUBLIC;

-- Name: FUNCTION agent_transfer_research_phase_attempt(p_parent uuid, p_attempt uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_transfer_research_phase_attempt(p_parent uuid, p_attempt uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_transfer_research_phase_attempt(p_parent uuid, p_attempt uuid) TO acquire_agent_user;

-- Name: FUNCTION agent_worker_scopes(maximum integer); Type: ACL
REVOKE ALL ON FUNCTION public.agent_worker_scopes(maximum integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_worker_scopes(maximum integer) TO acquire_agent_worker;

-- Name: FUNCTION agent_worker_scopes_for_mandate(maximum integer, selected_mandate uuid); Type: ACL
REVOKE ALL ON FUNCTION public.agent_worker_scopes_for_mandate(maximum integer, selected_mandate uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_worker_scopes_for_mandate(maximum integer, selected_mandate uuid) TO acquire_agent_worker;

-- Name: FUNCTION communications_policy_statement_fence(); Type: ACL
REVOKE ALL ON FUNCTION public.communications_policy_statement_fence() FROM PUBLIC;

-- Name: FUNCTION communications_resolve_untracked_outbound(p_request uuid, p_binding uuid, p_event text); Type: ACL
REVOKE ALL ON FUNCTION public.communications_resolve_untracked_outbound(p_request uuid, p_binding uuid, p_event text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.communications_resolve_untracked_outbound(p_request uuid, p_binding uuid, p_event text) TO acquire_campaign_user;

-- Name: FUNCTION communications_submission_receipt_guard(); Type: ACL
REVOKE ALL ON FUNCTION public.communications_submission_receipt_guard() FROM PUBLIC;

-- Name: FUNCTION communications_submission_receipt_immutable(); Type: ACL
REVOKE ALL ON FUNCTION public.communications_submission_receipt_immutable() FROM PUBLIC;

-- Name: FUNCTION company_identity_append_only(); Type: ACL
REVOKE ALL ON FUNCTION public.company_identity_append_only() FROM PUBLIC;

-- Name: TABLE agent_operations; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_operations TO acquire_agent_user;

-- Name: FUNCTION local_simulator_operation_business_anchor(p_operation public.agent_operations); Type: ACL
REVOKE ALL ON FUNCTION public.agent_operation_business_anchor(p_operation public.agent_operations) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_operation_business_anchor(p_operation public.agent_operations) TO acquire_agent_user;
GRANT ALL ON FUNCTION public.agent_operation_business_anchor(p_operation public.agent_operations) TO acquire_campaign_user;

-- Name: TABLE agent_authority_grants; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_authority_grants TO acquire_agent_user;

-- Name: TABLE agent_authority_uses; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_authority_uses TO acquire_agent_user;

-- Name: TABLE agent_budget_accounts; Type: ACL
GRANT SELECT ON TABLE public.agent_budget_accounts TO acquire_agent_user;

-- Name: TABLE agent_budget_reservations; Type: ACL
GRANT SELECT ON TABLE public.agent_budget_reservations TO acquire_agent_user;

-- Name: TABLE agent_channel_policies; Type: ACL
GRANT SELECT ON TABLE public.agent_channel_policies TO acquire_agent_user;

-- Name: TABLE agent_conversation_channels; Type: ACL
GRANT SELECT ON TABLE public.agent_conversation_channels TO acquire_agent_user;

-- Name: TABLE agent_conversations; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_conversations TO acquire_agent_user;

-- Name: TABLE agent_demo_contact_mappings; Type: ACL
GRANT SELECT ON TABLE public.agent_demo_contact_mappings TO acquire_agent_user;
GRANT SELECT ON TABLE public.agent_demo_contact_mappings TO acquire_campaign_user;

-- Name: TABLE agent_demo_mapping_receipts; Type: ACL
GRANT SELECT ON TABLE public.agent_demo_mapping_receipts TO acquire_agent_user;
GRANT SELECT ON TABLE public.agent_demo_mapping_receipts TO acquire_campaign_user;

-- Name: TABLE agent_demo_mapping_requests; Type: ACL
GRANT SELECT ON TABLE public.agent_demo_mapping_requests TO acquire_agent_user;
GRANT SELECT ON TABLE public.agent_demo_mapping_requests TO acquire_campaign_user;

-- Name: TABLE agent_demo_runs; Type: ACL
GRANT SELECT ON TABLE public.agent_demo_runs TO acquire_agent_user;
GRANT SELECT ON TABLE public.agent_demo_runs TO acquire_campaign_user;

-- Name: TABLE agent_events; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_events TO acquire_agent_user;

-- Name: TABLE agent_handoffs; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_handoffs TO acquire_agent_user;

-- Name: TABLE agent_linkedin_invitations; Type: ACL
GRANT SELECT ON TABLE public.agent_linkedin_invitations TO acquire_agent_user;

-- Name: TABLE agent_linkedin_relationships; Type: ACL
GRANT SELECT ON TABLE public.agent_linkedin_relationships TO acquire_agent_user;

-- Name: TABLE agent_mandate_execution_modes; Type: ACL
GRANT SELECT ON TABLE public.agent_mandate_execution_modes TO acquire_agent_user;
GRANT SELECT ON TABLE public.agent_mandate_execution_modes TO acquire_campaign_user;

-- Name: TABLE agent_messages; Type: ACL
GRANT SELECT,INSERT ON TABLE public.agent_messages TO acquire_agent_user;

-- Name: SEQUENCE agent_messages_sequence_seq; Type: ACL
GRANT USAGE ON SEQUENCE public.agent_messages_sequence_seq TO acquire_agent_user;

-- Name: TABLE agent_person_claims; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_person_claims TO acquire_agent_user;

-- Name: TABLE agent_research_phase_allocations; Type: ACL
GRANT SELECT ON TABLE public.agent_research_phase_allocations TO acquire_agent_user;

-- Name: TABLE agent_research_phase_budgets; Type: ACL
GRANT SELECT ON TABLE public.agent_research_phase_budgets TO acquire_agent_user;

-- Name: TABLE agent_responsibilities; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_responsibilities TO acquire_agent_user;

-- Name: TABLE agent_review_batches; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_review_batches TO acquire_agent_user;

-- Name: TABLE agent_runs; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_runs TO acquire_agent_user;

-- Name: TABLE agent_runtime_registrations; Type: ACL
GRANT SELECT ON TABLE public.agent_runtime_registrations TO acquire_agent_user;

-- Name: TABLE agent_sink_messages; Type: ACL
GRANT SELECT,INSERT ON TABLE public.agent_sink_messages TO acquire_agent_user;

-- Name: TABLE agent_threads; Type: ACL
GRANT SELECT,INSERT,UPDATE ON TABLE public.agent_threads TO acquire_agent_user;

-- Name: TABLE campaign_contact_holds; Type: ACL
GRANT SELECT ON TABLE public.campaign_contact_holds TO acquire_agent_user;

-- Name: TABLE campaign_enrolments; Type: ACL
GRANT SELECT ON TABLE public.campaign_enrolments TO acquire_agent_user;

-- Name: TABLE campaign_reply_holds; Type: ACL
GRANT SELECT ON TABLE public.campaign_reply_holds TO acquire_agent_user;

-- Name: TABLE campaign_send_attempts; Type: ACL
GRANT SELECT ON TABLE public.campaign_send_attempts TO acquire_agent_user;

-- Name: TABLE campaign_sequence_versions; Type: ACL
GRANT SELECT ON TABLE public.campaign_sequence_versions TO acquire_agent_user;

-- Name: TABLE campaign_sequences; Type: ACL
GRANT SELECT ON TABLE public.campaign_sequences TO acquire_agent_user;

-- Name: TABLE communication_bindings; Type: ACL
GRANT SELECT ON TABLE public.communication_bindings TO acquire_agent_user;

-- Name: TABLE communication_dispatch_intents; Type: ACL
GRANT SELECT ON TABLE public.communication_dispatch_intents TO acquire_agent_user;

-- Name: TABLE communication_dispatch_permits; Type: ACL
GRANT SELECT ON TABLE public.communication_dispatch_permits TO acquire_agent_user;

-- Name: TABLE communication_intent_resolutions; Type: ACL
GRANT SELECT ON TABLE public.communication_intent_resolutions TO acquire_agent_user;

-- Name: TABLE communication_reply_review_latches; Type: ACL
GRANT SELECT ON TABLE public.communication_reply_review_latches TO acquire_agent_user;

-- Name: TABLE communication_submission_receipts; Type: ACL
GRANT SELECT ON TABLE public.communication_submission_receipts TO acquire_agent_user;
GRANT SELECT ON TABLE public.communication_submission_receipts TO acquire_campaign_user;

-- Name: TABLE mandates; Type: ACL
GRANT SELECT ON TABLE public.mandates TO acquire_agent_user;

-- Name: TABLE member; Type: ACL
GRANT SELECT ON TABLE public.member TO acquire_agent_user;

-- Name: TABLE suppressions; Type: ACL
GRANT SELECT ON TABLE public.suppressions TO acquire_agent_user;

-- Remove inherited API roles from new private application objects only.
REVOKE ALL ON TABLE public.agent_authority_grants FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_authority_uses FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_budget_accounts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_budget_reservations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_channel_policies FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_conversation_channels FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_conversations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_demo_contact_mappings FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_demo_mapping_receipts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_demo_mapping_requests FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_demo_runs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_handoffs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_linkedin_invitations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_linkedin_relationships FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_mandate_execution_modes FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_messages FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_operations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_person_claims FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_research_phase_allocations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_research_phase_budgets FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_responsibilities FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_review_batches FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_runs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_runtime_registrations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_sink_messages FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.agent_threads FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.communication_submission_receipts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_identity_accepted_observations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_identity_claims FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_identity_decisions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_identity_observations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_identity_resolutions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_identity_reviews FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.company_membership_projections FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.agent_messages_sequence_seq FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_adopt_sequence_channels(uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_aliases_have_unresolved_sends(uuid[],uuid,boolean) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_allocate_channel_target(uuid,uuid,uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_allowed_mandate_binding(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_automatic_people_target(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_company_continuation(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_control_scope() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_execution_context_scope() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_mandate_outreach_mode(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_manual_mandate_outreach_mode(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_assert_target_allocation(uuid,uuid,uuid,text,text,uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_audit_completed_sequence(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_authority_use_immutable() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_automatic_people_context(uuid,uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_canonical_contact_aliases(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_canonical_json(jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_communications_change(jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_communications_source(uuid,uuid,bigint,bigint,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_due_reassessment(uuid,uuid,integer,timestamp with time zone) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_grant_immutable() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_local_binding(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_local_binding_before_execution_context(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_operation_authorised(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_operation_before_company_projection(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_operation_before_invitations(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_outbound_consumed_turn(uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_execution_context(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_invitations(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted_before_history_quiet(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_record_submission(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_reply_causality(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_reserved_recipient(text,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_channel_source_before_invitations(uuid,uuid,bigint,bigint,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_bounce(uuid,text,text,text,text,text,timestamp with time zone,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_change(uuid,text,text,text,text,text,timestamp with time zone,boolean) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_intent_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_no_submission_before_channels(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_receipt_wake(uuid,uuid,text,text,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_receipt_wake_before_channel_routes(uuid,uuid,text,text,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_source(uuid,uuid,bigint,bigint,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_source_before_reply_parent(uuid,uuid,bigint,bigint,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_communications_source_kind(uuid,uuid,bigint,bigint,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_continuation_job_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_continuation_operation_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_continuation_sources(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_conversation_permitted(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_findings_digest(text,uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_membership_projection(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_company_projection_writer_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_configure_budget(text,text,timestamp with time zone,timestamp with time zone,bigint,integer) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_consume_delegation() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_consume_delegation_before_channels() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_contact_delivery_recipients(jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_contact_identity_batch(text,uuid[]) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_context_revision(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_context_revision_before_channels(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_context_revision_before_company_projection(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_context_revision_before_invitations(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_control_handoff(uuid,uuid,jsonb,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_conversation_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_create_fields_job(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_create_people_job(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_create_research_job(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_current_company_projection(text,uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_delivery_candidate_projection(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_delivery_contact_projection(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_contact_fingerprint(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_evidence_immutable() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_evidence_insert_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_execution_readiness(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_manual_outreach_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_original_effect_identity_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_runtime_ready(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_demo_wire_valid(text,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_driver_allows(text,text,uuid,text,text,uuid,bigint) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_effective_contact(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_email_reply_parent(jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_email_window_open(timestamp with time zone) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_enrol_reviewed_sequence(uuid,uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_event_eligible(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_channel_due(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_event_eligible_before_registry(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_fields_company_snapshot(uuid,uuid,uuid[],uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_fields_current_source(text,uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_fields_job_before_company_projection(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_fields_persistence_permitted(uuid,text,uuid,text,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_fields_snapshot_before_company_projection(uuid,uuid,uuid[],uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_grant_immutable_scope() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_gui_testing_send_window_exempt(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_handoff_assignee_current(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_handoff_context(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_handoff_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_handoff_inbox(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_history_accounts_clear(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_ingest_channel_relationship(uuid,text,text,text,boolean,timestamp with time zone) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_intent_execution_context_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews_before_invitations(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_invitation_before_company_projection(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_invitation_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_invitation_operation_authorised(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_is_demo_origin(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_is_original_demo_source(text,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_legacy_sequence_conflicts(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_legacy_sequence_occupied(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_load_mandate_execution_context(jsonb,text,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_load_mandate_research_context(uuid,text,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_business_completion_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_lock_member() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_lock_send_gate() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_mandate_execution_mode_immutable() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_mandate_identity_scope(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_mandate_legacy_sequence_occupied(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_mandate_outreach_mode_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_mandate_person_has_unresolved_sends(uuid,uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_mandate_person_keys(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_manual_feedback_source(uuid,text,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_manual_target_snapshot(uuid,uuid[]) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_native_research_status(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_native_sending_policy(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_no_submission_before_invitations(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_operation_authorised(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_channels(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_history_accounts(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_sending_policy(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_operation_before_company_projection(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_origin_mandate(text,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_owned_target_snapshot(uuid,uuid[]) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_people_company_evidence(uuid,uuid[]) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_people_company_snapshot(uuid,uuid[],uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_people_company_snapshot_before_company_projection(uuid,uuid[],uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_person_has_unresolved_sends(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_person_keys(text,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_person_unresolved_before_invitations(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_prepare_firmable_research(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_prepare_hybrid_native_research(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_public_conversation_facts(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_record_automatic_people_candidates(uuid,uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_record_invitation_outcome(uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_record_people_candidates(uuid,uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_recorded_binding_digest(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_recorded_demo_route_matches(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_recorded_reply_execution_scope(uuid,text,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_recorded_reply_identity_registration(uuid,uuid,uuid,uuid,text,text,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_register_channel(uuid,uuid,integer,text,uuid,text,text,text,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_register_runtime(uuid,integer,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_registered_review_recovery_scopes(integer,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_registered_worker_scopes(integer,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_release_changed_research_budget() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_release_finished_research_budget() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_release_research_phase_internal(uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_reply_causality_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_research_phase_budget_status(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_research_v5_scope(jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_reserve_budget(uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_reserve_research_phase(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_review_history_holds_clear(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_route_execution_permitted(uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_same_execution_identity_scope(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_save_automatic_people_profile(uuid,uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_save_channel_history(uuid,integer,jsonb,timestamp with time zone,boolean) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_save_channel_policy(uuid,integer,jsonb,integer,jsonb,boolean) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_save_channel_policy_before_execution_context(uuid,integer,jsonb,integer,jsonb,boolean) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_save_people_profile(uuid,uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_sequence_channel_handover_source(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_before_company_projection(uuid,uuid,text,integer) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches_before_channels(uuid,uuid,text,integer) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_sequence_handover_source(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_settle_budget(uuid,jsonb) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_simulator_window_exception(uuid,uuid,text,text,timestamp with time zone) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_sink_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_target_snapshot(uuid,uuid[]) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_target_snapshot_before_company_projection(uuid,uuid[]) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_transfer_research_phase_attempt(uuid,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_worker_scopes(integer) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_worker_scopes_for_mandate(integer,uuid) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.communications_policy_statement_fence() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.communications_resolve_untracked_outbound(uuid,uuid,text) FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.communications_submission_receipt_guard() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.communications_submission_receipt_immutable() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.company_identity_append_only() FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.agent_operation_business_anchor(agent_operations) FROM anon,authenticated,service_role;
CREATE TABLE public.agent_production_schema_migrations(artifact text PRIMARY KEY,installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),source_revision text NOT NULL);
REVOKE ALL ON public.agent_production_schema_migrations FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_agent_worker,acquire_campaign_user,acquire_campaign_worker,acquire_communications_writer;
INSERT INTO public.agent_production_schema_migrations(artifact,source_revision) VALUES('native-agent-baseline-v1','c6e228c');
COMMIT;
