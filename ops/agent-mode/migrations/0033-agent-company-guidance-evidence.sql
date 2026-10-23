-- Read-only, bounded company evidence for already scoped people planning.
-- No raw targets/research_findings privilege is granted to the agent role.
CREATE FUNCTION public.agent_people_company_evidence(p_thread uuid,p_targets uuid[]) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;result jsonb:='{}';c record;findings jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL OR p_targets IS NULL OR cardinality(p_targets)>50 THEN RAISE EXCEPTION 'Owned bounded company evidence scope required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r JOIN public.mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.thread_id=t.id AND r.owner_user_id=actor AND r.organization_id=org AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text) THEN RAISE EXCEPTION 'Current company planning supervision required';END IF;
 FOR c IN SELECT g.id,g.company_name,g.domain,g.firmographics FROM public.targets g JOIN public.mandate_targets mt ON mt.target_id=g.id AND mt.organization_id=g.organization_id WHERE g.organization_id=org AND mt.mandate_id=t.mandate_id AND g.id=ANY(p_targets) ORDER BY g.id LIMIT 50 LOOP
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'evidence',f.evidence) ORDER BY f.observed_at DESC,f.id),'[]') INTO findings FROM(SELECT id,evidence,observed_at FROM public.research_findings WHERE organization_id=org AND mandate_id=t.mandate_id AND target_id=c.id ORDER BY observed_at DESC,id LIMIT 20)f;
  result:=result||jsonb_build_object(c.id::text,jsonb_build_object('companyName',c.company_name,'domain',c.domain,'firmographics',c.firmographics,'findings',findings));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_people_company_evidence(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_people_company_evidence(uuid,uuid[]) TO acquire_agent_user;
