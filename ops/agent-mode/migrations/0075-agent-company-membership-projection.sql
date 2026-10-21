-- AG26: current-buyer company facts published only by the trusted shared writer.
-- Historical memberships without an accepted 0074 observation retain their original path.
CREATE TABLE public.company_membership_projections (
 organization_id text NOT NULL REFERENCES public.organization(id),
 mandate_id uuid NOT NULL REFERENCES public.mandates(id),target_id uuid NOT NULL REFERENCES public.targets(id),
 mandate_revision text NOT NULL,membership_version integer NOT NULL,membership_revision text NOT NULL,target_revision text NOT NULL,
 observation_id uuid NOT NULL REFERENCES public.company_identity_observations(id),observation_digest text NOT NULL CHECK(observation_digest~'^[a-f0-9]{64}$'),
 findings_digest text NOT NULL CHECK(findings_digest~'^[a-f0-9]{64}$'),projection_digest text NOT NULL CHECK(projection_digest~'^[a-f0-9]{64}$'),
 projection jsonb NOT NULL CHECK(jsonb_typeof(projection)='object' AND octet_length(projection::text)<=512000),
 published_by text NOT NULL REFERENCES public."user"(id),published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,mandate_id,target_id)
);
ALTER TABLE public.company_membership_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_membership_projections FORCE ROW LEVEL SECURITY;
CREATE POLICY company_projection_owner ON public.company_membership_projections TO PUBLIC
 USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.company_membership_projections'::regclass)))
 WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.company_membership_projections'::regclass)));
REVOKE ALL ON public.company_membership_projections FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
-- No raw scoped-role write or stale raw projection read grant. The reader below
-- proves ownership, membership and every live source stamp before returning data.
CREATE FUNCTION public.agent_company_projection_writer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE org text:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
BEGIN
 IF current_setting('role',true) IN('acquire_agent_user','acquire_campaign_user','acquire_agent_worker') OR current_user IN('acquire_agent_user','acquire_campaign_user','acquire_agent_worker')
 OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=(7426619361492031::bigint>>32)::oid AND objid=(7426619361492031::bigint&4294967295::bigint)::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Trusted global-first company publication required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER company_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON public.company_membership_projections FOR EACH ROW EXECUTE FUNCTION public.agent_company_projection_writer_guard();
