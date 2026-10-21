-- PROPOSAL ONLY. UNAPPLIED. Production hosted schema v1; no run/account rows are inserted.
-- This proposal is intentionally pinned to the reviewed production-baseline source
-- bodies below. Unknown production versions MUST STOP, be inspected and produce
-- a separately reviewed artifact. Never loosen these hashes to make it apply.
-- Prerequisites: deployed native-agent tables/roles/source-context migrations;
-- authenticated /accounts/attest from the fixed hosted service; owner-reviewed
-- exact original bindings recorded by normal SDK setup; current membership.
-- No credentials, broad primary policy change, acceleration or 24h cadence edit.
-- One persistent Next node owns held admission sessions. Hosted flags stay OFF
-- until exact app/service versions, registry and end-to-end proofs are reviewed.
-- The approver's private executor must set app.hosted_demo_schema_target to JSON
-- {database,systemIdentifier,owner,artifact:"hosted-demo-registration-v1"} from
-- independently inspected target metadata. This selector is NOT authorization.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $guard$
DECLARE target jsonb;expected record;p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 target:=current_setting('app.hosted_demo_schema_target',true)::jsonb;
 IF target IS NULL OR jsonb_typeof(target) IS DISTINCT FROM 'object'
 OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(target) k) IS DISTINCT FROM ARRAY['artifact','database','environment','owner','systemIdentifier']
 OR target->>'artifact' IS DISTINCT FROM 'hosted-demo-registration-v1'
 OR target->>'database' IS DISTINCT FROM current_database()
 OR target->>'systemIdentifier' IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
 OR target->>'owner' IS DISTINCT FROM current_user OR current_user IS DISTINCT FROM session_user
 OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'Explicit independently reviewed exact target required';END IF;
 IF target->>'environment'='production' THEN
  IF current_database()<>'postgres' OR target->>'systemIdentifier'<>'7678071634733212629' THEN RAISE EXCEPTION 'Exact production target required';END IF;
 ELSIF target->>'environment'='rehearsal' THEN
  IF current_database()<>'acquire_hosted_demo_rehearsal' OR target->>'systemIdentifier'='7678071634733212629'
  OR shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') IS DISTINCT FROM 'acquire-hosted-demo-rehearsal-only'
  THEN RAISE EXCEPTION 'Exact isolated rehearsal target required';END IF;
 ELSE RAISE EXCEPTION 'Explicit production or isolated rehearsal selection required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_production_schema_migrations WHERE artifact='native-agent-baseline-v1') THEN RAISE EXCEPTION 'Reviewed native production baseline required';END IF;
 IF to_regclass('public.agent_hosted_demo_registrations') IS NOT NULL
 OR to_regprocedure('public.agent_demo_run_bindings_match_before_hosted(text,text,text,text,text,jsonb)') IS NOT NULL
 OR to_regprocedure('public.agent_demo_runtime_ready_before_hosted(uuid)') IS NOT NULL
 OR to_regprocedure('public.agent_demo_send_window_exempt(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'New hosted registration objects must be absent';END IF;
 FOR expected IN SELECT * FROM (VALUES
 ('public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb)','3cc4b81e104b102126781d5624f370784dc32e801b38a06270182a6e32dffa4a','v'),
 ('public.agent_demo_runtime_ready(uuid)','3cc4b81e104b102126781d5624f370784dc32e801b38a06270182a6e32dffa4a','s'),
 ('public.agent_channel_operation_before_invitations(uuid)','ffba9dc409e77c9a3df70a99a5b6eea77ca630a5b0930db577b3906f9dfb9079','v'),
 ('public.agent_invitation_before_company_projection(uuid)','7f8956fcdd8a6e522f668862d424d579ae7da4bb5314fcfae62f572aa72f3f4a','v')
 ) specs(signature,source_body_sha,volatility) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF p.oid IS NULL OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.source_body_sha
  OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user OR p.prosecdef IS DISTINCT FROM true
  OR p.provolatile::text IS DISTINCT FROM expected.volatility
  OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR p.prorettype IS DISTINCT FROM 'boolean'::regtype OR p.proretset OR p.prokind<>'f' OR p.proleakproof
  OR p.proacl::text IS DISTINCT FROM format('{%s=X/%s}',current_user,current_user)
  THEN RAISE EXCEPTION 'Exact reviewed predecessor authority required: %',expected.signature;END IF;
 END LOOP;
END $guard$;

-- Privileged metadata evidence, not a provider signature or permission to send.
-- Only the reviewed database owner can insert/disable a registration. The app
-- and hosted service have no INSERT/UPDATE/DELETE privilege on this table.
-- attestation is the exact authenticated TLS/scoped-service response; the
-- digest seals its SQL jsonb representation (not an invented wire signature).
CREATE TABLE public.agent_hosted_demo_registrations(
 organization_id text NOT NULL REFERENCES public.organization(id),
 owner_user_id text NOT NULL REFERENCES public."user"(id),
 run_id text NOT NULL CHECK(run_id~'^hosted-demo-[a-z0-9][a-z0-9-]{0,35}$'),
 integration_id text NOT NULL,configuration_ref text NOT NULL,
 service_origin text NOT NULL CHECK(service_origin='https://acquire-simulator.mlai.au'),
 senders jsonb NOT NULL CHECK(jsonb_typeof(senders)='array' AND jsonb_array_length(senders)=3 AND octet_length(senders::text)<=12000),
 attestation jsonb NOT NULL CHECK(jsonb_typeof(attestation)='object' AND octet_length(attestation::text)<=20000),
 attestation_digest text NOT NULL CHECK(attestation_digest=encode(sha256(convert_to(attestation::text,'UTF8')),'hex')),
 enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,owner_user_id,run_id),
 CHECK(integration_id='sim-'||run_id AND configuration_ref=integration_id||'-v1')
);
ALTER TABLE public.agent_hosted_demo_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_hosted_demo_registrations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_hosted_demo_registrations FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE POLICY agent_hosted_demo_owner ON public.agent_hosted_demo_registrations TO PUBLIC
 USING(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_hosted_demo_registrations'::regclass)))
 WITH CHECK(current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.agent_hosted_demo_registrations'::regclass)));

-- Original registration evidence never changes. Disabling is explicit and
-- irreversible for this run; reconnecting accounts requires a new reviewed run.
CREATE FUNCTION public.agent_hosted_demo_registration_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $registration$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original hosted registration evidence is retained';END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') OR OLD.enabled IS NOT TRUE OR NEW.enabled IS NOT FALSE THEN RAISE EXCEPTION 'Only explicit disable of original hosted registration is allowed';END IF;
  RETURN NEW;
 END IF;
 IF NEW.attestation->>'observedAt' IS NULL OR NEW.attestation->>'observedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
 OR (NEW.attestation->>'observedAt')::timestamptz<clock_timestamp()-interval '5 minutes'
 OR (NEW.attestation->>'observedAt')::timestamptz>clock_timestamp()+interval '30 seconds'
 THEN RAISE EXCEPTION 'Fresh owner-acquired authenticated attestation required for registration';END IF;
 RETURN NEW;
END $registration$;
REVOKE ALL ON FUNCTION public.agent_hosted_demo_registration_guard() FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE TRIGGER agent_hosted_demo_registration_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_hosted_demo_registrations FOR EACH ROW EXECUTE FUNCTION public.agent_hosted_demo_registration_guard();

-- Hosted-only registration predicate. No communications schema or DB credential.
CREATE FUNCTION public.agent_hosted_demo_bindings_match(p_org text,p_owner text,p_run text,p_integration text,p_config text,p_senders jsonb)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $hosted$
DECLARE registration public.agent_hosted_demo_registrations%ROWTYPE;item jsonb;account jsonb;b public.communication_bindings%ROWTYPE;seen_channels text[]:='{}';seen_bindings text[]:='{}';proof jsonb;
BEGIN
 IF p_org IS DISTINCT FROM current_setting('app.acquire_org',true) OR p_owner IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR p_run IS NULL OR p_run!~'^hosted-demo-[a-z0-9][a-z0-9-]{0,35}$'
 OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=p_org AND user_id=p_owner) THEN RETURN false;END IF;
 SELECT * INTO registration FROM public.agent_hosted_demo_registrations WHERE organization_id=p_org AND owner_user_id=p_owner AND run_id=p_run AND enabled;
 IF registration.run_id IS NULL OR registration.integration_id IS DISTINCT FROM p_integration OR registration.configuration_ref IS DISTINCT FROM p_config
 OR registration.senders IS DISTINCT FROM p_senders OR p_integration IS DISTINCT FROM 'sim-'||p_run OR p_config IS DISTINCT FROM p_integration||'-v1'
 OR jsonb_typeof(p_senders) IS DISTINCT FROM 'array' OR jsonb_array_length(p_senders)<>3 THEN RETURN false;END IF;
 proof:=registration.attestation;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(proof) k) IS DISTINCT FROM ARRAY['accounts','configurationReference','integrationId','observedAt','runId','scope','serviceOrigin','version']
 OR proof->'version' IS DISTINCT FROM '1'::jsonb OR proof->>'runId' IS DISTINCT FROM p_run
 OR proof->>'integrationId' IS DISTINCT FROM p_integration OR proof->>'configurationReference' IS DISTINCT FROM p_config
 OR proof->>'serviceOrigin' IS DISTINCT FROM registration.service_origin
 OR proof->'scope' IS DISTINCT FROM jsonb_build_object('applicationId','acquire','tenantId',p_org,'ownerId',p_owner)
 OR jsonb_typeof(proof->'accounts') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'accounts')<>3
 OR proof->>'observedAt' IS NULL THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_senders) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>6
  OR item->>'channel' IS NULL OR item->>'channel' NOT IN('email','whatsapp','linkedin')
  OR item->>'bindingId' IS NULL OR item->>'bindingId'!~'^[a-f0-9-]{36}$'
  OR item->>'bindingDigest' IS NULL OR item->>'bindingDigest'!~'^[a-f0-9]{64}$'
  OR item->>'accountId' IS NULL OR item->>'providerAccountId' IS DISTINCT FROM 'sim-'||p_run||'-'||(item->>'channel')
  OR item->>'sourceId' IS DISTINCT FROM 'sim-source-'||(item->>'channel')
  OR item->>'channel'=ANY(seen_channels) OR item->>'bindingId'=ANY(seen_bindings) THEN RETURN false;END IF;
  SELECT * INTO b FROM public.communication_bindings WHERE id::text=item->>'bindingId' AND organization_id=p_org AND owner_user_id=p_owner
   AND channel=item->>'channel' AND application_id='acquire' AND authority='service' AND backend='unipile';
  IF b.id IS NULL OR b.service_account_id IS DISTINCT FROM item->>'accountId' OR public.agent_recorded_binding_digest(b.id) IS DISTINCT FROM item->>'bindingDigest' THEN RETURN false;END IF;
  SELECT value INTO account FROM jsonb_array_elements(proof->'accounts') WHERE value->'binding'->>'channel'=b.channel;
  IF account IS NULL OR (SELECT count(*) FROM jsonb_array_elements(proof->'accounts') x WHERE x->'binding'->>'channel'=b.channel)<>1
  OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(account) k) IS DISTINCT FROM ARRAY['binding','providerAccountId','sourceId','status']
  OR account->>'status' IS DISTINCT FROM 'connected' OR account->>'providerAccountId' IS DISTINCT FROM item->>'providerAccountId' OR account->>'sourceId' IS DISTINCT FROM item->>'sourceId'
  OR account->'binding' IS DISTINCT FROM jsonb_build_object('applicationId',b.application_id,'tenantId',b.organization_id,'ownerId',b.owner_user_id,'connectionId',b.service_connection_id,'accountId',b.service_account_id,'generation',b.generation,'channel',b.channel,'platform',b.platform,'backend',b.backend)
  THEN RETURN false;END IF;
  seen_channels:=seen_channels||ARRAY[item->>'channel'];seen_bindings:=seen_bindings||ARRAY[item->>'bindingId'];
 END LOOP;
 RETURN cardinality(seen_channels)=3;
