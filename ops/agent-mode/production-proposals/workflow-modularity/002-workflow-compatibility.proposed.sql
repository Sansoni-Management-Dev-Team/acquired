-- WF-02 DRAFT: compatibility after 001, before 003. Requires exact approval.
-- Additive evidence and explicit origin associations; no historical row rewrite.
-- Review/parse is not PostgreSQL rehearsal. Apply only the complete approved bundle.
-- Application must bind app.acquire_workflow_version=1 and the exact persisted
-- app.acquire_workflow_execution in each transaction, including worker events.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ DECLARE system_id text:=(SELECT system_identifier::text FROM pg_control_system()); BEGIN
 IF (current_database()='postgres' AND system_id='7678071634733212629' OR current_database()='acquire_hosted_demo_rehearsal' AND system_id='7699248227334438947' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='acquire-hosted-demo-rehearsal-only') IS NOT TRUE THEN RAISE EXCEPTION 'Exact approved workflow target required';END IF;
END $$;


CREATE TABLE public.workflow_agent_demo_mapping_requests(
 workflow_execution_id uuid NOT NULL,
 request_key uuid PRIMARY KEY,organization_id text NOT NULL,mandate_id uuid NOT NULL,demo_id uuid NOT NULL,
 created_by text NOT NULL,demo_run_id uuid NOT NULL,manifest jsonb NOT NULL,input_digest text NOT NULL CHECK(input_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(demo_id=mandate_id),CHECK(jsonb_typeof(manifest)='object' AND jsonb_typeof(manifest->'people')='array' AND jsonb_array_length(manifest->'people') BETWEEN 1 AND 50 AND octet_length(manifest::text)<=64000),

 FOREIGN KEY(demo_run_id,organization_id,created_by) REFERENCES public.agent_demo_runs(id,organization_id,owner_user_id),
 UNIQUE(workflow_execution_id,request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id),
 FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,created_by) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id)
);

CREATE TABLE public.workflow_agent_demo_mapping_receipts(
 workflow_execution_id uuid NOT NULL,
 request_key uuid PRIMARY KEY,organization_id text NOT NULL,mandate_id uuid NOT NULL,demo_id uuid NOT NULL,created_by text NOT NULL,demo_run_id uuid NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=100000),
 result_digest text NOT NULL CHECK(result_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workflow_execution_id,request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id) REFERENCES public.workflow_agent_demo_mapping_requests(workflow_execution_id,request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id),
 UNIQUE(workflow_execution_id,request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id),
 FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,created_by) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id)
);

CREATE TABLE public.workflow_agent_demo_contact_mappings(
 workflow_execution_id uuid NOT NULL,
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,mandate_id uuid NOT NULL,demo_id uuid NOT NULL,created_by text NOT NULL,
 contact_id uuid NOT NULL,source_revision text NOT NULL CHECK(source_revision~'^[0-9]{1,30}$'),source_fingerprint text NOT NULL CHECK(source_fingerprint~'^[a-f0-9]{64}$'),
 demo_run_id uuid NOT NULL,request_key uuid NOT NULL,
 wire jsonb NOT NULL CHECK(jsonb_typeof(wire)='object' AND octet_length(wire::text)<=8000),
 -- The CLI digest seals the complete ordered BATCH, not this individual row.
 mapping_digest text NOT NULL CHECK(mapping_digest~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(contact_id,organization_id) REFERENCES public.contacts(id,organization_id),
 FOREIGN KEY(workflow_execution_id,request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id) REFERENCES public.workflow_agent_demo_mapping_receipts(workflow_execution_id,request_key,organization_id,mandate_id,demo_id,created_by,demo_run_id),
 UNIQUE(demo_id,contact_id),
 FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,created_by) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id)
);


CREATE UNIQUE INDEX workflow_demo_email_unique ON public.workflow_agent_demo_contact_mappings((wire->>'email'));
CREATE UNIQUE INDEX workflow_demo_phone_unique ON public.workflow_agent_demo_contact_mappings((wire->>'phone'));
CREATE UNIQUE INDEX workflow_demo_linkedin_unique ON public.workflow_agent_demo_contact_mappings((wire->>'linkedin'));
CREATE UNIQUE INDEX workflow_demo_provider_unique ON public.workflow_agent_demo_contact_mappings((wire->>'providerId'));
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['workflow_agent_demo_mapping_requests','workflow_agent_demo_mapping_receipts','workflow_agent_demo_contact_mappings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role, acquire_agent_user, acquire_campaign_user',name);
  EXECUTE format('GRANT SELECT ON public.%I TO acquire_agent_user, acquire_campaign_user',name);
  EXECUTE format('CREATE POLICY workflow_demo_owned_read ON public.%I FOR SELECT TO acquire_agent_user, acquire_campaign_user USING(organization_id=current_setting(''app.acquire_org'',true) AND created_by=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
  EXECUTE format('CREATE POLICY workflow_demo_definer ON public.%I TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',name,'public.'||name,'public.'||name);
  EXECUTE format('CREATE TRIGGER workflow_demo_evidence_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.agent_demo_evidence_immutable()',name);
 END LOOP;
END $$;

-- Exact legacy row shape retained, so old sealed wire/context digests stay v1.
-- There can be at most one lifetime outreach execution for a mandate.
CREATE VIEW public.agent_effective_execution_modes WITH (security_invoker=true) AS
 SELECT m.* FROM public.agent_mandate_execution_modes m
 WHERE NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions w WHERE w.mandate_id=m.mandate_id AND w.preset IN('demo','live'))
 UNION ALL
 SELECT w.mandate_id,w.organization_id,w.owner_user_id,
 CASE WHEN w.preset='demo' THEN 'demo' ELSE 'real' END,
 CASE WHEN w.preset='demo' THEN w.mandate_id ELSE NULL::uuid END,w.created_at
 FROM public.acquisition_workflow_executions w WHERE w.preset IN('demo','live');


CREATE VIEW public.agent_effective_demo_mapping_requests WITH (security_invoker=true) AS SELECT "request_key","organization_id","mandate_id","demo_id","created_by","demo_run_id","manifest","input_digest","created_at" FROM public.agent_demo_mapping_requests UNION ALL SELECT "request_key","organization_id","mandate_id","demo_id","created_by","demo_run_id","manifest","input_digest","created_at" FROM public.workflow_agent_demo_mapping_requests;

CREATE VIEW public.agent_effective_demo_mapping_receipts WITH (security_invoker=true) AS SELECT "request_key","organization_id","mandate_id","demo_id","created_by","demo_run_id","result","result_digest","created_at" FROM public.agent_demo_mapping_receipts UNION ALL SELECT "request_key","organization_id","mandate_id","demo_id","created_by","demo_run_id","result","result_digest","created_at" FROM public.workflow_agent_demo_mapping_receipts;

CREATE VIEW public.agent_effective_demo_contact_mappings WITH (security_invoker=true) AS SELECT "id","organization_id","mandate_id","demo_id","created_by","contact_id","source_revision","source_fingerprint","demo_run_id","request_key","wire","mapping_digest","created_at" FROM public.agent_demo_contact_mappings UNION ALL SELECT "id","organization_id","mandate_id","demo_id","created_by","contact_id","source_revision","source_fingerprint","demo_run_id","request_key","wire","mapping_digest","created_at" FROM public.workflow_agent_demo_contact_mappings;

