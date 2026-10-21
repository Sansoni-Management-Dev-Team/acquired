-- Forward correction after actual PG SQLSTATE42703: keep binding row b distinct
-- from review-batch SQL alias. Scope, exact approval and atomic allocation unchanged.
CREATE OR REPLACE FUNCTION public.agent_allocate_channel_target(p_thread uuid,p_operation uuid,p_contact uuid,p_source text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 SELECT * INTO c FROM public.contacts WHERE id=p_contact AND organization_id=org FOR SHARE;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=p_contact AND organization_id=org;
 SELECT * INTO r FROM public.agent_responsibilities WHERE id=(snapshot->>'responsibilityId')::uuid AND thread_id=t.id AND state IN('ready','waiting') FOR UPDATE;
 IF r.id IS NULL OR c.id IS NULL OR c.fictionalised IS DISTINCT FROM false OR coalesce(c.personal_data->>'doNotContact','false')<>'false' OR public.agent_legacy_sequence_occupied(c.id) OR public.agent_person_has_unresolved_sends(c.id,NULL) THEN RAISE EXCEPTION 'Permitted unoccupied person required';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(selected->'channels') LOOP
  SELECT * INTO b FROM public.communication_bindings WHERE id::text=x->>'bindingId' AND organization_id=org AND owner_user_id=actor AND channel=x->>'channel' AND authority='service' AND backend='unipile';
  IF b.id IS NULL OR x->>'bindingDigest' IS DISTINCT FROM public.agent_recorded_binding_digest(b.id) OR x->'identityProof' IS DISTINCT FROM jsonb_build_object('kind','recorded_contact','revision',source_revision) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) ref WHERE ref->>'bindingId'=b.id::text AND ref->>'bindingDigest'=x->>'bindingDigest' AND ref->>'channel'=x->>'channel') THEN RAISE EXCEPTION 'Exact current contact and reviewed account generation required';END IF;
 END LOOP;
 x:=selected->'channels'->0;
 SELECT * INTO b FROM public.communication_bindings WHERE id::text=x->>'bindingId';
 email:=CASE WHEN c.personal_data->>'email'~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' THEN lower(btrim(c.personal_data->>'email')) ELSE NULL END;
 INSERT INTO public.agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_id,binding_digest,recipient_email,driver_kind,phase,history_revision,history_complete,history_source)
 VALUES(t.id,org,t.mandate_id,actor,r.id,c.id,'communications',b.id,public.agent_recorded_binding_digest(b.id),email,'agent','active',encode(sha256(convert_to('[]','UTF8')),'hex'),false,'unavailable') RETURNING * INTO v;
 FOREACH key IN ARRAY public.agent_person_keys(org,c.id) LOOP
  INSERT INTO public.agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES(org,key,v.id,actor);
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(selected->'channels') LOOP
  context_hash:=public.agent_context_revision(v.id);
  PERFORM public.agent_register_channel(t.id,v.id,v.revision,context_hash,(x->>'bindingId')::uuid,x->>'channel',x->'recipient'->>'kind',x->'recipient'->>'value',x->'identityProof');
  SELECT * INTO v FROM public.agent_conversations WHERE id=v.id;
 END LOOP;
 RETURN jsonb_build_object('id',v.id,'revision',v.revision,'epoch',v.epoch,'reminderGeneration',v.reminder_generation);
END $$;
REVOKE ALL ON FUNCTION public.agent_allocate_channel_target(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_allocate_channel_target(uuid,uuid,uuid,text) TO acquire_agent_user;
