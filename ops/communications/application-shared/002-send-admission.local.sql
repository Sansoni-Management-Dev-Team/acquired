-- BUILD-FIRST REVIEW ARTIFACT ONLY. UNAPPROVED / UNAPPLIED. Never startup/bootstrap.
-- Exact existing APPLICATION-ONLY OrbStack 127.0.0.1:5434/project_acquire,
-- operator project_acquire, system7680143844628185121.
-- Body preserved from frozen isolated004 SHA9968570f93ff145c137a2d9d165e6d663b28396d9609b36ef3eb8cc031eefb04.
-- Only explicit target guard/header differs. No automatic retargeting or runtime derivation.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'project_acquire' OR current_user<>'project_acquire'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7680143844628185121'
 OR to_regnamespace('communications') IS NOT NULL
 OR to_regclass('public.communication_bindings') IS NULL OR to_regclass('public.communication_reply_review_latches') IS NULL
 OR to_regclass('public.communication_dispatch_intents') IS NOT NULL THEN RAISE EXCEPTION 'Exact reviewed shared application target and unapplied admission schema required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='acquire_communications_writer') THEN RAISE EXCEPTION 'New writer role must not already exist'; END IF;
END $$;
CREATE ROLE acquire_communications_writer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
-- Only the existing reviewed application login/operator may SET ROLE; deployment grant is a separate exact artifact.
DO $$ BEGIN EXECUTE format('GRANT acquire_communications_writer TO %I',current_user); END $$;
ALTER TABLE public.campaign_enrolments ADD COLUMN communication_initial_reviewed_at timestamptz;
-- Existing reviewed booleans are not backfilled into fabricated timestamps.
CREATE TABLE public.communication_send_gates(organization_id text PRIMARY KEY REFERENCES public.organization(id),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),writer_xid bigint NOT NULL);
CREATE TABLE public.communication_member_fence(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),writer_xid bigint NOT NULL DEFAULT 0);
INSERT INTO public.communication_member_fence(singleton) VALUES(true);
CREATE TABLE public.communication_dispatch_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,owner_user_id text NOT NULL,binding_id uuid NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN('campaign','draft')),source_id uuid NOT NULL,epoch integer NOT NULL CHECK(epoch>0),
 predecessor_id uuid REFERENCES public.communication_dispatch_intents(id),contact_id uuid NOT NULL REFERENCES public.contacts(id),
 operation_key text NOT NULL CHECK(length(operation_key) BETWEEN 1 AND 200),operation text NOT NULL CHECK(operation IN('message','invitation')),
 payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),intent_digest text NOT NULL CHECK(intent_digest~'^[a-f0-9]{64}$'),
 encrypted_intent text NOT NULL CHECK(length(encrypted_intent) BETWEEN 1 AND 2200000),intent_key_version text NOT NULL CHECK(length(intent_key_version) BETWEEN 1 AND 64),
 source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),required_since timestamptz NOT NULL,
 coverage_scopes jsonb NOT NULL CHECK(jsonb_typeof(coverage_scopes)='array' AND jsonb_array_length(coverage_scopes) BETWEEN 1 AND 3),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,owner_user_id,operation_key),UNIQUE(organization_id,owner_user_id,source_kind,source_id,epoch),
 FOREIGN KEY(binding_id,organization_id,owner_user_id) REFERENCES public.communication_bindings(id,organization_id,owner_user_id)
);
CREATE TABLE public.communication_intent_resolutions(
 intent_id uuid PRIMARY KEY REFERENCES public.communication_dispatch_intents(id),
 encrypted_proof text NOT NULL CHECK(length(encrypted_proof) BETWEEN 1 AND 2200000),proof_key_version text NOT NULL,proof_digest text NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.communication_dispatch_permits(
 id uuid PRIMARY KEY,intent_id uuid NOT NULL UNIQUE REFERENCES public.communication_dispatch_intents(id),service_admission_id text NOT NULL UNIQUE,
 service_journal_id text NOT NULL,encrypted_receipt text NOT NULL CHECK(length(encrypted_receipt) BETWEEN 1 AND 2200000),receipt_key_version text NOT NULL,
 receipt_digest text NOT NULL CHECK(receipt_digest~'^[a-f0-9]{64}$'),committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION public.communications_lock_send_gate(org text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE revision bigint; invoker text:=current_setting('role',true);
BEGIN
 IF org IS NULL OR length(org) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Organization scope required'; END IF;
 IF invoker IN('acquire_campaign_user','acquire_communications_writer') AND org IS DISTINCT FROM current_setting('app.acquire_org',true) THEN RAISE EXCEPTION 'Authenticated organization scope required'; END IF;
 IF invoker NOT IN('none','acquire_campaign_user','acquire_campaign_worker','acquire_communications_writer') THEN RAISE EXCEPTION 'Reviewed writer role required'; END IF;
 PERFORM pg_advisory_xact_lock_shared(7426619361492031::bigint);
 INSERT INTO public.communication_send_gates(organization_id,writer_xid) VALUES(org,txid_current()) ON CONFLICT(organization_id) DO UPDATE SET writer_xid=txid_current();
 SELECT g.revision INTO STRICT revision FROM public.communication_send_gates g WHERE organization_id=org FOR UPDATE;
 RETURN revision;
END $$;
CREATE FUNCTION public.communications_lock_send_member(org text,actor text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE allowed boolean;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_campaign_user','acquire_communications_writer') OR org IS DISTINCT FROM current_setting('app.acquire_org',true) OR actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held authenticated writer scope required'; END IF;
 SELECT true INTO allowed FROM public.member WHERE organization_id=org AND user_id=actor FOR SHARE;
 RETURN coalesce(allowed,false);
END $$;
CREATE FUNCTION public.communications_member_statement_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 UPDATE public.communication_member_fence SET writer_xid=txid_current() WHERE singleton;
 RETURN NULL;
END $$;
CREATE TRIGGER communications_member_statement_fence BEFORE INSERT OR UPDATE OR DELETE ON public.member FOR EACH STATEMENT EXECUTE FUNCTION public.communications_member_statement_fence();
CREATE FUNCTION public.communications_policy_statement_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE invoker text:=current_setting('role',true); org text:=current_setting('app.acquire_org',true);
BEGIN
 IF invoker IN('acquire_campaign_user','acquire_communications_writer','acquire_campaign_worker') AND EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RETURN NULL; END IF;
 IF invoker NOT IN('none','acquire_campaign_worker') THEN RAISE EXCEPTION 'Registered scoped writer must acquire organization gate first'; END IF;
 PERFORM pg_advisory_xact_lock(7426619361492031::bigint);
 UPDATE public.communication_member_fence SET writer_xid=txid_current() WHERE singleton;
 RETURN NULL;
END $$;
CREATE FUNCTION public.communications_require_send_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org text; old_org text;
BEGIN
 IF TG_OP<>'DELETE' THEN org:=to_jsonb(NEW)->>'organization_id'; END IF;
 IF TG_OP<>'INSERT' THEN old_org:=to_jsonb(OLD)->>'organization_id'; END IF;
 IF TG_TABLE_NAME IN('communication_intent_resolutions','communication_dispatch_permits') THEN
  SELECT organization_id INTO STRICT org FROM public.communication_dispatch_intents WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.intent_id ELSE NEW.intent_id END;
  IF TG_OP<>'INSERT' THEN old_org:=org; END IF;
 END IF;
 IF TG_TABLE_NAME='organization' THEN
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN org:=NEW.id; END IF; old_org:=OLD.id;
 END IF;
 IF org IS NULL THEN org:=old_org; END IF;
 IF old_org IS NOT NULL AND old_org IS DISTINCT FROM org THEN RAISE EXCEPTION 'Admission policy organization is immutable'; END IF;
 IF TG_TABLE_NAME='member' OR EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) THEN
  IF NOT EXISTS(SELECT 1 FROM public.communication_member_fence WHERE singleton AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Membership statement fence required'; END IF;
  INSERT INTO public.communication_send_gates(organization_id,writer_xid) VALUES(org,txid_current()) ON CONFLICT(organization_id) DO UPDATE SET writer_xid=txid_current();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Organization gate must precede policy row locks'; END IF;
 UPDATE public.communication_send_gates SET revision=revision+1 WHERE organization_id=org;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
-- Unknown writers fail closed. Operational workflow fields are allowed but still serialized.
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['organization','member','contacts','targets','mandates','mandate_targets','suppressions','messages','sequence_enrolments','sequences','campaign_sequences','campaign_sequence_versions','campaign_enrolments','campaign_send_attempts','campaign_contact_assignments','campaign_contact_holds','campaign_reply_holds','campaign_reply_identities','campaign_reply_receipts','campaign_reply_monitors','communication_bindings','communication_defaults','campaign_channel_bindings','outreach_draft_bindings','communication_reply_monitors','communication_consumer_checkpoints','communication_reply_review_latches','communication_dispatch_intents','communication_intent_resolutions','communication_dispatch_permits'] LOOP
  IF to_regclass('public.'||name) IS NULL THEN RAISE EXCEPTION 'Required critical policy relation missing: %',name; END IF;
  IF name<>'member' THEN EXECUTE format('CREATE TRIGGER communications_send_statement BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.communications_policy_statement_fence()',name); END IF;
  EXECUTE format('CREATE TRIGGER communications_send_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.communications_require_send_gate()',name);
 END LOOP;
END $$;
CREATE FUNCTION public.communications_admission_person_clear(org text,actor text,contact uuid,address text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR org IS DISTINCT FROM current_setting('app.acquire_org',true) OR actor IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current())
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RAISE EXCEPTION 'Held current application authority required'; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM public.campaign_reply_holds WHERE organization_id=org AND contact_id=contact)
 AND NOT EXISTS(SELECT 1 FROM public.campaign_contact_holds WHERE organization_id=org AND lower(email)=lower(address))
 AND NOT EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(communications_admission_person_clear.address) OR lower(s.domain)=split_part(lower(communications_admission_person_clear.address),'@',2)))
 AND NOT EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL);