REVOKE ALL ON public.agent_effective_execution_modes FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
GRANT SELECT ON public.agent_effective_execution_modes TO acquire_agent_user,acquire_campaign_user;

REVOKE ALL ON public.agent_effective_demo_mapping_requests FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
GRANT SELECT ON public.agent_effective_demo_mapping_requests TO acquire_agent_user,acquire_campaign_user;

REVOKE ALL ON public.agent_effective_demo_mapping_receipts FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
GRANT SELECT ON public.agent_effective_demo_mapping_receipts TO acquire_agent_user,acquire_campaign_user;

REVOKE ALL ON public.agent_effective_demo_contact_mappings FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
GRANT SELECT ON public.agent_effective_demo_contact_mappings TO acquire_agent_user,acquire_campaign_user;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_assert_manual_mandate_outreach_mode(uuid)'))) IS DISTINCT FROM '9d6c831ae710c1c4db324e4ae06477d3' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_assert_manual_mandate_outreach_mode(uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_assert_manual_mandate_outreach_mode(uuid)
CREATE OR REPLACE FUNCTION public.agent_assert_manual_mandate_outreach_mode(p_mandate uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 -- Historical null-origin records retain existing behavior. Normal approval
 -- separately rejects missing origins; this function grants no effect authority.
 IF p_mandate IS NULL THEN RETURN;END IF;
 IF org IS NULL OR org='' OR actor IS NULL OR actor=''
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org)
 THEN RAISE EXCEPTION 'Current owned mandate required';END IF;
 IF EXISTS(SELECT 1 FROM public.agent_effective_execution_modes WHERE mandate_id=p_mandate AND organization_id=org AND mode='demo')
 THEN RAISE EXCEPTION 'Manual outreach is disabled for demo mandates; use reviewed demo agent routes.';END IF;
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_delivery_candidate_projection(uuid,uuid)'))) IS DISTINCT FROM '8fe62aabfcd41630f7c9893d9f2d0de0' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_delivery_candidate_projection(uuid,uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_delivery_candidate_projection(uuid,uuid)
CREATE OR REPLACE FUNCTION public.agent_delivery_candidate_projection(p_mandate uuid, p_contact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE research jsonb;person public.contacts%ROWTYPE;mapping public.agent_effective_demo_contact_mappings%ROWTYPE;run public.agent_demo_runs%ROWTYPE;revision text;
BEGIN
 research:=public.agent_load_mandate_research_context(p_mandate,current_setting('app.acquire_org',true),current_setting('app.acquire_user',true));
 SELECT c.* INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=current_setting('app.acquire_org',true) AND (c.mandate_id=p_mandate OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.mandate_id=p_mandate AND mt.target_id=c.target_id));
 IF person.id IS NULL THEN RAISE EXCEPTION 'Owned source person required';END IF;
 IF research->>'mode'='real' THEN RETURN jsonb_build_object('available',true,'mode','real','recipients',public.agent_contact_delivery_recipients(person.personal_data));END IF;
 SELECT xmin::text INTO revision FROM public.contacts WHERE id=person.id;
 SELECT * INTO mapping FROM public.agent_effective_demo_contact_mappings WHERE mandate_id=p_mandate AND contact_id=p_contact AND organization_id=current_setting('app.acquire_org',true) AND created_by=current_setting('app.acquire_user',true);
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=mapping.demo_run_id AND organization_id=mapping.organization_id AND owner_user_id=mapping.created_by;
 IF mapping.id IS NULL OR mapping.source_revision IS DISTINCT FROM revision OR mapping.source_fingerprint IS DISTINCT FROM public.agent_demo_contact_fingerprint(p_contact) OR run.id IS NULL OR NOT public.agent_demo_runtime_ready(run.id) THEN RETURN jsonb_build_object('available',false,'mode','demo','recipients','{}'::jsonb);END IF;
 RETURN jsonb_build_object('available',true,'mode','demo','mappingId',mapping.id,'mappingDigest',mapping.mapping_digest,'recipients',jsonb_build_object('email',mapping.wire->>'email','whatsapp',mapping.wire->>'phone','linkedin',mapping.wire->>'linkedin'));
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_demo_execution_readiness(uuid)'))) IS DISTINCT FROM '691b9d06fa4c621508e329bd6d1384f6' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_demo_execution_readiness(uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_demo_execution_readiness(uuid)
CREATE OR REPLACE FUNCTION public.agent_demo_execution_readiness(p_thread uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.agent_threads%ROWTYPE;prepared integer;stale integer;sources integer;accounts boolean;policy boolean;
BEGIN
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF t.id IS NULL OR NOT public.agent_is_demo_origin(t.mandate_id) THEN RAISE EXCEPTION 'Owned demo readiness required';END IF;
 PERFORM public.agent_load_mandate_research_context(t.mandate_id,t.organization_id,t.owner_user_id);
 SELECT count(*) INTO sources FROM public.contacts c WHERE c.organization_id=t.organization_id AND (c.mandate_id=t.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.organization_id=c.organization_id AND mt.mandate_id=t.mandate_id AND mt.target_id=c.target_id));
 SELECT count(*) FILTER(WHERE c.id IS NOT NULL AND c.xmin::text=m.source_revision AND public.agent_demo_contact_fingerprint(c.id)=m.source_fingerprint),count(*) FILTER(WHERE CASE WHEN c.id IS NULL THEN true ELSE c.xmin::text IS DISTINCT FROM m.source_revision OR public.agent_demo_contact_fingerprint(c.id) IS DISTINCT FROM m.source_fingerprint END) INTO prepared,stale FROM public.agent_effective_demo_contact_mappings m LEFT JOIN public.contacts c ON c.id=m.contact_id AND c.organization_id=m.organization_id WHERE m.mandate_id=t.mandate_id AND m.organization_id=t.organization_id AND m.created_by=t.owner_user_id;
 SELECT EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.organization_id=t.organization_id AND run.owner_user_id=t.owner_user_id AND public.agent_demo_runtime_ready(run.id)) INTO accounts;
 SELECT EXISTS(SELECT 1 FROM public.agent_channel_policies p WHERE p.thread_id=t.id AND jsonb_array_length(p.bindings)=cardinality(p.channel_order) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) ref WHERE NOT public.agent_allowed_mandate_binding(t.mandate_id,(ref->>'bindingId')::uuid) OR ref->>'bindingDigest' IS DISTINCT FROM public.agent_recorded_binding_digest((ref->>'bindingId')::uuid))) INTO policy;
 RETURN jsonb_build_object('prepared',prepared,'stale',stale,'sourcePeopleAvailable',sources>0,'sourcePeople',sources,'accountsReady',accounts,'policyReady',policy,'outreachReady',accounts AND policy AND prepared>0,'reason',CASE WHEN NOT accounts THEN 'demo_accounts_required' WHEN NOT policy THEN 'review_channel_policy' WHEN prepared=0 THEN 'demo_mapping_required' ELSE NULL END);
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_demo_manual_outreach_guard()'))) IS DISTINCT FROM '9d11e5daf8e307e389903e1fe50c887d' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_demo_manual_outreach_guard()';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_demo_manual_outreach_guard()
CREATE OR REPLACE FUNCTION public.agent_demo_manual_outreach_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old_mandate uuid;new_mandate uuid;old_org text;new_org text;
BEGIN
 IF TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') THEN
  IF TG_OP='UPDATE' THEN old_mandate:=OLD.mandate_id;old_org:=OLD.organization_id;END IF;
  new_mandate:=NEW.mandate_id;new_org:=NEW.organization_id;
 ELSIF TG_TABLE_NAME='messages' THEN
  IF TG_OP='UPDATE' THEN SELECT mandate_id,organization_id INTO old_mandate,old_org FROM public.sequence_enrolments WHERE id=OLD.enrolment_id AND organization_id=OLD.organization_id;END IF;
  SELECT mandate_id,organization_id INTO new_mandate,new_org FROM public.sequence_enrolments WHERE id=NEW.enrolment_id AND organization_id=NEW.organization_id;
 ELSE RAISE EXCEPTION 'Unsupported manual outreach guard';END IF;
 -- Check OLD as well: changing/reparenting a demo record cannot launder its
 -- origin. Real/historical records keep existing writes and ownership guards.
 IF EXISTS(SELECT 1 FROM public.agent_effective_execution_modes m WHERE m.mode='demo'
  AND ((m.mandate_id=old_mandate AND m.organization_id=old_org) OR (m.mandate_id=new_mandate AND m.organization_id=new_org)))
 THEN
  -- Exact terminal projection only. V1 lacks sealed origin; retain its
  -- authenticated receipt in the ledger but hold ambiguous materialization.
  IF TG_TABLE_NAME='messages' AND TG_OP='UPDATE' THEN
   IF NEW.state='sent' AND OLD.state IN('approved','sent') AND NEW.id=OLD.id AND NEW.organization_id=OLD.organization_id AND NEW.enrolment_id=OLD.enrolment_id
   AND to_jsonb(NEW)-ARRAY['state','provider_message_id','provider_thread_id','sent_at','updated_at'] = to_jsonb(OLD)-ARRAY['state','provider_message_id','provider_thread_id','sent_at','updated_at']
   AND EXISTS(SELECT 1 FROM public.communication_submission_receipts r JOIN public.sequence_enrolments e ON e.id=OLD.enrolment_id AND e.organization_id=OLD.organization_id
    WHERE r.source_kind='draft' AND r.source_id=OLD.id AND r.operation='message' AND r.organization_id=OLD.organization_id
    AND r.owner_user_id=current_setting('app.acquire_user',true) AND r.organization_id=current_setting('app.acquire_org',true)
    AND r.origin_status='sealed' AND r.origin_mandate_id=e.mandate_id AND r.origin_enrolment_id=e.id AND r.source_revision IS NOT NULL
    AND r.source_digest=encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('source',jsonb_build_object('kind','draft','messageId',OLD.id,'revision',r.source_revision),'subject',OLD.subject,'body',OLD.body,'approvedBy',OLD.approved_by,'approvedAt',to_char(OLD.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'UTF8')),'hex')
    AND (OLD.state='sent' OR r.source_revision=to_char(OLD.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND r.provider_reference=NEW.provider_message_id AND r.provider_conversation_reference IS NOT DISTINCT FROM NEW.provider_thread_id AND r.submitted_at=NEW.sent_at
    AND (OLD.provider_message_id IS NULL OR OLD.provider_message_id=NEW.provider_message_id) AND (OLD.provider_thread_id IS NULL OR OLD.provider_thread_id IS NOT DISTINCT FROM NEW.provider_thread_id) AND (OLD.sent_at IS NULL OR OLD.sent_at=NEW.sent_at)
    AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=r.organization_id AND user_id=r.owner_user_id)
    AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=r.organization_id AND writer_xid=txid_current()))
   THEN RETURN NEW;END IF;
  END IF;
  RAISE EXCEPTION 'Manual outreach is disabled for demo mandates; use reviewed demo agent routes.';
 END IF;
 RETURN NEW;
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_effective_contact(uuid,uuid)'))) IS DISTINCT FROM '2e39433e0aed3a09f191ae592420050a' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_effective_contact(uuid,uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_effective_contact(uuid,uuid)
CREATE OR REPLACE FUNCTION public.agent_effective_contact(p_mandate uuid, p_contact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);person public.contacts%ROWTYPE;intent public.agent_effective_execution_modes%ROWTYPE;mapping public.agent_effective_demo_contact_mappings%ROWTYPE;run public.agent_demo_runs%ROWTYPE;source_revision text;source_fingerprint text;source jsonb;
BEGIN
 IF org IS NULL OR org='' OR actor IS NULL OR actor='' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org) THEN RAISE EXCEPTION 'Current owned mandate contact required';END IF;
 SELECT * INTO person FROM public.contacts c WHERE c.id=p_contact AND c.organization_id=org
 AND (c.mandate_id=p_mandate OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.mandate_id=p_mandate AND mt.organization_id=org AND mt.target_id=c.target_id)) FOR SHARE OF c;
 IF person.id IS NULL THEN RAISE EXCEPTION 'Current owned mandate contact required';END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id AND organization_id=org;
 source_fingerprint:=public.agent_demo_contact_fingerprint(person.id);
 source:=jsonb_build_object('id',person.id,'targetId',person.target_id,'displayName',person.display_name,'role',person.role,'personalData',person.personal_data,'provenance',person.provenance,'firmablePersonId',person.firmable_person_id,'fictionalised',person.fictionalised,'revision',source_revision,'fingerprint',source_fingerprint);
 SELECT * INTO intent FROM public.agent_effective_execution_modes WHERE mandate_id=p_mandate AND organization_id=org;
 IF intent.mode IS DISTINCT FROM 'demo' THEN RETURN jsonb_build_object('mode','real','sourceContact',source,'demoProjection',NULL);END IF;
 IF intent.created_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Current owned demo mapping required';END IF;
 SELECT * INTO mapping FROM public.agent_effective_demo_contact_mappings WHERE mandate_id=p_mandate AND organization_id=org AND created_by=actor AND contact_id=person.id AND demo_id=intent.demo_id;
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=mapping.demo_run_id AND organization_id=org AND owner_user_id=actor;
 IF mapping.id IS NULL OR mapping.source_revision IS DISTINCT FROM source_revision OR mapping.source_fingerprint IS DISTINCT FROM source_fingerprint OR run.id IS NULL
 OR NOT public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 THEN RAISE EXCEPTION 'Current immutable demo recipients are unavailable; real contact fallback is disabled.';END IF;
 RETURN jsonb_build_object('mode','demo','sourceContact',source,'demoProjection',jsonb_build_object('mappingId',mapping.id,'demoId',mapping.demo_id,'demoRunId',run.id,'runId',run.run_id,'integrationId',run.integration_id,'configurationRef',run.configuration_ref,'sourceRevision',mapping.source_revision,'sourceFingerprint',mapping.source_fingerprint,'mappingDigest',mapping.mapping_digest,'requestKey',mapping.request_key,'recipients',jsonb_build_object('email',mapping.wire->>'email','whatsapp',mapping.wire->>'phone','linkedin',mapping.wire->>'linkedin'),'providerId',mapping.wire->>'providerId','simulatorLeadId',mapping.wire->>'simulatorLeadId','senders',run.senders));
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_hosted_demo_send_window_exempt(uuid)'))) IS DISTINCT FROM '3b5e80592dc9fc06b3563642bac9174d' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_hosted_demo_send_window_exempt(uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_hosted_demo_send_window_exempt(uuid)
CREATE OR REPLACE FUNCTION public.agent_hosted_demo_send_window_exempt(p_route uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_conversation_channels r
 JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.mandate_id=r.mandate_id AND c.organization_id=org AND c.owner_user_id=actor
 JOIN public.agent_threads t ON t.id=c.thread_id AND t.mandate_id=c.mandate_id AND t.organization_id=org AND t.owner_user_id=actor
 JOIN public.agent_effective_execution_modes mode ON mode.mandate_id=c.mandate_id AND mode.organization_id=org AND mode.created_by=actor AND mode.mode='demo'
 JOIN public.agent_effective_demo_contact_mappings mapping ON mapping.contact_id=c.contact_id AND mapping.mandate_id=c.mandate_id AND mapping.organization_id=org AND mapping.created_by=actor
 JOIN public.agent_demo_runs run ON run.id=mapping.demo_run_id AND run.organization_id=org AND run.owner_user_id=actor
 JOIN LATERAL jsonb_array_elements(run.senders) sender ON sender->>'bindingId'=r.binding_id::text AND sender->>'bindingDigest'=r.binding_digest AND sender->>'channel'=r.channel
 WHERE r.id=p_route AND r.organization_id=org AND r.owner_user_id=actor AND c.delivery_mode='communications'
 AND public.agent_hosted_demo_bindings_match(org,actor,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 AND mapping.wire->>'email'~('^lead-[0-9]{3}@'||run.run_id||'[.]leads[.]acquire[.]test$')
 AND mapping.wire->>'phone'~'^[+]999[0-9]{12}$'
 AND mapping.wire->>'linkedin'~('^https://www[.]linkedin[.]com/in/sim-'||run.run_id||'-lead-[0-9]{3}$')
 AND CASE r.channel WHEN 'email' THEN r.recipient_kind='email' AND r.recipient_value=mapping.wire->>'email'
 WHEN 'whatsapp' THEN r.recipient_kind='phone' AND r.recipient_value=mapping.wire->>'phone'
 WHEN 'linkedin' THEN r.recipient_kind='linkedin_profile' AND r.recipient_value=mapping.wire->>'linkedin' ELSE false END);
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_is_demo_origin(uuid)'))) IS DISTINCT FROM '3a2e2b9fa9bec7a660781f5e0a777711' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_is_demo_origin(uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_is_demo_origin(uuid)
CREATE OR REPLACE FUNCTION public.agent_is_demo_origin(p_mandate uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.agent_effective_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=current_setting('app.acquire_org',true) AND x.mode='demo');
$function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_load_mandate_research_context(uuid,text,text)'))) IS DISTINCT FROM '86b8a4d0e9058208b3928b60db75cfd9' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_load_mandate_research_context(uuid,text,text)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_load_mandate_research_context(uuid,text,text)
CREATE OR REPLACE FUNCTION public.agent_load_mandate_research_context(p_mandate uuid, p_org text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE mode text;
BEGIN
 IF p_org IS DISTINCT FROM current_setting('app.acquire_org',true) OR p_actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_actor)
 OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=p_org) THEN RAISE EXCEPTION 'Current owned research mandate required';END IF;
 SELECT x.mode INTO mode FROM public.agent_effective_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=p_org;
 mode:=coalesce(mode,'real');
 RETURN jsonb_build_object('version',1,'mandateId',p_mandate,'mode',mode,'identityScope',jsonb_build_object('kind',CASE WHEN mode='demo' THEN 'demo' ELSE 'organization' END,'id',CASE WHEN mode='demo' THEN p_mandate::text ELSE p_org END));
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_mandate_identity_scope(uuid)'))) IS DISTINCT FROM '748b79826ab991b3ff0979e6d79cb87e' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_mandate_identity_scope(uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_mandate_identity_scope(uuid)
CREATE OR REPLACE FUNCTION public.agent_mandate_identity_scope(p_mandate uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);mode text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.mandates WHERE id=p_mandate AND organization_id=org) THEN RAISE EXCEPTION 'Owned mandate identity scope required';END IF;
 SELECT x.mode INTO mode FROM public.agent_effective_execution_modes x WHERE x.mandate_id=p_mandate AND x.organization_id=org;
 RETURN CASE WHEN mode='demo' THEN 'demo:'||p_mandate::text ELSE 'organization:'||org END;
