-- One reviewed continuation generation for explicitly never-started V4 company
-- candidates. No new ledger or retry authority. The app separately recomputes
-- the full canonical sourceDigest at review/dispatch/provider/persistence; SQL
-- independently fences owned current manifest identities and existing effects.
CREATE FUNCTION public.agent_assert_company_continuation(operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
 o public.agent_operations%ROWTYPE;s public.research_jobs%ROWTYPE;original public.agent_operations%ROWTYPE;
 meta jsonb;selection jsonb;item jsonb;key text;fid text;domain text;keys text[];h text;child_id uuid;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF o.id IS NULL OR o.name<>'research.start' THEN RAISE EXCEPTION 'Owned company continuation operation required';END IF;
 IF NOT(o.input->'config' ? 'companyContinuation') THEN RETURN NULL;END IF;
 meta:=o.input->'config'->'companyContinuation';
 IF jsonb_typeof(meta) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(meta))<>4
 OR meta->'version' IS DISTINCT FROM '1'::jsonb OR coalesce(meta->>'sourceRootId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR coalesce(meta->>'sourceDigest','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(meta->'candidateKeys') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Exact company continuation metadata required';END IF;
 IF jsonb_array_length(meta->'candidateKeys') NOT BETWEEN 1 AND 800
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(meta->'candidateKeys') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}') NOT BETWEEN 3 AND 320)
 THEN RAISE EXCEPTION 'Bounded company continuation selection required';END IF;
 SELECT array_agg(value) INTO keys FROM jsonb_array_elements_text(meta->'candidateKeys');
 IF cardinality(keys)<>(SELECT count(DISTINCT x) FROM unnest(keys)x) THEN RAISE EXCEPTION 'Distinct company continuation candidates required';END IF;
 SELECT * INTO s FROM public.research_jobs WHERE id=(meta->>'sourceRootId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor FOR UPDATE;
 IF s.id IS NULL OR s.status<>'partial' OR s.id::text=o.input->'config'->>'requestId'
 OR s.config ? 'companyContinuation' OR s.config->'companyDiscoveryPolicy'->>'version' IS DISTINCT FROM '4'
 OR s.config->'companyIdentityPolicyVersion' IS DISTINCT FROM '1'::jsonb OR s.config->'companyOnly' IS DISTINCT FROM 'true'::jsonb
 OR s.config->'findPeople' IS DISTINCT FROM 'false'::jsonb OR s.config->'includeCompanyPeople' IS DISTINCT FROM 'false'::jsonb OR s.config->'includePhones' IS DISTINCT FROM 'false'::jsonb
 OR s.config->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'hybrid-company-v1'
 THEN RAISE EXCEPTION 'Owned original partial company-only V4 source required';END IF;
 SELECT * INTO original FROM public.agent_operations WHERE id::text=s.config->'nativeAgent'->>'operationId' AND organization_id=org AND owner_user_id=actor AND mandate_id=o.mandate_id AND thread_id=o.thread_id AND name='research.start' AND state='complete';
 IF original.id IS NULL OR original.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1'
 OR original.input->'config'->>'requestId' IS DISTINCT FROM s.id::text
 OR original.input->'config'->'companyDiscoveryPolicy' IS DISTINCT FROM s.config->'companyDiscoveryPolicy'
 THEN RAISE EXCEPTION 'Completed owned source operation required';END IF;
 IF o.input->>'nativeResearchPlanVersion' IS DISTINCT FROM '1'
 OR o.input->'config'->'companyDiscoveryPolicy' IS DISTINCT FROM s.config->'companyDiscoveryPolicy'
 OR o.input->'config'->'companyIdentityPolicyVersion' IS DISTINCT FROM '1'::jsonb OR o.input->'config'->'companyOnly' IS DISTINCT FROM 'true'::jsonb
 OR o.input->'config'->'findPeople' IS DISTINCT FROM 'false'::jsonb OR o.input->'config'->'includeCompanyPeople' IS DISTINCT FROM 'false'::jsonb OR o.input->'config'->'includePhones' IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'Company-only V4 continuation scope required';END IF;
 selection:=s.config->'hybridResult'->'selection';
 IF jsonb_typeof(selection) IS DISTINCT FROM 'array' OR jsonb_array_length(selection) NOT BETWEEN 1 AND 800 THEN RAISE EXCEPTION 'Saved bounded company candidate manifest required';END IF;
 -- The source row lock and the existing organization gate serialize competing
 -- claims, including proposals in different threads. Failed/uncertain/completed
 -- descendants retain their claim; rejection releases only a proposal that has
 -- no root, dispatch or physical effect whatsoever.
 IF EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.organization_id=org AND other.mandate_id=o.mandate_id AND other.id<>o.id AND other.name='research.start'
 AND other.input->'config'->'companyContinuation'->>'sourceRootId'=s.id::text
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(other.input->'config'->'companyContinuation'->'candidateKeys')='array' THEN other.input->'config'->'companyContinuation'->'candidateKeys' ELSE '[]'::jsonb END)x WHERE x=ANY(keys))
 AND (other.state<>'rejected'
 OR EXISTS(SELECT 1 FROM public.research_jobs j WHERE j.organization_id=org AND j.config->'nativeAgent'->>'operationId'=other.id::text)
 OR EXISTS(SELECT 1 FROM public.agent_operations effect WHERE effect.organization_id=org AND effect.input->>'researchOperationId'=other.id::text AND effect.name IN('research.worker_dispatch','research.provider'))))
 THEN RAISE EXCEPTION 'Company continuation candidate already claimed';END IF;
 FOREACH key IN ARRAY keys LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(selection)x WHERE x->>'candidateKey'=key)<>1 THEN RAISE EXCEPTION 'Exact saved company candidate required';END IF;
  SELECT value INTO item FROM jsonb_array_elements(selection) WHERE value->>'candidateKey'=key;
  domain:=coalesce(item->>'domain','');fid:=nullif(item->>'firmableId','');
  IF item->>'outcome' IS DISTINCT FROM 'not_started' OR domain<>lower(domain)
  OR (fid IS NOT NULL AND (fid !~ '^f[0-9]+$' OR key IS DISTINCT FROM 'firmable:'||fid))
  OR (fid IS NULL AND (domain='' OR key IS DISTINCT FROM 'domain:'||domain))
  THEN RAISE EXCEPTION 'Explicit never-started company identity required';END IF;
  h:=encode(sha256(convert_to(s.id::text||':firmable:'||key,'UTF8')),'hex');
  child_id:=(substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid;
  IF EXISTS(SELECT 1 FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id
  AND (child.id=child_id OR child.config->>'parentJobId'=s.id::text
   OR EXISTS(SELECT 1 FROM public.research_jobs descendant WHERE descendant.organization_id=org AND descendant.mandate_id=o.mandate_id AND descendant.config->'companyContinuation'->>'sourceRootId'=s.id::text AND descendant.config->'nativeAgent'->>'operationId' IS DISTINCT FROM o.id::text AND child.config->>'parentJobId'=descendant.id::text))
  AND (child.id=child_id OR (fid IS NOT NULL AND (child.config->>'hybridFirmableId'=fid OR child.config->>'firmableCompanyId'=fid)) OR (domain<>'' AND (child.config->>'hybridExpectedDomain'=domain OR child.config->>'companyDomain'=domain))))
  THEN RAISE EXCEPTION 'Company candidate already has original or descendant work';END IF;
 END LOOP;
 RETURN jsonb_build_object('version',1,'sourceRootId',s.id,'sourceDigest',meta->>'sourceDigest','candidateKeys',meta->'candidateKeys');
END $$;
REVOKE ALL ON FUNCTION public.agent_assert_company_continuation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_assert_company_continuation(uuid) TO acquire_agent_user;

CREATE FUNCTION public.agent_company_continuation_operation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.name='research.start' AND OLD.input->'config' ? 'companyContinuation'
 AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.input->'config'->'companyContinuation' IS DISTINCT FROM OLD.input->'config'->'companyContinuation') THEN RAISE EXCEPTION 'Original company continuation claim cannot be removed or changed';END IF;
 IF NEW.name='research.start' AND NEW.input->'config' ? 'companyContinuation'
 AND (TG_OP='INSERT' OR NEW.input IS DISTINCT FROM OLD.input OR (OLD.state='proposed' AND NEW.state IN('approved','running')))
 THEN PERFORM public.agent_assert_company_continuation(NEW.id);END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_company_continuation_operation_guard() FROM PUBLIC;
