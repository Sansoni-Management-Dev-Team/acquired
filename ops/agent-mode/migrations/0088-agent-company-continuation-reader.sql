-- Narrow read boundary for the existing restricted agent role. No table SELECT
-- grant, execution authority, migration of original jobs or new state is added.
CREATE FUNCTION public.agent_company_continuation_sources(p_thread uuid,p_source uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 t public.agent_threads%ROWTYPE;s public.research_jobs%ROWTYPE;cfg jsonb;manifest jsonb;claims jsonb;children jsonb;result jsonb:='[]';
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Owned company continuation thread required';END IF;
 -- Ten is the intentional newest-source options window, never a child/effect
 -- truncation. An exact source lookup must either return that source or fail.
 FOR s IN SELECT j.* FROM public.research_jobs j JOIN public.agent_operations original
  ON original.id::text=j.config->'nativeAgent'->>'operationId' AND original.organization_id=org AND original.owner_user_id=actor
  AND original.thread_id=t.id AND original.mandate_id=t.mandate_id AND original.name='research.start' AND original.state='complete'
  AND original.input->>'nativeResearchPlanVersion'='1' AND original.input->'config'->>'requestId'=j.id::text
  AND original.input->'config'->'companyDiscoveryPolicy'=j.config->'companyDiscoveryPolicy'
 WHERE j.organization_id=org AND j.created_by=actor AND j.mandate_id=t.mandate_id AND (p_source IS NULL OR j.id=p_source)
 AND j.status='partial' AND j.config->>'pipelineDesign'='hybrid-firmable-v1' AND j.config->>'researchRunId'=j.id::text
 AND NOT(j.config ? 'companyContinuation') AND j.config->'companyDiscoveryPolicy'->>'version'='4'
 AND j.config->'companyIdentityPolicyVersion'='1'::jsonb AND j.config->'companyOnly'='true'::jsonb
 AND j.config->'findPeople'='false'::jsonb AND j.config->'includeCompanyPeople'='false'::jsonb AND j.config->'includePhones'='false'::jsonb
 AND j.config->'nativeAgent'->>'providerAdmission'='hybrid-company-v1'
 ORDER BY j.updated_at DESC,j.id DESC LIMIT 10 FOR SHARE OF j,original
 LOOP
  manifest:=s.config->'hybridResult'->'selection';
  IF jsonb_typeof(manifest) IS DISTINCT FROM 'array' OR jsonb_array_length(manifest)>800 THEN RAISE EXCEPTION 'Bounded original company manifest required';END IF;
  cfg:=jsonb_build_object('pipelineDesign',s.config->'pipelineDesign','researchRunId',s.config->'researchRunId',
   'companyDiscoveryPolicy',s.config->'companyDiscoveryPolicy','companyIdentityPolicyVersion',s.config->'companyIdentityPolicyVersion',
   'companyOnly',s.config->'companyOnly','findPeople',s.config->'findPeople','includeCompanyPeople',s.config->'includeCompanyPeople','includePhones',s.config->'includePhones','hybridResult',s.config->'hybridResult');
  IF s.config ? 'firmableSearchPages' THEN cfg:=cfg||jsonb_build_object('firmableSearchPages',s.config->'firmableSearchPages');END IF;
  IF s.config ? 'webSearchPages' THEN cfg:=cfg||jsonb_build_object('webSearchPages',s.config->'webSearchPages');END IF;
  IF octet_length(cfg::text)>4194304 THEN RAISE EXCEPTION 'Saved continuation evidence exceeds bounded snapshot';END IF;
  -- Include rejected claims if any root or dispatch/provider effect remains.
  -- Never omit uncertainty or infer that a missing child means no attempt.
  IF EXISTS(SELECT 1 FROM public.agent_operations o WHERE o.organization_id=org AND o.mandate_id=t.mandate_id AND o.name='research.start'
   AND o.input->'config'->'companyContinuation'->>'sourceRootId'=s.id::text
   AND (jsonb_typeof(o.input->'config'->'companyContinuation'->'candidateKeys') IS DISTINCT FROM 'array'
    OR jsonb_array_length(o.input->'config'->'companyContinuation'->'candidateKeys')>800))
  THEN RAISE EXCEPTION 'Bounded continuation claims required';END IF;
  SELECT coalesce(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO claims FROM(
   SELECT DISTINCT x.key FROM public.agent_operations o CROSS JOIN LATERAL jsonb_array_elements_text(o.input->'config'->'companyContinuation'->'candidateKeys')x(key)
   WHERE o.organization_id=org AND o.mandate_id=t.mandate_id AND o.name='research.start'
   AND o.input->'config'->'companyContinuation'->>'sourceRootId'=s.id::text
   AND (o.state<>'rejected'
    OR EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.organization_id=org AND j.config->'nativeAgent'->>'operationId'=o.id::text)
    OR EXISTS(SELECT 1 FROM public.agent_operations effect WHERE effect.organization_id=org AND effect.input->>'researchOperationId'=o.id::text AND effect.name IN('research.worker_dispatch','research.provider')))
  )claimed;
  IF jsonb_array_length(claims)>800 THEN RAISE EXCEPTION 'Bounded continuation claims required';END IF;
  WITH roots AS(
   SELECT j.id,j.config->'nativeAgent'->>'operationId' operation_id FROM public.research_jobs j
   WHERE j.organization_id=org AND j.mandate_id=t.mandate_id AND (j.id=s.id OR j.config->'companyContinuation'->>'sourceRootId'=s.id::text)
  ),ids AS(
   SELECT encode(sha256(convert_to(root.id::text||':firmable:'||(item->>'candidateKey'),'UTF8')),'hex') h,root.id root_id,root.operation_id
   FROM roots root CROSS JOIN LATERAL jsonb_array_elements(manifest)item
  ),expected AS(
   SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid id,root_id,operation_id FROM ids
  ),observed AS(
   SELECT DISTINCT ON(child.id) child.id,child.config,coalesce(root.operation_id,expected.operation_id) operation_id
   FROM public.research_jobs child LEFT JOIN roots root ON child.config->>'parentJobId'=root.id::text LEFT JOIN expected ON child.id=expected.id
   WHERE child.organization_id=org AND child.mandate_id=t.mandate_id AND (root.id IS NOT NULL OR expected.id IS NOT NULL)
   ORDER BY child.id,root.id,expected.root_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'config',jsonb_strip_nulls(jsonb_build_object(
   'parentJobId',config->'parentJobId','firmableCompanyId',config->'firmableCompanyId','hybridFirmableId',config->'hybridFirmableId',
   'hybridExpectedDomain',config->'hybridExpectedDomain','companyDomain',config->'companyDomain','nativeAgent',jsonb_build_object('operationId',operation_id)))) ORDER BY id),'[]'::jsonb)
  INTO children FROM observed;
  IF jsonb_array_length(children)>1600 OR octet_length(children::text)>4194304 THEN RAISE EXCEPTION 'Company continuation effects exceed bounded snapshot';END IF;
  result:=result||jsonb_build_array(jsonb_build_object('id',s.id,'status',s.status,'config',cfg,'claimedKeys',claims,'children',children));
 END LOOP;
 IF p_source IS NOT NULL AND jsonb_array_length(result)<>1 THEN RAISE EXCEPTION 'Owned original partial company-only V4 source required';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_company_continuation_sources(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_company_continuation_sources(uuid,uuid) TO acquire_agent_user;
