-- Separately reviewed company selection for bounded email contact enrichment.
CREATE FUNCTION agent_people_company_snapshot(p_thread uuid,p_targets uuid[] DEFAULT NULL,p_ignore_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mr text;c record;items jsonb:='[]';reasons jsonb;source text;findings jsonb;aliases uuid[];
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
  IF c.assessment->>'stage' IN('contacted','in-conversation') OR EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(aliases)) OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(aliases) AND x.state='sent') OR EXISTS(SELECT 1 FROM public.campaign_inbound_events e WHERE e.organization_id=org AND e.contact_id=ANY(aliases)) OR EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND claim.identity_key=ANY(public.agent_person_keys(org,p.id)))) THEN reasons:=reasons||'"previous_outreach_or_owned_company"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND (coalesce(p.personal_data->>'doNotContact','false')<>'false' OR public.agent_person_has_unresolved_sends(p.id,NULL::uuid))) OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(regexp_replace(s.domain,'^www[.]',''))=lower(regexp_replace(c.domain,'^www[.]','')) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND lower(s.address)=lower(p.personal_data->>'email')))) THEN reasons:=reasons||'"suppressed_or_unresolved"'::jsonb;END IF;
  IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(aliases) AND NOT p.fictionalised AND coalesce(p.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AND (p_ignore_operation IS NULL OR p.provenance->>'nativePeopleOperationId' IS DISTINCT FROM p_ignore_operation::text)) THEN reasons:=reasons||'"usable_cached_contact"'::jsonb;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'evidence',f.evidence,'observedAt',f.observed_at) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT * FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.id ORDER BY observed_at DESC,id LIMIT 20)f;
  source:=encode(sha256(convert_to(jsonb_build_object('target',c.source_xmin,'membership',c.membership_version,'assessment',c.assessment,'findings',findings)::text,'UTF8')),'hex');
  items:=items||jsonb_build_array(jsonb_build_object('targetId',c.id,'name',left(c.company_name,300),'firmableId',coalesce(c.firmable_company_id,''),'sourceRevision',source,'blockedReasons',reasons));
 END LOOP;
 RETURN jsonb_build_object('mandateRevision',mr,'responsibilityId',r.id,'responsibilityRevision',r.revision,'companies',items);
END $$;
REVOKE ALL ON FUNCTION agent_people_company_snapshot(uuid,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_people_company_snapshot(uuid,uuid[],uuid) TO acquire_agent_user;
CREATE FUNCTION agent_create_people_job(operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
REVOKE ALL ON FUNCTION agent_create_people_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_create_people_job(uuid) TO acquire_agent_user;
CREATE FUNCTION agent_record_people_candidates(operation uuid,target uuid,candidates jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;job uuid;existing jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.people' AND state='running';
 IF o.id IS NULL OR jsonb_array_length(candidates)>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(candidates) p WHERE p!~'^fp[0-9]+$') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.input->'selected') s WHERE s->>'targetId'=target::text) THEN RAISE EXCEPTION 'Approved bounded people candidates required';END IF;
 job:=(o.input->'config'->>'requestId')::uuid;
 SELECT config->'nativePeopleCandidates'->target::text INTO existing FROM public.research_jobs WHERE id=job AND organization_id=org FOR UPDATE;
 IF existing IS NOT NULL AND existing IS DISTINCT FROM candidates THEN RAISE EXCEPTION 'Saved candidate selection changed';END IF;
 UPDATE public.research_jobs SET config=config||jsonb_build_object('nativePeopleCandidates',coalesce(config->'nativePeopleCandidates','{}')||jsonb_build_object(target::text,candidates)),updated_at=now() WHERE id=job AND organization_id=org;
END $$;
REVOKE ALL ON FUNCTION agent_record_people_candidates(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_record_people_candidates(uuid,uuid,jsonb) TO acquire_agent_user;
CREATE FUNCTION agent_save_people_profile(operation uuid,target uuid,profile jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;
REVOKE ALL ON FUNCTION agent_save_people_profile(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_save_people_profile(uuid,uuid,jsonb) TO acquire_agent_user;

-- Count persisted scoped entities, never stale or malformed JSON pointers.
CREATE OR REPLACE FUNCTION agent_native_research_status(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('jobId',j.id,'status',j.status,'nativeAgent',j.config->'nativeAgent','updatedAt',j.updated_at,
 'companies',(SELECT count(DISTINCT t.id) FROM public.research_jobs child JOIN public.targets t ON t.id::text=child.config->>'targetId' AND t.organization_id=org AND t.mandate_id=o.mandate_id WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.config->>'parentJobId'=j.id::text),
 'contacts',(SELECT count(*) FROM public.contacts c WHERE c.organization_id=org AND c.mandate_id=o.mandate_id AND EXISTS(SELECT 1 FROM public.research_jobs child JOIN public.targets t ON t.id=c.target_id AND t.id::text=child.config->>'targetId' AND t.organization_id=org AND t.mandate_id=o.mandate_id WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.config->>'parentJobId'=j.id::text))) INTO result
 FROM public.agent_operations o JOIN public.research_jobs j ON j.id=(o.input->'config'->>'requestId')::uuid
 WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND ((o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1') OR (o.name='research.people' AND o.input->>'nativePeoplePlanVersion'='1'))
 AND j.organization_id=org AND j.mandate_id=o.mandate_id AND j.created_by=actor AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 RETURN result;
END $$;
