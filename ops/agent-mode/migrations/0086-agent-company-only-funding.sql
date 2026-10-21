-- New reviewed V4 company-only pricing: all discovered candidates remain call-
-- bounded. Firmable's zero incremental monetary ceiling is configured pricing,
-- not observed invoice data. Raw unknown receipts and uncertain outcomes remain
-- unchanged; no People/phone authority is introduced. Legacy plans retain $1
-- per-request escrow and their original ten-minute phase window.
ALTER TABLE public.agent_budget_reservations DROP CONSTRAINT agent_budget_reservations_amount_check;
ALTER TABLE public.agent_budget_reservations ADD CONSTRAINT agent_budget_reservations_amount_check CHECK(amount>=0);
ALTER TABLE public.agent_research_phase_allocations DROP CONSTRAINT agent_research_phase_allocations_initial_amount_check;
ALTER TABLE public.agent_research_phase_allocations ADD CONSTRAINT agent_research_phase_allocations_initial_amount_check CHECK(initial_amount>=0);
-- V4 binds the call accounts without holding future capacity. Each physical
-- attempt independently reserves one call under the existing account row locks.
-- Generic agent_reserve_budget still accepts strictly positive amounts only.
-- Only the exact company-only transfer below can create zero-dollar rows.
ALTER TABLE public.agent_research_phase_budgets DROP CONSTRAINT agent_research_phase_budgets_calls_ceiling_check;
ALTER TABLE public.agent_research_phase_budgets ADD CONSTRAINT agent_research_phase_budgets_calls_ceiling_check CHECK(calls_ceiling BETWEEN 1 AND 24035);

CREATE OR REPLACE FUNCTION public.agent_prepare_hybrid_native_research(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;scope_count integer;company_v4 boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state IN('approved','running') FOR UPDATE;
 company_v4:=coalesce(o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
  AND o.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND o.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND o.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND o.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND o.input->'config'->'companyOnly'='true'::jsonb AND o.input->'config'->'targetBusinesses'='20'::jsonb
  AND o.input->'config'->'findPeople'='false'::jsonb AND o.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND o.input->'config'->'includePhones'='false'::jsonb AND o.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(o.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND (o.input->'providerPolicy'->>'version'='2' OR o.input->'config'->'companyDiscoveryPolicy'->>'version'='4') THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF NOT company_v4 THEN IF o.id IS NULL OR o.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1' OR o.input->'providerPolicy'->>'version' IS DISTINCT FROM '1' OR o.input->'execution'->>'productionPipeline' IS DISTINCT FROM 'hybrid-firmable-v1' OR o.input->'config'->>'targetBusinesses' IS DISTINCT FROM '20' OR o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' OR o.input->'providerPolicy'->'maxAttempts' IS DISTINCT FROM '{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb OR o.input->'execution'->>'pipeline' IS DISTINCT FROM 'hybrid-company-v1' OR o.input->'execution'->>'backgroundResearch' IS DISTINCT FROM 'false' OR o.input->'execution'->>'peopleResearch' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reviewed supported research execution plan required';END IF; END IF;
 PERFORM 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision FOR SHARE OF r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF j.id IS NULL OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 IF company_v4 AND (j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config->>'companyOnly' IS DISTINCT FROM 'true' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'false') THEN RAISE EXCEPTION 'Saved company-only job scope changed';END IF;
 IF j.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1' THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id) a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('pipelineDesign','hybrid-firmable-v1','findPeople',false,'includeCompanyPeople',false,'parallelBusinessResearch',false,'automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+CASE WHEN company_v4 THEN 900000 ELSE 600000 END),'{nativeAgent,providerAdmission}','"hybrid-company-v1"'::jsonb),message='Approved native hybrid company research ready; background fields and people require separate review',updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);
END $$;

