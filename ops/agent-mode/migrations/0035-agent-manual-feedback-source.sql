-- Bounded read-only projection of a saved manual assessment or owned sequence
-- draft. Row SHARE locks retain the exact saved revision until feedback commits.
-- No raw business-table privilege and no research/responsibility authority.
CREATE FUNCTION public.agent_manual_feedback_source(p_thread uuid,p_kind text,p_entity uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);t public.agent_threads%ROWTYPE;result jsonb;c record;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=org AND owner_user_id=actor;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Owned feedback conversation required';END IF;
 IF p_kind='target_review' THEN
  SELECT mt.version,mt.assessment,g.company_name,g.domain INTO c
   FROM public.mandate_targets mt JOIN public.targets g ON g.id=mt.target_id AND g.organization_id=mt.organization_id
   WHERE mt.organization_id=org AND mt.mandate_id=t.mandate_id AND mt.target_id=p_entity FOR SHARE OF mt,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saved company review unavailable';END IF;
  result:=jsonb_build_object('kind',p_kind,'id',p_entity,'revision',c.version,'companyName',c.company_name,'domain',c.domain,'assessment',c.assessment);
 ELSIF p_kind='sequence_draft' THEN
  SELECT s.xmin::text AS revision,s.name,s.draft INTO c FROM public.campaign_sequences s
   WHERE s.id=p_entity AND s.organization_id=org AND s.owner_user_id=actor AND s.mandate_id=t.mandate_id FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned saved sequence draft unavailable';END IF;
  result:=jsonb_build_object('kind',p_kind,'id',p_entity,'revision',c.revision,'name',c.name,'draft',c.draft);
 ELSE RAISE EXCEPTION 'Unsupported manual feedback source';END IF;
 IF octet_length(result::text)>60000 THEN RAISE EXCEPTION 'Saved feedback source exceeds bounded snapshot';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.agent_manual_feedback_source(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_manual_feedback_source(uuid,text,uuid) TO acquire_agent_user;
