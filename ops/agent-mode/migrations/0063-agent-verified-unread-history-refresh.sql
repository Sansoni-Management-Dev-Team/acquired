-- A boolean proof for a human-requested, read-only account history refresh.
-- No send/reassessment authority, hold clearing or inferred message timestamp.
CREATE FUNCTION public.agent_review_history_holds_clear(p_conversation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);c public.agent_conversations%ROWTYPE;person public.contacts%ROWTYPE;h public.campaign_reply_holds%ROWTYPE;identities text[];matched boolean;verified integer:=0;source_revision text;
BEGIN
 IF current_setting('role',true)<>'acquire_agent_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current history review scope required';END IF;
 SELECT * INTO c FROM public.agent_conversations WHERE id=p_conversation AND organization_id=org AND owner_user_id=actor;
 IF c.id IS NULL OR c.driver_kind<>'agent' OR c.pending_driver IS NOT NULL OR NOT(c.phase='active' OR c.phase='held' AND c.pause_reason='human_review_required') OR c.engagement IN('stopped','handoff') OR c.delivery_mode<>'communications' THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='inbound' AND m->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 SELECT * INTO person FROM public.contacts WHERE id=c.contact_id AND organization_id=org AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false';
 IF person.id IS NULL THEN RETURN false;END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id AND organization_id=org;
 identities:=public.agent_person_keys(org,c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.organization_id=org AND x.id<>c.contact_id AND 'contact:'||x.id::text=ANY(identities)) THEN RETURN false;END IF;
 IF public.agent_person_has_unresolved_sends(c.contact_id,NULL::uuid) OR public.agent_legacy_sequence_occupied(c.contact_id)
 OR EXISTS(SELECT 1 FROM public.agent_operations WHERE conversation_id=c.id AND state IN('running','uncertain'))
 OR EXISTS(SELECT 1 FROM public.agent_handoffs WHERE conversation_id=c.id AND state<>'dismissed')
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(c.recipient_email) OR lower(s.domain)=split_part(lower(c.recipient_email),'@',2) OR EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(lower(r.recipient_value),'@',2))))) THEN RETURN false;END IF;
 -- The read must still address every current, explicitly recorded account and
 -- unchanged canonical contact. Staleness/incompleteness is what it will repair.
 IF NOT EXISTS(SELECT 1 FROM public.agent_channel_policies p WHERE p.thread_id=c.thread_id AND cardinality(p.channel_order)=(SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id))
 OR NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels WHERE conversation_id=c.id)
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels r LEFT JOIN public.communication_bindings b ON b.id=r.binding_id LEFT JOIN public.agent_channel_policies p ON p.thread_id=r.thread_id WHERE r.conversation_id=c.id AND (b.id IS NULL OR b.organization_id IS DISTINCT FROM org OR b.owner_user_id IS DISTINCT FROM actor OR b.authority IS DISTINCT FROM 'service' OR b.backend IS DISTINCT FROM 'unipile' OR b.channel IS DISTINCT FROM r.channel OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) OR r.identity_source->>'revision' IS DISTINCT FROM source_revision OR p.thread_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'channel'=r.channel AND x->>'bindingId'=r.binding_id::text AND x->>'bindingDigest'=r.binding_digest) OR (CASE r.channel WHEN 'email' THEN lower(btrim(person.personal_data->>'email')) WHEN 'whatsapp' THEN person.personal_data->>'phone' ELSE regexp_replace(person.personal_data->>'linkedinUrl','/$','') END) IS DISTINCT FROM r.recipient_value)) THEN RETURN false;END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.agent_review_history_holds_clear(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_review_history_holds_clear(uuid) TO acquire_agent_user;