END $$;
CREATE FUNCTION public.communications_intent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.communication_dispatch_intents%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Dispatch intent and recorded disposition are immutable'; END IF;
 IF NEW.epoch=1 THEN IF NEW.predecessor_id IS NOT NULL THEN RAISE EXCEPTION 'First epoch has no predecessor'; END IF;
 ELSE SELECT * INTO STRICT prior FROM public.communication_dispatch_intents WHERE id=NEW.predecessor_id;
  IF ROW(prior.organization_id,prior.owner_user_id,prior.source_kind,prior.source_id,prior.binding_id,prior.contact_id,prior.epoch+1) IS DISTINCT FROM ROW(NEW.organization_id,NEW.owner_user_id,NEW.source_kind,NEW.source_id,NEW.binding_id,NEW.contact_id,NEW.epoch)
  OR NOT EXISTS(SELECT 1 FROM public.communication_intent_resolutions WHERE intent_id=prior.id)
  OR EXISTS(SELECT 1 FROM public.communication_dispatch_permits WHERE intent_id=prior.id) THEN RAISE EXCEPTION 'Retry requires recorded original no-submission disposition'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER communications_intent_identity BEFORE INSERT OR UPDATE OR DELETE ON public.communication_dispatch_intents FOR EACH ROW EXECUTE FUNCTION public.communications_intent_guard();
