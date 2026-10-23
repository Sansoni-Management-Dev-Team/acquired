-- Native hybrid COMPANY phase only. No website background or people authority.
-- Uses existing account-wide provider quotas plus separately persisted per-HTTP budget admission.
CREATE FUNCTION public.agent_prepare_hybrid_native_research(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;scope_count integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL OR o.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1' OR o.input->'providerPolicy'->>'version' IS DISTINCT FROM '1' OR o.input->'execution'->>'productionPipeline' IS DISTINCT FROM 'hybrid-firmable-v1' OR o.input->'config'->>'targetBusinesses' IS DISTINCT FROM '20' OR o.input->'providerPolicy'->>'requestCeilingMicroUsd' IS DISTINCT FROM '1000000' OR o.input->'providerPolicy'->'maxAttempts' IS DISTINCT FROM '{"search":6,"page":5,"ai":0,"firmable":60}'::jsonb OR o.input->'execution'->>'pipeline' IS DISTINCT FROM 'hybrid-company-v1' OR o.input->'execution'->>'backgroundResearch' IS DISTINCT FROM 'false' OR o.input->'execution'->>'peopleResearch' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reviewed supported research execution plan required';END IF;
 PERFORM 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision FOR SHARE OF r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF j.id IS NULL OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 IF j.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1' THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id) a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('pipelineDesign','hybrid-firmable-v1','findPeople',false,'includeCompanyPeople',false,'parallelBusinessResearch',false,'automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+600000),'{nativeAgent,providerAdmission}','"hybrid-company-v1"'::jsonb),message='Approved native hybrid company research ready; background fields and people require separate review',updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);
END $$;
REVOKE ALL ON FUNCTION public.agent_prepare_hybrid_native_research(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_prepare_hybrid_native_research(uuid) TO acquire_agent_user;