END $function$
;

DO $$ BEGIN IF md5(pg_get_functiondef(to_regprocedure('public.agent_recorded_demo_route_matches(uuid)'))) IS DISTINCT FROM 'b44040008cfa8b57fbabed76211f4a18' THEN RAISE EXCEPTION 'Installed predecessor changed: agent_recorded_demo_route_matches(uuid)';END IF;END $$;
-- Installed definition preserved except exact effective-read source substitution: agent_recorded_demo_route_matches(uuid)
CREATE OR REPLACE FUNCTION public.agent_recorded_demo_route_matches(p_route uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF org IS NULL OR actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held owned recorded route scope required';END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_conversation_channels r
  JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.organization_id=r.organization_id AND c.owner_user_id=r.owner_user_id AND c.mandate_id=r.mandate_id
  JOIN public.agent_effective_execution_modes mode ON mode.mandate_id=c.mandate_id AND mode.organization_id=c.organization_id AND mode.mode='demo' AND mode.created_by=c.owner_user_id
  JOIN public.agent_effective_demo_contact_mappings m ON m.mandate_id=c.mandate_id AND m.demo_id=mode.demo_id AND m.contact_id=c.contact_id AND m.organization_id=c.organization_id AND m.created_by=c.owner_user_id
  JOIN public.agent_demo_runs run ON run.id=m.demo_run_id AND run.organization_id=m.organization_id AND run.owner_user_id=m.created_by
  JOIN public.communication_bindings b ON b.id=r.binding_id AND b.organization_id=r.organization_id AND b.owner_user_id=r.owner_user_id AND b.channel=r.channel
  WHERE public.agent_demo_runtime_ready(run.id) AND r.id=p_route AND r.organization_id=org AND r.owner_user_id=actor AND r.binding_digest=public.agent_recorded_binding_digest(b.id)
   AND r.recipient_value=CASE r.channel WHEN 'email' THEN m.wire->>'email' WHEN 'whatsapp' THEN m.wire->>'phone' WHEN 'linkedin' THEN m.wire->>'linkedin' END
   AND r.recipient_kind=CASE r.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END
   AND r.identity_source->>'revision'=m.source_revision
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(run.senders) s WHERE s->>'bindingId'=b.id::text AND s->>'bindingDigest'=r.binding_digest AND s->>'channel'=r.channel));
END $function$
;