REVOKE ALL ON FUNCTION public.agent_company_projection_writer_guard() FROM PUBLIC;
CREATE FUNCTION public.agent_company_findings_digest(p_org text,p_mandate uuid,p_target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(f.id,f.revision) ORDER BY f.observed_at DESC,f.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM(SELECT id,xmin::text AS revision,observed_at FROM public.research_findings WHERE organization_id=p_org AND mandate_id=p_mandate AND target_id=p_target ORDER BY observed_at DESC,id LIMIT 100)f
$$;
REVOKE ALL ON FUNCTION public.agent_company_findings_digest(text,uuid,uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_company_membership_projection(p_mandate uuid,p_target uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o record;p public.company_membership_projections%ROWTYPE;stamp record;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.agent_threads WHERE organization_id=org AND mandate_id=p_mandate AND owner_user_id=actor) THEN RAISE EXCEPTION 'Owned current company projection scope required';END IF;
 SELECT id,input_digest INTO o FROM public.company_identity_accepted_observations WHERE organization_id=org AND mandate_id=p_mandate AND target_id=p_target ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT g.xmin::text AS target_revision,m.xmin::text AS mandate_revision,mt.version AS membership_version,mt.xmin::text AS membership_revision INTO stamp
 FROM public.mandates m JOIN public.mandate_targets mt ON mt.organization_id=m.organization_id AND mt.mandate_id=m.id JOIN public.targets g ON g.id=mt.target_id AND g.organization_id=m.organization_id WHERE m.id=p_mandate AND m.organization_id=org AND g.id=p_target;
 SELECT * INTO p FROM public.company_membership_projections WHERE organization_id=org AND mandate_id=p_mandate AND target_id=p_target;
 IF stamp.mandate_revision IS NULL OR p.target_id IS NULL OR p.mandate_revision IS DISTINCT FROM stamp.mandate_revision OR p.membership_version IS DISTINCT FROM stamp.membership_version OR p.membership_revision IS DISTINCT FROM stamp.membership_revision OR p.target_revision IS DISTINCT FROM stamp.target_revision OR p.observation_id IS DISTINCT FROM o.id OR p.observation_digest IS DISTINCT FROM o.input_digest OR p.findings_digest IS DISTINCT FROM public.agent_company_findings_digest(org,p_mandate,p_target)
 OR p.projection->>'digest' IS DISTINCT FROM p.projection_digest OR p.projection->'observation'->>'id' IS DISTINCT FROM o.id::text OR p.projection->'observation'->>'digest' IS DISTINCT FROM o.input_digest THEN RAISE EXCEPTION 'Current company source projection requires refresh';END IF;
 RETURN p.projection;
END $$;
REVOKE ALL ON FUNCTION public.agent_company_membership_projection(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_company_membership_projection(uuid,uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_people_company_snapshot(uuid,uuid[],uuid) RENAME TO agent_people_company_snapshot_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_people_company_snapshot_before_company_projection(uuid,uuid[],uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_people_company_snapshot(p_thread uuid,p_targets uuid[] DEFAULT NULL,p_ignore_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE snapshot jsonb;item jsonb;items jsonb:='[]';projection jsonb;reasons jsonb;mid uuid;
BEGIN
 snapshot:=public.agent_people_company_snapshot_before_company_projection(p_thread,p_targets,p_ignore_operation);
 SELECT mandate_id INTO mid FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'companies') LOOP
  projection:=public.agent_company_membership_projection(mid,(item->>'targetId')::uuid);
  IF projection IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(reason),'[]') INTO reasons FROM jsonb_array_elements(item->'blockedReasons')reason WHERE reason<>'"company_excluded"'::jsonb;
   item:=item||jsonb_build_object('name',projection->'target'->>'companyName','firmableId',coalesce(projection->'target'->>'firmableCompanyId',''),'blockedReasons',reasons||(projection->'blockedReasons'),'sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(item->>'sourceRevision',projection->>'digest')),'UTF8')),'hex'));
  END IF;
  items:=items||jsonb_build_array(item);
 END LOOP;RETURN snapshot||jsonb_build_object('companies',items);
END $$;
REVOKE ALL ON FUNCTION public.agent_people_company_snapshot(uuid,uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_people_company_snapshot(uuid,uuid[],uuid) TO acquire_agent_user;
ALTER FUNCTION public.agent_target_snapshot(uuid,uuid[]) RENAME TO agent_target_snapshot_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_target_snapshot_before_company_projection(uuid,uuid[]) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_target_snapshot(p_thread uuid,p_contacts uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE snapshot jsonb;item jsonb;items jsonb:='[]';projection jsonb;mid uuid;
BEGIN
 snapshot:=public.agent_target_snapshot_before_company_projection(p_thread,p_contacts);
 SELECT mandate_id INTO mid FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'candidates') LOOP
  projection:=public.agent_company_membership_projection(mid,(item->>'targetId')::uuid);
  IF projection IS NOT NULL THEN item:=item||jsonb_build_object('target',projection->'target','assessment',projection->'assessment','blockedReasons',(item->'blockedReasons')||(projection->'blockedReasons'),'sourceRevision',encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(item->>'sourceRevision',projection->>'digest')),'UTF8')),'hex'));END IF;
  items:=items||jsonb_build_array(item);
 END LOOP;RETURN snapshot||jsonb_build_object('candidates',items);
END $$;
REVOKE ALL ON FUNCTION public.agent_target_snapshot(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_target_snapshot(uuid,uuid[]) TO acquire_agent_user;
ALTER FUNCTION public.agent_context_revision(uuid) RENAME TO agent_context_revision_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_context_revision_before_company_projection(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_context_revision(p_conversation uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base text;mid uuid;target uuid;projection jsonb;
BEGIN
 base:=public.agent_context_revision_before_company_projection(p_conversation);
 SELECT c.mandate_id,p.target_id INTO mid,target FROM public.agent_conversations c JOIN public.contacts p ON p.id=c.contact_id AND p.organization_id=c.organization_id WHERE c.id=p_conversation AND c.organization_id=current_setting('app.acquire_org',true) AND c.owner_user_id=current_setting('app.acquire_user',true);
 IF target IS NULL THEN RETURN base;END IF;
 projection:=public.agent_company_membership_projection(mid,target);IF projection IS NULL THEN RETURN base;END IF;
 RETURN encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(base,projection->>'digest')),'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION public.agent_context_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_context_revision(uuid) TO acquire_agent_user,acquire_campaign_user;
-- No original-intent lookup, receipt settlement or no-submission kernel changed.

-- Only admission of a NEW physical effect reads mutable company readiness.
-- Outcome recording/original intent/no-submission settlement do not use this gate.
CREATE FUNCTION public.agent_company_conversation_permitted(p_conversation uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c record;projection jsonb;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) THEN RAISE EXCEPTION 'Current company admission scope required';END IF;
 SELECT v.mandate_id,p.target_id INTO c FROM public.agent_conversations v JOIN public.contacts p ON p.id=v.contact_id AND p.organization_id=v.organization_id WHERE v.id=p_conversation AND v.organization_id=current_setting('app.acquire_org',true) AND v.owner_user_id=current_setting('app.acquire_user',true);
 IF NOT FOUND THEN RETURN false;END IF;
 IF c.target_id IS NULL THEN RETURN true;END IF;
 projection:=public.agent_company_membership_projection(c.mandate_id,c.target_id);
 RETURN projection IS NULL OR jsonb_array_length(projection->'blockedReasons')=0;
END $$;
REVOKE ALL ON FUNCTION public.agent_company_conversation_permitted(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_company_conversation_permitted(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_operation_authorised(uuid) RENAME TO agent_operation_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_operation_before_company_projection(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_operation_authorised(operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cid uuid;
BEGIN
 IF NOT public.agent_operation_before_company_projection(operation) THEN RETURN false;END IF;
 SELECT conversation_id INTO cid FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 RETURN public.agent_company_conversation_permitted(cid);
END $$;
REVOKE ALL ON FUNCTION public.agent_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_channel_operation_authorised(uuid) RENAME TO agent_channel_operation_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_channel_operation_before_company_projection(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_channel_operation_authorised(p_operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cid uuid;
BEGIN
 IF NOT public.agent_channel_operation_before_company_projection(p_operation) THEN RETURN false;END IF;
 SELECT conversation_id INTO cid FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 RETURN public.agent_company_conversation_permitted(cid);
END $$;
REVOKE ALL ON FUNCTION public.agent_channel_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_channel_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_invitation_operation_authorised(uuid) RENAME TO agent_invitation_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_invitation_before_company_projection(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user,acquire_agent_worker;
CREATE FUNCTION public.agent_invitation_operation_authorised(p_operation uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE cid uuid;
BEGIN
 IF NOT public.agent_invitation_before_company_projection(p_operation) THEN RETURN false;END IF;
 SELECT conversation_id INTO cid FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 RETURN public.agent_company_conversation_permitted(cid);
END $$;
REVOKE ALL ON FUNCTION public.agent_invitation_operation_authorised(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_invitation_operation_authorised(uuid) TO acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) RENAME TO agent_sequence_driver_before_company_projection;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_before_company_projection(uuid,uuid,text,integer) FROM PUBLIC,acquire_agent_user;
CREATE FUNCTION public.agent_sequence_driver_matches(p_conversation uuid,p_enrolment uuid,p_runtime text,p_generation integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN public.agent_sequence_driver_before_company_projection(p_conversation,p_enrolment,p_runtime,p_generation) AND public.agent_company_conversation_permitted(p_conversation);
END $$;
REVOKE ALL ON FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_sequence_driver_matches(uuid,uuid,text,integer) TO acquire_agent_user;
