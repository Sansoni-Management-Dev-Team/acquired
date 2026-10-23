-- Exact approved, bounded email enrolment. This capability only creates the
-- existing initial-conversation hold; it grants no campaign update/send power.
CREATE FUNCTION agent_enrol_reviewed_sequence(p_thread uuid,p_operation uuid,p_contact uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;
REVOKE ALL ON FUNCTION agent_enrol_reviewed_sequence(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_enrol_reviewed_sequence(uuid,uuid,uuid) TO acquire_agent_user;