CREATE OR REPLACE FUNCTION public.agent_reserve_research_phase(p_operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;j public.research_jobs%ROWTYPE;a public.agent_budget_accounts%ROWTYPE;entry record;count_scopes integer:=0;calls bigint;usd bigint;n integer;deadline timestamptz;accounts uuid[]:='{}';shortfalls jsonb:='[]';needed bigint;company_v4 boolean;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Approved owned research phase required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision) THEN RAISE EXCEPTION 'Current research phase supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research phase approval required';END IF;
 company_v4:=coalesce(o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
  AND o.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND o.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND o.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND o.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND o.input->'config'->'companyOnly'='true'::jsonb AND o.input->'config'->'targetBusinesses'='20'::jsonb
  AND o.input->'config'->'findPeople'='false'::jsonb AND o.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND o.input->'config'->'includePhones'='false'::jsonb AND o.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(o.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND (o.input->'providerPolicy'->>'version'='2' OR o.input->'config'->'companyDiscoveryPolicy'->>'version'='4') THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF company_v4 THEN calls:=24035;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'  AND o.input->'execution'->>'productionPipeline'='hybrid-firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb THEN calls:=71;
 ELSIF o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->'execution'->>'productionPipeline'='firmable-v1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":6,"page":5,"ai":5,"firmable":60}'::jsonb THEN calls:=76;
 ELSIF o.name='research.people' AND o.input->>'nativePeoplePlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":0,"page":0,"ai":0,"firmable":60}'::jsonb THEN calls:=60;
 ELSIF o.name='research.fields' AND o.input->>'nativeFieldsPlanVersion'='1' AND o.input->'providerPolicy'->'maxAttempts'='{"search":60,"page":320,"ai":0,"firmable":0}'::jsonb AND o.input->'providerPolicy'->'perCompany'='{"search":12,"page":64}'::jsonb THEN n:=jsonb_array_length(o.input->'selected');IF n IS NULL OR n NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Exact bounded public-field selection required';END IF;calls:=n*76;
 ELSE RAISE EXCEPTION 'Frozen physical research policy required';END IF;
 IF o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' THEN RAISE EXCEPTION 'Frozen request reservation ceiling required';END IF;usd:=CASE WHEN company_v4 THEN 11000000 ELSE calls*1000000 END;
 SELECT * INTO p FROM public.agent_research_phase_budgets WHERE operation_id=o.id FOR UPDATE;
 IF p.operation_id IS NOT NULL THEN IF p.input_digest IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Research funding belongs to another manifest';END IF;RETURN public.agent_research_phase_budget_status(o.id);END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') THEN RAISE EXCEPTION 'Saved unfinished research job required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_operations child WHERE child.thread_id=o.thread_id AND child.input->>'researchOperationId'=o.id::text AND child.name IN('research.provider','research.worker_dispatch')) THEN RAISE EXCEPTION 'Original research attempts require reconciliation before phase funding';END IF;
 deadline:=clock_timestamp()+CASE WHEN company_v4 THEN interval '15 minutes' ELSE interval '10 minutes' END;
 FOR entry IN SELECT scope_key,unit FROM(VALUES('organization:calls','calls'),('organization:usd_micro','usd_micro'),('user:'||actor||':calls','calls'),('user:'||actor||':usd_micro','usd_micro'),('mandate:'||o.mandate_id::text||':calls','calls'),('mandate:'||o.mandate_id::text||':usd_micro','usd_micro'))x(scope_key,unit) ORDER BY scope_key LOOP
  SELECT * INTO a FROM public.agent_budget_accounts b WHERE b.organization_id=org AND b.scope_key=entry.scope_key AND b.unit=entry.unit AND b.window_start<=clock_timestamp() AND b.window_end>clock_timestamp() ORDER BY b.window_start DESC,b.id LIMIT 1 FOR UPDATE;
  needed:=CASE WHEN entry.unit='calls' THEN CASE WHEN company_v4 THEN 1 ELSE calls END ELSE usd END;
  IF a.id IS NULL OR a.window_end<deadline+interval '2 minutes' OR a.cap-a.spent-a.reserved<needed THEN shortfalls:=shortfalls||jsonb_build_array(jsonb_build_object('scopeKey',entry.scope_key,'unit',entry.unit,'needed',needed::text,'available',greatest(coalesce(a.cap-a.spent-a.reserved,0),0)::text,'windowCoversPhase',coalesce(a.window_end>=deadline+interval '2 minutes',false)));ELSE accounts:=array_append(accounts,a.id);count_scopes:=count_scopes+1;END IF;
 END LOOP;
 IF count_scopes<>6 THEN RETURN jsonb_build_object('ready',false,'reason','phase_funding_required','calls',calls::text,'usdMicro',usd::text,'shortfalls',shortfalls);END IF;
 INSERT INTO public.agent_research_phase_budgets(operation_id,organization_id,owner_user_id,input_digest,calls_ceiling,usd_ceiling,deadline)VALUES(o.id,org,actor,o.input_digest,calls,usd,deadline);
 FOR a IN SELECT * FROM public.agent_budget_accounts WHERE id=ANY(accounts) ORDER BY id LOOP needed:=CASE WHEN a.unit='calls' THEN CASE WHEN company_v4 THEN 0 ELSE calls END ELSE usd END;INSERT INTO public.agent_research_phase_allocations(operation_id,account_id,organization_id,owner_user_id,initial_amount,remaining_amount)VALUES(o.id,a.id,org,actor,needed,needed);UPDATE public.agent_budget_accounts SET reserved=reserved+needed WHERE id=a.id;END LOOP;
 UPDATE public.research_jobs SET config=config||jsonb_build_object('automaticDeadline',(extract(epoch FROM deadline)*1000)::bigint),updated_at=clock_timestamp() WHERE id=j.id;
 RETURN public.agent_research_phase_budget_status(o.id);
END $$;

CREATE OR REPLACE FUNCTION public.agent_transfer_research_phase_attempt(p_parent uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);parent public.agent_operations%ROWTYPE;child public.agent_operations%ROWTYPE;p public.agent_research_phase_budgets%ROWTYPE;x record;amount bigint;prior integer;result jsonb:='[]';company_v4 boolean;request_usd bigint:=1000000;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO parent FROM public.agent_operations WHERE id=p_parent AND organization_id=org AND owner_user_id=actor AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE;
 SELECT * INTO child FROM public.agent_operations WHERE id=p_attempt AND thread_id=parent.thread_id AND organization_id=org AND owner_user_id=actor AND name='research.provider' AND state='running' FOR UPDATE;
 IF parent.id IS NULL OR child.id IS NULL OR child.input->>'researchOperationId' IS DISTINCT FROM parent.id::text OR child.input->>'researchJobId' IS DISTINCT FROM parent.input->'config'->>'requestId' THEN RAISE EXCEPTION 'Exact current research attempt required';END IF;
 company_v4:=coalesce(parent.name='research.start' AND parent.input->>'nativeResearchPlanVersion'='1'
  AND parent.input->'providerPolicy'='{"version":2,"companyOnly":true,"callAdmission":"per_request","requestCeilingMicroUsd":"1000000","requestCeilingsMicroUsd":{"firmable":"0","search":"1000000","page":"1000000","ai":"1000000"},"pricingBasis":"configured_company_only_incremental","maxAttempts":{"search":6,"page":5,"ai":0,"firmable":24024}}'::jsonb
  AND parent.input->'execution'='{"productionPipeline":"hybrid-firmable-v1","pipeline":"hybrid-company-v1","backgroundResearch":false,"peopleResearch":false}'::jsonb
  AND parent.input->'config'->'companyDiscoveryPolicy'='{"version":4,"countryScope":"AU","desiredSourceCompanies":20,"maxProfiledCompanies":800,"firmablePageSize":100,"maxFirmablePages":2,"maxFirmableRows":200,"maxWebQueries":6,"maxWebRowsPerQuery":100,"queryOrder":"subsector_round_robin","profileSelection":{"strategy":"all_discovered","identity":"firmable_id_then_domain","companyOnly":true}}'::jsonb
  AND parent.input->'config'->'companyIdentityPolicyVersion'='1'::jsonb
  AND parent.input->'config'->'companyOnly'='true'::jsonb AND parent.input->'config'->'targetBusinesses'='20'::jsonb
  AND parent.input->'config'->'findPeople'='false'::jsonb AND parent.input->'config'->'includeCompanyPeople'='false'::jsonb
  AND parent.input->'config'->'includePhones'='false'::jsonb AND parent.input->'config'->'budget'->'maxMinutes'='15'::jsonb
  AND coalesce(parent.input->'config'->'companyBackgroundResearch','false'::jsonb)='false'::jsonb,false);
 IF NOT company_v4 AND (parent.input->'providerPolicy'->>'version'='2' OR parent.input->'config'->'companyDiscoveryPolicy'->>'version'='4') THEN RAISE EXCEPTION 'Exact reviewed company-only v4 pricing and discovery policy required';END IF;
 IF company_v4 AND child.input->>'provider'='firmable' AND coalesce(child.input->>'requestClass','') NOT IN('company_search','company_profile','auth') THEN RAISE EXCEPTION 'Exact company-only Firmable request class required';END IF;
 IF company_v4 THEN request_usd:=(parent.input->'providerPolicy'->'requestCeilingsMicroUsd'->>(child.input->>'provider'))::bigint;END IF;
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
  IF company_v4 AND x.unit='calls' THEN
   IF x.window_start>clock_timestamp() OR x.window_end<=clock_timestamp() OR x.cap-x.spent-x.reserved<1 THEN RAISE EXCEPTION 'Current research call budget exhausted or expired';END IF;
   UPDATE public.agent_budget_accounts SET reserved=reserved+1 WHERE id=x.account_id;
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