END $hosted$;
REVOKE ALL ON FUNCTION public.agent_hosted_demo_bindings_match(text,text,text,text,text,jsonb) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;

-- Restricted current-registration read for service authentication. It must not
-- acquire the organization writer gate because it is called during held proof
-- revalidation. This produces no permit or coverage/send authority.
CREATE FUNCTION public.agent_hosted_demo_access_ready(p_run text,p_integration text,p_config text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $access$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_demo_runs run WHERE run.organization_id=org AND run.owner_user_id=actor AND run.run_id=p_run AND run.integration_id=p_integration AND run.configuration_ref=p_config
 AND public.agent_hosted_demo_bindings_match(org,actor,run.run_id,run.integration_id,run.configuration_ref,run.senders));
END $access$;
REVOKE ALL ON FUNCTION public.agent_hosted_demo_access_ready(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_hosted_demo_access_ready(text,text,text) TO acquire_agent_user,acquire_campaign_user;

-- Preserve original implementations and their legacy/local behavior bytewise.
ALTER FUNCTION public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb) RENAME TO agent_demo_run_bindings_match_before_hosted;
REVOKE ALL ON FUNCTION public.agent_demo_run_bindings_match_before_hosted(text,text,text,text,text,jsonb) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_demo_run_bindings_match(p_org text,p_owner text,p_run text,p_integration text,p_config text,p_senders jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $run$
BEGIN
 IF p_run LIKE 'hosted-demo-%' THEN RETURN public.agent_hosted_demo_bindings_match(p_org,p_owner,p_run,p_integration,p_config,p_senders);END IF;
 RETURN public.agent_demo_run_bindings_match_before_hosted(p_org,p_owner,p_run,p_integration,p_config,p_senders);
END $run$;
REVOKE ALL ON FUNCTION public.agent_demo_run_bindings_match(text,text,text,text,text,jsonb) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
ALTER FUNCTION public.agent_demo_runtime_ready(uuid) RENAME TO agent_demo_runtime_ready_before_hosted;
REVOKE ALL ON FUNCTION public.agent_demo_runtime_ready_before_hosted(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;
CREATE FUNCTION public.agent_demo_runtime_ready(p_run uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $ready$
DECLARE run public.agent_demo_runs%ROWTYPE;
BEGIN
 SELECT * INTO run FROM public.agent_demo_runs WHERE id=p_run AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF run.run_id LIKE 'hosted-demo-%' THEN RETURN public.agent_hosted_demo_bindings_match(run.organization_id,run.owner_user_id,run.run_id,run.integration_id,run.configuration_ref,run.senders);END IF;
 RETURN public.agent_demo_runtime_ready_before_hosted(p_run);
END $ready$;
REVOKE ALL ON FUNCTION public.agent_demo_runtime_ready(uuid) FROM PUBLIC,acquire_agent_user,acquire_campaign_user;

-- Only exact mapped demo routes can borrow this hours exception. All ordinary
-- source CAS, histories, approvals, quota, leases, opt-out and cold cadence gates
-- still run. This does not mark hosted bindings local or enable acceleration.
CREATE FUNCTION public.agent_hosted_demo_send_window_exempt(p_route uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $hours$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.agent_conversation_channels r
 JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.mandate_id=r.mandate_id AND c.organization_id=org AND c.owner_user_id=actor
 JOIN public.agent_threads t ON t.id=c.thread_id AND t.mandate_id=c.mandate_id AND t.organization_id=org AND t.owner_user_id=actor
 JOIN public.agent_mandate_execution_modes mode ON mode.mandate_id=c.mandate_id AND mode.organization_id=org AND mode.created_by=actor AND mode.mode='demo'
 JOIN public.agent_demo_contact_mappings mapping ON mapping.contact_id=c.contact_id AND mapping.mandate_id=c.mandate_id AND mapping.organization_id=org AND mapping.created_by=actor
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
END $hours$;
REVOKE ALL ON FUNCTION public.agent_hosted_demo_send_window_exempt(uuid) FROM PUBLIC,acquire_campaign_user;
GRANT EXECUTE ON FUNCTION public.agent_hosted_demo_send_window_exempt(uuid) TO acquire_agent_user;
CREATE FUNCTION public.agent_demo_send_window_exempt(p_route uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $probe$
DECLARE local_result boolean;
BEGIN
 IF public.agent_hosted_demo_send_window_exempt(p_route) THEN RETURN true;END IF;
 IF to_regprocedure('public.agent_gui_testing_send_window_exempt(uuid)') IS NOT NULL THEN
  EXECUTE 'SELECT public.agent_gui_testing_send_window_exempt($1)' INTO local_result USING p_route;
  RETURN local_result IS TRUE;
 END IF;
 RETURN false;
END $probe$;
REVOKE ALL ON FUNCTION public.agent_demo_send_window_exempt(uuid) FROM PUBLIC,acquire_campaign_user;
GRANT EXECUTE ON FUNCTION public.agent_demo_send_window_exempt(uuid) TO acquire_agent_user;

-- Exact source hashes above gate these two surgical edits. This replaces ONLY
-- the final hours veto. No recreated/handwritten authority body can hide drift.
DO $patch_hours$
DECLARE signature text;definition text;patched text;needle text:='AND NOT public.agent_gui_testing_send_window_exempt(r.id)';
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.agent_channel_operation_before_invitations(uuid)','public.agent_invitation_before_company_projection(uuid)'] LOOP
  definition:=pg_get_functiondef(to_regprocedure(signature));
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Exact single hours clause required: %',signature;END IF;
  patched:=replace(definition,needle,needle||' AND NOT public.agent_hosted_demo_send_window_exempt(r.id)');
  EXECUTE patched;
  IF replace(pg_get_functiondef(to_regprocedure(signature)),needle||' AND NOT public.agent_hosted_demo_send_window_exempt(r.id)',needle) IS DISTINCT FROM definition THEN RAISE EXCEPTION 'Non-hours authority changed';END IF;
 END LOOP;
END $patch_hours$;

-- Supabase API roles inherit no access to this private bridge.
REVOKE ALL ON TABLE public.agent_hosted_demo_registrations FROM anon,authenticated,service_role;
DO $api_roles$
DECLARE entry record;
BEGIN
 FOR entry IN SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('agent_hosted_demo_registration_guard','agent_hosted_demo_bindings_match','agent_hosted_demo_access_ready','agent_demo_run_bindings_match','agent_demo_runtime_ready','agent_hosted_demo_send_window_exempt','agent_demo_send_window_exempt') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||entry.signature||' FROM anon,authenticated,service_role';
 END LOOP;
END $api_roles$;
INSERT INTO public.agent_production_schema_migrations(artifact,source_revision) VALUES('hosted-demo-registration-v1','c6e228c');
COMMIT;
