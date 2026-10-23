-- No general audit table privilege: write only the server-derived receipt of an
-- exactly reviewed, completed owned sequence draft/publication in this tenant.
CREATE FUNCTION agent_audit_completed_sequence(p_operation uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
REVOKE ALL ON FUNCTION agent_audit_completed_sequence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_audit_completed_sequence(uuid) TO acquire_agent_user;