CREATE OR REPLACE FUNCTION public.workflow_demo_evidence_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE run public.agent_demo_runs%ROWTYPE;request public.workflow_agent_demo_mapping_requests%ROWTYPE;receipt public.workflow_agent_demo_mapping_receipts%ROWTYPE;item jsonb;wire jsonb;seen uuid[]:='{}';ordinal integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions w WHERE w.id=NEW.workflow_execution_id AND w.organization_id=NEW.organization_id AND w.owner_user_id=NEW.created_by AND w.mandate_id=NEW.mandate_id AND w.preset='demo' AND w.state IN('accepted','ready','outreach')) OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1' OR current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM NEW.workflow_execution_id::text THEN RAISE EXCEPTION 'Exact active workflow demo required';END IF;

 IF current_setting('app.acquire_org',true) IS DISTINCT FROM NEW.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'Current owned demo evidence scope required';END IF;
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=NEW.demo_run_id AND organization_id=NEW.organization_id AND owner_user_id=NEW.created_by;
 IF run.id IS NULL OR NOT public.agent_demo_run_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders)
 OR NOT EXISTS(SELECT 1 FROM public.agent_effective_execution_modes m JOIN public.member x ON x.organization_id=m.organization_id AND x.user_id=m.created_by
  WHERE m.mandate_id=NEW.mandate_id AND m.organization_id=NEW.organization_id AND m.created_by=NEW.created_by AND m.mode='demo' AND m.demo_id=NEW.demo_id)
 THEN RAISE EXCEPTION 'Current owned demo source and registry required';END IF;
 IF TG_TABLE_NAME='workflow_agent_demo_mapping_requests' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.manifest))<>7 OR NEW.manifest->>'version' IS DISTINCT FROM '1' OR NEW.manifest->>'demoId' IS DISTINCT FROM NEW.demo_id::text OR NEW.manifest->>'mandateId' IS DISTINCT FROM NEW.mandate_id::text
  OR NEW.manifest->>'organizationId' IS DISTINCT FROM NEW.organization_id OR NEW.manifest->>'userId' IS DISTINCT FROM NEW.created_by OR NEW.manifest->>'requestKey' IS DISTINCT FROM NEW.request_key::text
  OR jsonb_typeof(NEW.manifest->'people') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.manifest->'people') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Exact immutable demo request manifest required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.manifest->'people') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3
   OR item->>'sourcePersonId' IS NULL OR item->>'sourcePersonId'!~'^[a-f0-9-]{36}$' OR item->>'sourceFingerprint' IS NULL OR item->>'sourceFingerprint'!~'^[a-f0-9]{64}$'
   OR item->>'sourcePersonId'=ANY(seen::text[]) THEN RAISE EXCEPTION 'Exact unique demo source metadata required';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text=item->>'sourcePersonId' AND c.organization_id=NEW.organization_id AND c.xmin::text=item->>'sourceRevision'
    AND (c.mandate_id=NEW.mandate_id OR EXISTS(SELECT 1 FROM public.mandate_targets mt WHERE mt.mandate_id=NEW.mandate_id AND mt.organization_id=c.organization_id AND mt.target_id=c.target_id)))
   THEN RAISE EXCEPTION 'Current mandate contact revision required';END IF;
   IF item->>'sourceFingerprint' IS DISTINCT FROM public.agent_demo_contact_fingerprint((item->>'sourcePersonId')::uuid) THEN RAISE EXCEPTION 'Current canonical contact fingerprint required';END IF;
   seen:=seen||ARRAY[(item->>'sourcePersonId')::uuid];
  END LOOP;
 ELSIF TG_TABLE_NAME='workflow_agent_demo_mapping_receipts' THEN
  SELECT * INTO request FROM public.workflow_agent_demo_mapping_requests WHERE request_key=NEW.request_key AND organization_id=NEW.organization_id AND mandate_id=NEW.mandate_id AND created_by=NEW.created_by AND demo_id=NEW.demo_id AND demo_run_id=NEW.demo_run_id;
  IF request.request_key IS NULL OR (SELECT count(*) FROM jsonb_object_keys(NEW.result))<>9 OR NEW.result->>'version' IS DISTINCT FROM '1' OR NEW.result->>'demoId' IS DISTINCT FROM NEW.demo_id::text OR NEW.result->>'runId' IS DISTINCT FROM run.run_id
   OR NEW.result->>'mappingDigest' IS NULL OR NEW.result->>'mappingDigest'!~'^[a-f0-9]{64}$'
   OR jsonb_typeof(NEW.result->'mappings') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'mappings')<>jsonb_array_length(request.manifest->'people')
   OR jsonb_typeof(NEW.result->'accounts') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.result->'accounts')<>3
  THEN RAISE EXCEPTION 'Exact verified demo batch receipt required';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(run.senders) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result->'accounts') a WHERE a->>'channel'=item->>'channel' AND a->>'providerAccountId'=item->>'providerAccountId' AND a->>'sourceId'=item->>'sourceId') THEN RAISE EXCEPTION 'Demo receipt sender differs from registry';END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(request.manifest->'people') LOOP
   wire:=NEW.result->'mappings'->ordinal;ordinal:=ordinal+1;
   IF NOT public.agent_demo_wire_valid(run.run_id,wire) OR wire->>'sourcePersonId' IS DISTINCT FROM item->>'sourcePersonId' OR wire->>'sourceRevision' IS DISTINCT FROM item->>'sourceRevision' OR wire->>'sourceFingerprint' IS DISTINCT FROM item->>'sourceFingerprint' THEN RAISE EXCEPTION 'Ordered verified demo batch differs from source manifest';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.result->'mappings') m WHERE m->>'sourcePersonId'=item->>'sourcePersonId' AND m->>'sourceRevision'=item->>'sourceRevision' AND m->>'sourceFingerprint'=item->>'sourceFingerprint') THEN RAISE EXCEPTION 'Demo batch changed its source manifest';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text=item->>'sourcePersonId' AND c.organization_id=NEW.organization_id AND c.xmin::text=item->>'sourceRevision') OR item->>'sourceFingerprint' IS DISTINCT FROM public.agent_demo_contact_fingerprint((item->>'sourcePersonId')::uuid) THEN RAISE EXCEPTION 'Demo source changed before receipt persistence';END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='workflow_agent_demo_contact_mappings' THEN
  SELECT * INTO receipt FROM public.workflow_agent_demo_mapping_receipts WHERE request_key=NEW.request_key AND organization_id=NEW.organization_id AND mandate_id=NEW.mandate_id AND demo_id=NEW.demo_id AND created_by=NEW.created_by AND demo_run_id=NEW.demo_run_id;
  wire:=NEW.wire;
  IF receipt.request_key IS NULL OR NOT public.agent_demo_wire_valid(run.run_id,wire)
   OR wire->>'sourcePersonId' IS DISTINCT FROM NEW.contact_id::text OR wire->>'sourceRevision' IS DISTINCT FROM NEW.source_revision OR wire->>'sourceFingerprint' IS DISTINCT FROM NEW.source_fingerprint
   OR wire->>'simulatorLeadId' IS NULL OR wire->>'simulatorLeadId'!~'^lead-[0-9]{3}$' OR wire->>'email' IS DISTINCT FROM (wire->>'simulatorLeadId')||'@'||run.run_id||'.leads.acquire.test'
   OR wire->>'phone' IS NULL OR wire->>'phone'!~'^[+]999[0-9]{12}$' OR wire->>'linkedin' IS DISTINCT FROM 'https://www.linkedin.com/in/sim-'||run.run_id||'-'||(wire->>'simulatorLeadId')
   OR wire->>'providerId' IS DISTINCT FROM 'ACo_sim_'||run.run_id||'_'||(wire->>'simulatorLeadId') OR NEW.mapping_digest IS DISTINCT FROM receipt.result->>'mappingDigest'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt.result->'mappings') m WHERE m=wire)
   OR NOT EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=NEW.contact_id AND c.organization_id=NEW.organization_id AND c.xmin::text=NEW.source_revision)
   OR NEW.source_fingerprint IS DISTINCT FROM public.agent_demo_contact_fingerprint(NEW.contact_id)
  THEN RAISE EXCEPTION 'Exact current immutable demo contact mapping required';END IF;
 ELSE RAISE EXCEPTION 'Unsupported demo evidence table';END IF;
 RETURN NEW;
