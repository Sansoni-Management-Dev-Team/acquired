-- Preserve all proposal-time duplicate prevention; exempt only the exact HIL operation from its own running-state admission check.
CREATE OR REPLACE FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
