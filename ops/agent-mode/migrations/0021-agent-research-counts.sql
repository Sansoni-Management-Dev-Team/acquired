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
 WHERE o.id=operation AND o.organization_id=org AND o.owner_user_id=actor AND o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1'
 AND j.organization_id=org AND j.mandate_id=o.mandate_id AND j.created_by=actor AND j.config->'nativeAgent'->>'operationId'=o.id::text;
 IF result IS NULL THEN RAISE EXCEPTION 'Owned native research job required';END IF;
 RETURN result;
END $$;