END $function$
;
REVOKE ALL ON FUNCTION public.workflow_demo_evidence_insert_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;

CREATE TRIGGER workflow_demo_evidence_insert_guard BEFORE INSERT ON public.workflow_agent_demo_mapping_requests FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_evidence_insert_guard();

CREATE TRIGGER workflow_demo_evidence_insert_guard BEFORE INSERT ON public.workflow_agent_demo_mapping_receipts FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_evidence_insert_guard();

CREATE TRIGGER workflow_demo_evidence_insert_guard BEFORE INSERT ON public.workflow_agent_demo_contact_mappings FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_evidence_insert_guard();


-- Cross-namespace recipient uniqueness. Locks are ordered identically for both
-- legacy and new evidence writers, including competing transaction inserts.
CREATE FUNCTION public.workflow_demo_alias_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE value text; BEGIN
 FOR value IN SELECT x FROM unnest(ARRAY['mapping-id:'||NEW.id::text,NEW.wire->>'email',NEW.wire->>'phone',NEW.wire->>'linkedin',NEW.wire->>'providerId']) x ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('workflow-demo-alias:'||value,0));
 END LOOP;
 IF (TG_TABLE_NAME='agent_demo_contact_mappings' AND EXISTS(SELECT 1 FROM public.workflow_agent_demo_contact_mappings m WHERE m.id=NEW.id OR m.wire->>'email'=NEW.wire->>'email' OR m.wire->>'phone'=NEW.wire->>'phone' OR m.wire->>'linkedin'=NEW.wire->>'linkedin' OR m.wire->>'providerId'=NEW.wire->>'providerId'))
 OR (TG_TABLE_NAME='workflow_agent_demo_contact_mappings' AND EXISTS(SELECT 1 FROM public.agent_demo_contact_mappings m WHERE m.id=NEW.id OR m.wire->>'email'=NEW.wire->>'email' OR m.wire->>'phone'=NEW.wire->>'phone' OR m.wire->>'linkedin'=NEW.wire->>'linkedin' OR m.wire->>'providerId'=NEW.wire->>'providerId'))
 THEN RAISE EXCEPTION 'Simulator recipient already has immutable provenance';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_demo_alias_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