CREATE TRIGGER agent_company_continuation_operation_guard AFTER INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.agent_company_continuation_operation_guard();

CREATE FUNCTION public.agent_company_continuation_job_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE operation uuid;approved boolean;
BEGIN
 -- A company profile child inherits the envelope but its original root owns
 -- review/dispatch. Do not treat the child's insert as a second root launch.
 IF NEW.config ? 'companyContinuation' AND (NEW.config->>'researchTask' IS DISTINCT FROM 'company' OR NEW.id::text=NEW.config->>'researchRunId') THEN
  IF NEW.config->'nativeAgent'->>'operationId' IS NULL THEN RAISE EXCEPTION 'Native reviewed company continuation required';END IF;
  operation:=(NEW.config->'nativeAgent'->>'operationId')::uuid;
  PERFORM public.agent_assert_company_continuation(operation);
  SELECT o.state IN('approved','running') AND o.organization_id=NEW.organization_id AND o.owner_user_id=NEW.created_by AND o.mandate_id=NEW.mandate_id
   AND o.input->'config'->>'requestId'=NEW.id::text AND o.input->'config'->'companyContinuation'=NEW.config->'companyContinuation'
   AND EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=o.organization_id AND b.owner_user_id=o.owner_user_id AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')))
  INTO approved FROM public.agent_operations o WHERE o.id=operation;
  IF approved IS DISTINCT FROM true THEN RAISE EXCEPTION 'Exact approved company continuation root required';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_company_continuation_job_guard() FROM PUBLIC;
CREATE TRIGGER agent_company_continuation_job_guard AFTER INSERT ON public.research_jobs FOR EACH ROW EXECUTE FUNCTION public.agent_company_continuation_job_guard();