CREATE TRIGGER communications_resolution_immutable BEFORE UPDATE OR DELETE ON public.communication_intent_resolutions FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
CREATE TRIGGER communications_permit_immutable BEFORE UPDATE OR DELETE ON public.communication_dispatch_permits FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
-- An admitted draft keeps its approved source bytes/ownership; only authoritative
-- receipt materialization by the application writer may advance it to sent.
CREATE FUNCTION public.communications_guard_admitted_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits p ON p.intent_id=i.id WHERE i.source_kind='draft' AND i.source_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Admitted draft history cannot be deleted'; END IF;
  IF ROW(NEW.subject,NEW.body,NEW.approved_at,NEW.approved_by,NEW.enrolment_id,NEW.organization_id) IS DISTINCT FROM ROW(OLD.subject,OLD.body,OLD.approved_at,OLD.approved_by,OLD.enrolment_id,OLD.organization_id)
   OR (NEW.state IS DISTINCT FROM OLD.state AND NEW.state<>'sent') THEN RAISE EXCEPTION 'Admitted draft source cannot be edited or approval revoked'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER communications_admitted_draft BEFORE UPDATE OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.communications_guard_admitted_draft();
REVOKE ALL ON FUNCTION public.communications_guard_admitted_draft() FROM PUBLIC;
-- Every new table is FORCE RLS; only definer functions can alter gate ownership markers.
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['communication_send_gates','communication_member_fence'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY communications_gate_owner ON public.%I TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass))) WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=%L::regclass)))',name,'public.'||name,'public.'||name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['communication_dispatch_intents','communication_intent_resolutions','communication_dispatch_permits'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
 END LOOP;