CREATE TRIGGER workflow_demo_alias_guard BEFORE INSERT ON public.agent_demo_contact_mappings FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_alias_guard();
CREATE TRIGGER workflow_demo_alias_guard BEFORE INSERT ON public.workflow_agent_demo_contact_mappings FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_alias_guard();


ALTER TABLE public.agent_events ADD COLUMN workflow_execution_id uuid;
ALTER TABLE public.agent_events ADD CONSTRAINT agent_events_workflow_scope_fk FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,owner_user_id) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id);

ALTER TABLE public.agent_conversations ADD COLUMN workflow_execution_id uuid;
ALTER TABLE public.agent_conversations ADD CONSTRAINT agent_conversations_workflow_scope_fk FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,owner_user_id) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id);

ALTER TABLE public.agent_operations ADD COLUMN workflow_execution_id uuid;
ALTER TABLE public.agent_operations ADD CONSTRAINT agent_operations_workflow_scope_fk FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,owner_user_id) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id);

ALTER TABLE public.research_jobs ADD COLUMN workflow_execution_id uuid;
ALTER TABLE public.research_jobs ADD CONSTRAINT research_jobs_workflow_scope_fk FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,created_by) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id);


-- This guard serializes against admission and makes old writers fail closed on
-- workflow-managed mandates. Historical rows remain nullable and unmodified.
CREATE FUNCTION public.workflow_source_write_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.acquisition_workflow_executions%ROWTYPE; actor text; requested uuid; managed boolean;
BEGIN
 actor:=CASE WHEN TG_TABLE_NAME='research_jobs' THEN to_jsonb(NEW)->>'created_by' ELSE to_jsonb(NEW)->>'owner_user_id' END;
 IF TG_OP='UPDATE' AND (OLD.workflow_execution_id IS DISTINCT FROM NEW.workflow_execution_id OR OLD.mandate_id IS DISTINCT FROM NEW.mandate_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id) THEN
  IF OLD.workflow_execution_id IS NOT NULL OR NEW.workflow_execution_id IS NOT NULL THEN RAISE EXCEPTION 'Workflow effect association is immutable';END IF;
 END IF;
 -- New sources and explicit reactivation serialize against reservation. Ordinary
 -- immutable-identity bookkeeping does not introduce another row lock.
 IF TG_TABLE_NAME IN('agent_conversations','agent_operations') THEN
  IF EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) THEN PERFORM public.communications_lock_send_gate(NEW.organization_id);END IF;
  IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Organization gate must precede workflow source lock';END IF;
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (OLD.mandate_id IS DISTINCT FROM NEW.mandate_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id OR to_jsonb(OLD)->>'name' IS DISTINCT FROM to_jsonb(NEW)->>'name')) OR (TG_OP='UPDATE' AND ((TG_TABLE_NAME='research_jobs' AND to_jsonb(OLD)->>'status' IN('complete','partial','failed','cancelled') AND to_jsonb(NEW)->>'status' NOT IN('complete','partial','failed','cancelled')) OR (TG_TABLE_NAME='agent_events' AND to_jsonb(OLD)->>'state' IN('done') AND to_jsonb(NEW)->>'state' NOT IN('done')))) THEN
  IF TG_OP='UPDATE' THEN PERFORM 1 FROM public.mandates WHERE id IN(NEW.mandate_id,OLD.mandate_id) ORDER BY id FOR UPDATE; ELSE PERFORM 1 FROM public.mandates WHERE id=NEW.mandate_id AND organization_id=NEW.organization_id FOR UPDATE;END IF;
 END IF;
 managed:=EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=NEW.mandate_id);
 IF NOT managed THEN
  IF NEW.workflow_execution_id IS NOT NULL THEN RAISE EXCEPTION 'Workflow association unavailable';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.workflow_execution_id IS NULL THEN
  -- Old completed research evidence may be read but not reactivated/reparented.
  IF TG_TABLE_NAME='research_jobs' AND to_jsonb(OLD)->>'status' IN('complete','partial','failed','cancelled') AND to_jsonb(NEW)->>'status'=to_jsonb(OLD)->>'status' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW;END IF;
  -- A late event may be retired; it cannot be leased or converted into new work.
  IF TG_TABLE_NAME='agent_events' AND to_jsonb(NEW)->>'state' IN('done') AND to_jsonb(OLD)->>'state'<> 'leased'
    AND to_jsonb(NEW)-ARRAY['state','lease_owner','lease_until'] = to_jsonb(OLD)-ARRAY['state','lease_owner','lease_until'] THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'Historical work cannot acquire new workflow authority';
 END IF;
 IF current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR nullif(current_setting('app.acquire_workflow_execution',true),'') IS NULL THEN RAISE EXCEPTION 'Explicit workflow-capable writer required';END IF;
 requested:=current_setting('app.acquire_workflow_execution',true)::uuid;
 IF NEW.workflow_execution_id IS NULL AND TG_OP='INSERT' THEN NEW.workflow_execution_id:=requested;END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=NEW.workflow_execution_id AND mandate_id=NEW.mandate_id AND organization_id=NEW.organization_id AND owner_user_id=actor;
 IF w.id IS NULL OR w.id<>requested OR actor IS DISTINCT FROM current_setting('app.acquire_user',true) OR NEW.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id) THEN RAISE EXCEPTION 'Exact current owned workflow association required';END IF;
 IF TG_OP='INSERT' AND w.state IN('complete','failed','cancelled','uncertain') AND NOT (TG_TABLE_NAME='agent_events' AND to_jsonb(NEW)->>'kind'='conversation.history_changed' AND w.preset IN('demo','live')) THEN RAISE EXCEPTION 'Terminal or uncertain workflow cannot create work';END IF;
 IF TG_OP='UPDATE' AND w.state IN('complete','failed','cancelled','uncertain') THEN
  IF TG_TABLE_NAME='research_jobs' AND to_jsonb(NEW)->>'status' NOT IN('complete','partial','failed','cancelled') THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate research';END IF;
  IF TG_TABLE_NAME='agent_events' AND to_jsonb(NEW)->>'state'<>'done' AND NOT (to_jsonb(NEW)->>'kind'='conversation.history_changed' AND w.preset IN('demo','live')) THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate event';END IF;
  IF TG_TABLE_NAME='agent_operations' AND to_jsonb(NEW)->>'state' NOT IN('complete','failed','cancelled','rejected','uncertain') THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate operation';END IF;
  IF TG_TABLE_NAME='agent_conversations' AND ((to_jsonb(NEW)->>'driver_kind'='agent' AND to_jsonb(OLD)->>'driver_kind'<>'agent') OR (to_jsonb(NEW)->>'phase'='active' AND to_jsonb(OLD)->>'phase'<>'active') OR (to_jsonb(OLD)->>'phase'='complete' AND to_jsonb(NEW)->>'phase'<>'complete')) THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate conversation';END IF;
 END IF;
 IF TG_TABLE_NAME='research_jobs' THEN
  IF w.preset='demo' THEN RAISE EXCEPTION 'Saved demo cannot start live research';END IF;
 ELSIF TG_TABLE_NAME='agent_conversations' THEN
  IF w.preset='live-research-test' OR TG_OP='INSERT' AND w.state NOT IN('ready','outreach') THEN RAISE EXCEPTION 'Execution cannot create outreach conversations';END IF;
 ELSIF TG_TABLE_NAME='agent_operations' THEN
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.id=NEW.conversation_id AND c.workflow_execution_id=w.id AND c.organization_id=w.organization_id AND c.owner_user_id=w.owner_user_id) THEN RAISE EXCEPTION 'Conversation belongs to another workflow';END IF;
  IF w.preset='live-research-test' AND (NEW.conversation_id IS NOT NULL OR NEW.name!~'^research[.]') THEN RAISE EXCEPTION 'Research-only execution cannot create outreach operations';END IF;
 ELSIF TG_TABLE_NAME='agent_events' THEN
  IF NEW.payload ? 'conversationId' OR NEW.kind='conversation.history_changed' THEN
   IF NOT EXISTS(SELECT 1 FROM public.agent_conversations c WHERE c.id::text=NEW.payload->>'conversationId' AND c.workflow_execution_id=w.id AND c.mandate_id=w.mandate_id AND c.organization_id=w.organization_id AND c.owner_user_id=w.owner_user_id) THEN RAISE EXCEPTION 'Event conversation belongs to another workflow';END IF;
  END IF;
  IF w.preset='live-research-test' AND NEW.kind NOT IN('control.changed','research.completed','research.failed','research.requested','research.continue','research.people.completed','research.people.failed') THEN RAISE EXCEPTION 'Research-only execution cannot schedule outreach';END IF;
 ELSE RAISE EXCEPTION 'Unsupported workflow write source';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_source_write_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;


