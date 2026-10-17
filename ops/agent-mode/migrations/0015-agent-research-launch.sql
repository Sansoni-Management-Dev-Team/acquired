-- Isolated local native research persistence only. No provider dispatch, budget
-- bypass, existing-job adoption, or migration of original UI research.
CREATE FUNCTION agent_create_research_job(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 op public.agent_operations%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mrev text;job uuid;cfg jsonb;saved public.research_jobs%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF op.id IS NULL OR op.name<>'research.start' OR op.state NOT IN('approved','running') OR op.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Approved native research operation required';END IF;
 SELECT * INTO r FROM public.agent_responsibilities WHERE id=(op.input->>'responsibilityId')::uuid AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 SELECT xmin::text INTO mrev FROM public.mandates WHERE id=op.mandate_id AND organization_id=org;
 IF r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.revision::text IS DISTINCT FROM (op.input->>'responsibilityRevision') OR r.mandate_revision IS DISTINCT FROM (op.input->>'mandateRevision') OR mrev IS DISTINCT FROM r.mandate_revision THEN RAISE EXCEPTION 'Current research supervision required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=op.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact research approval required';END IF;
 job:=(op.input->'config'->>'requestId')::uuid;
 cfg:=(op.input->'config')-'requestId'||jsonb_build_object('researchRunId',job,'executionSlot','agent:'||op.thread_id::text,'automaticDeadline',0,'nativeAgent',jsonb_build_object('version',1,'operationId',op.id,'threadId',op.thread_id,'responsibilityId',r.id,'responsibilityRevision',r.revision,'mandateRevision',mrev,'contextRevision',op.input->>'contextRevision','providerAdmission','required'));
 SELECT * INTO saved FROM public.research_jobs WHERE id=job FOR UPDATE;
 IF saved.id IS NOT NULL THEN
  IF saved.organization_id<>org OR saved.mandate_id<>op.mandate_id OR saved.created_by<>actor OR saved.config->'nativeAgent'->>'operationId' IS DISTINCT FROM op.id::text THEN RAISE EXCEPTION 'Research handle belongs to different work';END IF;
  RETURN jsonb_build_object('jobId',saved.id,'status',saved.status,'dispatchReady',false,'blockedReason','budgeted_provider_adapter_required');
 END IF;
 IF EXISTS(SELECT 1 FROM public.research_jobs WHERE organization_id=org AND mandate_id=op.mandate_id AND status NOT IN('complete','partial','failed','cancelled') AND config->'companyBackgroundResearch' IS NULL) THEN RAISE EXCEPTION 'Research already active for this mandate';END IF;
 INSERT INTO public.research_jobs(id,organization_id,mandate_id,created_by,status,config,seeds,message)
 VALUES(job,org,op.mandate_id,actor,'queued',cfg,COALESCE(cfg->'seeds','[]'::jsonb),'Approved research saved; awaiting per-request provider budget admission');
 RETURN jsonb_build_object('jobId',job,'status','queued','dispatchReady',false,'blockedReason','budgeted_provider_adapter_required');
END $$;
REVOKE ALL ON FUNCTION agent_create_research_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_create_research_job(uuid) TO acquire_agent_user;
CREATE FUNCTION agent_native_research_status(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);result jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT jsonb_build_object('jobId',j.id,'status',j.status,'nativeAgent',j.config->'nativeAgent') INTO result
 FROM public.agent_operations o JOIN public.research_jobs j ON j.id=(o.input->'config'->>'requestId')::uuid
 WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
 AND j.organization_id=org AND j.mandate_id=o.mandate_id AND j.created_by=actor AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION agent_native_research_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_native_research_status(uuid) TO acquire_agent_user;
