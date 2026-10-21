-- Correct the demonstrated PostgreSQL 42702 domain identifier ambiguity.
-- 0089 stays immutable. Only the local variable is renamed; scope, source,
-- pricing, locking, privacy and all original receipts are unchanged.
CREATE OR REPLACE FUNCTION public.agent_automatic_people_context(operation uuid,target uuid,firmable_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;j public.research_jobs%ROWTYPE;source jsonb;projection jsonb;item jsonb;saved jsonb;company_domain text;aliases uuid[];identity_keys text[];identity_aliases uuid[];assessment jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor AND name='research.start' AND state='running' FOR UPDATE;
 IF o.id IS NULL OR NOT public.agent_research_v5_scope(o.input) OR firmable_id IS NULL OR firmable_id!~'^f[0-9]+$' OR target IS NULL THEN RAISE EXCEPTION 'Current approved V5 automatic People scope required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_review_batches b WHERE b.thread_id=o.thread_id AND b.organization_id=org AND b.owner_user_id=actor AND b.state='approved' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision'))) THEN RAISE EXCEPTION 'Exact initial automatic People approval required';END IF;
 SELECT * INTO j FROM public.research_jobs WHERE id=(o.input->'config'->>'requestId')::uuid AND organization_id=org AND mandate_id=o.mandate_id AND created_by=actor AND config->'nativeAgent'->>'operationId'=o.id::text FOR UPDATE;
 IF j.id IS NULL OR j.status NOT IN('queued','discovering','extracting','crawling') OR j.config->>'includeCompanyPeople' IS DISTINCT FROM 'true' OR j.config->>'includePhones' IS DISTINCT FROM 'false' OR j.config->>'findPeople' IS DISTINCT FROM 'false' OR j.config ? 'companyOnly' OR j.config->'companyDiscoveryPolicy' IS DISTINCT FROM o.input->'config'->'companyDiscoveryPolicy' OR j.config->'nativeAgent'->>'providerAdmission' IS DISTINCT FROM 'hybrid-company-v1' OR NOT coalesce((public.agent_research_phase_budget_status(o.id)->>'ready')::boolean,false) THEN RAISE EXCEPTION 'Saved current automatic People root and funding required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.research_jobs child WHERE child.organization_id=org AND child.mandate_id=o.mandate_id AND child.created_by=actor AND child.config->>'parentJobId'=j.id::text AND child.config->>'targetId'=target::text AND child.status IN('complete','partial') AND (child.config->>'firmableCompanyId'=firmable_id OR child.config->>'hybridFirmableId'=firmable_id)) THEN RAISE EXCEPTION 'Accepted original company result required before People';END IF;
 -- Exact membership/source lookup, never the historical ranked/top-50 People
 -- selection. Scoring is evidence for the GUI, not admission for this V5 rule.
 SELECT mt.assessment INTO assessment FROM public.mandate_targets mt WHERE mt.organization_id=org AND mt.mandate_id=o.mandate_id AND mt.target_id=target;
 IF NOT FOUND OR assessment->>'stage' IN('contacted','in-conversation') OR (assessment->>'stage' IN('excluded','parked') AND assessment->>'decisionOrigin' IS DISTINCT FROM 'automatic') THEN RAISE EXCEPTION 'Current explicitly available company membership required';END IF;
 source:=public.agent_fields_current_source(org,o.mandate_id,target);projection:=source->'projection';
 IF projection IS NULL OR projection->'target'->>'firmableCompanyId' IS DISTINCT FROM firmable_id THEN RAISE EXCEPTION 'Current accepted canonical company source required';END IF;
 item:=jsonb_build_object('targetId',target,'firmableId',firmable_id,'sourceRevision',source->>'sourceRevision');
 company_domain:=projection->'target'->>'domain';
 SELECT array_agg(p.id) INTO aliases FROM public.contacts p JOIN public.targets g ON g.id=p.target_id AND g.organization_id=org WHERE p.organization_id=org AND (g.id=target OR (coalesce(company_domain,'')<>'' AND lower(regexp_replace(g.domain,'^www[.]',''))=lower(regexp_replace(company_domain,'^www[.]',''))) OR g.firmable_company_id=firmable_id);
 WITH batch AS MATERIALIZED(SELECT * FROM public.agent_contact_identity_batch(org,coalesce(aliases,'{}'::uuid[])))
 SELECT ARRAY(SELECT DISTINCT unnest(b.identity_keys) FROM batch b),ARRAY(SELECT DISTINCT unnest(b.contact_aliases) FROM batch b) INTO identity_keys,identity_aliases;
 IF EXISTS(SELECT 1 FROM public.campaign_enrolments e WHERE e.organization_id=org AND e.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])))
 OR EXISTS(SELECT 1 FROM public.messages x JOIN public.sequence_enrolments se ON se.id=x.enrolment_id WHERE x.organization_id=org AND se.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND x.state='sent')
 OR EXISTS(SELECT 1 FROM public.campaign_inbound_events e WHERE e.organization_id=org AND e.contact_id=ANY(coalesce(identity_aliases,'{}'::uuid[])))
 OR EXISTS(SELECT 1 FROM public.agent_person_claims claim WHERE claim.organization_id=org AND claim.identity_key=ANY(coalesce(identity_keys,'{}'::text[]))) THEN RAISE EXCEPTION 'Previous outreach or owned conversation requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND coalesce(p.personal_data->>'doNotContact','false')<>'false')
 OR public.agent_aliases_have_unresolved_sends(identity_aliases,NULL::uuid,true)
 OR EXISTS(SELECT 1 FROM public.suppressions suppression WHERE suppression.organization_id=org AND ((coalesce(company_domain,'')<>'' AND lower(regexp_replace(suppression.domain,'^www[.]',''))=lower(regexp_replace(company_domain,'^www[.]',''))) OR EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND lower(suppression.address)=lower(p.personal_data->>'email')))) THEN RAISE EXCEPTION 'Opt-out, suppression or unresolved outcome requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.contacts p WHERE p.id=ANY(coalesce(identity_aliases,'{}'::uuid[])) AND NOT p.fictionalised AND coalesce(p.personal_data->>'email','')~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AND p.provenance->>'nativeAutomaticPeopleOperationId' IS DISTINCT FROM o.id::text) THEN RAISE EXCEPTION 'Existing cached contact requires review';END IF;
 IF EXISTS(SELECT 1 FROM public.firmable_sync_runs run WHERE run.organization_id=org AND run.target_id=target AND run.status IN('queued','running'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.organization_id=org AND other.id<>o.id AND other.name='research.people' AND other.state IN('proposed','approved','running','uncertain') AND EXISTS(SELECT 1 FROM jsonb_array_elements(other.input->'selected') selection WHERE selection->>'targetId'=target::text OR selection->>'firmableId'=firmable_id))
 OR EXISTS(SELECT 1 FROM public.research_jobs other JOIN public.agent_operations parent ON parent.id::text=other.config->'nativeAgent'->>'operationId' AND parent.organization_id=org WHERE other.organization_id=org AND other.id<>j.id AND other.config->'automaticPeopleCompanies' @> jsonb_build_object(target::text,jsonb_build_object('firmableId',firmable_id)) AND (parent.state IN('approved','running','uncertain') OR EXISTS(SELECT 1 FROM public.agent_operations attempt WHERE attempt.organization_id=org AND attempt.input->>'researchOperationId'=parent.id::text AND attempt.input->>'targetId'=target::text AND attempt.name='research.provider' AND attempt.state IN('running','uncertain')))) THEN RAISE EXCEPTION 'Existing People work requires its original outcome';END IF;
 saved:=j.config->'automaticPeopleCompanies'->target::text;
 IF saved IS NOT NULL THEN
  IF saved->>'targetId' IS DISTINCT FROM target::text OR saved->>'firmableId' IS DISTINCT FROM firmable_id OR saved->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' THEN RAISE EXCEPTION 'Automatic People company source changed';END IF;
 ELSE
  IF jsonb_typeof(coalesce(j.config->'automaticPeopleCompanies','{}'::jsonb))<>'object' OR (SELECT count(*) FROM jsonb_object_keys(coalesce(j.config->'automaticPeopleCompanies','{}'::jsonb)))>=800 THEN RAISE EXCEPTION 'Automatic People company bound reached';END IF;
  saved:=jsonb_build_object('targetId',target,'firmableId',firmable_id,'sourceRevision',item->>'sourceRevision','maxContactsPerCompany',3);
  UPDATE public.research_jobs SET config=jsonb_set(config,'{automaticPeopleCompanies}',coalesce(config->'automaticPeopleCompanies','{}'::jsonb)||jsonb_build_object(target::text,saved)),updated_at=clock_timestamp() WHERE id=j.id;
 END IF;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.agent_automatic_people_context(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_automatic_people_context(uuid,uuid,text) TO acquire_agent_user;
