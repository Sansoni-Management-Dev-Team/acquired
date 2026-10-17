-- LinkedIn invitation effects remain separately human-reviewed.
-- Original action receipts are distinct from messages and relationship acceptance.
CREATE TABLE public.agent_linkedin_relationships(
 route_id uuid PRIMARY KEY REFERENCES public.agent_conversation_channels(id),conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id),
 thread_id uuid NOT NULL REFERENCES public.agent_threads(id),organization_id text NOT NULL REFERENCES public.organization(id),owner_user_id text NOT NULL REFERENCES public."user"(id),
 binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),identity_revision text NOT NULL CHECK(identity_revision~'^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN('connected','invitation_pending','not_connected','unknown')),can_message boolean,observed_at timestamptz NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(status='connected' AND can_message IS TRUE OR status='invitation_pending' AND can_message IS FALSE OR status='not_connected' AND can_message IS NOT TRUE OR status='unknown' AND can_message IS NULL)
);
CREATE TABLE public.agent_linkedin_invitations(
 operation_id uuid PRIMARY KEY REFERENCES public.agent_operations(id),route_id uuid NOT NULL REFERENCES public.agent_conversation_channels(id),conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id),thread_id uuid NOT NULL REFERENCES public.agent_threads(id),
 organization_id text NOT NULL REFERENCES public.organization(id),owner_user_id text NOT NULL REFERENCES public."user"(id),binding_digest text NOT NULL CHECK(binding_digest~'^[a-f0-9]{64}$'),identity_revision text NOT NULL CHECK(identity_revision~'^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('unknown','pending','accepted','not_submitted')),provider_operation_id text,submitted_at timestamptz,intent_id uuid REFERENCES public.communication_dispatch_intents(id),
 accepted_observed_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(state IN('unknown','not_submitted') AND provider_operation_id IS NULL AND submitted_at IS NULL OR state IN('pending','accepted') AND provider_operation_id IS NOT NULL AND length(provider_operation_id) BETWEEN 1 AND 2048 AND submitted_at IS NOT NULL AND intent_id IS NOT NULL),
 CHECK(state<>'accepted' OR accepted_observed_at IS NOT NULL)
);
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['agent_linkedin_relationships','agent_linkedin_invitations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT ON public.%I TO acquire_agent_user',name);
  EXECUTE format('CREATE POLICY agent_invitation_owned_read ON public.%I FOR SELECT TO acquire_agent_user USING(organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
  EXECUTE format('CREATE POLICY agent_invitation_definer ON public.%I TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',name,name,name);
  EXECUTE format('CREATE TRIGGER agent_invitation_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate()',name);
 END LOOP;
END $$;
CREATE FUNCTION public.agent_ingest_channel_relationship(p_route uuid,p_binding_digest text,p_identity_revision text,p_status text,p_can_message boolean,p_observed_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;old public.agent_linkedin_relationships%ROWTYPE;saved public.agent_linkedin_relationships%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 IF r.id IS NULL OR r.channel<>'linkedin' OR r.binding_digest IS DISTINCT FROM p_binding_digest OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) OR r.identity_revision IS DISTINCT FROM p_identity_revision OR p_status IS NULL OR p_observed_at IS NULL OR p_observed_at>clock_timestamp() OR p_observed_at<clock_timestamp()-interval '5 minutes'
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
REVOKE ALL ON FUNCTION public.agent_ingest_channel_relationship(uuid,text,text,text,boolean,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_ingest_channel_relationship(uuid,text,text,text,boolean,timestamptz) TO acquire_agent_user;
CREATE FUNCTION public.agent_record_invitation_outcome(p_operation uuid,p_delivery jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;prior public.agent_linkedin_invitations%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND name='linkedin.invitation' FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND thread_id=o.thread_id;
 IF o.id IS NULL OR r.id IS NULL OR r.channel<>'linkedin' OR r.binding_digest IS DISTINCT FROM o.input->>'bindingDigest' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR o.result->'delivery' IS DISTINCT FROM p_delivery
 OR NOT EXISTS(SELECT 1 FROM public.agent_authority_uses a WHERE a.operation_id=o.id AND a.grant_id IS NULL AND a.review_batch_id IS NOT NULL AND a.operation_digest=o.input_digest AND a.operation_revision=o.revision AND a.operation_fence=o.fence AND a.binding_digest=r.binding_digest AND a.state IN('settled','uncertain')) THEN RAISE EXCEPTION 'Original human-reviewed invitation authority and outcome required';END IF;
 IF p_delivery->>'status'='submitted' THEN
  IF o.state<>'complete' OR p_delivery->>'effect' IS DISTINCT FROM 'invitation' OR p_delivery->>'providerOperationId' IS NULL OR p_delivery->>'intentId' IS NULL OR length(p_delivery->>'providerOperationId') NOT BETWEEN 1 AND 2048 OR p_delivery->>'submittedAt' IS NULL OR (p_delivery->>'submittedAt')::timestamptz>clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits p ON p.intent_id=i.id WHERE i.id::text=p_delivery->>'intentId' AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id AND i.source_kind='agent' AND i.source_id=o.id AND i.binding_id=r.binding_id AND i.operation='invitation') THEN RAISE EXCEPTION 'Exact original admitted invitation action receipt required';END IF;
 ELSIF p_delivery IS DISTINCT FROM '{"status":"unknown"}'::jsonb OR o.state<>'uncertain' THEN RAISE EXCEPTION 'Conservative invitation outcome required';END IF;
 SELECT * INTO prior FROM public.agent_linkedin_invitations WHERE operation_id=o.id FOR UPDATE;
 IF prior.operation_id IS NOT NULL AND (prior.route_id<>r.id OR prior.binding_digest<>r.binding_digest OR prior.identity_revision<>r.identity_revision OR prior.state<>'unknown' AND (p_delivery->>'status'<>'submitted' OR prior.provider_operation_id IS DISTINCT FROM p_delivery->>'providerOperationId' OR prior.intent_id::text IS DISTINCT FROM p_delivery->>'intentId' OR prior.submitted_at IS DISTINCT FROM (p_delivery->>'submittedAt')::timestamptz)) THEN RAISE EXCEPTION 'Original invitation outcome is immutable';END IF;
 INSERT INTO public.agent_linkedin_invitations(operation_id,route_id,conversation_id,thread_id,organization_id,owner_user_id,binding_digest,identity_revision,state,provider_operation_id,submitted_at,intent_id)
 VALUES(o.id,r.id,r.conversation_id,r.thread_id,r.organization_id,r.owner_user_id,r.binding_digest,r.identity_revision,CASE WHEN p_delivery->>'status'='submitted' THEN 'pending' ELSE 'unknown' END,p_delivery->>'providerOperationId',(p_delivery->>'submittedAt')::timestamptz,(p_delivery->>'intentId')::uuid)
 ON CONFLICT(operation_id) DO UPDATE SET state=CASE WHEN agent_linkedin_invitations.state='accepted' THEN 'accepted' ELSE EXCLUDED.state END,provider_operation_id=EXCLUDED.provider_operation_id,submitted_at=EXCLUDED.submitted_at,intent_id=EXCLUDED.intent_id,updated_at=clock_timestamp();
 PERFORM public.agent_assert_control_scope();
END $$;
REVOKE ALL ON FUNCTION public.agent_record_invitation_outcome(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_record_invitation_outcome(uuid,jsonb) TO acquire_agent_user;
ALTER FUNCTION public.agent_channel_proposal_permitted(uuid,text) RENAME TO agent_channel_proposal_before_invitations;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_invitations(uuid,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_channel_proposal_permitted(p_route uuid,p_stage text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;relationship public.agent_linkedin_relationships%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF r.id IS NULL THEN RETURN false;END IF;
 IF r.channel<>'linkedin' THEN RETURN public.agent_channel_proposal_before_invitations(p_route,p_stage);END IF;
 SELECT * INTO relationship FROM public.agent_linkedin_relationships WHERE route_id=r.id AND binding_digest=r.binding_digest AND identity_revision=r.identity_revision;
 IF relationship.route_id IS NULL OR relationship.observed_at>clock_timestamp() OR relationship.observed_at<clock_timestamp()-interval '5 minutes' THEN RETURN false;END IF;
 IF p_stage='invitation' THEN
  IF relationship.status<>'not_connected' OR relationship.can_message IS TRUE OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations WHERE route_id=r.id AND state IN('unknown','pending','accepted')) OR EXISTS(SELECT 1 FROM public.agent_operations WHERE conversation_id=r.conversation_id AND name='linkedin.invitation' AND state IN('running','uncertain','complete')) THEN RETURN false;END IF;
  RETURN public.agent_channel_proposal_before_invitations(p_route,'initial');
 END IF;
 IF relationship.status<>'connected' OR relationship.can_message IS DISTINCT FROM true THEN RETURN false;END IF;
 RETURN public.agent_channel_proposal_before_invitations(p_route,p_stage);
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_proposal_permitted(uuid,text) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_context_revision(uuid) RENAME TO agent_context_revision_before_invitations;
REVOKE ALL ON FUNCTION public.agent_context_revision_before_invitations(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_context_revision(p_conversation uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base text;relationships jsonb;
BEGIN
 base:=public.agent_context_revision_before_invitations(p_conversation);
 SELECT jsonb_agg(jsonb_build_object('routeId',route_id,'bindingDigest',binding_digest,'identityRevision',identity_revision,'status',status,'canMessage',can_message,'revision',revision) ORDER BY route_id) INTO relationships FROM public.agent_linkedin_relationships WHERE conversation_id=p_conversation;
 IF relationships IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(jsonb_build_object('base',base,'relationships',relationships)::text,'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public.agent_context_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_context_revision(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_invalidate_person_reviews(uuid) RENAME TO agent_invalidate_person_reviews_before_invitations;
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews_before_invitations(uuid) FROM PUBLIC;
CREATE FUNCTION public.agent_invalidate_person_reviews(p_conversation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.agent_invalidate_person_reviews_before_invitations(p_conversation);
 UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=p_conversation AND name='linkedin.invitation' AND state IN('proposed','approved');
 UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=item->>'operationId' WHERE o.conversation_id=p_conversation AND o.name='linkedin.invitation' AND o.state='failed' AND o.result->>'reason'='context_changed');
END $$;
REVOKE ALL ON FUNCTION public.agent_invalidate_person_reviews(uuid) FROM PUBLIC;

CREATE FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage IS DISTINCT FROM 'invitation' OR r.channel<>'linkedin' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>300 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
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
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NOT NULL OR a.review_batch_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=o.id)<>4 THEN RETURN false;END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $$;
REVOKE ALL ON FUNCTION public.agent_invitation_operation_authorised(uuid) FROM PUBLIC;
ALTER FUNCTION public.agent_channel_operation_authorised(uuid) RENAME TO agent_channel_operation_before_invitations;
REVOKE ALL ON FUNCTION public.agent_channel_operation_before_invitations(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_channel_operation_authorised(p_operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.agent_operations WHERE id=p_operation AND name='linkedin.invitation' AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)) THEN RETURN public.agent_invitation_operation_authorised(p_operation);END IF;
 RETURN public.agent_channel_operation_before_invitations(p_operation);
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_channel_communications_source(uuid,uuid,bigint,bigint,uuid) RENAME TO agent_channel_source_before_invitations;
REVOKE ALL ON FUNCTION public.agent_channel_source_before_invitations(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC,acquire_campaign_user;
CREATE FUNCTION public.agent_channel_communications_source(operation uuid,conversation uuid,expected_epoch bigint,expected_fence bigint,binding uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
REVOKE ALL ON FUNCTION public.agent_channel_communications_source(uuid,uuid,bigint,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_communications_source(uuid,uuid,bigint,bigint,uuid) TO acquire_campaign_user;
CREATE OR REPLACE FUNCTION public.agent_communications_intent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
REVOKE ALL ON FUNCTION public.agent_communications_intent_guard() FROM PUBLIC;

CREATE FUNCTION public.agent_invitation_no_submission(operation uuid,intent uuid DEFAULT NULL,expected_proof_digest text DEFAULT NULL,current_run uuid DEFAULT NULL,current_event uuid DEFAULT NULL,current_lease_owner uuid DEFAULT NULL,current_fence bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.agent_invitation_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM PUBLIC;
ALTER FUNCTION public.agent_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) RENAME TO agent_no_submission_before_invitations;
REVOKE ALL ON FUNCTION public.agent_no_submission_before_invitations(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_communications_no_submission(operation uuid,intent uuid DEFAULT NULL,expected_proof_digest text DEFAULT NULL,current_run uuid DEFAULT NULL,current_event uuid DEFAULT NULL,current_lease_owner uuid DEFAULT NULL,current_fence bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.agent_operations WHERE id=operation AND name='linkedin.invitation' AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)) THEN RETURN public.agent_invitation_no_submission(operation,intent,expected_proof_digest,current_run,current_event,current_lease_owner,current_fence);END IF;
 RETURN public.agent_no_submission_before_invitations(operation,intent,expected_proof_digest,current_run,current_event,current_lease_owner,current_fence);
END $$;
REVOKE ALL ON FUNCTION public.agent_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_communications_no_submission(uuid,uuid,text,uuid,uuid,uuid,bigint) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_person_has_unresolved_sends(uuid,uuid) RENAME TO agent_person_unresolved_before_invitations;
REVOKE ALL ON FUNCTION public.agent_person_unresolved_before_invitations(uuid,uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_person_has_unresolved_sends(contact uuid,ignored_operation uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE aliases uuid[];
BEGIN
 IF public.agent_person_unresolved_before_invitations(contact,ignored_operation) THEN RETURN true;END IF;
 aliases:=public.agent_canonical_contact_aliases(contact);
 RETURN EXISTS(SELECT 1 FROM public.agent_operations o JOIN public.agent_conversations c ON c.id=o.conversation_id AND c.organization_id=o.organization_id WHERE o.organization_id=current_setting('app.acquire_org',true) AND c.contact_id=ANY(aliases) AND o.name='linkedin.invitation' AND o.state IN('running','uncertain') AND o.id IS DISTINCT FROM ignored_operation);
END $$;
REVOKE ALL ON FUNCTION public.agent_person_has_unresolved_sends(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_person_has_unresolved_sends(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
