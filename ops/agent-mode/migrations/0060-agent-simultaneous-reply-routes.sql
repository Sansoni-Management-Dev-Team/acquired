-- Reply routes at the same newest verified timestamp are alternatives for one
-- person-level answer. Preserve invitation, source, ownership and effect wrappers.
-- No schema/data/grant expansion; do not edit applied predecessors.
CREATE OR REPLACE FUNCTION public.agent_channel_proposal_before_invitations(p_route uuid,p_stage text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;latest_in jsonb;latest_out jsonb;reply_candidate jsonb;person_out jsonb;last_sent record;next_index integer;source_revision text;
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
 IF latest_in IS NOT NULL AND p_stage='reply' THEN
  -- A simultaneous inbound is selectable only on its original verified route
  -- at the person's maximum incoming timestamp. Hash order is not a preference.
  SELECT value INTO reply_candidate FROM jsonb_array_elements(r.history)
   WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=(latest_in->>'at')::timestamptz
   ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF reply_candidate IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=reply_candidate)
   OR (CASE WHEN reply_candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id ELSE reply_candidate->>'routeId' IS DISTINCT FROM r.id::text OR reply_candidate->>'channel' IS DISTINCT FROM r.channel OR reply_candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  -- A real answer on any recorded route consumes this simultaneous reply turn.
  SELECT value INTO person_out FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  RETURN person_out IS NULL OR (person_out->>'at')::timestamptz<(reply_candidate->>'at')::timestamptz;
 END IF;
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
REVOKE ALL ON FUNCTION public.agent_channel_proposal_before_invitations(uuid,text) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
