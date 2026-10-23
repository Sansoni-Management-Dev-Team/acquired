-- One person/conversation/owner; account-specific routes are immutable children.
-- Legacy email rows and original n8n definitions are not rewritten/backfilled.
CREATE TABLE public.agent_channel_policies(
 thread_id uuid PRIMARY KEY REFERENCES public.agent_threads(id),organization_id text NOT NULL REFERENCES public.organization(id),
 owner_user_id text NOT NULL REFERENCES public."user"(id),mandate_id uuid NOT NULL REFERENCES public.mandates(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),channel_order text[] NOT NULL CHECK(cardinality(channel_order) BETWEEN 1 AND 3),
 delay_seconds integer NOT NULL CHECK(delay_seconds BETWEEN 3 AND 31622400),bindings jsonb NOT NULL CHECK(jsonb_typeof(bindings)='array' AND jsonb_array_length(bindings) BETWEEN 1 AND 3),
 accelerated_simulation boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(accelerated_simulation AND delay_seconds BETWEEN 3 AND 60 OR NOT accelerated_simulation AND delay_seconds>=86400)
);
CREATE TABLE public.agent_conversation_channels(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id),
 organization_id text NOT NULL REFERENCES public.organization(id),owner_user_id text NOT NULL REFERENCES public."user"(id),
 thread_id uuid NOT NULL REFERENCES public.agent_threads(id),mandate_id uuid NOT NULL REFERENCES public.mandates(id),
 channel text NOT NULL CHECK(channel IN('email','whatsapp','linkedin')),binding_id uuid NOT NULL,
 binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),recipient_kind text NOT NULL CHECK(recipient_kind IN('email','phone','linkedin_profile')),
 recipient_value text NOT NULL CHECK(length(recipient_value) BETWEEN 3 AND 500),identity_source jsonb NOT NULL,
 identity_revision text NOT NULL CHECK(identity_revision~'^[a-f0-9]{64}$'),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 history jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(history)='array' AND jsonb_array_length(history)<=200),
 history_revision text NOT NULL,history_complete boolean NOT NULL DEFAULT false,history_observed_at timestamptz,
 next_allowed_at timestamptz,cold_cancelled_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(conversation_id,channel),FOREIGN KEY(binding_id,organization_id,owner_user_id,channel) REFERENCES public.communication_bindings(id,organization_id,owner_user_id,channel),
 CHECK(channel='email' AND recipient_kind='email' OR channel='whatsapp' AND recipient_kind='phone' OR channel='linkedin' AND recipient_kind='linkedin_profile')
);
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['agent_channel_policies','agent_conversation_channels'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT ON public.%I TO acquire_agent_user',name);
  EXECUTE format('CREATE POLICY agent_channel_owned_read ON public.%I FOR SELECT TO acquire_agent_user USING(organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
  EXECUTE format('CREATE POLICY agent_channel_definer ON public.%I TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',name,name,name);
  EXECUTE format('CREATE TRIGGER agent_channel_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate()',name);
 END LOOP;
END $$;
CREATE FUNCTION public.agent_channel_canonical_json(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result text;
BEGIN
 IF jsonb_typeof(v)='object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.agent_channel_canonical_json(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);RETURN result;
 ELSIF jsonb_typeof(v)='array' THEN SELECT '['||coalesce(string_agg(public.agent_channel_canonical_json(value),',' ORDER BY ordinality),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY;RETURN result;
 ELSE RETURN v::text;END IF;
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_canonical_json(jsonb) FROM PUBLIC;
CREATE FUNCTION public.agent_recorded_binding_digest(p_binding uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('applicationId',application_id,'tenantId',organization_id,'ownerId',owner_user_id,'connectionId',service_connection_id,'accountId',service_account_id,'generation',generation,'channel',channel,'platform',platform,'backend',backend)),'UTF8')),'hex') FROM public.communication_bindings WHERE id=p_binding;
$$;
REVOKE ALL ON FUNCTION public.agent_recorded_binding_digest(uuid) FROM PUBLIC;
-- Local acceleration is separately bounded to the current mock integration,
-- actual owned/current service generation and reserved synthetic identities.
CREATE FUNCTION public.agent_channel_local_binding(p_binding uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result boolean;
BEGIN
 IF current_database()<>'acquire_agent_mode' OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR current_setting('app.acquire_channel_simulation',true) IS DISTINCT FROM 'true' OR current_setting('app.acquire_runtime_id',true) IS DISTINCT FROM 'agent-multichannel-20261017' OR to_regclass('communications.connection_generations') IS NULL THEN RETURN false;END IF;
 SELECT EXISTS(SELECT 1 FROM public.communication_bindings b JOIN communications.connections c ON c.id=b.service_connection_id AND c.application_id=b.application_id AND c.tenant_id=b.organization_id AND c.owner_id=b.owner_user_id AND c.account_id=b.service_account_id AND c.current_generation=b.generation AND c.channel=b.channel AND c.platform=b.platform AND c.backend=b.backend AND c.active AND c.status='connected'
 JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation AND g.integration_id='sim-agent-multichannel-20261017' AND g.provider_configuration_reference='sim-agent-multichannel-20261017-v1' AND g.provider_api_version='v1' AND g.authority='service'
 WHERE b.id=p_binding AND b.organization_id=current_setting('app.acquire_org',true) AND b.owner_user_id=current_setting('app.acquire_user',true) AND b.authority='service' AND b.backend='unipile') INTO result;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_local_binding(uuid) FROM PUBLIC;
CREATE FUNCTION public.agent_channel_reserved_recipient(p_channel text,p_value text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE p_channel WHEN 'email' THEN p_value~'^lead-[0-9]{3}@agent-multichannel-20261017[.]leads[.]acquire[.]test$'
 WHEN 'whatsapp' THEN p_value~'^[+]999[0-9]{12}$'
 WHEN 'linkedin' THEN p_value~'^https://www[.]linkedin[.]com/in/sim-agent-multichannel-20261017-lead-[0-9]{3}$' ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.agent_channel_reserved_recipient(text,text) FROM PUBLIC;
CREATE FUNCTION public.agent_invalidate_person_reviews(p_conversation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp()
 WHERE conversation_id=p_conversation AND name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up') AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=item->>'operationId' WHERE o.conversation_id=p_conversation AND o.state='failed' AND o.result->>'reason'='context_changed');
END $$;
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews(uuid) FROM PUBLIC;
CREATE FUNCTION public.agent_save_channel_policy(p_thread uuid,p_revision integer,p_order jsonb,p_delay integer,p_bindings jsonb,p_accelerated boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.agent_save_channel_policy(uuid,integer,jsonb,integer,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_save_channel_policy(uuid,integer,jsonb,integer,jsonb,boolean) TO acquire_agent_user;

CREATE FUNCTION public.agent_register_channel(p_thread uuid,p_conversation uuid,p_revision integer,p_context text,p_binding uuid,p_channel text,p_kind text,p_value text,p_source jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.agent_threads%ROWTYPE;conv public.agent_conversations%ROWTYPE;person public.contacts%ROWTYPE;source_revision text;policy public.agent_channel_policies%ROWTYPE;binding public.communication_bindings%ROWTYPE;route public.agent_conversation_channels%ROWTYPE;identity_hash text;keys text[];key text;notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=p_conversation AND thread_id=t.id FOR UPDATE;
 IF conv.id IS NULL OR p_revision IS NULL OR conv.revision<>p_revision OR public.agent_context_revision(conv.id) IS DISTINCT FROM p_context OR conv.driver_kind<>'agent' OR conv.phase<>'active' OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Current owned person context required';END IF;
 SELECT * INTO policy FROM public.agent_channel_policies WHERE thread_id=t.id;
 SELECT * INTO binding FROM public.communication_bindings WHERE id=p_binding AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id AND channel=p_channel AND application_id='acquire' AND authority='service' AND backend='unipile';
 IF binding.id IS NULL OR policy.thread_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(policy.bindings) x WHERE x->>'bindingId'=binding.id::text AND x->>'channel'=p_channel AND x->>'bindingDigest'=public.agent_recorded_binding_digest(binding.id)) THEN RAISE EXCEPTION 'Exact reviewed policy account required';END IF;
 SELECT * INTO person FROM public.contacts WHERE id=conv.contact_id AND organization_id=t.organization_id FOR SHARE;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id;
 IF person.id IS NULL OR person.fictionalised IS DISTINCT FROM false OR coalesce(person.personal_data->>'doNotContact','false')<>'false' OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_source))<>2 OR p_source->>'kind' IS DISTINCT FROM 'recorded_contact' OR p_source->>'revision' IS DISTINCT FROM source_revision THEN RAISE EXCEPTION 'Current explicitly reviewed contact identity required';END IF;
 IF NOT coalesce(CASE p_channel WHEN 'email' THEN p_kind='email' AND p_value=lower(btrim(person.personal_data->>'email')) AND p_value~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$'
 WHEN 'whatsapp' THEN p_kind='phone' AND p_value=person.personal_data->>'phone' AND p_value~'^[+][1-9][0-9]{6,14}$'
 WHEN 'linkedin' THEN p_kind='linkedin_profile' AND p_value=person.personal_data->>'linkedinUrl' AND p_value~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END,false) THEN RAISE EXCEPTION 'Exact canonical recipient differs from reviewed contact';END IF;
 IF policy.accelerated_simulation AND (NOT public.agent_channel_local_binding(binding.id) OR NOT public.agent_channel_reserved_recipient(p_channel,p_value)) THEN RAISE EXCEPTION 'Accelerated route must use the exact reserved simulation identity';END IF;
 IF public.agent_person_has_unresolved_sends(person.id,NULL) THEN RAISE EXCEPTION 'Original unresolved sends must be reconciled before adding a route';END IF;
 identity_hash:=encode(sha256(convert_to(jsonb_build_object('contactId',person.id,'sourceRevision',source_revision,'channel',p_channel,'recipientKind',p_kind,'recipient',p_value,'bindingDigest',public.agent_recorded_binding_digest(binding.id))::text,'UTF8')),'hex');
 SELECT * INTO route FROM public.agent_conversation_channels WHERE conversation_id=conv.id AND channel=p_channel;
 IF route.id IS NOT NULL THEN
  IF route.binding_id<>binding.id OR route.recipient_value<>p_value OR route.identity_revision<>identity_hash THEN RAISE EXCEPTION 'Recorded route identity/account is immutable; review a reconciled replacement';END IF;RETURN jsonb_build_object('id',route.id,'revision',route.revision);
 END IF;
 INSERT INTO public.agent_conversation_channels(conversation_id,organization_id,owner_user_id,thread_id,mandate_id,channel,binding_id,binding_digest,recipient_kind,recipient_value,identity_source,identity_revision,history_revision,next_allowed_at)
 VALUES(conv.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,p_channel,binding.id,public.agent_recorded_binding_digest(binding.id),p_kind,p_value,p_source,identity_hash,encode(sha256(convert_to('[]','UTF8')),'hex'),clock_timestamp()+((array_position(policy.channel_order,p_channel)-1)*policy.delay_seconds)*interval '1 second') RETURNING * INTO route;
 keys:=ARRAY[p_channel||':'||p_value];
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
END $$;
REVOKE ALL ON FUNCTION public.agent_register_channel(uuid,uuid,integer,text,uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_register_channel(uuid,uuid,integer,text,uuid,text,text,text,jsonb) TO acquire_agent_user;

ALTER FUNCTION public.agent_context_revision(uuid) RENAME TO agent_context_revision_before_channels;
REVOKE ALL ON FUNCTION public.agent_context_revision_before_channels(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_context_revision(p_conversation uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base text;frame jsonb;
BEGIN
 base:=public.agent_context_revision_before_channels(p_conversation);
 SELECT jsonb_build_object('policy',jsonb_build_object('revision',p.revision,'order',p.channel_order,'delay',p.delay_seconds,'bindings',p.bindings,'simulation',p.accelerated_simulation),'routes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'binding',r.binding_digest,'identity',r.identity_revision,'history',r.history_revision,'complete',r.history_complete,'nextAllowedAt',r.next_allowed_at,'coldCancelledAt',r.cold_cancelled_at) ORDER BY r.id) FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id),'[]')) INTO frame
 FROM public.agent_conversations c JOIN public.agent_channel_policies p ON p.thread_id=c.thread_id WHERE c.id=p_conversation AND c.organization_id=current_setting('app.acquire_org',true) AND c.owner_user_id=current_setting('app.acquire_user',true);
 IF frame IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,frame)),'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public.agent_context_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_context_revision(uuid) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_channel_proposal_permitted(p_route uuid,p_stage text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;latest_in jsonb;latest_out jsonb;last_sent record;next_index integer;source_revision text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel proposal scope required';END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=r.thread_id;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_stage IS NULL OR p_stage NOT IN('initial','reply','follow_up') OR c.phase<>'active' OR c.driver_kind<>'agent' OR c.engagement IN('handoff','stopped') OR NOT c.history_complete OR c.history_source<>'communications' THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities WHERE id=c.responsibility_id AND state IN('ready','waiting')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'bindingId'=r.binding_id::text AND x->>'channel'=r.channel AND x->>'bindingDigest'=r.binding_digest) OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND (NOT x.history_complete OR x.history_observed_at IS NULL OR x.history_observed_at>clock_timestamp() OR x.history_observed_at<clock_timestamp()-interval '5 minutes')) OR (SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id)<>cardinality(p.channel_order) THEN RETURN false;END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=c.contact_id AND organization_id=c.organization_id AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false';
 IF source_revision IS NULL OR r.identity_source->>'revision' IS DISTINCT FROM source_revision THEN RETURN false;END IF;
 IF p.accelerated_simulation AND (NOT public.agent_channel_local_binding(r.binding_id) OR NOT public.agent_channel_reserved_recipient(r.channel,r.recipient_value)) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 SELECT value INTO latest_out FROM jsonb_array_elements(r.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL THEN
  -- A reply permanently cancels cold touches on every route. Warm follow-up
  -- may only remain on this latest verified incoming route after its answer.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) x WHERE x->>'id'=latest_in->>'id' AND x->>'direction'='inbound' AND x->>'text'=latest_in->>'text' AND (x->>'at')::timestamptz=(latest_in->>'at')::timestamptz)
  OR (CASE WHEN latest_in->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id ELSE latest_in->>'routeId' IS DISTINCT FROM r.id::text OR latest_in->>'channel' IS DISTINCT FROM r.channel OR latest_in->>'bindingDigest' IS DISTINCT FROM r.binding_digest END)
  OR p_stage='initial' THEN RETURN false;END IF;
  IF p_stage='reply' THEN RETURN latest_out IS NULL OR (latest_out->>'at')::timestamptz<(latest_in->>'at')::timestamptz;END IF;
  RETURN latest_out IS NOT NULL AND (latest_out->>'at')::timestamptz>(latest_in->>'at')::timestamptz AND r.next_allowed_at IS NOT NULL AND r.next_allowed_at<=clock_timestamp();
 END IF;
 IF r.cold_cancelled_at IS NOT NULL OR c.engagement<>'cold' OR p_stage='reply' OR r.next_allowed_at IS NULL OR r.next_allowed_at>clock_timestamp() THEN RETURN false;END IF;
 SELECT o.input->>'routeId' AS route_id,greatest((o.result->'delivery'->>'submittedAt')::timestamptz,o.updated_at) AS updated_at INTO last_sent FROM public.agent_operations o WHERE o.conversation_id=c.id AND o.state='complete' AND o.result->'delivery'->>'status'='submitted' ORDER BY o.updated_at DESC,o.id DESC LIMIT 1;
 IF last_sent.route_id IS NULL THEN next_index:=1;
 ELSE SELECT coalesce(array_position(p.channel_order,x.channel),0)%cardinality(p.channel_order)+1 INTO next_index FROM public.agent_conversation_channels x WHERE x.id::text=last_sent.route_id AND x.conversation_id=c.id;
  IF next_index IS NULL OR clock_timestamp()<last_sent.updated_at+make_interval(secs=>p.delay_seconds) THEN RETURN false;END IF;
 END IF;
 IF p.channel_order[next_index]<>r.channel THEN RETURN false;END IF;
 RETURN CASE p_stage WHEN 'initial' THEN latest_out IS NULL WHEN 'follow_up' THEN latest_out IS NOT NULL ELSE false END;
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) TO acquire_agent_user,acquire_campaign_user;

CREATE FUNCTION public.agent_save_channel_history(p_route uuid,p_revision integer,p_history jsonb,p_observed timestamptz,p_complete boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;message jsonb;history_hash text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id FOR UPDATE;
 IF r.id IS NULL OR p_revision IS NULL OR r.revision<>p_revision OR p_observed IS NULL OR p_observed>clock_timestamp() OR p_observed<r.history_observed_at OR p_complete IS NULL OR jsonb_typeof(p_history) IS DISTINCT FROM 'array' OR jsonb_array_length(p_history)>200 OR octet_length(p_history::text)>1500000 THEN RAISE EXCEPTION 'Current bounded original-account history required';END IF;
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
REVOKE ALL ON FUNCTION public.agent_save_channel_history(uuid,integer,jsonb,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_save_channel_history(uuid,integer,jsonb,timestamptz,boolean) TO acquire_agent_user;

-- Exact routed authority is checked again under the organisation/person gate
-- immediately before creating a physical communications permit.
CREATE FUNCTION public.agent_channel_operation_authorised(p_operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;g public.agent_authority_grants%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
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
 OR public.agent_person_has_unresolved_sends(c.contact_id,o.id) THEN RETURN false;END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_operation_authorised(uuid) RENAME TO agent_operation_authorised_before_channels;
REVOKE ALL ON FUNCTION public.agent_operation_authorised_before_channels(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_operation_authorised(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.agent_operations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF o.id IS NULL THEN RETURN false;END IF;
 IF o.input ? 'routeId' THEN RETURN public.agent_channel_operation_authorised(operation);END IF;
 IF o.name<>'email.manual_link' AND EXISTS(SELECT 1 FROM public.agent_channel_policies WHERE thread_id=o.thread_id) THEN RETURN false;END IF;
 RETURN public.agent_operation_authorised_before_channels(operation);
END $$;
REVOKE ALL ON FUNCTION public.agent_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;

-- Existing grants retain their exact email scope; new grants select one channel
-- and explicit immutable route IDs. Invitations are deliberately excluded.
ALTER TABLE public.agent_authority_grants ADD COLUMN route_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(route_ids)='array' AND jsonb_array_length(route_ids)<=200);
ALTER TABLE public.agent_authority_grants DROP CONSTRAINT agent_authority_grants_channel_check;
ALTER TABLE public.agent_authority_grants ADD CONSTRAINT agent_authority_grants_channel_check CHECK(channel IN('email','whatsapp','linkedin'));
ALTER TABLE public.agent_authority_grants DROP CONSTRAINT agent_authority_grants_actions_check;
ALTER TABLE public.agent_authority_grants ADD CONSTRAINT agent_authority_grants_actions_check CHECK(jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 3 AND CASE channel WHEN 'email' THEN actions<@'["initial_email","reply_email","follow_up_email"]'::jsonb WHEN 'whatsapp' THEN jsonb_array_length(route_ids)>0 AND actions<@'["initial_whatsapp","reply_whatsapp","follow_up_whatsapp"]'::jsonb WHEN 'linkedin' THEN jsonb_array_length(route_ids)>0 AND actions<@'["initial_linkedin","reply_linkedin","follow_up_linkedin"]'::jsonb ELSE false END);
CREATE FUNCTION public.agent_channel_grant_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN IF NEW.route_ids IS DISTINCT FROM OLD.route_ids THEN RAISE EXCEPTION 'Exact approved routes are immutable';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.agent_channel_grant_immutable() FROM PUBLIC;
CREATE TRIGGER agent_channel_grant_scope BEFORE UPDATE ON public.agent_authority_grants FOR EACH ROW EXECUTE FUNCTION public.agent_channel_grant_immutable();
ALTER FUNCTION public.agent_consume_delegation() RENAME TO agent_consume_delegation_before_channels;
REVOKE ALL ON FUNCTION public.agent_consume_delegation_before_channels() FROM PUBLIC;
CREATE FUNCTION public.agent_consume_delegation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
REVOKE ALL ON FUNCTION public.agent_consume_delegation() FROM PUBLIC;
DROP TRIGGER agent_consume_delegation ON public.agent_authority_uses;
CREATE TRIGGER agent_consume_delegation AFTER INSERT ON public.agent_authority_uses FOR EACH ROW EXECUTE FUNCTION public.agent_consume_delegation();

CREATE FUNCTION public.agent_communications_source_kind(operation uuid,conversation uuid,expected_epoch bigint,expected_fence bigint,binding uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
REVOKE ALL ON FUNCTION public.agent_communications_source_kind(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_source_kind(uuid,uuid,bigint,bigint,uuid) TO acquire_campaign_user;
CREATE FUNCTION public.agent_channel_communications_source(operation uuid,conversation uuid,expected_epoch bigint,expected_fence bigint,binding uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;parent jsonb;peer jsonb;coverage jsonb;latest jsonb;stage text;
BEGIN
 IF public.agent_communications_source_kind(operation,conversation,expected_epoch,expected_fence,binding) IS DISTINCT FROM 'recorded_channel' OR NOT public.agent_operation_authorised(operation) THEN RETURN NULL;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation;
 SELECT * INTO c FROM public.agent_conversations WHERE id=conversation;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId';stage:=split_part(o.name,'.',2);
 SELECT jsonb_agg(jsonb_build_object('bindingId',x.binding_id,'channel',x.channel,'recipient',jsonb_build_object('kind',x.recipient_kind,'value',x.recipient_value)) ORDER BY x.channel) INTO coverage FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id;
 IF stage<>'initial' THEN
  SELECT value INTO latest FROM jsonb_array_elements(r.history) WHERE coalesce(value->>'providerMessageId',value->>'id') IS NOT NULL ORDER BY (value->>'direction'='inbound') DESC,(value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF latest IS NULL THEN RETURN NULL;END IF;
  IF r.channel='email' THEN parent:=jsonb_build_object('id',coalesce(latest->>'providerMessageId',latest->>'id'),'contentDigest',encode(sha256(convert_to(coalesce(latest->>'subject','')||E'\n'||(latest->>'text'),'UTF8')),'hex'));
  ELSE IF coalesce(latest->>'providerConversationId','')='' THEN RETURN NULL;END IF;peer:=jsonb_build_object('id',latest->>'providerConversationId');END IF;
 ELSIF jsonb_array_length(r.history)>0 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('routeId',r.id,'channel',r.channel,'contactId',c.contact_id,'recipient',jsonb_build_object('kind',r.recipient_kind,'value',r.recipient_value),'subject',o.input->>'subject','body',o.input->>'body','contextDigest',o.input_digest,'requiredSince','1970-01-01T00:00:00.000Z','replyParent',parent,'conversation',peer,'coverageRoutes',coverage);
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_communications_source(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_communications_source(uuid,uuid,bigint,bigint,uuid) TO acquire_campaign_user;
-- Preserve the existing intent table's source guard while selecting the exact
-- proof kernel by saved operation metadata, never by client-supplied channel.
CREATE OR REPLACE FUNCTION public.agent_communications_intent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.agent_operations%ROWTYPE;proof jsonb;kind text;
BEGIN
 IF NEW.source_kind<>'agent' THEN RETURN NEW;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=NEW.source_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Current native source required';END IF;
 kind:=public.agent_communications_source_kind(o.id,o.conversation_id,(o.input->>'epoch')::bigint,o.fence,NEW.binding_id);
 IF kind='recorded_channel' THEN proof:=public.agent_channel_communications_source(o.id,o.conversation_id,(o.input->>'epoch')::bigint,o.fence,NEW.binding_id);
 ELSIF kind='legacy_email' THEN proof:=public.agent_communications_source(o.id,o.conversation_id,(o.input->>'epoch')::bigint,o.fence,NEW.binding_id);END IF;
 IF proof IS NULL OR proof->>'contactId' IS DISTINCT FROM NEW.contact_id::text OR NEW.operation<>'message' THEN RAISE EXCEPTION 'Current native source required';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_intent_guard() FROM PUBLIC;

-- Stored human-reviewed phone/profile identities participate in the same owner
-- claims before any route is opened. Opaque provider aliases only enter through
-- authenticated recorded reply identity registration, never guessed from names.
CREATE OR REPLACE FUNCTION public.agent_person_keys(org text,contact uuid) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result text[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR org IS DISTINCT FROM current_setting('app.acquire_org',true) OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held canonical identity scope required';END IF;
 SELECT array_agg(DISTINCT key ORDER BY key) INTO result FROM(
 SELECT 'contact:'||c.id::text key FROM public.contacts c WHERE c.id=contact AND c.organization_id=org
 UNION SELECT 'email:'||lower(btrim(c.personal_data->>'email')) FROM public.contacts c WHERE c.id=contact AND c.organization_id=org AND length(btrim(c.personal_data->>'email'))>0
 UNION SELECT 'firmable:'||c.firmable_person_id FROM public.contacts c WHERE c.id=contact AND c.organization_id=org AND c.firmable_person_id IS NOT NULL
 UNION SELECT 'whatsapp:'||(c.personal_data->>'phone') FROM public.contacts c WHERE c.id=contact AND c.organization_id=org AND c.personal_data->>'phone'~'^[+][1-9][0-9]{6,14}$'
 UNION SELECT 'linkedin:'||regexp_replace(c.personal_data->>'linkedinUrl','/$','') FROM public.contacts c WHERE c.id=contact AND c.organization_id=org AND c.personal_data->>'linkedinUrl'~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$'
 UNION SELECT i.channel||':'||i.identity FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.contact_id=contact AND length(i.identity)>0
 UNION SELECT i.channel||':'||i.source_identity FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.contact_id=contact AND length(i.source_identity)>0
 ) x WHERE length(key) BETWEEN 3 AND 400;
 IF result IS NULL THEN RAISE EXCEPTION 'Canonical contact not found';END IF;
 -- Include existing contact claims for aliases which were allocated before
 -- phone/profile keys existed. No historical claim row is rewritten.
 SELECT array_agg(DISTINCT key ORDER BY key) INTO result FROM(SELECT unnest(result) key UNION SELECT 'contact:'||x.id::text FROM public.contacts x WHERE x.organization_id=org AND ('email:'||lower(btrim(x.personal_data->>'email'))=ANY(result) OR 'firmable:'||x.firmable_person_id=ANY(result) OR x.personal_data->>'phone'~'^[+][1-9][0-9]{6,14}$' AND 'whatsapp:'||(x.personal_data->>'phone')=ANY(result) OR x.personal_data->>'linkedinUrl'~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' AND 'linkedin:'||regexp_replace(x.personal_data->>'linkedinUrl','/$','')=ANY(result) OR EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.contact_id=x.id AND (i.channel||':'||i.identity=ANY(result) OR i.channel||':'||i.source_identity=ANY(result))))) expanded;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.agent_canonical_contact_aliases(p_contact uuid) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);keys text[];result uuid[];
BEGIN
 keys:=public.agent_person_keys(org,p_contact);
 SELECT array_agg(DISTINCT p.id ORDER BY p.id) INTO result FROM public.contacts p WHERE p.organization_id=org AND (
 'contact:'||p.id::text=ANY(keys) OR 'email:'||lower(btrim(p.personal_data->>'email'))=ANY(keys) OR 'firmable:'||p.firmable_person_id=ANY(keys)
 OR p.personal_data->>'phone'~'^[+][1-9][0-9]{6,14}$' AND 'whatsapp:'||(p.personal_data->>'phone')=ANY(keys)
 OR p.personal_data->>'linkedinUrl'~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' AND 'linkedin:'||regexp_replace(p.personal_data->>'linkedinUrl','/$','')=ANY(keys)
 OR EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.contact_id=p.id AND (i.channel||':'||i.identity=ANY(keys) OR i.channel||':'||i.source_identity=ANY(keys))));RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_canonical_contact_aliases(uuid) FROM PUBLIC;

-- The next cold step is anchored to positive original-receipt materialisation,
-- never registration/approval time. Provider timestamps may precede observation;
-- the conservative observation floor prevents a late ACK from collapsing waits.
CREATE FUNCTION public.agent_channel_record_submission(p_operation uuid) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;anchor timestamptz;due timestamptz;next_channel text;latest_in timestamptz;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND binding_digest=o.input->>'bindingDigest';
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF o.id IS NULL OR r.id IS NULL OR p.thread_id IS NULL OR o.state<>'complete' OR o.result->'delivery'->>'status' IS DISTINCT FROM 'submitted' OR NOT EXISTS(SELECT 1 FROM public.agent_authority_uses a WHERE a.operation_id=o.id AND a.state='settled' AND a.binding_digest=r.binding_digest) OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits v ON v.intent_id=i.id WHERE i.source_kind='agent' AND i.source_id=o.id AND i.binding_id=r.binding_id AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id) THEN RAISE EXCEPTION 'Positive original admitted routed receipt required';END IF;
 anchor:=greatest((o.result->'delivery'->>'submittedAt')::timestamptz,o.updated_at);IF anchor IS NULL OR anchor>clock_timestamp() THEN RAISE EXCEPTION 'Original submitted timestamp required';END IF;
 due:=anchor+make_interval(secs=>p.delay_seconds);
 SELECT max((value->>'at')::timestamptz) INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound';
 IF latest_in IS NULL AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels WHERE conversation_id=c.id AND cold_cancelled_at IS NOT NULL) THEN
  next_channel:=p.channel_order[array_position(p.channel_order,r.channel)%cardinality(p.channel_order)+1];
  UPDATE public.agent_conversation_channels SET next_allowed_at=CASE WHEN channel=next_channel THEN due ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id;
 ELSE
  UPDATE public.agent_conversation_channels SET next_allowed_at=CASE WHEN id=r.id THEN due ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id;
 END IF;RETURN due;
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_record_submission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_record_submission(uuid) TO acquire_agent_user;