CREATE TRIGGER acquisition_00_workflow_source_guard BEFORE INSERT OR UPDATE ON public.agent_events FOR EACH ROW EXECUTE FUNCTION public.workflow_source_write_guard();

CREATE TRIGGER acquisition_00_workflow_source_guard BEFORE INSERT OR UPDATE ON public.agent_conversations FOR EACH ROW EXECUTE FUNCTION public.workflow_source_write_guard();

CREATE TRIGGER acquisition_00_workflow_source_guard BEFORE INSERT OR UPDATE ON public.agent_operations FOR EACH ROW EXECUTE FUNCTION public.workflow_source_write_guard();

CREATE TRIGGER acquisition_00_workflow_source_guard BEFORE INSERT OR UPDATE ON public.research_jobs FOR EACH ROW EXECUTE FUNCTION public.workflow_source_write_guard();

ALTER TABLE public.campaign_enrolments ADD COLUMN workflow_execution_id uuid;
ALTER TABLE public.campaign_enrolments ADD CONSTRAINT campaign_enrolments_workflow_scope_fk FOREIGN KEY(workflow_execution_id,organization_id,mandate_id,owner_user_id) REFERENCES public.acquisition_workflow_executions(id,organization_id,mandate_id,owner_user_id);
ALTER TABLE public.sequence_enrolments ADD COLUMN workflow_execution_id uuid REFERENCES public.acquisition_workflow_executions(id);
-- Legacy sequence rows have no owner column. The trigger validates exact mandate,
-- organization and current actor against the referenced immutable execution.
CREATE FUNCTION public.workflow_manual_source_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE mandate uuid;org text;old_mandate uuid;execution uuid;w public.acquisition_workflow_executions%ROWTYPE;managed boolean;
BEGIN
 IF TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') THEN
  mandate:=NEW.mandate_id;org:=NEW.organization_id;execution:=NEW.workflow_execution_id;
  IF TG_OP='UPDATE' THEN
   old_mandate:=OLD.mandate_id;
   IF (OLD.workflow_execution_id IS NOT NULL OR NEW.workflow_execution_id IS NOT NULL) AND (OLD.workflow_execution_id IS DISTINCT FROM NEW.workflow_execution_id OR OLD.mandate_id IS DISTINCT FROM NEW.mandate_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id) THEN RAISE EXCEPTION 'Manual workflow association is immutable';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='messages' THEN
  SELECT e.mandate_id,e.organization_id,e.workflow_execution_id INTO mandate,org,execution FROM public.sequence_enrolments e WHERE e.id=NEW.enrolment_id AND e.organization_id=NEW.organization_id;
  IF TG_OP='UPDATE' THEN
   SELECT e.mandate_id INTO old_mandate FROM public.sequence_enrolments e WHERE e.id=OLD.enrolment_id AND e.organization_id=OLD.organization_id;
   IF (execution IS NOT NULL OR EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=old_mandate)) AND NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id THEN RAISE EXCEPTION 'Workflow draft origin is immutable';END IF;
  END IF;
 ELSE RAISE EXCEPTION 'Unsupported manual workflow source';END IF;
 -- Statement policy fence precedes this trigger. Take its organization gate
 -- before the mandate reservation row, matching workflow admission lock order.
 IF EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) THEN PERFORM public.communications_lock_send_gate(org);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Organization gate must precede workflow source lock';END IF;
 IF TG_OP='INSERT' OR old_mandate IS DISTINCT FROM mandate THEN PERFORM 1 FROM public.mandates WHERE id IN(mandate,old_mandate) ORDER BY id FOR UPDATE;END IF;
 managed:=EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id IN(mandate,old_mandate));
 IF NOT managed THEN
  IF execution IS NOT NULL THEN RAISE EXCEPTION 'Manual workflow unavailable';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('sequence_enrolments','campaign_enrolments') AND execution IS NULL THEN
  execution:=nullif(current_setting('app.acquire_workflow_execution',true),'')::uuid;NEW.workflow_execution_id:=execution;
 END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=execution AND mandate_id=mandate AND organization_id=org;
 IF w.id IS NULL OR w.preset<>'live' OR w.presentation<>'workspace'
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM w.id::text
 OR current_setting('app.acquire_user',true) IS DISTINCT FROM w.owner_user_id OR current_setting('app.acquire_org',true) IS DISTINCT FROM w.organization_id
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id)
 THEN RAISE EXCEPTION 'Only exact live workspace execution permits manual outreach';END IF;
 IF TG_TABLE_NAME='campaign_enrolments' AND to_jsonb(NEW)->>'owner_user_id' IS DISTINCT FROM w.owner_user_id THEN RAISE EXCEPTION 'Manual workflow owner differs';END IF;
 IF TG_OP='INSERT' AND w.state NOT IN('ready','outreach') THEN RAISE EXCEPTION 'Workflow is not ready for manual outreach';END IF;
 IF TG_OP='UPDATE' AND w.state IN('complete','failed','cancelled','uncertain') AND to_jsonb(NEW)->>'state' IS DISTINCT FROM to_jsonb(OLD)->>'state' AND to_jsonb(NEW)->>'state' NOT IN('sent','complete','completed','failed','cancelled','stopped','replied') THEN RAISE EXCEPTION 'Terminal workflow cannot reactivate manual outreach';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_manual_source_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
