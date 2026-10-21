-- PREPARED ONLY. Fresh V5 initial review authorizes bounded basic People after
-- accepted company persistence. Historical V4 and standalone People remain exact.
-- No new tables, no inherited approvals, no phone or outreach authority.
-- Discovery holds USD11; People independently reserve USD1 per physical attempt
-- against the existing six accounts, retaining unknown original reservations.
CREATE FUNCTION public.agent_research_v5_scope(p_input jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(p_input->>'nativeResearchPlanVersion'='1'
 AND p_input->'providerPolicy'='{"version":3,"callAdmission":"per_request","usdAdmission":"company_phase_people_per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"1000000","search":"1000000","page":"1000000","ai":"1000000"},"firmableCompanyRequestCeilingMicroUsd":"0","pricingBasis":"configured_company_plus_metered_people","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
 AND p_input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":true}'::jsonb
 AND p_input->'config'->'companyDiscoveryPolicy'='{"version":5,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":false},"automaticPeople":{"version":1,"maxCompanies":800,"maxSearchPagesPerCompany":1,"searchPageSize":50,"maxContactsPerCompany":3,"includePhones":false}}'::jsonb
 AND p_input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
 AND NOT(p_input->'config' ? 'companyOnly') AND NOT(p_input->'config' ? 'companyContinuation')
 AND p_input->'config'->'targetBusinesses'='20'::jsonb
 AND p_input->'config'->'findPeople'='false'::jsonb
 AND p_input->'config'->'includeCompanyPeople'='true'::jsonb
 AND p_input->'config'->'includePhones'='false'::jsonb
 AND p_input->'config'->'budget'->'maxMinutes'='15'::jsonb
 AND coalesce(p_input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false)
$$;
REVOKE ALL ON FUNCTION public.agent_research_v5_scope(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.agent_prepare_hybrid_native_research(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;scope_count integer;company_v4 boolean;company_v5 boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state IN('approved','running') FOR UPDATE;
 company_v5:=o.name='research.start' AND public.agent_research_v5_scope(o.input);
 company_v4:=coalesce(o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
  AND o.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND o.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND o.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND o.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND o.input->'config'->'companyOnly'='true'::jsonb AND o.input->'config'->'targetBusinesses'='20'::jsonb
  AND o.input->'config'->'findPeople'='false'::jsonb AND o.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND o.input->'config'->'includePhones'='false'::jsonb AND o.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(o.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND NOT company_v5 AND (o.input->'providerPolicy'->>'version' IN('2','3') OR o.input->'config'->'companyDiscoveryPolicy'->>'version' IN('4','5')) THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF NOT company_v4 AND NOT company_v5 THEN IF o.id IS NULL OR o.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1' OR o.input->'providerPolicy'->>'version' IS DISTINCT FROM '1' OR o.input->'execution'->>'productionPipeline' IS DISTINCT FROM 'hybrid-firmable-v1' OR o.input->'config'->>'targetBusinesses' IS DISTINCT FROM '20' OR o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' OR o.input->'providerPolicy'->'maxAttempts' IS DISTINCT FROM '{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb OR o.input->'execution'->>'pipeline' IS DISTINCT FROM 'hybrid-company-v1' OR o.input->'execution'->>'backgroundResearch' IS DISTINCT FROM 'false' OR o.input->'execution'->>'peopleResearch' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reviewed supported research execution plan required';END IF; END IF;
 PERFORM 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision FOR SHARE OF r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF j.id IS NULL OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 IF company_v4 AND (j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config->>'companyOnly' IS DISTINCT FROM 'true' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'false') THEN RAISE EXCEPTION 'Saved company-only job scope changed';END IF;
 IF company_v5 AND (j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config ? 'companyOnly' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Saved combined research scope changed';END IF;
 IF j.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1' THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id) a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('pipelineDesign','hybrid-firmable-v1','findPeople',false,'includeCompanyPeople',company_v5,'parallelBusinessResearch',false,'automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+CASE WHEN company_v4 OR company_v5 THEN 900000 ELSE 600000 END),'{nativeAgent,providerAdmission}','"hybrid-company-v1"'::jsonb),message=CASE WHEN company_v5 THEN 'Approved company and basic People research ready; phone reveal and outreach require separate review' ELSE 'Approved native hybrid company research ready; background fields and people require separate review' END,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);
END $$;

CREATE OR REPLACE FUNCTION public.agent_reserve_research_phase(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;j public.research_jobs%ROWTYPE;a public.agent_budget_accounts%ROWTYPE;entry record;count_scopes integer:=0;calls bigint;usd bigint;n integer;deadline timestamptz;accounts uuid[]:='{}';shortfalls jsonb:='[]';needed bigint;company_v4 boolean;company_v5 boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Approved owned research phase required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision) THEN RAISE EXCEPTION 'Current research phase supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research phase approval required';END IF;
 company_v5:=o.name='research.start' AND public.agent_research_v5_scope(o.input);
 company_v4:=coalesce(o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
  AND o.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND o.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND o.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND o.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND o.input->'config'->'companyOnly'='true'::jsonb AND o.input->'config'->'targetBusinesses'='20'::jsonb
  AND o.input->'config'->'findPeople'='false'::jsonb AND o.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND o.input->'config'->'includePhones'='false'::jsonb AND o.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(o.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND NOT company_v5 AND (o.input->'providerPolicy'->>'version' IN('2','3') OR o.input->'config'->'companyDiscoveryPolicy'->>'version' IN('4','5')) THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF company_v4 OR company_v5 THEN calls:=24035;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'  AND o.input->'execution'->>'productionPipeline'='hybrid-firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb THEN calls:=71;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->'execution'->>'productionPipeline'='firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":5,"firmable":60}'::jsonb THEN calls:=76;
 ELSIF o.name='research.people' AND o.input->>'nativePeoplePlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":0,"page":0,"ai":0,"firmable":60}'::jsonb THEN calls:=60;
 ELSIF o.name='research.fields' AND o.input->>'nativeFieldsPlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":60,"page":320,"ai":0,"firmable":0}'::jsonb AND o.input->'providerPolicy'->'perCompany'='{"search":12,"page":64}'::jsonb THEN n:=jsonb_array_length(o.input->'selected');IF n IS NULL OR n NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Exact bounded public-field selection required';END IF;calls:=n*76;
 ELSE RAISE EXCEPTION 'Frozen physical research policy required';END IF;
 IF o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' THEN RAISE EXCEPTION 'Frozen request reservation ceiling required';END IF;usd:=CASE WHEN company_v4 OR company_v5 THEN 11000000 ELSE calls*1000000 END;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=o.id FOR UPDATE;
 IF p.operation_id IS NOT NULL THEN IF p.input_digest IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Research funding belongs to another manifest';END IF;RETURN public.agent_research_phase_budget_status(o.id);END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') THEN RAISE EXCEPTION 'Saved unfinished research job required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations child WHERE child.thread_id=o.thread_id AND child.input->>'researchOperationId'=o.id::text AND child.name IN('research.provider','research.worker_dispatch')) THEN RAISE EXCEPTION 'Original research attempts require reconciliation before phase funding';END IF;
 deadline:=clock_timestamp()+CASE WHEN company_v4 OR company_v5 THEN interval '15 minutes' ELSE interval '10 minutes' END;
 FOR entry IN SELECT scope_key,unit FROM(VALUES('organization:calls','calls'),('organization:usd_micro','usd_micro'),('user:'||actor||':calls','calls'),('user:'||actor||':usd_micro','usd_micro'),('mandate:'||o.mandate_id::text||':calls','calls'),('mandate:'||o.mandate_id::text||':usd_micro','usd_micro'))x(scope_key,unit) ORDER BY scope_key LOOP
  SELECT * INTO a FROM public.agent_budget_accounts b WHERE b.organization_id=org AND b.scope_key=entry.scope_key AND b.unit=entry.unit AND b.window_start<=clock_timestamp() AND b.window_end>clock_timestamp() ORDER BY b.window_start DESC,b.id LIMIT 1 FOR UPDATE;
  needed:=CASE WHEN entry.unit='calls' THEN CASE WHEN company_v4 OR company_v5 THEN 1 ELSE calls END ELSE usd END;
  IF a.id IS NULL OR a.window_end<deadline+interval '2 minutes' OR a.cap-a.spent-a.reserved<needed THEN shortfalls:=shortfalls||jsonb_build_array(jsonb_build_object('scopeKey',entry.scope_key,'unit',entry.unit,'needed',needed::text,'available',greatest(coalesce(a.cap-a.spent-a.reserved,0),0)::text,'windowCoversPhase',coalesce(a.window_end>=deadline+interval '2 minutes',false)));ELSE accounts:=array_append(accounts,a.id);count_scopes:=count_scopes+1;END IF;
 END LOOP;
 IF count_scopes<>6 THEN RETURN jsonb_build_object('ready',false,'reason','phase_funding_required','calls',calls::text,'usdMicro',usd::text,'shortfalls',shortfalls);END IF;
 INSERT INTO public.agent_research_phase_budgets(operation_id,organization_id,owner_user_id,input_digest,calls_ceiling,usd_ceiling,deadline)VALUES(o.id,org,actor,o.input_digest,calls,usd,deadline);
 FOR a IN SELECT * FROM public.agent_budget_accounts WHERE id=ANY(accounts) ORDER BY id LOOP needed:=CASE WHEN a.unit='calls' THEN CASE WHEN company_v4 OR company_v5 THEN 0 ELSE calls END ELSE usd END;INSERT INTO public.agent_research_phase_allocations(operation_id,account_id,organization_id,owner_user_id,initial_amount,remaining_amount)VALUES(o.id,a.id,org,actor,needed,needed);UPDATE public.agent_budget_accounts SET reserved=reserved+needed WHERE id=a.id;END LOOP;
 UPDATE public.research_jobs SET config=config||jsonb_build_object('automaticDeadline',(extract(epoch FROM deadline)*1000)::bigint),updated_at=clock_timestamp() WHERE id=j.id;
 RETURN public.agent_research_phase_budget_status(o.id);
END $$;

CREATE OR REPLACE FUNCTION public.agent_transfer_research_phase_attempt(p_parent uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);parent public.agent_operations%ROWTYPE;child public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;x record;amount bigint;prior integer;result jsonb:='[]';company_v4 boolean;company_v5 boolean;request_usd bigint:=1000000;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO parent FROM public.agent_operations WHERE id=p_parent AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE;
 SELECT * INTO child FROM public.agent_operations WHERE id=p_attempt AND thread_id=parent.thread_id AND organization_id=org AND owner_user_id=actor AND name='research.provider' AND state='running' FOR UPDATE;
 IF parent.id IS NULL OR child.id IS NULL OR child.input->>'researchOperationId' IS DISTINCT FROM parent.id::text OR child.input->>'researchJobId' IS DISTINCT FROM parent.input->'config'->>'requestId' THEN RAISE EXCEPTION 'Exact current research attempt required';END IF;
 company_v5:=parent.name='research.start' AND public.agent_research_v5_scope(parent.input);
 company_v4:=coalesce(parent.name='research.start' AND parent.input->>'nativeResearchPlanVersion'='1'
  AND parent.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND parent.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND parent.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND parent.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND parent.input->'config'->'companyOnly'='true'::jsonb AND parent.input->'config'->'targetBusinesses'='20'::jsonb
  AND parent.input->'config'->'findPeople'='false'::jsonb AND parent.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND parent.input->'config'->'includePhones'='false'::jsonb AND parent.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(parent.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND NOT company_v5 AND (parent.input->'providerPolicy'->>'version' IN('2','3') OR parent.input->'config'->'companyDiscoveryPolicy'->>'version' IN('4','5')) THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF company_v4 AND child.input->>'provider'='firmable' AND coalesce(child.input->>'requestClass','') NOT IN('company_search','company_profile','auth') THEN RAISE EXCEPTION 'Exact company-only Firmable request class required';END IF;
 IF company_v4 THEN request_usd:=(parent.input->'providerPolicy'->'requestCeilingsMicroUsd'->>(child.input->>'provider'))::bigint;END IF;
 IF company_v5 THEN
  IF child.input->>'provider'='firmable' THEN
   IF coalesce(child.input->>'requestClass','') NOT IN('company_search','company_profile','auth','people_search','person_profile') THEN RAISE EXCEPTION 'Exact nonphone V5 request class required';END IF;
   IF child.input->>'requestClass' IN('people_search','person_profile') THEN
    PERFORM public.agent_assert_automatic_people_target(parent.id,(child.input->>'targetId')::uuid);
    IF (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'targetId'=child.input->>'targetId' AND a.input->>'requestClass'=child.input->>'requestClass')>(CASE WHEN child.input->>'requestClass'='people_search' THEN 2 ELSE 6 END) THEN RAISE EXCEPTION 'Bounded physical People attempts exhausted';END IF;
   ELSE request_usd:=0;
   END IF;
  END IF;
 END IF;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=parent.id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF p.operation_id IS NULL OR p.state<>'active' OR p.input_digest IS DISTINCT FROM parent.input_digest OR p.deadline<=clock_timestamp() OR NOT(public.agent_research_phase_budget_status(parent.id)->>'ready')::boolean THEN RAISE EXCEPTION 'Complete current phase funding required';END IF;
 IF child.input->>'provider' IS NULL OR child.input->>'provider' NOT IN('search','page','ai','firmable') OR NOT(parent.input->'providerPolicy'->'maxAttempts' ? (child.input->>'provider')) OR (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'provider'=child.input->>'provider')>(parent.input->'providerPolicy'->'maxAttempts'->>(child.input->>'provider'))::integer THEN RAISE EXCEPTION 'Frozen provider attempt ceiling required';END IF;
 IF parent.name='research.fields' AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.input->'selected')s WHERE s->>'targetId'=child.input->>'targetId') OR child.input->>'provider' NOT IN('search','page') OR (SELECT count(*) FROM public.agent_operations a WHERE a.thread_id=parent.thread_id AND a.name='research.provider' AND a.input->>'researchOperationId'=parent.id::text AND a.input->>'targetId'=child.input->>'targetId' AND a.input->>'provider'=child.input->>'provider')>(parent.input->'providerPolicy'->'perCompany'->>(child.input->>'provider'))::integer) THEN RAISE EXCEPTION 'Frozen public company attempt ceiling required';END IF;
 SELECT count(*) INTO prior FROM public.agent_budget_reservations WHERE operation_id=child.id;
 IF prior NOT IN(0,6) THEN RAISE EXCEPTION 'Partial research attempt reservation';END IF;
 IF prior=6 THEN IF(SELECT count(*) FROM public.agent_budget_reservations r JOIN public.agent_research_phase_allocations a ON a.operation_id=parent.id AND a.account_id=r.account_id JOIN public.agent_budget_accounts b ON b.id=r.account_id WHERE r.operation_id=child.id AND r.organization_id=org AND r.owner_user_id=actor AND r.state='reserved' AND r.amount=CASE WHEN b.unit='calls' THEN 1 WHEN b.unit='usd_micro' THEN request_usd ELSE NULL END)<>6 THEN RAISE EXCEPTION 'Original research attempt allocation changed';END IF;RETURN jsonb_build_object('replay',true);END IF;
 IF(SELECT count(*) FROM public.agent_research_phase_allocations WHERE operation_id=parent.id)<>6 THEN RAISE EXCEPTION 'Exact six-account research allocation required';END IF;
 FOR x IN SELECT a.account_id,a.remaining_amount,b.unit,b.cap,b.spent,b.reserved,b.window_start,b.window_end FROM public.agent_research_phase_allocations a JOIN public.agent_budget_accounts b ON b.id=a.account_id AND b.organization_id=org WHERE a.operation_id=parent.id ORDER BY a.account_id FOR UPDATE OF a,b LOOP
  amount:=CASE WHEN x.unit='calls' THEN 1 WHEN x.unit='usd_micro' THEN request_usd ELSE NULL END;
  IF (company_v4 OR company_v5) AND x.unit='calls' OR company_v5 AND x.unit='usd_micro' AND child.input->>'provider'='firmable' AND child.input->>'requestClass' IN('people_search','person_profile') THEN
   IF x.window_start>clock_timestamp() OR x.window_end<=clock_timestamp() OR x.cap-x.spent-x.reserved<amount THEN RAISE EXCEPTION 'Current research request budget exhausted or expired';END IF;
   UPDATE public.agent_budget_accounts SET reserved=reserved+amount WHERE id=x.account_id;
  ELSE
   IF amount IS NULL OR x.remaining_amount<amount THEN RAISE EXCEPTION 'Research phase allocation exhausted';END IF;
   UPDATE public.agent_research_phase_allocations SET remaining_amount=remaining_amount-amount WHERE operation_id=parent.id AND account_id=x.account_id;
  END IF;
  INSERT INTO public.agent_budget_reservations(operation_id,account_id,organization_id,owner_user_id,amount,state)VALUES(child.id,x.account_id,org,actor,amount,'reserved');
  result:=result||jsonb_build_array(jsonb_build_object('accountId',x.account_id,'amount',amount::text));
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_prepare_hybrid_native_research(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_prepare_hybrid_native_research(uuid) TO acquire_agent_user;
REVOKE ALL ON FUNCTION public.agent_reserve_research_phase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_reserve_research_phase(uuid) TO acquire_agent_user;
REVOKE ALL ON FUNCTION public.agent_transfer_research_phase_attempt(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_transfer_research_phase_attempt(uuid,uuid) TO acquire_agent_user;

-- The original initial-review operation remains the authority. The current
-- company snapshot is checked before admitting personal reads or saving data.
CREATE FUNCTION public.agent_automatic_people_context(operation uuid,target uuid,firmable_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;source jsonb;projection jsonb;item jsonb;saved jsonb;domain text;aliases uuid[];identity_keys text[];identity_aliases uuid[];assessment jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state='running' FOR UPDATE;
 IF o.id IS NULL OR NOT public.agent_research_v5_scope(o.input) OR firmable_id IS NULL OR firmable_id!~'^f[0-9]+$' OR target IS NULL THEN RAISE EXCEPTION 'Current approved V5 automatic People scope required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact initial automatic People approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'true' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config ? 'companyOnly' OR j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'hybrid-company-v1' OR NOT coalesce((public.agent_research_phase_budget_status(o.id)->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Saved current automatic People root and funding required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.created_by=actor AND child.config->>'parentJobId'=j.id::text AND child.config->>'targetId'=target::text AND child.status IN('complete','partial') AND (child.config->>'firmableCompanyId'=firmable_id OR child.config->>'hybridFirmableId'=firmable_id)) THEN RAISE EXCEPTION 'Accepted original company result required before People';END IF;
 -- Exact membership/source lookup, never the historical ranked/top-50 People
 -- selection. Scoring is evidence for the GUI, not admission for this V5 rule.
 SELECT mt.assessment INTO assessment FROM public.mandate_targets mt WHERE mt.organization_id=org AND mt.mandate_id=o.mandate_id AND mt.target_id=target;
 IF NOT FOUND OR assessment->>'stage' IN('contacted','in-conversation') OR (assessment->>'stage' IN('excluded','parked') AND assessment->>'decisionOrigin' IS DISTINCT FROM 'automatic') THEN RAISE EXCEPTION 'Current explicitly available company membership required';END IF;
 source:=public.agent_fields_current_source(org,o.mandate_id,target);projection:=source->'projection';
 IF projection IS NULL OR projection->'target'->>'firmableCompanyId' IS DISTINCT FROM firmable_id THEN RAISE EXCEPTION 'Current accepted canonical company source required';END IF;
 item:=jsonb_build_object('targetId',target,'firmableId',firmable_id,'sourceRevision',source->>'sourceRevision');
 domain:=projection->'target'->>'domain';
 SELECT array_agg(p.id) INTO aliases FROM public.contacts p JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org WHERE p.organization_id=org AND (g.id=target OR (coalesce(domain,'')<>'' AND lower(regexp_replace(g.domain,'^www[.]',''))=lower(regexp_replace(domain,'^www[.]',''))) OR g.firmable_company_id=firmable_id);
 WITH batch AS MATERIALIZED(SELECT * FROM public.agent_contact_identity_batch(org,coalesce(aliases,'{}'::uuid[])))
 SELECT ARRAY(SELECT DISTINCT unnest(b.identity_keys) FROM batch b),ARRAY(SELECT DISTINCT unnest(b.contact_aliases) FROM batch b) INTO identity_keys,identity_aliases;
 IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])))
 OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND x.state='sent')
 OR EXISTS(SELECT 1 FROM public.campaign_inbound_events e WHERE e.organization_id=org AND e.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])))
 OR EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key=ANY(coalesce(identity_keys,'{}'::text[]))) THEN RAISE EXCEPTION 'Previous outreach or owned conversation requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND coalesce(p.personal_data->>'doNotContact','false')<>'false')
 OR public.agent_aliases_have_unresolved_sends(identity_aliases,NULL::uuid,true)
 OR EXISTS(SELECT 1 FROM public.suppressions suppression WHERE suppression.organization_id=org AND ((coalesce(domain,'')<>'' AND lower(regexp_replace(suppression.domain,'^www[.]',''))=lower(regexp_replace(domain,'^www[.]',''))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND lower(suppression.address)=lower(p.personal_data->>'email')))) THEN RAISE EXCEPTION 'Opt-out, suppression or unresolved outcome requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND NOT p.fictionalised AND coalesce(p.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AND p.provenance->>'nativeAutomaticPeopleOperationId' IS DISTINCT FROM o.id::text) THEN RAISE EXCEPTION 'Existing cached contact requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.firmable_sync_runs run WHERE run.organization_id=org AND run.target_id=target AND run.status IN('queued','running'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.organization_id=org AND other.id<>o.id AND other.name='research.people' AND other.state IN('proposed','approved','running','uncertain') AND EXISTS(SELECT 1 FROM jsonb_array_elements(other.input->'selected') selection WHERE selection->>'targetId'=target::text OR selection->>'firmableId'=firmable_id))
 OR EXISTS(SELECT 1 FROM public.research_jobs other JOIN public.agent_operations parent ON parent.id::text=other.config->'nativeAgent'->>'operationId' AND parent.organization_id=org WHERE other.organization_id=org AND other.id<>j.id AND other.config->'automaticPeopleCompanies' @> jsonb_build_object(target::text,jsonb_build_object('firmableId',firmable_id)) AND (parent.state IN('approved','running','uncertain') OR EXISTS(SELECT 1 FROM public.agent_operations attempt WHERE attempt.organization_id=org AND attempt.input->>'researchOperationId'=parent.id::text AND attempt.input->>'targetId'=target::text AND attempt.name='research.provider' AND attempt.state IN('running','uncertain')))) THEN RAISE EXCEPTION 'Existing People work requires its original outcome';END IF;
 saved:=j.config->'automaticPeopleCompanies'->target::text;
 IF saved IS NOT NULL THEN
  IF saved->>'targetId' IS DISTINCT FROM target::text OR saved->>'firmableId' IS DISTINCT FROM firmable_id OR saved->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' THEN RAISE EXCEPTION 'Automatic People company source changed';END IF;
 ELSE
  IF jsonb_typeof(coalesce(j.config->'automaticPeopleCompanies','{}'::jsonb))<>'object' OR (SELECT count(*) FROM jsonb_object_keys(coalesce(j.config->'automaticPeopleCompanies','{}'::jsonb)))>=800 THEN RAISE EXCEPTION 'Automatic People company bound reached';END IF;
  saved:=jsonb_build_object('targetId',target,'firmableId',firmable_id,'sourceRevision',item->>'sourceRevision','maxContactsPerCompany',3);
  UPDATE public.research_jobs SET config=jsonb_set(config,'{automaticPeopleCompanies}',coalesce(config->'automaticPeopleCompanies','{}'::jsonb)||jsonb_build_object(target::text,saved)),updated_at=clock_timestamp() WHERE id=j.id;
 END IF;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.agent_automatic_people_context(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_automatic_people_context(uuid,uuid,text) TO acquire_agent_user;

CREATE FUNCTION public.agent_assert_automatic_people_target(operation uuid,target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);fid text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT j.config->'automaticPeopleCompanies'->target::text->>'firmableId' INTO fid FROM public.agent_operations o JOIN public.research_jobs j ON j.id=(o.input->'config'->>'requestId')::uuid AND j.organization_id=o.organization_id AND j.mandate_id=o.mandate_id AND j.created_by=o.owner_user_id WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.start' AND o.state='running' AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF fid IS NULL THEN RAISE EXCEPTION 'Saved automatic People company admission required';END IF;
 RETURN public.agent_automatic_people_context(operation,target,fid);
END $$;
REVOKE ALL ON FUNCTION public.agent_assert_automatic_people_target(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_assert_automatic_people_target(uuid,uuid) TO acquire_agent_user;

CREATE FUNCTION public.agent_record_automatic_people_candidates(operation uuid,target uuid,candidates jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);scope jsonb;jid uuid;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF candidates IS NULL OR jsonb_typeof(candidates)<>'array' OR jsonb_array_length(candidates)>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(candidates)p WHERE jsonb_typeof(p)<>'string' OR (p#>>'{}')!~'^fp[0-9]+$') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(candidates))<>jsonb_array_length(candidates) THEN RAISE EXCEPTION 'Bounded automatic People candidates required';END IF;
 scope:=public.agent_assert_automatic_people_target(operation,target);
 IF scope ? 'candidates' THEN IF scope->'candidates' IS DISTINCT FROM candidates THEN RAISE EXCEPTION 'Saved automatic People candidates changed';END IF;RETURN;END IF;
 SELECT (o.input->'config'->>'requestId')::uuid INTO jid FROM public.agent_operations o WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor;
 UPDATE public.research_jobs SET config=jsonb_set(config,ARRAY['automaticPeopleCompanies',target::text],scope||jsonb_build_object('candidates',candidates)),updated_at=clock_timestamp() WHERE id=jid AND organization_id=org;
END $$;
REVOKE ALL ON FUNCTION public.agent_record_automatic_people_candidates(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_record_automatic_people_candidates(uuid,uuid,jsonb) TO acquire_agent_user;

CREATE FUNCTION public.agent_save_automatic_people_profile(operation uuid,target uuid,profile jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);scope jsonb;o public.agent_operations%ROWTYPE;pid text:=profile->>'id';email text:=lower(btrim(profile->>'email'));linkedin text:=profile->>'linkedinUrl';contact uuid;existing public.contacts%ROWTYPE;person_data jsonb;proof jsonb;fictional boolean;dnc boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR pid IS NULL OR pid!~'^fp[0-9]+$' OR length(coalesce(profile->>'name',''))>300 OR length(coalesce(profile->>'position',''))>300 OR length(coalesce(email,''))>300 OR jsonb_typeof(profile->'fictionalised') IS DISTINCT FROM 'boolean' OR jsonb_typeof(profile->'doNotContact') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Bounded nonphone automatic People profile required';END IF;
 scope:=public.agent_assert_automatic_people_target(operation,target);
 IF NOT coalesce(scope->'candidates' @> jsonb_build_array(pid),false) THEN RAISE EXCEPTION 'Person is outside saved automatic People selection';END IF;
 IF scope->'outcomes' ? pid THEN RETURN (scope->'outcomes'->pid->>'contactId')::uuid;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.organization_id=org AND p.firmable_person_id=pid AND p.target_id<>target) THEN RAISE EXCEPTION 'Person company identity requires review';END IF;
 IF email IS NULL OR email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN email:=NULL;END IF;
 IF linkedin IS NULL OR linkedin!~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' THEN linkedin:=NULL;END IF;
 fictional:=(profile->>'fictionalised')::boolean;dnc:=(profile->>'doNotContact')::boolean;
 SELECT * INTO existing FROM public.contacts p WHERE p.organization_id=org AND p.target_id=target AND p.firmable_person_id=pid FOR UPDATE;
 IF existing.id IS NOT NULL AND existing.fictionalised THEN RAISE EXCEPTION 'Existing person privacy requires review';END IF;
 person_data:=jsonb_strip_nulls(jsonb_build_object('email',email,'linkedinUrl',linkedin,'emailLookupStatus',CASE WHEN email IS NULL THEN 'not_reported' ELSE 'reported' END,'phoneLookupStatus','not_requested','doNotContact',coalesce((existing.personal_data->>'doNotContact')::boolean,false) OR dnc));
 proof:=jsonb_build_object('source','Firmable','nativeAutomaticPeopleOperationId',o.id,'capturedAt',clock_timestamp(),'phoneLookupStatus','not_requested');
 INSERT INTO public.firmable_people(id,name) VALUES(pid,left(profile->>'name',300)) ON CONFLICT(id) DO NOTHING;
 IF existing.id IS NULL THEN
  INSERT INTO public.contacts(organization_id,mandate_id,target_id,firmable_person_id,display_name,role,personal_data,provenance,fictionalised) VALUES(org,o.mandate_id,target,pid,coalesce(nullif(profile->>'name',''),pid),profile->>'position',person_data,proof,fictional) RETURNING id INTO contact;
 ELSE
  UPDATE public.contacts SET display_name=coalesce(nullif(display_name,''),nullif(profile->>'name',''),pid),role=coalesce(nullif(role,''),profile->>'position'),fictionalised=existing.fictionalised OR fictional,personal_data=coalesce(personal_data,'{}'::jsonb)||person_data,provenance=coalesce(provenance,'{}'::jsonb)||(proof-'source'-'capturedAt')||jsonb_build_object('nativeAutomaticPeopleCapturedAt',clock_timestamp()) WHERE id=existing.id RETURNING id INTO contact;
 END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config,ARRAY['automaticPeopleCompanies',target::text],scope||jsonb_build_object('outcomes',coalesce(scope->'outcomes','{}'::jsonb)||jsonb_build_object(pid,jsonb_build_object('contactId',contact)))),updated_at=clock_timestamp() WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org;
 RETURN contact;
END $$;
REVOKE ALL ON FUNCTION public.agent_save_automatic_people_profile(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_save_automatic_people_profile(uuid,uuid,jsonb) TO acquire_agent_user;
