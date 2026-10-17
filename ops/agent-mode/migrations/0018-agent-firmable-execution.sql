-- Explicit native company-only phase. Original UI research is unaffected.
CREATE FUNCTION agent_prepare_firmable_research(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;scope_count integer;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state IN('approved','running') FOR UPDATE;
 IF o.id IS NULL OR o.input->'execution'->>'pipeline' IS DISTINCT FROM 'firmable-company-v1' OR o.input->'execution'->>'backgroundResearch' IS DISTINCT FROM 'false' OR o.input->'execution'->>'peopleResearch' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reviewed supported research execution plan required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=(o.input->>'responsibilityId')::uuid AND r.thread_id=o.thread_id AND r.organization_id=org AND r.owner_user_id=actor AND r.state IN('ready','waiting') AND r.revision::text=o.input->>'responsibilityRevision' AND r.mandate_revision=o.input->>'mandateRevision' AND m.xmin::text=r.mandate_revision) THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF j.id IS NULL OR j.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 IF j.config->'nativeAgent'->>'providerAdmission'='firmable-company-v1' THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);END IF;
 SELECT count(*) INTO scope_count FROM (SELECT DISTINCT ON(scope_key) scope_key,unit,cap,spent,reserved FROM public.agent_budget_accounts WHERE organization_id=org AND window_start<=clock_timestamp() AND window_end>clock_timestamp() AND scope_key=ANY(ARRAY['organization:calls','organization:usd_micro','user:'||actor||':calls','user:'||actor||':usd_micro','mandate:'||o.mandate_id::text||':calls','mandate:'||o.mandate_id::text||':usd_micro']) ORDER BY scope_key,window_start DESC,id) a WHERE scope_key LIKE '%:'||unit AND ((unit='calls' AND cap-spent-reserved>=1) OR (unit='usd_micro' AND cap-spent-reserved>=1000000));
 IF scope_count<>6 THEN RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',false,'blockedReason','provider_budget_required');END IF;
 UPDATE public.research_jobs SET config=jsonb_set(config||jsonb_build_object('pipelineDesign','firmable-v1','findPeople',false,'includeCompanyPeople',false,'parallelBusinessResearch',false,'automaticDeadline',(extract(epoch FROM clock_timestamp())*1000)::bigint+600000),'{nativeAgent,providerAdmission}','"firmable-company-v1"'::jsonb),message='Approved native company research ready',updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'status',j.status,'dispatchReady',true);
END $$;
REVOKE ALL ON FUNCTION agent_prepare_firmable_research(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_prepare_firmable_research(uuid) TO acquire_agent_user;

CREATE OR REPLACE FUNCTION agent_native_research_status(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('jobId',j.id,'status',j.status,'nativeAgent',j.config->'nativeAgent','updatedAt',j.updated_at,
 'companies',(SELECT count(DISTINCT child.config->>'targetId') FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.config->>'parentJobId'=j.id::text AND child.config->>'targetId' IS NOT NULL),
 'contacts',(SELECT count(*) FROM public.contacts c WHERE c.organization_id=org AND c.mandate_id=o.mandate_id AND c.target_id IN(SELECT (child.config->>'targetId')::uuid FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.config->>'parentJobId'=j.id::text AND child.config->>'targetId' IS NOT NULL))) INTO result
 FROM public.agent_operations o JOIN public.research_jobs j ON j.id=(o.input->'config'->>'requestId')::uuid
 WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
 AND j.organization_id=org AND j.mandate_id=o.mandate_id AND j.created_by=actor AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 RETURN result;
END $$;
