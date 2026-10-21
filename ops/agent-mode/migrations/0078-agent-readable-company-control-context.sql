-- AG26: readable control/history CAS is not proof that company evidence is
-- current enough for a new effect. Keep all 0075/0077 fresh readers and effect
-- gates intact. Original receipt and no-submission paths are unchanged.
CREATE OR REPLACE FUNCTION public.agent_context_revision(p_conversation uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base text;mid uuid;target uuid;org text:=current_setting('app.acquire_org',true);projection jsonb;frame jsonb;
BEGIN
 -- This original chain still proves the owned conversation/current member and
 -- carries all person, account, policy, history and invitation context.
 base:=public.agent_context_revision_before_company_projection(p_conversation);
 SELECT c.mandate_id,p.target_id INTO mid,target FROM public.agent_conversations c JOIN public.contacts p ON p.id=c.contact_id AND p.organization_id=c.organization_id WHERE c.id=p_conversation AND c.organization_id=org AND c.owner_user_id=current_setting('app.acquire_user',true);
 IF target IS NULL THEN RETURN base;END IF;
 BEGIN
  projection:=public.agent_current_company_projection(org,mid,target);
 EXCEPTION WHEN raise_exception THEN
  -- A stale/missing publication must not erase the normal Pause/Resume/history
  -- controls. Do not suppress ownership, membership or other database errors.
  IF SQLERRM IS DISTINCT FROM 'Current company source projection requires refresh' THEN RAISE;END IF;
  SELECT jsonb_build_object(
   'kind','stale-company-source-v1',
   'accepted',(SELECT jsonb_build_array(o.id,o.input_digest) FROM public.company_identity_accepted_observations o WHERE o.organization_id=org AND o.mandate_id=mid AND o.target_id=target ORDER BY o.observed_at DESC,o.created_at DESC,o.id DESC LIMIT 1),
   'current',(SELECT jsonb_build_array(m.xmin::text,mt.version,mt.xmin::text,g.xmin::text) FROM public.mandates m JOIN public.mandate_targets mt ON mt.organization_id=m.organization_id AND mt.mandate_id=m.id JOIN public.targets g ON g.organization_id=m.organization_id AND g.id=mt.target_id WHERE m.organization_id=org AND m.id=mid AND g.id=target),
   'findings',public.agent_company_findings_digest(org,mid,target),
   'published',(SELECT jsonb_build_array(p.mandate_revision,p.membership_version,p.membership_revision,p.target_revision,p.observation_id,p.observation_digest,p.findings_digest,p.projection_digest,encode(sha256(convert_to(p.projection::text,'UTF8')),'hex')) FROM public.company_membership_projections p WHERE p.organization_id=org AND p.mandate_id=mid AND p.target_id=target)
  ) INTO frame;
  RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,frame)),'UTF8')),'hex');
 END;
 -- Preserve the exact existing CAS for fresh accepted sources and for all
 -- legacy/no-observation handles. No new authority is implied by this digest.
 IF projection IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,projection->>'digest')),'UTF8')),'hex');
END $$;
