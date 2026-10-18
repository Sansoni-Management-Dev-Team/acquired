-- Tenant-scoped cached target facts and source tokens; no global cache or send tool.
CREATE FUNCTION agent_target_snapshot(p_thread uuid,p_contacts uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
  ids:=public.agent_person_keys(org,c.id);
  SELECT array_agg(p.id) INTO aliases FROM public.contacts p WHERE p.organization_id=org AND public.agent_person_keys(org,p.id)&&ids;
  reasons:='[]';
  IF c.fictionalised OR coalesce(c.personal_data->>'doNotContact','false')<>'false' THEN reasons:=reasons||'"contact_not_admissible"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts a WHERE a.id=ANY(aliases) AND (lower(s.address)=lower(btrim(a.personal_data->>'email')) OR lower(s.domain)=split_part(lower(btrim(a.personal_data->>'email')),'@',2)))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND coalesce(p.personal_data->>'doNotContact','false')<>'false') THEN reasons:=reasons||'"suppressed"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.agent_person_claims k WHERE k.organization_id=org AND k.identity_key=ANY(ids)) THEN reasons:=reasons||'"conversation_already_owned"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases) AND e.state IN('active','paused','needs_review')) THEN reasons:=reasons||'"structured_sequence_owner"'::jsonb;END IF;
  IF public.agent_person_has_unresolved_sends(c.id,NULL::uuid) THEN reasons:=reasons||'"unresolved_send"'::jsonb;END IF;
  IF c.assessment->>'stage' IN('contacted','in-conversation') OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id WHERE a.organization_id=org AND e.contact_id=ANY(aliases) AND (a.state='sent' OR a.sent_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM public.campaign_inbound_events x WHERE x.organization_id=org AND x.contact_id=ANY(aliases)) THEN reasons:=reasons||'"previously_contacted"'::jsonb;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'jobId',f.job_id,'targetId',f.target_id,'sourceUrl',f.source_url,'observedAt',f.observed_at,'evidence',f.evidence,'confidence',f.confidence) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT * FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.target_id ORDER BY observed_at DESC,id LIMIT 20)f;
  source:=encode(sha256(convert_to(jsonb_build_object('contact',c.contact_revision,'target',c.target_revision,'membership',c.membership_version,'assessment',c.assessment,'findings',findings)::text,'UTF8')),'hex');
  items:=items||jsonb_build_array(jsonb_build_object('contactId',c.id,'targetId',c.target_id,'name',c.display_name,'email',coalesce(c.personal_data->>'email',''),'sourceRevision',source,'assessment',c.assessment,'findings',findings,'blockedReasons',reasons,'identityKeys',to_jsonb(ids),
   'target',jsonb_build_object('id',c.target_id,'organizationId',org,'companyName',c.company_name,'domain',c.domain,'identifiers',c.identifiers,'firmographics',c.firmographics,'status',c.target_status,'qualification',c.qualification,'fitScore',c.fit_score,'ripenessScore',c.ripeness_score,'financeabilityScore',c.financeability_score,'confidenceScore',c.confidence_score,'band',c.band)));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mandate_revision,'responsibilityId',r.id,'responsibilityRevision',r.revision,'brief',m.filters->'brief','candidates',items,'companies',(SELECT count(*) FROM public.mandate_targets WHERE organization_id=org AND mandate_id=t.mandate_id),'contacts',(SELECT count(*) FROM public.contacts p JOIN public.mandate_targets mt ON mt.target_id=p.target_id AND mt.organization_id=p.organization_id WHERE p.organization_id=org AND mt.mandate_id=t.mandate_id));
END $$;
REVOKE ALL ON FUNCTION agent_target_snapshot(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_target_snapshot(uuid,uuid[]) TO acquire_agent_user;
CREATE FUNCTION agent_assert_target_allocation(p_thread uuid,p_operation uuid,p_contact uuid,p_source text,p_mode text,p_binding uuid,p_binding_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.agent_operations%ROWTYPE;snapshot jsonb;candidate jsonb;selected jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=p_operation AND thread_id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND name='target.select' AND state IN('approved','running');
 IF op.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=p_thread AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact current target approval required'; END IF;
 SELECT item INTO selected FROM jsonb_array_elements(op.input->'selected') item WHERE item->>'contactId'=p_contact::text AND item->>'sourceRevision'=p_source;
 IF selected IS NULL THEN RAISE EXCEPTION 'Contact not in approved selection'; END IF;
 snapshot:=public.agent_target_snapshot(p_thread,ARRAY[p_contact]);
 IF snapshot->>'mandateRevision' IS DISTINCT FROM op.input->>'mandateRevision' OR snapshot->>'responsibilityId' IS DISTINCT FROM op.input->>'responsibilityId' OR snapshot->>'responsibilityRevision' IS DISTINCT FROM op.input->>'responsibilityRevision' THEN RAISE EXCEPTION 'Target supervision changed'; END IF;
 candidate:=snapshot->'candidates'->0;
 IF candidate IS NULL OR candidate->>'sourceRevision' IS DISTINCT FROM p_source OR jsonb_array_length(candidate->'blockedReasons')<>0 THEN RAISE EXCEPTION 'Target contact evidence or ownership needs review'; END IF;
 IF p_mode IS DISTINCT FROM op.input->'delivery'->>'mode' THEN RAISE EXCEPTION 'Approved delivery mode changed'; END IF;
 IF p_mode='communications' THEN
  IF p_binding::text IS DISTINCT FROM op.input->'delivery'->>'bindingId' OR p_binding_digest IS DISTINCT FROM op.input->'delivery'->>'bindingDigest' THEN RAISE EXCEPTION 'Approved email account changed'; END IF;
 ELSIF p_mode<>'local_sink' OR p_binding IS NOT NULL THEN RAISE EXCEPTION 'Explicit delivery mode required'; END IF;
END $$;
REVOKE ALL ON FUNCTION agent_assert_target_allocation(uuid,uuid,uuid,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_assert_target_allocation(uuid,uuid,uuid,text,text,uuid,text) TO acquire_agent_user;