END $$;
CREATE POLICY communications_intent_scope ON public.communication_dispatch_intents TO acquire_campaign_user USING(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=communication_dispatch_intents.organization_id AND user_id=communication_dispatch_intents.owner_user_id)) WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=communication_dispatch_intents.organization_id AND user_id=communication_dispatch_intents.owner_user_id));
CREATE POLICY communications_intent_definer_read ON public.communication_dispatch_intents FOR SELECT TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.communication_dispatch_intents'::regclass)));
CREATE POLICY communications_permit_definer_read ON public.communication_dispatch_permits FOR SELECT TO PUBLIC USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.communication_dispatch_permits'::regclass)));
CREATE POLICY communications_resolution_scope ON public.communication_intent_resolutions TO acquire_campaign_user USING(EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.id=intent_id)) WITH CHECK(EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.id=intent_id));
CREATE POLICY communications_permit_scope ON public.communication_dispatch_permits TO acquire_campaign_user USING(EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.id=intent_id)) WITH CHECK(EXISTS(SELECT 1 FROM public.communication_dispatch_intents i WHERE i.id=intent_id));
GRANT SELECT,INSERT ON public.communication_dispatch_intents,public.communication_intent_resolutions,public.communication_dispatch_permits TO acquire_campaign_user;
GRANT SELECT ON public.messages,public.sequence_enrolments TO acquire_campaign_user;
GRANT UPDATE ON public.messages TO acquire_campaign_user;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['contacts','targets','mandates','mandate_targets','messages','sequence_enrolments'] LOOP
  EXECUTE format('CREATE POLICY communications_admission_source_read ON public.%I FOR SELECT TO acquire_campaign_user USING(organization_id=current_setting(''app.acquire_org'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
END $$;
CREATE POLICY communications_admission_message_update ON public.messages FOR UPDATE TO acquire_campaign_user USING(organization_id=current_setting('app.acquire_org',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=messages.organization_id AND user_id=current_setting('app.acquire_user',true))) WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=messages.organization_id AND user_id=current_setting('app.acquire_user',true)));
GRANT USAGE ON SCHEMA public TO acquire_communications_writer;
GRANT SELECT ON public.organization,public.member,public.contacts,public.sequences,public.sequence_enrolments,public.messages,public.mandate_targets,public.communication_bindings,public.communication_defaults,public.outreach_draft_bindings TO acquire_communications_writer;
GRANT INSERT ON public.sequences,public.sequence_enrolments,public.messages,public.audit_events,public.outreach_draft_bindings TO acquire_communications_writer;
GRANT UPDATE ON public.messages,public.sequence_enrolments,public.mandate_targets TO acquire_communications_writer;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['contacts','sequences','sequence_enrolments','messages','mandate_targets','communication_bindings','communication_defaults','outreach_draft_bindings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY communications_writer_scope ON public.%I TO acquire_communications_writer USING(organization_id=current_setting(''app.acquire_org'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true))) WITH CHECK(organization_id=current_setting(''app.acquire_org'',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
END $$;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_writer_audit ON public.audit_events FOR INSERT TO acquire_communications_writer WITH CHECK(organization_id=current_setting('app.acquire_org',true) AND actor_id=current_setting('app.acquire_user',true) AND EXISTS(SELECT 1 FROM public.member WHERE organization_id=audit_events.organization_id AND user_id=audit_events.actor_id));
REVOKE ALL ON FUNCTION public.communications_lock_send_gate(text),public.communications_lock_send_member(text,text),public.communications_member_statement_fence(),public.communications_policy_statement_fence(),public.communications_require_send_gate(),public.communications_admission_person_clear(text,text,uuid,text),public.communications_intent_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communications_lock_send_gate(text) TO acquire_campaign_user,acquire_campaign_worker,acquire_communications_writer;
GRANT EXECUTE ON FUNCTION public.communications_lock_send_member(text,text) TO acquire_campaign_user,acquire_communications_writer;
GRANT EXECUTE ON FUNCTION public.communications_admission_person_clear(text,text,uuid,text) TO acquire_campaign_user;
COMMIT;
