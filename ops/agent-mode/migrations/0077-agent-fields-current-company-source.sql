-- AG26: one current company-source validator for reviewed field planning and persistence.
-- 0075 remains immutable. No receipt, provider or phase-budget authority is changed.
CREATE FUNCTION public.agent_current_company_projection(p_org text,p_mandate uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o record;p public.company_membership_projections%ROWTYPE;stamp record;
BEGIN
 SELECT id,input_digest INTO o FROM public.company_identity_accepted_observations WHERE organization_id=p_org AND mandate_id=p_mandate AND target_id=p_target ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT g.xmin::text AS target_revision,m.xmin::text AS mandate_revision,mt.version AS membership_version,mt.xmin::text AS membership_revision INTO stamp
 FROM public.mandates m JOIN public.mandate_targets mt ON mt.organization_id=m.organization_id AND mt.mandate_id=m.id JOIN public.targets g ON g.id=mt.target_id AND g.organization_id=m.organization_id WHERE m.id=p_mandate AND m.organization_id=p_org AND g.id=p_target;
 SELECT * INTO p FROM public.company_membership_projections WHERE organization_id=p_org AND mandate_id=p_mandate AND target_id=p_target;
 IF stamp.mandate_revision IS NULL OR p.target_id IS NULL OR p.mandate_revision IS DISTINCT FROM stamp.mandate_revision OR p.membership_version IS DISTINCT FROM stamp.membership_version OR p.membership_revision IS DISTINCT FROM stamp.membership_revision OR p.target_revision IS DISTINCT FROM stamp.target_revision OR p.observation_id IS DISTINCT FROM o.id OR p.observation_digest IS DISTINCT FROM o.input_digest OR p.findings_digest IS DISTINCT FROM public.agent_company_findings_digest(p_org,p_mandate,p_target)
 OR p.projection->>'digest' IS DISTINCT FROM p.projection_digest OR p.projection->'observation'->>'id' IS DISTINCT FROM o.id::text OR p.projection->'observation'->>'digest' IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Current company source projection requires refresh';END IF;
 RETURN p.projection;
END $$;

REVOKE ALL ON FUNCTION public.agent_current_company_projection(text,uuid,uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE OR REPLACE FUNCTION public.agent_company_membership_projection(p_mandate uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.agent_threads WHERE organization_id=org AND mandate_id=p_mandate AND owner_user_id=actor) THEN RAISE EXCEPTION 'Owned current company projection scope required';END IF;
 RETURN public.agent_current_company_projection(org,p_mandate,p_target);
END $$;
CREATE FUNCTION public.agent_fields_current_source(p_org text,p_mandate uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base text;projection jsonb;
BEGIN
 SELECT encode(sha256(convert_to(jsonb_build_object('target',g.xmin::text,'membership',mt.version,'assessment',mt.assessment)::text,'UTF8')),'hex') INTO base FROM public.targets g JOIN public.mandate_targets mt ON mt.target_id=g.id AND mt.organization_id=g.organization_id AND mt.mandate_id=p_mandate WHERE g.id=p_target AND g.organization_id=p_org;
 IF base IS NULL THEN RAISE EXCEPTION 'Owned public company membership required';END IF;
 projection:=public.agent_current_company_projection(p_org,p_mandate,p_target);
 IF projection IS NULL THEN RETURN jsonb_build_object('sourceRevision',base);END IF;
 RETURN jsonb_build_object('sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,projection->>'digest')),'UTF8')),'hex'),'projection',projection);
END $$;
REVOKE ALL ON FUNCTION public.agent_fields_current_source(text,uuid,uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
ALTER FUNCTION public.agent_fields_company_snapshot(uuid,uuid,uuid[],uuid) RENAME TO agent_fields_snapshot_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_fields_snapshot_before_company_projection(uuid,uuid,uuid[],uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_fields_company_snapshot(p_thread uuid,p_root uuid,p_targets uuid[] DEFAULT NULL,p_ignore uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE snapshot jsonb;item jsonb;items jsonb:='[]';mid uuid;source jsonb;projection jsonb;reasons jsonb;
BEGIN
 snapshot:=public.agent_fields_snapshot_before_company_projection(p_thread,p_root,p_targets,p_ignore);
 SELECT mandate_id INTO mid FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'companies') LOOP
  source:=public.agent_fields_current_source(current_setting('app.acquire_org',true),mid,(item->>'targetId')::uuid);projection:=source->'projection';
  IF projection IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(reason),'[]') INTO reasons FROM jsonb_array_elements(item->'blockedReasons')reason WHERE reason<>'"company_excluded"'::jsonb;
   item:=item||jsonb_build_object('target',projection->'target','sourceRevision',source->>'sourceRevision','blockedReasons',reasons||(projection->'blockedReasons'),'companyIdentityPolicyVersion',1);
  END IF;items:=items||jsonb_build_array(item);
 END LOOP;RETURN snapshot||jsonb_build_object('companies',items);
END $$;
REVOKE ALL ON FUNCTION public.agent_fields_company_snapshot(uuid,uuid,uuid[],uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_fields_company_snapshot(uuid,uuid,uuid[],uuid) TO acquire_agent_user;
-- Normal trusted evidence transactions have no scoped actor role. This exact
-- job entry proves that authority, then invokes the same private source helper.
CREATE FUNCTION public.agent_fields_persistence_permitted(p_job uuid,p_org text,p_mandate uuid,p_actor text,p_config jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.research_jobs%ROWTYPE;o public.agent_operations%ROWTYPE;r public.agent_responsibilities%ROWTYPE;mr text;s jsonb;source jsonb;
BEGIN
 IF current_setting('role',true) IN('acquire_agent_user','acquire_campaign_user','acquire_agent_worker') THEN RAISE EXCEPTION 'Trusted public-field persistence required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=p_job AND organization_id=p_org AND mandate_id=p_mandate AND created_by=p_actor AND config=p_config FOR SHARE;
 IF j.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=j.organization_id AND user_id=j.created_by)
 OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=(7426619361492031::bigint>>32)::oid AND objid=(7426619361492031::bigint&4294967295::bigint)::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=j.organization_id AND writer_xid=txid_current()) THEN RETURN false;END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id::text=j.config->'nativeAgent'->>'operationId' AND organization_id=j.organization_id AND mandate_id=j.mandate_id AND owner_user_id=j.created_by AND name='research.fields' AND state='running' FOR SHARE;
 SELECT * INTO r FROM public.agent_responsibilities WHERE id::text=j.config->'nativeAgent'->>'responsibilityId' AND thread_id=o.thread_id AND organization_id=j.organization_id AND mandate_id=j.mandate_id AND owner_user_id=j.created_by FOR SHARE;
 SELECT xmin::text INTO mr FROM public.mandates WHERE id=j.mandate_id AND organization_id=j.organization_id FOR SHARE;
 IF o.id IS NULL OR r.id IS NULL OR r.state NOT IN('ready','waiting') OR r.revision::text IS DISTINCT FROM j.config->'nativeAgent'->>'responsibilityRevision' OR r.mandate_revision IS DISTINCT FROM j.config->'nativeAgent'->>'mandateRevision' OR mr IS DISTINCT FROM r.mandate_revision OR o.input->'config'->>'requestId' IS DISTINCT FROM j.config->>'parentJobId' THEN RETURN false;END IF;
 SELECT value INTO s FROM jsonb_array_elements(o.input->'selected') WHERE value->>'targetId'=j.config->>'targetId' AND value->>'childJobId'=j.id::text;
 IF s IS NULL OR s->>'sourceRevision' IS DISTINCT FROM j.config->>'nativeFieldsSourceRevision' OR s->'fields' IS DISTINCT FROM j.config->'companyBackgroundResearch'->'fields' OR s->>'verifyAbn' IS DISTINCT FROM j.config->'companyBackgroundResearch'->>'verifyAbn' OR s->'companyIdentityPolicyVersion' IS DISTINCT FROM j.config->'companyIdentityPolicyVersion' THEN RETURN false;END IF;
 source:=public.agent_fields_current_source(j.organization_id,j.mandate_id,(s->>'targetId')::uuid);
 RETURN s->>'sourceRevision'=source->>'sourceRevision' AND (source->'projection' IS NULL OR jsonb_array_length(source->'projection'->'blockedReasons')=0);
END $$;
REVOKE ALL ON FUNCTION public.agent_fields_persistence_permitted(uuid,text,uuid,text,jsonb) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;

ALTER FUNCTION public.agent_create_fields_job(uuid) RENAME TO agent_fields_job_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_fields_job_before_company_projection(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_create_fields_job(operation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt jsonb;o public.agent_operations%ROWTYPE;s jsonb;source jsonb;
BEGIN
 -- The unchanged 0071 kernel establishes exact HIL, scope, supervision,
 -- budget escrow and immutable job handles before any saved config is extended.
 receipt:=public.agent_fields_job_before_company_projection(operation);
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR s IN SELECT value FROM jsonb_array_elements(o.input->'selected') LOOP
  source:=public.agent_fields_current_source(o.organization_id,o.mandate_id,(s->>'targetId')::uuid);
  IF s->'companyIdentityPolicyVersion' IS DISTINCT FROM (CASE WHEN source->'projection' IS NULL THEN NULL ELSE '1'::jsonb END) THEN RAISE EXCEPTION 'Exact reviewed company identity policy required';END IF;
  IF s->>'companyIdentityPolicyVersion'='1' THEN
   UPDATE public.research_jobs SET config=config||jsonb_build_object('companyIdentityPolicyVersion',1) WHERE id=(s->>'childJobId')::uuid AND organization_id=o.organization_id AND mandate_id=o.mandate_id AND created_by=o.owner_user_id AND config->'nativeAgent'->>'operationId'=o.id::text AND config->>'companyIdentityPolicyVersion' IS DISTINCT FROM '1';
  END IF;
 END LOOP;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.agent_create_fields_job(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
GRANT EXECUTE ON FUNCTION public.agent_create_fields_job(uuid) TO acquire_agent_user;