CREATE TRIGGER acquisition_00_workflow_manual_guard BEFORE INSERT OR UPDATE ON public.sequence_enrolments FOR EACH ROW EXECUTE FUNCTION public.workflow_manual_source_guard();
CREATE TRIGGER acquisition_00_workflow_manual_guard BEFORE INSERT OR UPDATE ON public.campaign_enrolments FOR EACH ROW EXECUTE FUNCTION public.workflow_manual_source_guard();
CREATE TRIGGER acquisition_00_workflow_manual_guard BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.workflow_manual_source_guard();


-- Final admission also requires the exact source workflow. This prevents an old
-- binary from sending a saved new-workflow intent via the legacy route.
CREATE FUNCTION public.workflow_dispatch_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE intent public.communication_dispatch_intents%ROWTYPE;mandate uuid;execution uuid;w public.acquisition_workflow_executions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='communication_dispatch_intents' THEN intent:=NEW;
 ELSE SELECT * INTO intent FROM public.communication_dispatch_intents WHERE id=NEW.intent_id;END IF;
 mandate:=public.agent_origin_mandate(intent.source_kind,intent.source_id);
 IF mandate IS NULL THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) THEN PERFORM public.communications_lock_send_gate(intent.organization_id);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=intent.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held organization gate required before dispatch source lock';END IF;
 PERFORM 1 FROM public.mandates WHERE id=mandate FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=mandate) THEN RETURN NEW;END IF;
 IF intent.source_kind='agent' THEN
  SELECT o.workflow_execution_id INTO execution FROM public.agent_operations o WHERE o.id=intent.source_id AND o.organization_id=intent.organization_id AND o.owner_user_id=intent.owner_user_id AND o.mandate_id=mandate;
 ELSIF intent.source_kind='campaign' THEN
  SELECT e.workflow_execution_id INTO execution FROM public.campaign_send_attempts a JOIN public.campaign_enrolments e ON e.id=a.enrolment_id AND e.organization_id=a.organization_id WHERE a.id=intent.source_id AND e.organization_id=intent.organization_id AND e.owner_user_id=intent.owner_user_id AND e.mandate_id=mandate;
 ELSIF intent.source_kind='draft' THEN
  SELECT e.workflow_execution_id INTO execution FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id WHERE m.id=intent.source_id AND e.organization_id=intent.organization_id AND e.mandate_id=mandate;
 END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=execution AND mandate_id=mandate AND organization_id=intent.organization_id AND owner_user_id=intent.owner_user_id;
 IF w.id IS NULL OR w.preset='live-research-test' OR w.state NOT IN('ready','outreach')
 OR intent.source_kind<>'agent' AND (w.preset<>'live' OR w.presentation<>'workspace')
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR current_setting('app.acquire_workflow_execution',true) IS DISTINCT FROM w.id::text
 OR current_setting('app.acquire_org',true) IS DISTINCT FROM w.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM w.owner_user_id
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id)
 THEN RAISE EXCEPTION 'Exact active outreach workflow required for new dispatch';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_dispatch_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
CREATE TRIGGER acquisition_00_workflow_dispatch_guard BEFORE INSERT ON public.communication_dispatch_intents FOR EACH ROW EXECUTE FUNCTION public.workflow_dispatch_guard();
CREATE TRIGGER acquisition_00_workflow_permit_guard BEFORE INSERT ON public.communication_dispatch_permits FOR EACH ROW EXECUTE FUNCTION public.workflow_dispatch_guard();

CREATE FUNCTION public.workflow_channel_policy_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE mandate uuid;w public.acquisition_workflow_executions%ROWTYPE;
BEGIN
 SELECT t.mandate_id INTO mandate FROM public.agent_threads t WHERE t.id=NEW.thread_id AND t.organization_id=NEW.organization_id AND t.owner_user_id=NEW.owner_user_id;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=NEW.organization_id AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held organization gate required before policy source lock';END IF;
 PERFORM 1 FROM public.mandates WHERE id=mandate FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.acquisition_workflow_executions WHERE mandate_id=mandate) THEN RETURN NEW;END IF;
 SELECT * INTO w FROM public.acquisition_workflow_executions WHERE id=nullif(current_setting('app.acquire_workflow_execution',true),'')::uuid AND mandate_id=mandate AND organization_id=NEW.organization_id AND owner_user_id=NEW.owner_user_id;
 IF w.id IS NULL OR w.preset='live-research-test' OR w.state NOT IN('accepted','ready','outreach')
 OR current_setting('app.acquire_workflow_version',true) IS DISTINCT FROM '1'
 OR current_setting('app.acquire_org',true) IS DISTINCT FROM w.organization_id OR current_setting('app.acquire_user',true) IS DISTINCT FROM w.owner_user_id
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=w.organization_id AND user_id=w.owner_user_id)
 THEN RAISE EXCEPTION 'Exact outreach workflow required for channel policy';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_channel_policy_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
CREATE TRIGGER acquisition_00_workflow_policy_guard BEFORE INSERT OR UPDATE ON public.agent_channel_policies FOR EACH ROW EXECUTE FUNCTION public.workflow_channel_policy_guard();

CREATE FUNCTION public.workflow_demo_request_key_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workflow-demo-request:'||NEW.request_key::text,0));
 IF (TG_TABLE_NAME='agent_demo_mapping_requests' AND EXISTS(SELECT 1 FROM public.workflow_agent_demo_mapping_requests WHERE request_key=NEW.request_key))
 OR (TG_TABLE_NAME='workflow_agent_demo_mapping_requests' AND EXISTS(SELECT 1 FROM public.agent_demo_mapping_requests WHERE request_key=NEW.request_key))
 THEN RAISE EXCEPTION 'Mapping request identity already belongs to another evidence namespace';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_demo_request_key_guard() FROM PUBLIC,anon,authenticated,service_role,acquire_agent_user,acquire_campaign_user;
CREATE TRIGGER workflow_demo_request_key_guard BEFORE INSERT ON public.agent_demo_mapping_requests FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_request_key_guard();
CREATE TRIGGER workflow_demo_request_key_guard BEFORE INSERT ON public.workflow_agent_demo_mapping_requests FOR EACH ROW EXECUTE FUNCTION public.workflow_demo_request_key_guard();


COMMIT;
