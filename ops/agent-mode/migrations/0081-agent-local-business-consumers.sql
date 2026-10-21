-- SIM28: forward business-time consumers for current native79 + local0080.
-- Only selected local clock contexts use business coordinates. All original
-- authority, RLS, leases, grants, model/send-budget expiry and audit remain real.
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(1094930773,2901);
DO $target$ BEGIN
 IF current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225'
 OR to_regprocedure('public.local_simulator_business_now()') IS NULL
 OR EXISTS(SELECT 1 FROM public.local_simulator_business_runs) THEN RAISE EXCEPTION 'Exact idle unactivated local clock target required';END IF;
END $target$;
DO $predecessors$ BEGIN
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='communications.guard_dispatch_admission()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,communications_control=X/project_acquire}') IS DISTINCT FROM 'c7f7095fa92c9d4d2ad51d72c1bd7447c9d70b3da70c459320b8df5d8eaf177a' THEN RAISE EXCEPTION 'Changed predecessor: communications.guard_dispatch_admission()';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='communications.history_coverage_commit_guard()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,communications_control=X/project_acquire}') IS DISTINCT FROM '9fcedcaa58707838f74a5bb3ba4507735b55d676c5b395f7daff91dd3934e87c' THEN RAISE EXCEPTION 'Changed predecessor: communications.history_coverage_commit_guard()';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='communications.protect_history_initial_sync()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,communications_control=X/project_acquire}') IS DISTINCT FROM '0458e6a4ce9516e7a4885d23705c551b4874551a1816c5b9caabeb10ec288e15' THEN RAISE EXCEPTION 'Changed predecessor: communications.protect_history_initial_sync()';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='communications.protect_history_refresh()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,communications_control=X/project_acquire}') IS DISTINCT FROM '8fbb0176b17658610bdf9ea9fc28c9715f1138dc3b7ef5e559d4b2425dd12e4e' THEN RAISE EXCEPTION 'Changed predecessor: communications.protect_history_refresh()';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_adopt_sequence_channels(uuid,jsonb)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM 'c2036f5b24634a3650b7fe6d9e50621136a07c6051af559ce5b4bc0a5f992691' THEN RAISE EXCEPTION 'Changed predecessor: agent_adopt_sequence_channels(uuid,jsonb)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_communications_change(jsonb)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_campaign_user=X/project_acquire}') IS DISTINCT FROM 'e01a83b70e2600355564881928386d978147ccc75fb17859e974359b46705359' THEN RAISE EXCEPTION 'Changed predecessor: agent_channel_communications_change(jsonb)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_due_reassessment(uuid,uuid,integer,timestamp with time zone)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM 'e45be0e4d83c4070b9f5652280c1af10b7ffaa5a69b9c25db1e6eb5b742abe12' THEN RAISE EXCEPTION 'Changed predecessor: agent_channel_due_reassessment(uuid,uuid,integer,timestamp with time zone)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_operation_before_invitations(uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '197e55cd0d74a5352f918e1444b032c82440525d360cbf0538af87f26cd386db' THEN RAISE EXCEPTION 'Changed predecessor: agent_channel_operation_before_invitations(uuid)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_proposal_before_invitations(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM 'f7cc79703987285e3d57707959648d793d25eea3a95a2d2d81e6a19263a85f90' THEN RAISE EXCEPTION 'Changed predecessor: agent_channel_proposal_before_invitations(uuid,text)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_proposal_permitted_before_history_quiet(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '190559ec09a6efe4a10767405c5a51a806259123a460100aefccf2976389602c' THEN RAISE EXCEPTION 'Changed predecessor: agent_channel_proposal_permitted_before_history_quiet(uuid,text)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_channel_record_submission(uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM '696b790af3d588496ab2763ec92b97408ae97248730b9edf8f94894649be85ab' THEN RAISE EXCEPTION 'Changed predecessor: agent_channel_record_submission(uuid)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_communications_bounce(uuid,text,text,text,text,text,timestamp with time zone,text)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_campaign_user=X/project_acquire}') IS DISTINCT FROM '001b57ed7a91329fb95be24b9d5ba45c78f3a9c89c1be1ce917c701e8502768f' THEN RAISE EXCEPTION 'Changed predecessor: agent_communications_bounce(uuid,text,text,text,text,text,timestamp with time zone,text)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_communications_change(uuid,text,text,text,text,text,timestamp with time zone,boolean)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_campaign_user=X/project_acquire}') IS DISTINCT FROM '80fc10e28ff02d93e3cf3a2186dda12cc0858156989a21c9ae52ba688b85a051' THEN RAISE EXCEPTION 'Changed predecessor: agent_communications_change(uuid,text,text,text,text,text,timestamp with time zone,boolean)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_ingest_channel_relationship(uuid,text,text,text,boolean,timestamp with time zone)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM '0cc748d6d9bd7b27ec2917061b6f60a13e89c9d72f27c1d6abdb44114f51c5fb' THEN RAISE EXCEPTION 'Changed predecessor: agent_ingest_channel_relationship(uuid,text,text,text,boolean,timestamp with time zone)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_invitation_before_company_projection(uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '1561e6d90842aa1cf0db0a6d105e4bbfd8c8a39f91be01e965cc3c450fd5d3c4' THEN RAISE EXCEPTION 'Changed predecessor: agent_invitation_before_company_projection(uuid)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_lock_member()'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM 'a4242d36be35013c74a913813ad8dc9e43f39f31f58d2c194fde4c55016e7ce9' THEN RAISE EXCEPTION 'Changed predecessor: agent_lock_member()';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_native_sending_policy(uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '80dbdaed4e6a1f6c22002be0b37e83242f5d6169e4118a4e89d46d715f63b07e' THEN RAISE EXCEPTION 'Changed predecessor: agent_native_sending_policy(uuid)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_operation_authorised_before_sending_policy(uuid)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire}') IS DISTINCT FROM '3bba66cc6d6cb434320e49a16e93954453f9f33ccbcecc3919f9f628c98a7556' THEN RAISE EXCEPTION 'Changed predecessor: agent_operation_authorised_before_sending_policy(uuid)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_record_invitation_outcome(uuid,jsonb)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM 'c8f4d537b0e2d27092d821dccb67fe7edf19473cf0d3f3f4f1fc7b7e088b76d8' THEN RAISE EXCEPTION 'Changed predecessor: agent_record_invitation_outcome(uuid,jsonb)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_register_channel(uuid,uuid,integer,text,uuid,text,text,text,jsonb)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM '7a6b5dce87d38e83db037ee0a48fb41a537384e632f160b1c8b7bae6c9f82aae' THEN RAISE EXCEPTION 'Changed predecessor: agent_register_channel(uuid,uuid,integer,text,uuid,text,text,text,jsonb)';END IF;
 IF (SELECT encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') FROM pg_proc WHERE oid='public.agent_save_channel_history(uuid,integer,jsonb,timestamp with time zone,boolean)'::regprocedure AND pg_get_userbyid(proowner)='project_acquire' AND proacl::text='{project_acquire=X/project_acquire,acquire_agent_user=X/project_acquire}') IS DISTINCT FROM '11b88e109efb3db695d74be95319678280097e92925b2ae1b66bc7ea48467959' THEN RAISE EXCEPTION 'Changed predecessor: agent_save_channel_history(uuid,integer,jsonb,timestamp with time zone,boolean)';END IF;
 IF (SELECT sha256 FROM public.agent_local_migrations WHERE name='0080-agent-local-business-clock.sql') IS DISTINCT FROM 'f9b2947a2111014fc720be776d3920d4f04881e403bfcc9dacef4fa1255afebd' OR (SELECT count(*) FROM public.agent_local_migrations)<>78 THEN RAISE EXCEPTION 'Exact installed0080 ledger required';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.local_simulator_business_now()'::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]) IS DISTINCT FROM '65390e2ae00954c1defb5b10ecfe0d359381e6b797f8de861723aaa69070d862' THEN RAISE EXCEPTION 'Exact installed0080 SQL clock required';END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='communications.history_refreshes'::regclass AND conname='history_refreshes_check') IS DISTINCT FROM 'CHECK ((required_since <= started_at))' THEN RAISE EXCEPTION 'Changed history business constraint';END IF;
END $predecessors$;
CREATE FUNCTION public.local_simulator_assert_business_scope(p_tenant text,p_owner text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $scope$
BEGIN
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.local_simulator_business_runs WHERE organization_id=p_tenant AND owner_user_id=p_owner AND enabled) THEN RAISE EXCEPTION 'Registered actor requires business clock context';END IF;
  RETURN;
 END IF;
 IF p_tenant IS DISTINCT FROM current_setting('app.acquire_org',true) OR p_owner IS DISTINCT FROM current_setting('app.acquire_user',true) THEN RAISE EXCEPTION 'Business clock actor differs';END IF;
 PERFORM public.local_simulator_business_now();
END $scope$;
REVOKE ALL ON FUNCTION public.local_simulator_assert_business_scope(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_simulator_assert_business_scope(text,text) TO communications_control,communications_scoped;
CREATE FUNCTION public.local_simulator_operation_business_anchor(p_operation public.agent_operations) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $anchor$
DECLARE anchor timestamptz;
BEGIN
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN RETURN greatest((p_operation.result->'delivery'->>'submittedAt')::timestamptz,p_operation.updated_at);END IF;
 PERFORM public.local_simulator_business_now();
 anchor:=coalesce(p_operation.business_completed_at,CASE WHEN p_operation.result->'delivery'->>'status'='submitted' THEN (p_operation.result->'delivery'->>'submittedAt')::timestamptz ELSE NULL END);
 IF anchor IS NULL OR NOT isfinite(anchor) OR anchor>public.local_simulator_business_now() THEN RAISE EXCEPTION 'Original scoped business completion required';END IF;
 RETURN anchor;
END $anchor$;
REVOKE ALL ON FUNCTION public.local_simulator_operation_business_anchor(public.agent_operations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.local_simulator_operation_business_anchor(public.agent_operations) TO acquire_agent_user,acquire_campaign_user;
ALTER TABLE communications.history_refreshes ADD COLUMN business_started_at timestamptz,ADD COLUMN business_finished_at timestamptz;
ALTER TABLE communications.history_refreshes DROP CONSTRAINT history_refreshes_check;
ALTER TABLE communications.history_refreshes ADD CONSTRAINT history_refreshes_business_required_since CHECK(required_since<=coalesce(business_started_at,started_at));
ALTER TABLE communications.history_refreshes ADD CONSTRAINT history_refreshes_business_finished CHECK(business_finished_at IS NULL OR business_started_at IS NOT NULL AND business_finished_at>=business_started_at);
ALTER TABLE communications.history_initial_sync ADD COLUMN business_completed_at timestamptz;
ALTER TABLE communications.dispatch_admissions ADD COLUMN business_admitted_at timestamptz;

CREATE OR REPLACE FUNCTION public.local_simulator_business_now() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $clock$
DECLARE run text:=nullif(current_setting('acquire.simulator_business_run',true),'');
 stamp text:=nullif(current_setting('acquire.simulator_business_time',true),'');
 runtime text:=nullif(current_setting('app.acquire_runtime_id',true),'');
 config public.local_simulator_business_runs%ROWTYPE;
BEGIN
 IF run IS NULL AND stamp IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.local_simulator_business_runs WHERE (runtime_id=runtime OR organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)) AND enabled) THEN RAISE EXCEPTION 'Configured local clock context missing';END IF;
  RETURN clock_timestamp();
 END IF;
 SELECT * INTO config FROM public.local_simulator_business_runs WHERE run_id=run AND enabled;
 IF config.run_id IS NULL OR config.runtime_id IS DISTINCT FROM runtime
 OR config.organization_id IS DISTINCT FROM current_setting('app.acquire_org',true)
 OR config.owner_user_id IS DISTINCT FROM current_setting('app.acquire_user',true)
 OR stamp IS NULL OR stamp!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[.]\d{3}Z$'
 OR current_database()<>'acquire_agent_mode'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only'
 OR (SELECT system_identifier::text FROM pg_control_system())<>'7697400069962248225' THEN RAISE EXCEPTION 'Exact registered business clock scope required';END IF;
 RETURN stamp::timestamptz;
END $clock$;
ALTER TABLE public.local_simulator_business_runs ADD CONSTRAINT local_simulator_business_actor_unique UNIQUE(organization_id,owner_user_id);

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION communications.guard_dispatch_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'communications'
AS $function$
DECLARE operation communications.operation_journal%ROWTYPE; current_revision bigint;
BEGIN
 PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);

 IF current_user<>'communications_control' THEN RAISE EXCEPTION 'Restricted service admission writer required'; END IF;
 SELECT * INTO STRICT operation FROM communications.operation_journal WHERE id=NEW.journal_id FOR SHARE;
 current_revision:=communications.assert_dispatch_reply_barrier(NEW.application_id,NEW.tenant_id);
 IF ROW(operation.application_id,operation.tenant_id,operation.owner_id,operation.connection_id,operation.generation,operation.account_id,operation.operation_key,operation.payload_digest,operation.claim_token,operation.fencing_token,operation.lease_owner_token)
 IS DISTINCT FROM ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.connection_id,NEW.generation,NEW.account_id,NEW.operation_key,NEW.payload_digest,NEW.claim_token,NEW.fencing_token,NEW.lease_owner_token)
 OR operation.state<>'dispatching' OR NOT operation.quota_reserved OR operation.claim_until<=clock_timestamp() OR current_revision<>NEW.service_revision
 OR NOT EXISTS(SELECT 1 FROM communications.connections c WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active AND c.status='connected')
 OR NOT EXISTS(SELECT 1 FROM communications.physical_accounts p WHERE p.id=NEW.account_id AND p.verified_at IS NOT NULL AND p.verified_at<=clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM communications.access_grants g WHERE g.application_id=NEW.application_id AND g.tenant_id=NEW.tenant_id AND g.owner_id=NEW.owner_id AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM communications.account_leases l WHERE l.account_id=NEW.account_id AND l.owner_token=NEW.lease_owner_token AND l.fencing_token=NEW.fencing_token AND l.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Original held admission authority expired or mismatched'; END IF;
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN
  IF NEW.business_admitted_at IS NOT NULL THEN RAISE EXCEPTION 'Unscoped business admission';END IF;
 ELSE
  PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);
  IF NEW.business_admitted_at IS DISTINCT FROM public.local_simulator_business_now() THEN RAISE EXCEPTION 'Exact scoped business admission required';END IF;
 END IF;
 RETURN NEW;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION communications.history_coverage_commit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'communications'
AS $function$
BEGIN
 IF NEW.complete THEN
 PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);

  IF NOT NEW.initial_sync_complete OR NEW.invalidated OR NEW.encrypted_cursor IS NULL OR NEW.cursor_key_version IS NULL
   OR NEW.coverage_through>public.local_simulator_business_now() OR NEW.observed_at>public.local_simulator_business_now()
   OR NOT EXISTS(SELECT 1 FROM communications.history_refreshes h WHERE h.connection_id=NEW.connection_id
    AND h.generation=NEW.generation AND h.scope_digest=NEW.scope_digest
    AND h.application_id=NEW.application_id AND h.tenant_id=NEW.tenant_id AND h.owner_id=NEW.owner_id
    AND h.account_id=NEW.account_id AND h.required_since=NEW.coverage_from
    AND date_trunc('milliseconds',CASE WHEN nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN h.started_at ELSE h.business_started_at END)=NEW.coverage_through AND h.finished_at IS NOT NULL
    AND (nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL AND h.business_started_at IS NULL AND h.finished_at>=NEW.observed_at
      OR nullif(current_setting('acquire.simulator_business_run',true),'') IS NOT NULL AND h.business_started_at IS NOT NULL AND h.business_finished_at>=NEW.observed_at))
   OR NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.access_grants g
    ON g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id
    WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active
    AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Complete history coverage lacks current finished original authorization';
  END IF;
 END IF;
 RETURN NULL;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION communications.protect_history_initial_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'communications'
AS $function$
BEGIN
 PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);

 PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
 PERFORM communications.assert_account_retirement_open(NEW.account_id);
 IF NEW.completed_at>clock_timestamp() OR NOT EXISTS(
  SELECT 1 FROM communications.webhook_receipt_routes r JOIN communications.webhook_inbox w ON w.id=r.webhook_inbox_id
  WHERE r.webhook_inbox_id=NEW.webhook_inbox_id AND r.application_id=NEW.application_id AND r.tenant_id=NEW.tenant_id
   AND r.owner_id=NEW.owner_id AND r.connection_id=NEW.connection_id AND r.generation=NEW.generation AND r.account_id=NEW.account_id
   AND w.backend='unipile' AND w.authenticated_at<=clock_timestamp() AND w.received_at=NEW.completed_at
   AND w.state='processing' AND w.lease_until>clock_timestamp() AND w.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Initial sync requires exact authenticated owned original receipt';
 END IF;
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN
  IF NEW.business_completed_at IS NOT NULL THEN RAISE EXCEPTION 'Unscoped business sync completion';END IF;
 ELSE
  PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);
  IF NEW.business_completed_at IS DISTINCT FROM public.local_simulator_business_now() THEN RAISE EXCEPTION 'Exact scoped business sync completion required';END IF;
 END IF;
 RETURN NEW;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION communications.protect_history_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'communications'
AS $function$
DECLARE c communications.connections%ROWTYPE;
BEGIN
 PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);

 PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
 PERFORM communications.assert_account_retirement_open(NEW.account_id);
 SELECT * INTO STRICT c FROM communications.connections WHERE id=NEW.connection_id FOR SHARE;
 IF NOT c.active OR c.current_generation<>NEW.generation OR c.account_id<>NEW.account_id
  OR ROW(c.application_id,c.tenant_id,c.owner_id) IS DISTINCT FROM ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id)
  OR NOT EXISTS(SELECT 1 FROM communications.access_grants WHERE application_id=NEW.application_id
   AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND revoked_at IS NULL AND expires_at>clock_timestamp())
  OR NEW.started_at>clock_timestamp() THEN
  RAISE EXCEPTION 'History refresh requires current original authority';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.connection_id,NEW.generation,NEW.account_id,NEW.scope_digest,NEW.digest_key_version)
   IS DISTINCT FROM ROW(OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.connection_id,OLD.generation,OLD.account_id,OLD.scope_digest,OLD.digest_key_version)
   OR (NEW.token_hash<>OLD.token_hash AND (OLD.lease_until>clock_timestamp() OR NEW.started_at<OLD.started_at OR NEW.finished_at IS NOT NULL))
   OR (NEW.token_hash=OLD.token_hash AND ROW(NEW.required_since,NEW.capture_revision,NEW.started_at)
    IS DISTINCT FROM ROW(OLD.required_since,OLD.capture_revision,OLD.started_at)) THEN
   RAISE EXCEPTION 'History identity/active claim is immutable';
  END IF;
 END IF;
 IF nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN
  IF NEW.business_started_at IS NOT NULL OR NEW.business_finished_at IS NOT NULL THEN RAISE EXCEPTION 'Unscoped business history refresh';END IF;
 ELSE
  PERFORM public.local_simulator_assert_business_scope(NEW.tenant_id,NEW.owner_id);
  IF NEW.business_started_at IS NULL OR NEW.business_started_at>public.local_simulator_business_now()
   OR (TG_OP='INSERT' OR NEW.token_hash<>OLD.token_hash) AND (NEW.business_started_at IS DISTINCT FROM public.local_simulator_business_now() OR NEW.business_finished_at IS NOT NULL)
   OR (NEW.finished_at IS NULL) IS DISTINCT FROM (NEW.business_finished_at IS NULL)
   OR NEW.business_finished_at IS NOT NULL AND (NEW.business_finished_at<NEW.business_started_at OR NEW.business_finished_at IS DISTINCT FROM public.local_simulator_business_now())
   OR TG_OP='UPDATE' AND NEW.token_hash=OLD.token_hash AND NEW.business_started_at IS DISTINCT FROM OLD.business_started_at
   OR TG_OP='UPDATE' AND NEW.token_hash=OLD.token_hash AND OLD.business_finished_at IS NOT NULL AND NEW.business_finished_at IS DISTINCT FROM OLD.business_finished_at THEN
   RAISE EXCEPTION 'Original coherent business history anchors required';END IF;
 END IF;
 RETURN NEW;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_adopt_sequence_channels(p_thread uuid, p_review jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.agent_threads%ROWTYPE;s public.agent_responsibilities%ROWTYPE;source jsonb;person public.agent_conversations%ROWTYPE;route jsonb;key text;coverage jsonb;primary_route jsonb;notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO s FROM public.agent_responsibilities WHERE thread_id=t.id AND state IN('ready','waiting') FOR UPDATE;
 IF t.id IS NULL OR s.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.mandates m WHERE m.id=t.mandate_id AND m.organization_id=t.organization_id AND m.xmin::text=s.mandate_revision) THEN RAISE EXCEPTION 'Current reviewed mandate responsibility required';END IF;
 source:=public.agent_sequence_channel_handover_source(t.id,(p_review->>'enrolmentId')::uuid);
 IF source->>'versionId' IS DISTINCT FROM p_review->>'expectedVersionId' OR source->>'sourceRevision' IS DISTINCT FROM p_review->>'sourceRevision' OR source->>'channelPolicyRevision' IS DISTINCT FROM p_review->>'channelPolicyRevision' OR source->'channels' IS DISTINCT FROM p_review->'channels' THEN RAISE EXCEPTION 'Original sequence or exact human reviewed channel identities changed';END IF;
 IF public.agent_legacy_sequence_conflicts((source->>'contactId')::uuid,(source->>'enrolmentId')::uuid) THEN RAISE EXCEPTION 'Another sequence owns this canonical person';END IF;
 primary_route:=source->'channels'->0;
 SELECT jsonb_agg(jsonb_build_object('channel',x->>'channel','bindingId',x->>'bindingId','since',source->>'startedAt')) INTO coverage FROM jsonb_array_elements(source->'channels') x;
 INSERT INTO public.agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_id,binding_digest,recipient_email,driver_kind,sequence_enrolment_id,sequence_runtime,driver_generation,phase,history_revision,coverage_bindings)
 VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,s.id,(source->>'contactId')::uuid,'communications',(primary_route->>'bindingId')::uuid,primary_route->>'bindingDigest',(SELECT x->'recipient'->>'value' FROM jsonb_array_elements(source->'channels') x WHERE x->>'channel'='email'),'sequence',(source->>'enrolmentId')::uuid,source->>'runtime',(source->>'generation')::integer,'active',encode(sha256(convert_to('[]','UTF8')),'hex'),coverage) RETURNING * INTO person;
 FOREACH key IN ARRAY public.agent_person_keys(t.organization_id,person.contact_id) LOOP INSERT INTO public.agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES(t.organization_id,key,person.id,t.owner_user_id);END LOOP;
 FOR route IN SELECT value FROM jsonb_array_elements(source->'channels') LOOP
  INSERT INTO public.agent_conversation_channels(conversation_id,organization_id,owner_user_id,thread_id,mandate_id,channel,binding_id,binding_digest,recipient_kind,recipient_value,identity_source,identity_revision,history_revision,next_allowed_at)
  VALUES(person.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,route->>'channel',(route->>'bindingId')::uuid,route->>'bindingDigest',route->'recipient'->>'kind',route->'recipient'->>'value',route->'identityProof',encode(sha256(convert_to(public.agent_channel_canonical_json(route),'UTF8')),'hex'),encode(sha256(convert_to('[]','UTF8')),'hex'),public.local_simulator_business_now()+(SELECT delay_seconds FROM public.agent_channel_policies WHERE thread_id=t.id)*interval '1 second');
 END LOOP;
 notice:=jsonb_build_object('text','You reviewed all original sequence accounts and contact identities. The sequence still owns this person until it is stopped, its in-flight outcomes are reconciled, and you explicitly complete the handover. No agent message is approved.','details',jsonb_build_object('conversationId',person.id,'enrolmentId',source->>'enrolmentId','versionId',source->>'versionId','runtime',source->>'runtime','channels',source->'channels','sourceRevision',source->>'sourceRevision'));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,'sequence-channels-adopt:'||person.id,'assistant',notice,encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_object('role','assistant','content',notice)),'UTF8')),'hex'));
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(t.organization_id,t.owner_user_id,'agent.sequence_channels_adopted','agent_conversation',person.id::text,notice->'details');
 RETURN jsonb_build_object('id',person.id,'revision',person.revision,'epoch',person.epoch,'status','sequence_owned');
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_channel_communications_change(p jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);b public.communication_bindings%ROWTYPE;receipt public.communication_event_receipts%ROWTYPE;conv public.agent_conversations%ROWTYPE;candidate record;frame jsonb;outcome jsonb;binding uuid;event text;fingerprint text;changed text;occurred timestamptz;conflict boolean;reviewed boolean;key text;notice jsonb;payload jsonb;affected integer:=0;sender_kind text;sender_value text;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel receipt scope required';END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>20000 OR (SELECT count(*) FROM jsonb_object_keys(p))<>12 OR NOT(p ?& ARRAY['bindingId','serviceEventId','receiptFingerprint','changeFingerprint','channel','sender','providerMessageId','providerConversationId','occurredAt','reviewRequired','reviewReason','receiptPreimage']) THEN RAISE EXCEPTION 'Exact bounded channel receipt required';END IF;
 binding:=(p->>'bindingId')::uuid;event:=p->>'serviceEventId';fingerprint:=p->>'receiptFingerprint';changed:=p->>'changeFingerprint';occurred:=(p->>'occurredAt')::timestamptz;reviewed:=(p->>'reviewRequired')::boolean;sender_kind:=p->'sender'->>'kind';sender_value:=p->'sender'->>'value';
 IF coalesce(length(event),0) NOT BETWEEN 1 AND 200 OR coalesce(fingerprint,'')!~'^[a-f0-9]{64}$' OR coalesce(changed,'')!~'^[a-f0-9]{64}$' OR sender_kind IS NULL OR sender_value IS NULL OR occurred IS NULL OR occurred>public.local_simulator_business_now()+interval '1 minute' OR reviewed IS NULL OR coalesce(length(p->>'providerMessageId'),0) NOT BETWEEN 1 AND 2048 OR jsonb_typeof(p->'sender') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'sender'))<>2 THEN RAISE EXCEPTION 'Verified channel metadata required';END IF;
 SELECT * INTO b FROM public.communication_bindings WHERE id=binding AND organization_id=org AND owner_user_id=actor AND application_id='acquire' AND backend='unipile' AND authority='service' FOR SHARE;
 IF b.id IS NULL OR b.channel IS DISTINCT FROM p->>'channel' OR sender_kind IS DISTINCT FROM (CASE b.channel WHEN 'email' THEN 'email' WHEN 'whatsapp' THEN 'phone' WHEN 'linkedin' THEN 'linkedin_profile' END) OR NOT (CASE b.channel WHEN 'email' THEN sender_value=lower(btrim(sender_value)) AND sender_value~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' WHEN 'whatsapp' THEN sender_value~'^[+][1-9][0-9]{6,14}$' WHEN 'linkedin' THEN sender_value~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END) THEN RAISE EXCEPTION 'Original owned canonical channel required';END IF;
 IF coalesce(octet_length(p->>'receiptPreimage'),0) NOT BETWEEN 1 AND 12000 OR encode(sha256(convert_to(p->>'receiptPreimage','UTF8')),'hex') IS DISTINCT FROM changed THEN RAISE EXCEPTION 'Exact authenticated receipt preimage required';END IF;
 frame:=(p->>'receiptPreimage')::jsonb;outcome:=frame->7;
 IF jsonb_typeof(frame) IS DISTINCT FROM 'array' OR jsonb_array_length(frame)<>8 OR frame->>0 IS DISTINCT FROM 'acquire.reply.delivery.v1' OR frame->1 IS DISTINCT FROM jsonb_build_array(b.application_id,b.organization_id,b.owner_user_id,b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend) OR frame->>2 IS DISTINCT FROM binding::text OR frame->>3 IS DISTINCT FROM event OR jsonb_typeof(outcome) IS DISTINCT FROM 'array' OR jsonb_array_length(outcome)<>6 OR outcome->>0 IS DISTINCT FROM p->>'providerMessageId' OR outcome->1 IS DISTINCT FROM p->'providerConversationId' OR outcome->>2 IS DISTINCT FROM 'inbound' OR outcome->>3 IS DISTINCT FROM sender_kind OR outcome->>4 IS DISTINCT FROM sender_value OR (outcome->>5)::timestamptz IS DISTINCT FROM occurred OR (frame->>6)::timestamptz<occurred OR (frame->>6)::timestamptz>public.local_simulator_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Authenticated receipt metadata differs';END IF;
 IF frame->>4 IS DISTINCT FROM encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array('communications.reply.event.v1',frame->1,outcome->1,outcome->0)),'UTF8')),'hex') OR frame->>5 IS DISTINCT FROM encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array('communications.reply.content.v1',frame->1,outcome->0,outcome->1,'inbound',sender_kind,sender_value,outcome->5)),'UTF8')),'hex') THEN RAISE EXCEPTION 'Original source fingerprint differs';END IF;
 SELECT * INTO receipt FROM public.communication_event_receipts WHERE binding_id=binding AND service_event_id=event AND organization_id=org AND owner_user_id=actor FOR SHARE;
 IF receipt.binding_id IS NULL OR receipt.payload_fingerprint IS DISTINCT FROM fingerprint OR receipt.fingerprint_version IS DISTINCT FROM 'acquire.reply.delivery.v1' OR receipt.event_type IS DISTINCT FROM 'message' THEN RAISE EXCEPTION 'Original application receipt required';END IF;
 conflict:=fingerprint IS DISTINCT FROM changed;
 IF conflict AND (NOT reviewed OR p->>'reviewReason' IS DISTINCT FROM 'semantic_conflict') OR NOT conflict AND (receipt.occurred_at IS DISTINCT FROM occurred OR reviewed AND p->>'reviewReason' IS DISTINCT FROM 'identity_pending') THEN RAISE EXCEPTION 'Exact original receipt/review state required';END IF;
 -- A caller cannot promote an immutable review receipt by changing the flag.
 -- Only independently resolved original review evidence permits verified replay.
 IF NOT conflict AND NOT reviewed AND receipt.result='review' AND NOT EXISTS(SELECT 1 FROM public.communication_reply_review_latches l WHERE l.binding_id=binding AND l.service_event_id=event AND l.organization_id=org AND l.owner_user_id=actor AND l.resolved_at IS NOT NULL AND l.resolution_reference NOT LIKE 'human-unrelated:%') THEN reviewed:=true;END IF;
 -- A changed payload cannot identify a person. Notify only threads already bound
 -- to this account, dedup by ORIGINAL receipt, with no ownership/state changes.
 IF conflict THEN
  IF (SELECT count(DISTINCT thread_id) FROM public.agent_conversation_channels WHERE binding_id=binding AND organization_id=org AND owner_user_id=actor)>100 THEN RAISE EXCEPTION 'Channel receipt thread bound exceeded';END IF;
  FOR candidate IN SELECT DISTINCT thread_id,mandate_id FROM public.agent_conversation_channels WHERE binding_id=binding AND organization_id=org AND owner_user_id=actor ORDER BY thread_id LOOP
   PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
   key:='channel-receipt-conflict:'||encode(sha256(convert_to(jsonb_build_array(binding,event,fingerprint)::text,'UTF8')),'hex');
   IF EXISTS(SELECT 1 FROM public.agent_messages WHERE thread_id=candidate.thread_id AND request_key=key) THEN CONTINUE;END IF;
   notice:=jsonb_build_object('text','An account event conflicts with its original receipt and needs human review. No person was identified and no reply or cancellation was inferred. Account sending remains blocked by the communications review barrier.','details',jsonb_build_object('bindingId',binding,'serviceEventId',event,'reviewRequired',true,'verifiedReply',false));
   INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(candidate.thread_id,org,candidate.mandate_id,actor,key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
   affected:=affected+1;
  END LOOP;RETURN affected;
 END IF;
 IF (SELECT count(*) FROM public.agent_conversation_channels WHERE binding_id=binding AND organization_id=org AND owner_user_id=actor AND recipient_kind=sender_kind AND recipient_value=sender_value)>100 THEN RAISE EXCEPTION 'Channel incoming person bound exceeded';END IF;
 FOR candidate IN SELECT r.conversation_id,r.thread_id,r.id FROM public.agent_conversation_channels r JOIN public.agent_conversations c ON c.id=r.conversation_id AND c.thread_id=r.thread_id AND c.organization_id=org AND c.owner_user_id=actor WHERE r.binding_id=binding AND r.organization_id=org AND r.owner_user_id=actor AND r.channel=b.channel AND r.binding_digest=public.agent_recorded_binding_digest(binding) AND r.recipient_kind=sender_kind AND r.recipient_value=sender_value AND (reviewed OR public.agent_recorded_demo_route_matches(r.id) OR EXISTS(SELECT 1 FROM public.campaign_reply_identities i WHERE i.organization_id=org AND i.owner_user_id=actor AND i.contact_id=c.contact_id AND i.channel=b.channel AND i.source_identity=sender_value AND (i.identity=sender_value OR (b.channel='whatsapp' AND sender_kind='phone' AND i.identity=substring(sender_value from 2)||'@s.whatsapp.net')))) AND (reviewed OR b.channel<>'whatsapp' OR (SELECT count(DISTINCT other.contact_id) FROM public.agent_conversation_channels other_route JOIN public.agent_conversations other ON other.id=other_route.conversation_id AND other.thread_id=other_route.thread_id WHERE other_route.binding_id=binding AND other_route.organization_id=org AND other_route.owner_user_id=actor AND other.organization_id=org AND other.owner_user_id=actor AND other_route.channel='whatsapp' AND other_route.binding_digest=public.agent_recorded_binding_digest(binding) AND other_route.recipient_kind='phone' AND other_route.recipient_value=sender_value)=1) ORDER BY r.thread_id,r.conversation_id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.conversation_id FOR UPDATE;
  key:='channel-incoming:'||encode(sha256(convert_to(jsonb_build_array(binding,event,fingerprint,conv.id,reviewed)::text,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.agent_events WHERE thread_id=conv.thread_id AND event_key=key) THEN CONTINUE;END IF;
  UPDATE public.agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,phase=CASE WHEN reviewed AND driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,pause_reason=CASE WHEN driver_kind<>'agent' OR phase<>'active' THEN pause_reason WHEN reviewed THEN 'incoming_channel_review_required' ELSE 'provider_history_changed' END,updated_at=clock_timestamp() WHERE id=conv.id;
  UPDATE public.agent_conversation_channels SET history_complete=false,revision=revision+1,updated_at=clock_timestamp(),cold_cancelled_at=CASE WHEN NOT reviewed THEN coalesce(cold_cancelled_at,clock_timestamp()) ELSE cold_cancelled_at END,next_allowed_at=CASE WHEN NOT reviewed THEN NULL ELSE next_allowed_at END WHERE conversation_id=conv.id;
  PERFORM public.agent_invalidate_person_reviews(conv.id);
  -- Invitation is a separate effect, but a pending cold invitation also loses
  -- authority on any incoming event; original in-flight evidence is untouched.
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND name='linkedin.invitation' AND state IN('proposed','approved');
  UPDATE public.agent_review_batches rb SET state='invalidated' WHERE rb.thread_id=conv.thread_id AND rb.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(rb.manifest) item JOIN public.agent_operations o ON o.id::text=item->>'operationId' WHERE o.conversation_id=conv.id AND o.state='failed' AND o.result->>'reason'='context_changed');
  -- Ordinary verified replies invalidate every old proposal, not a human's
  -- still-current exact reply-only delegation. No cold or mixed grant survives.
  -- Missing body/full history remains non-authorising; dispatch checks it later.
  UPDATE public.agent_authority_grants g SET revoked_at=clock_timestamp(),revision=revision+1
   WHERE g.thread_id=conv.thread_id AND g.revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=conv.id AND (g.route_ids ? r.id::text OR g.recipient_keys ? (r.channel||':'||r.recipient_value)))
    AND NOT (
     NOT reviewed AND conv.phase='active' AND conv.driver_kind='agent' AND conv.engagement NOT IN('handoff','stopped')
     AND g.organization_id=org AND g.owner_user_id=actor AND g.mandate_id=conv.mandate_id
     AND g.channel=b.channel AND g.binding_digest=public.agent_recorded_binding_digest(binding)
     AND g.actions=jsonb_build_array('reply_'||b.channel)
     AND g.route_ids ? candidate.id::text AND g.recipient_keys ? (b.channel||':'||sender_value)
     AND g.approved_at<=clock_timestamp() AND g.expires_at>clock_timestamp() AND g.used_sends<g.max_sends
     AND EXISTS(SELECT 1 FROM public.agent_responsibilities a JOIN public.mandates m ON m.id=a.mandate_id AND m.organization_id=a.organization_id
      JOIN public.agent_operations approval ON approval.id=g.id AND approval.thread_id=g.thread_id AND approval.organization_id=org AND approval.owner_user_id=actor
      WHERE a.id=conv.responsibility_id AND a.thread_id=conv.thread_id AND a.state IN('ready','waiting') AND a.mandate_revision=m.xmin::text
       AND approval.name='authority.create_channels' AND approval.state='complete' AND approval.input->>'mandateRevision'=m.xmin::text)
    );
  UPDATE public.agent_handoffs SET revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=conv.id AND state IN('pending','acknowledged','link_sent');
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text',CASE WHEN reviewed THEN 'An incoming channel event needs identity review. No verified reply or cold cancellation was inferred. Automation remains paused.' WHEN conv.phase='complete' THEN 'A verified reply arrived on a stopped conversation. Cold outreach across all channels is cancelled; automation remains stopped.' WHEN conv.driver_kind<>'agent' OR conv.phase<>'active' THEN 'A verified reply arrived for this person. Cold outreach across all channels is cancelled; your existing control remains in place.' ELSE 'A verified reply arrived. Cold outreach across all channels is cancelled while I check the full conversation.' END,'details',jsonb_build_object('conversationId',conv.id,'routeId',candidate.id,'channel',b.channel,'bindingId',binding,'serviceEventId',event,'providerMessageId',p->>'providerMessageId','occurredAt',occurred,'reviewRequired',reviewed,'verifiedReply',NOT reviewed));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.incoming_channel','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',event,'channel',b.channel,'reviewRequired',reviewed));affected:=affected+1;
 END LOOP;RETURN affected;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_channel_due_reassessment(p_thread uuid, p_route uuid, p_policy_revision integer, p_scheduled_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.agent_threads%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id FOR UPDATE;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=t.id AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=t.id;
 IF t.id IS NULL OR r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_policy_revision IS NULL OR p.revision IS DISTINCT FROM p_policy_revision
 OR p_scheduled_at IS NULL OR r.next_allowed_at IS NULL
 OR date_trunc('milliseconds',r.next_allowed_at) IS DISTINCT FROM p_scheduled_at OR r.next_allowed_at>public.local_simulator_business_now()
 OR r.cold_cancelled_at IS NOT NULL OR c.engagement IS DISTINCT FROM 'cold' OR c.phase IS DISTINCT FROM 'active' OR c.driver_kind IS DISTINCT FROM 'agent'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) m WHERE m->>'direction'='inbound')
 OR EXISTS(SELECT 1 FROM public.agent_conversation_channels peer,jsonb_array_elements(peer.history) m WHERE peer.conversation_id=c.id AND m->>'direction'='inbound')
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.thread_id=t.id AND s.organization_id=t.organization_id AND s.owner_user_id=t.owner_user_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR NOT public.agent_event_eligible(t.id,'channel.due') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('conversationId',c.id,'epoch',c.epoch,'reminderGeneration',c.reminder_generation);
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_channel_operation_before_invitations(p_operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;g public.agent_authority_grants%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF c.id IS NOT NULL THEN PERFORM public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent','operationId',o.id),org,actor);END IF;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage NOT IN('initial','reply','follow_up') OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>6000 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
 OR r.channel<>'email' AND o.input->>'subject' IS DISTINCT FROM '' OR r.channel='email' AND coalesce(o.input->>'subject','')='' OR NOT public.agent_channel_proposal_permitted(r.id,stage) THEN RETURN false;END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.local_simulator_business_now()) THEN RETURN false;END IF;
 -- A plan revision, a manual handoff, an opt-out or another account's unknown
 -- outcome cannot be bypassed by choosing a different channel.
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR public.agent_mandate_person_has_unresolved_sends(c.mandate_id,c.contact_id,o.id) THEN RETURN false;END IF;
 aliases:=public.agent_canonical_contact_aliases(c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false'))
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>public.local_simulator_business_now() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage='initial' OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage='initial' OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NULL THEN
  SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
  IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 ELSE
  SELECT * INTO g FROM public.agent_authority_grants WHERE id=a.grant_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
  IF o.input->>'requiresHumanReview'='true' OR g.id IS NULL OR g.revision<>a.grant_revision OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR g.approved_at>clock_timestamp() OR g.used_sends>g.max_sends OR g.channel<>r.channel OR g.binding_digest<>r.binding_digest OR NOT g.actions ? kind OR NOT g.recipient_keys ? (r.channel||':'||r.recipient_value) OR NOT g.route_ids ? r.id::text THEN RETURN false;END IF;
 END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_channel_proposal_before_invitations(p_route uuid, p_stage text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;latest_in jsonb;latest_out jsonb;reply_candidate jsonb;person_out jsonb;last_sent record;next_index integer;source_revision text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true)) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=current_setting('app.acquire_org',true) AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current channel proposal scope required';END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=r.thread_id;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR p_stage IS NULL OR p_stage NOT IN('initial','reply','follow_up') OR c.phase<>'active' OR c.driver_kind<>'agent' OR c.engagement IN('handoff','stopped') OR NOT c.history_complete OR c.history_source<>'communications' THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities WHERE id=c.responsibility_id AND state IN('ready','waiting')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'bindingId'=r.binding_id::text AND x->>'channel'=r.channel AND x->>'bindingDigest'=r.binding_digest) OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.agent_conversation_channels x WHERE x.conversation_id=c.id AND (NOT x.history_complete OR x.history_observed_at IS NULL OR x.history_observed_at>public.local_simulator_business_now() OR x.history_observed_at<public.local_simulator_business_now()-interval '5 minutes')) OR (SELECT count(*) FROM public.agent_conversation_channels WHERE conversation_id=c.id)<>cardinality(p.channel_order) THEN RETURN false;END IF;
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=c.contact_id AND organization_id=c.organization_id AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false';
 IF source_revision IS NULL OR r.identity_source->>'revision' IS DISTINCT FROM source_revision THEN RETURN false;END IF;
 IF p.accelerated_simulation AND (NOT public.agent_channel_local_binding(r.binding_id) OR NOT public.agent_channel_reserved_recipient(r.channel,r.recipient_value)) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 SELECT value INTO latest_out FROM jsonb_array_elements(r.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND p_stage='reply' THEN
  -- A simultaneous inbound is selectable only on its original verified route
  -- at the person's maximum incoming timestamp. Hash order is not a preference.
  SELECT value INTO reply_candidate FROM jsonb_array_elements(r.history)
   WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=(latest_in->>'at')::timestamptz
   ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF reply_candidate IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=reply_candidate)
   OR (CASE WHEN reply_candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id ELSE reply_candidate->>'routeId' IS DISTINCT FROM r.id::text OR reply_candidate->>'channel' IS DISTINCT FROM r.channel OR reply_candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  -- A real answer on any recorded route consumes this simultaneous reply turn.
  SELECT value INTO person_out FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  RETURN person_out IS NULL OR (person_out->>'at')::timestamptz<(reply_candidate->>'at')::timestamptz;
 END IF;
 IF latest_in IS NOT NULL THEN
  -- Cold introductions stay cancelled. Warm continuity follows the latest
  -- actual person answer, not the hash order of simultaneous incoming IDs.
  IF p_stage<>'follow_up' THEN RETURN false;END IF;
  SELECT value INTO person_out FROM jsonb_array_elements(c.history) WHERE value->>'direction'='outbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF person_out IS NULL OR (person_out->>'at')::timestamptz<=(latest_in->>'at')::timestamptz
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) x WHERE x=person_out)
   OR (CASE WHEN person_out->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(person_out->>'channel','email')<>'email' ELSE person_out->>'routeId' IS DISTINCT FROM r.id::text OR person_out->>'channel' IS DISTINCT FROM r.channel OR person_out->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  -- Equal-time answers on multiple routes are ambiguous; never pick by hash.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x->>'direction'='outbound' AND (x->>'at')::timestamptz=(person_out->>'at')::timestamptz
   AND (CASE WHEN x->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(x->>'channel','email')<>'email' ELSE x->>'routeId' IS DISTINCT FROM r.id::text OR x->>'channel' IS DISTINCT FROM r.channel OR x->>'bindingDigest' IS DISTINCT FROM r.binding_digest END)) THEN RETURN false;END IF;
  SELECT value INTO reply_candidate FROM jsonb_array_elements(r.history) WHERE value->>'direction'='inbound' AND (value->>'at')::timestamptz=(latest_in->>'at')::timestamptz ORDER BY value->>'id' DESC LIMIT 1;
  IF reply_candidate IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) x WHERE x=reply_candidate)
   OR (CASE WHEN reply_candidate->>'routeId' IS NULL THEN r.channel<>'email' OR r.binding_id<>c.binding_id OR coalesce(reply_candidate->>'channel','email')<>'email' ELSE reply_candidate->>'routeId' IS DISTINCT FROM r.id::text OR reply_candidate->>'channel' IS DISTINCT FROM r.channel OR reply_candidate->>'bindingDigest' IS DISTINCT FROM r.binding_digest END) THEN RETURN false;END IF;
  RETURN r.next_allowed_at IS NOT NULL AND r.next_allowed_at<=public.local_simulator_business_now();
 END IF;
 IF r.cold_cancelled_at IS NOT NULL OR c.engagement<>'cold' OR p_stage='reply' OR r.next_allowed_at IS NULL OR r.next_allowed_at>public.local_simulator_business_now() THEN RETURN false;END IF;
 SELECT o.input->>'routeId' AS route_id,public.local_simulator_operation_business_anchor(o) AS updated_at INTO last_sent FROM public.agent_operations o WHERE o.conversation_id=c.id AND o.state='complete' AND o.result->'delivery'->>'status'='submitted' ORDER BY CASE WHEN nullif(current_setting('acquire.simulator_business_run',true),'') IS NULL THEN o.updated_at ELSE public.local_simulator_operation_business_anchor(o) END DESC,o.id DESC LIMIT 1;
 IF last_sent.route_id IS NULL THEN next_index:=1;
 ELSE SELECT coalesce(array_position(p.channel_order,x.channel),0)%cardinality(p.channel_order)+1 INTO next_index FROM public.agent_conversation_channels x WHERE x.id::text=last_sent.route_id AND x.conversation_id=c.id;
  IF next_index IS NULL OR public.local_simulator_business_now()<last_sent.updated_at+make_interval(secs=>p.delay_seconds) THEN RETURN false;END IF;
 END IF;
 IF p.channel_order[next_index]<>r.channel THEN RETURN false;END IF;
 RETURN CASE p_stage WHEN 'initial' THEN latest_out IS NULL WHEN 'follow_up' THEN latest_out IS NOT NULL ELSE false END;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_channel_proposal_permitted_before_history_quiet(p_route uuid, p_stage text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.agent_conversation_channels%ROWTYPE;relationship public.agent_linkedin_relationships%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF r.id IS NULL THEN RETURN false;END IF;
 IF r.channel<>'linkedin' THEN RETURN public.agent_channel_proposal_before_invitations(p_route,p_stage);END IF;
 SELECT * INTO relationship FROM public.agent_linkedin_relationships WHERE route_id=r.id AND binding_digest=r.binding_digest AND identity_revision=r.identity_revision;
 IF relationship.route_id IS NULL OR relationship.observed_at>public.local_simulator_business_now() OR relationship.observed_at<public.local_simulator_business_now()-interval '5 minutes' THEN RETURN false;END IF;
 IF p_stage='invitation' THEN
  IF relationship.status<>'not_connected' OR relationship.can_message IS TRUE OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations WHERE route_id=r.id AND state IN('unknown','pending','accepted')) OR EXISTS(SELECT 1 FROM public.agent_operations WHERE conversation_id=r.conversation_id AND name='linkedin.invitation' AND state IN('running','uncertain','complete')) THEN RETURN false;END IF;
  RETURN public.agent_channel_proposal_before_invitations(p_route,'initial');
 END IF;
 IF relationship.status<>'connected' OR relationship.can_message IS DISTINCT FROM true THEN RETURN false;END IF;
 RETURN public.agent_channel_proposal_before_invitations(p_route,p_stage);
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_channel_record_submission(p_operation uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;p public.agent_channel_policies%ROWTYPE;anchor timestamptz;due timestamptz;next_channel text;latest_in timestamptz;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND binding_digest=o.input->>'bindingDigest';
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id FOR UPDATE;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF o.id IS NULL OR r.id IS NULL OR p.thread_id IS NULL OR o.state<>'complete' OR o.result->'delivery'->>'status' IS DISTINCT FROM 'submitted' OR NOT EXISTS(SELECT 1 FROM public.agent_authority_uses a WHERE a.operation_id=o.id AND a.state='settled' AND a.binding_digest=r.binding_digest) OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits v ON v.intent_id=i.id WHERE i.source_kind='agent' AND i.source_id=o.id AND i.binding_id=r.binding_id AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id) THEN RAISE EXCEPTION 'Positive original admitted routed receipt required';END IF;
 anchor:=public.local_simulator_operation_business_anchor(o);IF anchor IS NULL OR anchor>public.local_simulator_business_now() THEN RAISE EXCEPTION 'Original submitted timestamp required';END IF;
 due:=anchor+make_interval(secs=>p.delay_seconds);
 SELECT max((value->>'at')::timestamptz) INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound';
 IF latest_in IS NULL AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels WHERE conversation_id=c.id AND cold_cancelled_at IS NOT NULL) THEN
  next_channel:=p.channel_order[array_position(p.channel_order,r.channel)%cardinality(p.channel_order)+1];
  UPDATE public.agent_conversation_channels SET next_allowed_at=CASE WHEN channel=next_channel THEN due ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id;
 ELSE
  UPDATE public.agent_conversation_channels SET next_allowed_at=CASE WHEN id=r.id THEN due ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id;
 END IF;RETURN due;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_communications_bounce(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_recipient text, p_message text, p_occurred timestamp with time zone, p_receipt_preimage text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);candidate record;conv public.agent_conversations%ROWTYPE;bounce_key text;notice jsonb;payload jsonb;affected integer:=0;frame jsonb;recorded public.communication_bindings%ROWTYPE;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current delivery-failure scope required'; END IF;
 IF p_event IS NULL OR p_receipt_fingerprint IS NULL OR p_change_fingerprint IS NULL OR p_receipt_fingerprint IS DISTINCT FROM p_change_fingerprint OR p_recipient IS NULL OR p_message IS NULL OR length(p_event) NOT BETWEEN 1 AND 200 OR p_receipt_fingerprint!~'^[a-f0-9]{64}$' OR p_change_fingerprint!~'^[a-f0-9]{64}$' OR p_recipient IS DISTINCT FROM lower(btrim(p_recipient)) OR p_recipient!~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' OR length(p_message) NOT BETWEEN 1 AND 2048 OR p_occurred IS NULL OR p_occurred>public.local_simulator_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Verified delivery-failure metadata required'; END IF;
 SELECT * INTO recorded FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service';
 IF recorded.id IS NULL THEN RAISE EXCEPTION 'Original owned email account required'; END IF;
 IF p_receipt_preimage IS NULL OR octet_length(p_receipt_preimage)>12000 OR encode(sha256(convert_to(p_receipt_preimage,'UTF8')),'hex') IS DISTINCT FROM p_receipt_fingerprint THEN RAISE EXCEPTION 'Original delivery-failure receipt preimage required'; END IF;
 frame:=p_receipt_preimage::jsonb;
 IF jsonb_typeof(frame) IS DISTINCT FROM 'array' OR jsonb_array_length(frame)<>8 OR frame->>0 IS DISTINCT FROM 'acquire.reply.delivery.v1' OR frame->1 IS DISTINCT FROM jsonb_build_array(recorded.application_id,recorded.organization_id,recorded.owner_user_id,recorded.service_connection_id,recorded.service_account_id,recorded.generation,recorded.channel,recorded.platform,recorded.backend) OR frame->>2 IS DISTINCT FROM p_binding::text OR frame->>3 IS DISTINCT FROM p_event OR COALESCE(frame->>4,'') !~ '^[a-f0-9]{64}$' OR COALESCE(frame->>5,'') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(frame->7) IS DISTINCT FROM 'array' OR jsonb_array_length(frame->7)<>5 OR frame->7->>0 IS DISTINCT FROM 'bounce' OR frame->7->>1 IS DISTINCT FROM p_message OR frame->7->>2 IS DISTINCT FROM 'email' OR frame->7->>3 IS DISTINCT FROM p_recipient OR (frame->7->>4)::timestamptz IS DISTINCT FROM p_occurred OR jsonb_typeof(frame->6) IS DISTINCT FROM 'string' OR (frame->>6)::timestamptz< p_occurred OR (frame->>6)::timestamptz>public.local_simulator_business_now()+interval '1 minute' THEN RAISE EXCEPTION 'Original delivery-failure metadata differs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_event_receipts r WHERE r.binding_id=p_binding AND r.service_event_id=p_event AND r.organization_id=org AND r.owner_user_id=actor AND r.event_type='email_change' AND r.payload_fingerprint=p_receipt_fingerprint AND r.occurred_at=p_occurred) THEN RAISE EXCEPTION 'Original delivery-failure receipt required'; END IF;
 IF (SELECT count(*) FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_recipient)>100 THEN RAISE EXCEPTION 'Delivery-failure conversation bound exceeded'; END IF;
 FOR candidate IN SELECT id,thread_id FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_recipient ORDER BY thread_id,id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.id FOR UPDATE;
  bounce_key:='email-bounce:'||encode(sha256(convert_to(jsonb_build_array(p_binding,p_event,p_change_fingerprint,conv.id)::text,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=conv.thread_id AND e.event_key=bounce_key) THEN CONTINUE; END IF;
  -- Preserve real provider submission receipts/reservations: bounced does not
  -- mean not submitted and never authorises a retry or releases paid sends.
  UPDATE public.agent_conversations SET history_complete=false,engagement='stopped',phase=CASE WHEN phase='complete' THEN phase ELSE 'held' END,pause_reason='delivery_failure',pending_driver=NULL,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','delivery_failure'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND thread_id=conv.thread_id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
  UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=conv.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=(item->>'operationId') WHERE o.conversation_id=conv.id AND o.thread_id=conv.thread_id AND o.result->>'reason'='delivery_failure');
  UPDATE public.agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE thread_id=conv.thread_id AND revoked_at IS NULL AND recipient_keys ? ('email:'||conv.recipient_email);
  UPDATE public.agent_handoffs h SET revision=revision+1,updated_at=clock_timestamp() WHERE h.conversation_id=conv.id AND h.state IN('pending','acknowledged','link_sent') AND EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=org AND m.user_id=h.assignee_user_id);
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,bounce_key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text','The email provider reported a delivery failure. Outreach to this address is stopped. Review the recipient and original account; no follow-up or replacement send was created.','details',jsonb_build_object('conversationId',conv.id,'bindingId',p_binding,'serviceEventId',p_event,'providerMessageId',p_message,'occurredAt',p_occurred,'deliveryFailure',true));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(conv.thread_id,org,conv.mandate_id,actor,bounce_key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.delivery_failure','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',p_event,'providerMessageId',p_message));
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_communications_change(p_binding uuid, p_event text, p_receipt_fingerprint text, p_change_fingerprint text, p_sender text, p_message text, p_occurred timestamp with time zone, p_review boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);candidate record;conv public.agent_conversations%ROWTYPE;incoming_key text;base_key text;notice jsonb;payload jsonb;affected integer:=0;
BEGIN
 IF current_setting('role',true)<>'acquire_campaign_user' OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current incoming-message scope required'; END IF;
 IF p_event IS NULL OR p_receipt_fingerprint IS NULL OR p_change_fingerprint IS NULL OR p_sender IS NULL OR p_message IS NULL OR length(p_event) NOT BETWEEN 1 AND 200 OR p_receipt_fingerprint!~'^[a-f0-9]{64}$' OR p_change_fingerprint!~'^[a-f0-9]{64}$' OR p_sender IS DISTINCT FROM lower(btrim(p_sender)) OR p_sender!~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' OR length(p_message) NOT BETWEEN 1 AND 2048 OR p_occurred IS NULL OR p_occurred>public.local_simulator_business_now()+interval '1 minute' OR p_review IS NULL THEN RAISE EXCEPTION 'Verified incoming metadata required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_bindings b WHERE b.id=p_binding AND b.organization_id=org AND b.owner_user_id=actor AND b.application_id='acquire' AND b.channel='email' AND b.backend='unipile' AND b.authority='service') THEN RAISE EXCEPTION 'Original owned email account required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communication_event_receipts r WHERE r.binding_id=p_binding AND r.service_event_id=p_event AND r.organization_id=org AND r.owner_user_id=actor AND r.event_type='message' AND r.payload_fingerprint=p_receipt_fingerprint) OR (p_receipt_fingerprint<>p_change_fingerprint AND NOT p_review) THEN RAISE EXCEPTION 'Committed-in-this-transaction application receipt required'; END IF;
 base_key:='incoming-email:'||encode(sha256(convert_to(jsonb_build_array(p_binding,p_event,p_change_fingerprint)::text,'UTF8')),'hex');
 IF (SELECT count(*) FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_sender AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id))>100 THEN RAISE EXCEPTION 'Incoming conversation bound exceeded'; END IF;
 FOR candidate IN SELECT id,thread_id FROM public.agent_conversations c WHERE c.organization_id=org AND c.owner_user_id=actor AND c.delivery_mode='communications' AND c.binding_id=p_binding AND c.recipient_email=p_sender AND NOT EXISTS(SELECT 1 FROM public.agent_conversation_channels r WHERE r.conversation_id=c.id) ORDER BY thread_id,id LOOP
  PERFORM 1 FROM public.agent_threads WHERE id=candidate.thread_id AND organization_id=org AND owner_user_id=actor FOR UPDATE;
  SELECT * INTO STRICT conv FROM public.agent_conversations WHERE id=candidate.id FOR UPDATE;
  incoming_key:=base_key||':'||conv.id::text;
  -- Preserve replay of an already-processed0022 event only for the exact
  -- conversation in its saved payload. A retired row cannot swallow another.
  IF EXISTS(SELECT 1 FROM public.agent_events e WHERE e.thread_id=conv.thread_id AND (e.event_key=incoming_key OR e.event_key=base_key AND e.payload->>'conversationId'=conv.id::text)) THEN CONTINUE; END IF;
  -- Never fabricate a body or certify complete history from webhook metadata.
  UPDATE public.agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,
   phase=CASE WHEN p_review AND driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,
   pause_reason=CASE WHEN driver_kind<>'agent' OR phase<>'active' THEN pause_reason WHEN p_review THEN 'incoming_email_review_required' ELSE 'provider_history_changed' END,updated_at=clock_timestamp()
  WHERE id=conv.id;
  UPDATE public.agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE conversation_id=conv.id AND thread_id=conv.thread_id AND name IN('email.initial','email.reply','email.follow_up') AND state IN('proposed','approved');
  UPDATE public.agent_review_batches b SET state='invalidated' WHERE b.thread_id=conv.thread_id AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item JOIN public.agent_operations o ON o.id::text=(item->>'operationId') WHERE o.conversation_id=conv.id AND o.thread_id=conv.thread_id AND o.name IN('email.initial','email.reply','email.follow_up') AND o.state='failed' AND o.result->>'reason'='context_changed');
  -- Source/context is immutable; bump only the task revision. Conversation epoch
  -- also invalidates every older handoff context token, including retired assignees.
  UPDATE public.agent_handoffs h SET revision=revision+1,updated_at=clock_timestamp() WHERE h.conversation_id=conv.id AND h.state IN('pending','acknowledged','link_sent') AND EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=org AND m.user_id=h.assignee_user_id);
  payload:=jsonb_build_object('conversationId',conv.id);
  INSERT INTO public.agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
  VALUES(conv.thread_id,org,conv.mandate_id,actor,incoming_key,'conversation.history_changed',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
  notice:=jsonb_build_object('text',CASE WHEN p_review THEN 'A new email needs human review. Automation remains paused.' WHEN conv.phase='complete' THEN 'A new email arrived on a stopped conversation. Automation remains stopped.' WHEN conv.driver_kind<>'agent' OR conv.phase<>'active' THEN 'A new email arrived for a conversation you are handling. Automation remains paused.' ELSE 'A new email arrived. I am checking the full conversation before deciding what to do next.' END,'details',jsonb_build_object('conversationId',conv.id,'serviceEventId',p_event,'providerMessageId',p_message,'occurredAt',p_occurred,'reviewRequired',p_review));
  INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
  VALUES(conv.thread_id,org,conv.mandate_id,actor,incoming_key,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
  INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(org,actor,'agent.incoming_email','agent_conversation',conv.id::text,jsonb_build_object('serviceEventId',p_event,'reviewRequired',p_review));
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_ingest_channel_relationship(p_route uuid, p_binding_digest text, p_identity_revision text, p_status text, p_can_message boolean, p_observed_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.agent_conversation_channels%ROWTYPE;old public.agent_linkedin_relationships%ROWTYPE;saved public.agent_linkedin_relationships%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 IF r.id IS NULL OR r.channel<>'linkedin' OR r.binding_digest IS DISTINCT FROM p_binding_digest OR r.binding_digest IS DISTINCT FROM public.agent_recorded_binding_digest(r.binding_id) OR r.identity_revision IS DISTINCT FROM p_identity_revision OR p_status IS NULL OR p_observed_at IS NULL OR p_observed_at>public.local_simulator_business_now() OR p_observed_at<public.local_simulator_business_now()-interval '5 minutes'
 OR NOT(p_status='connected' AND p_can_message IS TRUE OR p_status='invitation_pending' AND p_can_message IS FALSE OR p_status='not_connected' AND p_can_message IS NOT TRUE OR p_status='unknown' AND p_can_message IS NULL) THEN RAISE EXCEPTION 'Fresh exact recorded LinkedIn relationship proof required';END IF;
 SELECT * INTO old FROM public.agent_linkedin_relationships WHERE route_id=r.id FOR UPDATE;
 IF old.route_id IS NOT NULL AND old.observed_at>p_observed_at THEN RAISE EXCEPTION 'Relationship observation is older than saved proof';END IF;
 INSERT INTO public.agent_linkedin_relationships(route_id,conversation_id,thread_id,organization_id,owner_user_id,binding_digest,identity_revision,status,can_message,observed_at)
 VALUES(r.id,r.conversation_id,r.thread_id,r.organization_id,r.owner_user_id,r.binding_digest,r.identity_revision,p_status,p_can_message,p_observed_at)
 ON CONFLICT(route_id) DO UPDATE SET status=EXCLUDED.status,can_message=EXCLUDED.can_message,observed_at=EXCLUDED.observed_at,
 revision=agent_linkedin_relationships.revision+CASE WHEN agent_linkedin_relationships.status IS DISTINCT FROM EXCLUDED.status OR agent_linkedin_relationships.can_message IS DISTINCT FROM EXCLUDED.can_message THEN 1 ELSE 0 END,updated_at=clock_timestamp() RETURNING * INTO saved;
 IF p_status='connected' AND p_can_message IS TRUE THEN UPDATE public.agent_linkedin_invitations SET state='accepted',accepted_observed_at=p_observed_at,updated_at=clock_timestamp() WHERE route_id=r.id AND binding_digest=r.binding_digest AND identity_revision=r.identity_revision AND state='pending';END IF;
 IF old.route_id IS NULL OR old.revision<>saved.revision THEN PERFORM public.agent_invalidate_person_reviews(r.conversation_id);END IF;
 PERFORM public.agent_assert_control_scope();
 RETURN jsonb_build_object('revision',saved.revision,'changed',old.route_id IS NULL OR old.revision<>saved.revision);
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_invitation_before_company_projection(p_operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);o public.agent_operations%ROWTYPE;c public.agent_conversations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;p public.agent_channel_policies%ROWTYPE;a public.agent_authority_uses%ROWTYPE;b public.agent_review_batches%ROWTYPE;stage text;kind text;latest_in jsonb;aliases uuid[];
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor) OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current routed authority required';END IF;
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=org AND owner_user_id=actor;
 IF o.id IS NULL OR o.state<>'running' OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR NOT o.input ? 'routeId' OR coalesce(o.input->>'routeId','')!~'^[a-f0-9-]{36}$' THEN RETURN false;END IF;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=(o.input->>'routeId')::uuid AND conversation_id=o.conversation_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND organization_id=org AND owner_user_id=actor;
 SELECT * INTO p FROM public.agent_channel_policies WHERE thread_id=c.thread_id;
 IF c.id IS NOT NULL THEN PERFORM public.agent_load_mandate_execution_context(jsonb_build_object('kind','agent','operationId',o.id),org,actor);END IF;
 stage:=split_part(o.name,'.',2);kind:=stage||'_'||r.channel;
 IF r.id IS NULL OR c.id IS NULL OR p.thread_id IS NULL OR o.name<>r.channel||'.'||stage OR stage IS DISTINCT FROM 'invitation' OR r.channel<>'linkedin' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR c.delivery_mode<>'communications'
 OR o.input->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR o.input->>'identityRevision' IS DISTINCT FROM r.identity_revision OR o.input->>'policyRevision' IS DISTINCT FROM p.revision::text OR o.input->>'routeHistoryRevision' IS DISTINCT FROM r.history_revision
 OR o.input->>'recipientKey' IS DISTINCT FROM r.channel||':'||r.recipient_value OR o.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(c.id) OR o.input->>'epoch' IS DISTINCT FROM c.epoch::text
 OR o.input->>'kind' IS DISTINCT FROM kind OR coalesce(o.input->>'body','')='' OR length(o.input->>'body')>300 OR (o.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR o.input->>'intent' IN('meeting_ready','opt_out','uncertain')
 OR r.channel<>'email' AND o.input->>'subject' IS DISTINCT FROM '' OR r.channel='email' AND coalesce(o.input->>'subject','')='' OR NOT public.agent_channel_proposal_before_invitations(r.id,'initial') THEN RETURN false;END IF;
 -- Admission validates this already-running exact HIL operation. Proposal-time
 -- duplicate checks still reject every running invitation, including this one.
 IF NOT EXISTS(SELECT 1 FROM public.agent_linkedin_relationships relationship WHERE relationship.route_id=r.id AND relationship.binding_digest=r.binding_digest AND relationship.identity_revision=r.identity_revision AND relationship.status='not_connected' AND relationship.can_message IS NOT TRUE AND relationship.observed_at<=public.local_simulator_business_now() AND relationship.observed_at>=public.local_simulator_business_now()-interval '5 minutes')
 OR EXISTS(SELECT 1 FROM public.agent_linkedin_invitations invitation WHERE invitation.route_id=r.id AND invitation.state IN('unknown','pending','accepted'))
 OR EXISTS(SELECT 1 FROM public.agent_operations other WHERE other.conversation_id=r.conversation_id AND other.name='linkedin.invitation' AND other.id<>o.id AND other.state IN('running','uncertain','complete')) THEN RETURN false;END IF;
 IF NOT p.accelerated_simulation AND NOT public.agent_email_window_open(public.local_simulator_business_now()) THEN RETURN false;END IF;
 -- A plan revision, a manual handoff, an opt-out or another account's unknown
 -- outcome cannot be bypassed by choosing a different channel.
 IF NOT EXISTS(SELECT 1 FROM public.agent_responsibilities s JOIN public.mandates m ON m.id=s.mandate_id AND m.organization_id=s.organization_id WHERE s.id=c.responsibility_id AND s.state IN('ready','waiting') AND s.mandate_revision=m.xmin::text)
 OR EXISTS(SELECT 1 FROM public.agent_handoffs h WHERE h.conversation_id=c.id AND h.state NOT IN('dismissed','meeting_confirmed'))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL)
 OR public.agent_mandate_person_has_unresolved_sends(c.mandate_id,c.contact_id,o.id) THEN RETURN false;END IF;
 aliases:=public.agent_canonical_contact_aliases(c.contact_id);
 IF EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false'))
 OR EXISTS(SELECT 1 FROM public.suppressions s WHERE s.organization_id=org AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) THEN RETURN false;END IF;
 SELECT value INTO latest_in FROM jsonb_array_elements(c.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
 IF latest_in IS NOT NULL AND ((latest_in->>'at')::timestamptz>public.local_simulator_business_now() OR latest_in->>'text'~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND h.contact_id=ANY(aliases) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL OR h.received_at>(latest_in->>'at')::timestamptz))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.contacts x WHERE x.id=ANY(aliases) AND lower(x.personal_data->>'email')=lower(h.email)) AND (stage IN('initial','invitation') OR h.reason<>'reply_received' OR latest_in IS NULL)) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.agent_authority_uses WHERE operation_id=o.id AND organization_id=org AND owner_user_id=actor;
 IF a.operation_id IS NULL OR a.state<>'reserved' OR a.operation_revision<>o.revision OR a.operation_fence<>o.fence OR a.operation_digest<>o.input_digest OR a.context_revision IS DISTINCT FROM o.input->>'contextRevision' OR a.binding_digest IS DISTINCT FROM r.binding_digest THEN RETURN false;END IF;
 IF a.grant_id IS NOT NULL OR a.review_batch_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO b FROM public.agent_review_batches WHERE id=a.review_batch_id AND thread_id=o.thread_id AND organization_id=org AND owner_user_id=actor;
 IF b.id IS NULL OR b.state<>'approved' OR NOT b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id,'revision',o.revision,'digest',o.input_digest,'contextRevision',o.input->>'contextRevision')) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM public.agent_budget_reservations WHERE operation_id=o.id)<>4 THEN RETURN false;END IF;
 RETURN (SELECT count(DISTINCT x.scope_key)=4 FROM public.agent_budget_reservations z JOIN public.agent_budget_accounts x ON x.id=z.account_id AND x.organization_id=z.organization_id WHERE z.operation_id=o.id AND z.organization_id=org AND z.state='reserved' AND z.amount=1 AND x.unit='sends' AND x.scope_key=ANY(ARRAY['organization:sends','user:'||actor||':sends','mandate:'||c.mandate_id::text||':sends','binding:'||r.binding_digest||':sends']) AND x.window_start<=clock_timestamp() AND x.window_end>clock_timestamp() AND x.spent+x.reserved<=x.cap);
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_lock_member()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 PERFORM public.local_simulator_business_now();
 PERFORM 1 FROM public.member
 WHERE organization_id=current_setting('app.acquire_org',true)
 AND user_id=current_setting('app.acquire_user',true) FOR SHARE;
 RETURN FOUND;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_native_sending_policy(operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE op public.agent_operations%ROWTYPE;conv public.agent_conversations%ROWTYPE;inbound_at timestamptz;outbound_at timestamptz;
BEGIN
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true);
 IF op.id IS NULL THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN RETURN true; END IF;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=op.conversation_id AND thread_id=op.thread_id;
 IF conv.id IS NULL OR (conv.delivery_mode<>'local_sink' AND NOT public.agent_email_window_open(public.local_simulator_business_now()) AND NOT public.agent_simulator_window_exception(conv.mandate_id,conv.binding_id,conv.binding_digest,conv.recipient_email,clock_timestamp())) THEN RETURN false; END IF;
 SELECT max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='inbound'),max((value->>'at')::timestamptz) FILTER(WHERE value->>'direction'='outbound') INTO inbound_at,outbound_at FROM jsonb_array_elements(conv.history);
 IF op.name='email.initial' THEN RETURN jsonb_array_length(conv.history)=0;
 ELSIF op.name='email.reply' THEN RETURN inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at);
 ELSIF op.name='email.follow_up' THEN RETURN outbound_at IS NOT NULL AND outbound_at<=public.local_simulator_business_now()-interval '24 hours' AND (inbound_at IS NULL OR inbound_at<outbound_at);
 END IF;
 RETURN false;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_operation_authorised_before_sending_policy(operation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE org text:=current_setting('app.acquire_org',true);actor text:=current_setting('app.acquire_user',true);latest_inbound timestamptz;latest_body text;op public.agent_operations%ROWTYPE;conversation public.agent_conversations%ROWTYPE;authority public.agent_authority_uses%ROWTYPE;delegation public.agent_authority_grants%ROWTYPE;batch public.agent_review_batches%ROWTYPE;kind text;
BEGIN
 IF current_setting('role',true) NOT IN('acquire_agent_user','acquire_campaign_user') OR NOT EXISTS(SELECT 1 FROM public.member WHERE organization_id=org AND user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.communication_send_gates WHERE organization_id=org AND writer_xid=txid_current()) THEN RAISE EXCEPTION 'Held current dispatch authority required'; END IF;
 SELECT * INTO op FROM public.agent_operations WHERE id=operation AND organization_id=org AND owner_user_id=actor;
 IF op.id IS NULL OR op.name NOT IN('email.initial','email.reply','email.follow_up','email.manual_link') OR op.state<>'running' OR op.lease_until IS NULL OR op.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO conversation FROM public.agent_conversations WHERE id=op.conversation_id AND organization_id=org AND owner_user_id=actor;
 IF conversation.id IS NULL OR conversation.phase<>'active' OR NOT conversation.history_complete OR conversation.history_observed_at IS NULL OR conversation.history_observed_at>public.local_simulator_business_now() OR conversation.history_observed_at<public.local_simulator_business_now()-interval '5 minutes'
 OR op.input->>'contextRevision' IS DISTINCT FROM public.agent_context_revision(conversation.id) OR op.input->>'recipientKey' IS DISTINCT FROM 'email:'||conversation.recipient_email OR op.input->>'bindingDigest' IS DISTINCT FROM conversation.binding_digest THEN RETURN false; END IF;
 IF op.name='email.manual_link' THEN
  IF conversation.driver_kind<>'human' OR conversation.human_user_id<>actor THEN RETURN false; END IF;
 ELSE
  IF conversation.driver_kind<>'agent' OR NOT EXISTS(SELECT 1 FROM public.agent_responsibilities r WHERE r.id=conversation.responsibility_id AND r.state IN('ready','waiting')) THEN RETURN false; END IF;
  IF (op.input->>'body')~*'(https?://|www[.]|calendly|cal[.]com)' OR op.input->>'intent' IN('meeting_ready','opt_out','uncertain') THEN RETURN false; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contacts person WHERE person.id=conversation.contact_id AND person.organization_id=org AND person.fictionalised=false AND COALESCE(person.personal_data->>'doNotContact','false')='false' AND lower(btrim(person.personal_data->>'email'))=conversation.recipient_email)
 OR EXISTS(SELECT 1 FROM public.suppressions WHERE organization_id=org AND (lower(address)=conversation.recipient_email OR lower(domain)=split_part(conversation.recipient_email,'@',2)))
 OR EXISTS(SELECT 1 FROM public.communication_reply_review_latches WHERE organization_id=org AND resolved_at IS NULL) THEN RETURN false; END IF;
 SELECT (value->>'at')::timestamptz,value->>'text' INTO latest_inbound,latest_body FROM jsonb_array_elements(conversation.history) WHERE value->>'direction'='inbound' ORDER BY (value->>'at')::timestamptz DESC,value->>'id' LIMIT 1;
 IF latest_inbound>public.local_simulator_business_now() OR latest_body~*'(unsubscribe|do not (contact|email|message)|don[''’]t (contact|email|message)|stop (contacting|emailing|messaging)|remove me|no further (emails|messages|contact))' THEN RETURN false; END IF;
 IF op.name IN('email.reply','email.manual_link') AND latest_inbound IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.campaign_reply_holds h WHERE h.organization_id=org AND (h.contact_id=conversation.contact_id OR public.agent_person_keys(org,h.contact_id)&&public.agent_person_keys(org,conversation.contact_id)) AND (op.name='email.initial' OR op.name='email.follow_up' AND conversation.engagement='cold' OR h.reason<>'reply_received' OR latest_inbound IS NULL OR h.received_at>latest_inbound))
 OR EXISTS(SELECT 1 FROM public.campaign_contact_holds h WHERE h.organization_id=org AND EXISTS(SELECT 1 FROM public.agent_person_claims p WHERE p.conversation_id=conversation.id AND p.organization_id=org AND p.identity_key='email:'||lower(h.email)) AND (op.name='email.initial' OR op.name='email.follow_up' AND conversation.engagement='cold' OR h.reason<>'reply_received' OR latest_inbound IS NULL)) THEN RETURN false; END IF;
 SELECT * INTO authority FROM public.agent_authority_uses WHERE operation_id=operation AND organization_id=org AND owner_user_id=actor;
 IF authority.operation_id IS NULL OR authority.state<>'reserved' OR authority.operation_revision<>op.revision OR authority.operation_fence<>op.fence OR authority.operation_digest<>op.input_digest OR authority.context_revision IS DISTINCT FROM op.input->>'contextRevision' OR authority.binding_digest<>conversation.binding_digest THEN RETURN false; END IF;
 IF authority.grant_id IS NOT NULL THEN
  IF jsonb_array_length(conversation.history)>0 AND NOT EXISTS(SELECT 1 FROM public.agent_sink_messages m WHERE m.conversation_id=conversation.id) AND NOT EXISTS(SELECT 1 FROM public.agent_operations p WHERE p.conversation_id=conversation.id AND p.state='complete' AND p.result->'delivery'->>'status'='submitted') THEN RETURN false; END IF;
  kind:=CASE op.name WHEN 'email.initial' THEN 'initial_email' WHEN 'email.reply' THEN 'reply_email' WHEN 'email.follow_up' THEN 'follow_up_email' ELSE NULL END;
  SELECT * INTO delegation FROM public.agent_authority_grants WHERE id=authority.grant_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
  IF kind IS NULL OR delegation.id IS NULL OR delegation.revision<>authority.grant_revision OR delegation.revoked_at IS NOT NULL OR delegation.expires_at<=clock_timestamp() OR delegation.used_sends>delegation.max_sends OR delegation.binding_digest<>conversation.binding_digest OR NOT delegation.actions ? kind OR NOT delegation.recipient_keys ? ('email:'||conversation.recipient_email) THEN RETURN false; END IF;
 ELSE
  SELECT * INTO batch FROM public.agent_review_batches WHERE id=authority.review_batch_id AND thread_id=op.thread_id AND organization_id=org AND owner_user_id=actor;
  IF batch.id IS NULL OR batch.state<>'approved' OR NOT batch.manifest @> jsonb_build_array(jsonb_build_object('operationId',op.id,'revision',op.revision,'digest',op.input_digest,'contextRevision',op.input->>'contextRevision')) THEN RETURN false; END IF;
 END IF;
 IF public.agent_person_has_unresolved_sends(conversation.contact_id,operation) THEN RETURN false; END IF;
 -- Reservations remain charged while outcomes/usage are uncertain. Require an
 -- active send-count reservation in the current window immediately at dispatch.
 IF NOT EXISTS(SELECT 1 FROM public.agent_budget_reservations r JOIN public.agent_budget_accounts a ON a.id=r.account_id AND a.organization_id=r.organization_id WHERE r.operation_id=operation AND r.state='reserved' AND a.unit='sends' AND a.window_start<=clock_timestamp() AND a.window_end>clock_timestamp() AND a.spent+a.reserved<=a.cap) THEN RETURN false; END IF;
 RETURN true;
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_record_invitation_outcome(p_operation uuid, p_delivery jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE o public.agent_operations%ROWTYPE;r public.agent_conversation_channels%ROWTYPE;prior public.agent_linkedin_invitations%ROWTYPE;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO o FROM public.agent_operations WHERE id=p_operation AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) AND name='linkedin.invitation' FOR UPDATE;
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id::text=o.input->>'routeId' AND conversation_id=o.conversation_id AND thread_id=o.thread_id;
 IF o.id IS NULL OR r.id IS NULL OR r.channel<>'linkedin' OR r.binding_digest IS DISTINCT FROM o.input->>'bindingDigest' OR o.input->'requiresHumanReview' IS DISTINCT FROM 'true'::jsonb OR o.result->'delivery' IS DISTINCT FROM p_delivery
 OR NOT EXISTS(SELECT 1 FROM public.agent_authority_uses a WHERE a.operation_id=o.id AND a.grant_id IS NULL AND a.review_batch_id IS NOT NULL AND a.operation_digest=o.input_digest AND a.operation_revision=o.revision AND a.operation_fence=o.fence AND a.binding_digest=r.binding_digest AND a.state IN('settled','uncertain')) THEN RAISE EXCEPTION 'Original human-reviewed invitation authority and outcome required';END IF;
 IF p_delivery->>'status'='submitted' THEN
  IF o.state<>'complete' OR p_delivery->>'effect' IS DISTINCT FROM 'invitation' OR p_delivery->>'providerOperationId' IS NULL OR p_delivery->>'intentId' IS NULL OR length(p_delivery->>'providerOperationId') NOT BETWEEN 1 AND 2048 OR p_delivery->>'submittedAt' IS NULL OR (p_delivery->>'submittedAt')::timestamptz>public.local_simulator_business_now()
  OR NOT EXISTS(SELECT 1 FROM public.communication_dispatch_intents i JOIN public.communication_dispatch_permits p ON p.intent_id=i.id WHERE i.id::text=p_delivery->>'intentId' AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id AND i.source_kind='agent' AND i.source_id=o.id AND i.binding_id=r.binding_id AND i.operation='invitation') THEN RAISE EXCEPTION 'Exact original admitted invitation action receipt required';END IF;
 ELSIF p_delivery IS DISTINCT FROM '{"status":"unknown"}'::jsonb OR o.state<>'uncertain' THEN RAISE EXCEPTION 'Conservative invitation outcome required';END IF;
 SELECT * INTO prior FROM public.agent_linkedin_invitations WHERE operation_id=o.id FOR UPDATE;
 IF prior.operation_id IS NOT NULL AND (prior.route_id<>r.id OR prior.binding_digest<>r.binding_digest OR prior.identity_revision<>r.identity_revision OR prior.state<>'unknown' AND (p_delivery->>'status'<>'submitted' OR prior.provider_operation_id IS DISTINCT FROM p_delivery->>'providerOperationId' OR prior.intent_id::text IS DISTINCT FROM p_delivery->>'intentId' OR prior.submitted_at IS DISTINCT FROM (p_delivery->>'submittedAt')::timestamptz)) THEN RAISE EXCEPTION 'Original invitation outcome is immutable';END IF;
 INSERT INTO public.agent_linkedin_invitations(operation_id,route_id,conversation_id,thread_id,organization_id,owner_user_id,binding_digest,identity_revision,state,provider_operation_id,submitted_at,intent_id)
 VALUES(o.id,r.id,r.conversation_id,r.thread_id,r.organization_id,r.owner_user_id,r.binding_digest,r.identity_revision,CASE WHEN p_delivery->>'status'='submitted' THEN 'pending' ELSE 'unknown' END,p_delivery->>'providerOperationId',(p_delivery->>'submittedAt')::timestamptz,(p_delivery->>'intentId')::uuid)
 ON CONFLICT(operation_id) DO UPDATE SET state=CASE WHEN agent_linkedin_invitations.state='accepted' THEN 'accepted' ELSE EXCLUDED.state END,provider_operation_id=EXCLUDED.provider_operation_id,submitted_at=EXCLUDED.submitted_at,intent_id=EXCLUDED.intent_id,updated_at=clock_timestamp();
 PERFORM public.agent_assert_control_scope();
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_register_channel(p_thread uuid, p_conversation uuid, p_revision integer, p_context text, p_binding uuid, p_channel text, p_kind text, p_value text, p_source jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.agent_threads%ROWTYPE;conv public.agent_conversations%ROWTYPE;person public.contacts%ROWTYPE;source_revision text;policy public.agent_channel_policies%ROWTYPE;binding public.communication_bindings%ROWTYPE;route public.agent_conversation_channels%ROWTYPE;identity_hash text;keys text[];key text;notice jsonb;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO t FROM public.agent_threads WHERE id=p_thread AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO conv FROM public.agent_conversations WHERE id=p_conversation AND thread_id=t.id FOR UPDATE;
 IF conv.id IS NULL OR p_revision IS NULL OR conv.revision<>p_revision OR public.agent_context_revision(conv.id) IS DISTINCT FROM p_context OR conv.driver_kind<>'agent' OR conv.phase<>'active' OR conv.delivery_mode<>'communications' THEN RAISE EXCEPTION 'Current owned person context required';END IF;
 SELECT * INTO policy FROM public.agent_channel_policies WHERE thread_id=t.id;
 SELECT * INTO binding FROM public.communication_bindings WHERE id=p_binding AND organization_id=t.organization_id AND owner_user_id=t.owner_user_id AND channel=p_channel AND application_id='acquire' AND authority='service' AND backend='unipile';
 IF binding.id IS NULL OR policy.thread_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(policy.bindings) x WHERE x->>'bindingId'=binding.id::text AND x->>'channel'=p_channel AND x->>'bindingDigest'=public.agent_recorded_binding_digest(binding.id)) THEN RAISE EXCEPTION 'Exact reviewed policy account required';END IF;
 SELECT * INTO person FROM public.agent_delivery_contact_projection(t.mandate_id,conv.contact_id);
 SELECT xmin::text INTO source_revision FROM public.contacts WHERE id=person.id;
 IF person.id IS NULL OR person.fictionalised IS DISTINCT FROM false OR coalesce(person.personal_data->>'doNotContact','false')<>'false' OR jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_source))<>2 OR p_source->>'kind' IS DISTINCT FROM 'recorded_contact' OR p_source->>'revision' IS DISTINCT FROM source_revision THEN RAISE EXCEPTION 'Current explicitly reviewed contact identity required';END IF;
 IF NOT coalesce(CASE p_channel WHEN 'email' THEN p_kind='email' AND p_value=lower(btrim(person.personal_data->>'email')) AND p_value~'^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$'
 WHEN 'whatsapp' THEN p_kind='phone' AND p_value=person.personal_data->>'phone' AND p_value~'^[+][1-9][0-9]{6,14}$'
 WHEN 'linkedin' THEN p_kind='linkedin_profile' AND p_value=person.personal_data->>'linkedinUrl' AND p_value~'^https://www[.]linkedin[.]com/in/[A-Za-z0-9_%.-]+/?$' ELSE false END,false) THEN RAISE EXCEPTION 'Exact canonical recipient differs from reviewed contact';END IF;
 IF policy.accelerated_simulation AND (NOT public.agent_channel_local_binding(binding.id) OR NOT public.agent_channel_reserved_recipient(p_channel,p_value)) THEN RAISE EXCEPTION 'Accelerated route must use the exact reserved simulation identity';END IF;
 IF public.agent_mandate_person_has_unresolved_sends(t.mandate_id,person.id,NULL) THEN RAISE EXCEPTION 'Original unresolved sends must be reconciled before adding a route';END IF;
 identity_hash:=encode(sha256(convert_to(jsonb_build_object('contactId',person.id,'sourceRevision',source_revision,'channel',p_channel,'recipientKind',p_kind,'recipient',p_value,'bindingDigest',public.agent_recorded_binding_digest(binding.id))::text,'UTF8')),'hex');
 SELECT * INTO route FROM public.agent_conversation_channels WHERE conversation_id=conv.id AND channel=p_channel;
 IF route.id IS NOT NULL THEN
  IF route.binding_id<>binding.id OR route.recipient_value<>p_value OR route.identity_revision<>identity_hash THEN RAISE EXCEPTION 'Recorded route identity/account is immutable; review a reconciled replacement';END IF;RETURN jsonb_build_object('id',route.id,'revision',route.revision);
 END IF;
 INSERT INTO public.agent_conversation_channels(conversation_id,organization_id,owner_user_id,thread_id,mandate_id,channel,binding_id,binding_digest,recipient_kind,recipient_value,identity_source,identity_revision,history_revision,next_allowed_at)
 VALUES(conv.id,t.organization_id,t.owner_user_id,t.id,t.mandate_id,p_channel,binding.id,public.agent_recorded_binding_digest(binding.id),p_kind,p_value,p_source,identity_hash,encode(sha256(convert_to('[]','UTF8')),'hex'),public.local_simulator_business_now()+((array_position(policy.channel_order,p_channel)-1)*policy.delay_seconds)*interval '1 second') RETURNING * INTO route;
 keys:=public.agent_mandate_person_keys(t.mandate_id,person.id);
 FOREACH key IN ARRAY keys LOOP
  IF EXISTS(SELECT 1 FROM public.agent_person_claims WHERE organization_id=t.organization_id AND identity_key=key AND conversation_id<>conv.id) THEN RAISE EXCEPTION 'This person already has another active owner';END IF;
  INSERT INTO public.agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES(t.organization_id,key,conv.id,t.owner_user_id) ON CONFLICT(organization_id,identity_key) DO NOTHING;
 END LOOP;
 UPDATE public.agent_conversations SET history_complete=false,revision=revision+1,epoch=epoch+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=conv.id;
 PERFORM public.agent_invalidate_person_reviews(conv.id);
 notice:=jsonb_build_object('text','You reviewed a person’s exact channel and account. Provider identity and full history must still be verified before outreach.','details',jsonb_build_object('conversationId',conv.id,'routeId',route.id,'channel',p_channel,'bindingId',binding.id,'recipientKind',p_kind,'recipient',p_value,'policyRevision',policy.revision));
 INSERT INTO public.agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES(t.id,t.organization_id,t.mandate_id,t.owner_user_id,'channel-route:'||route.id,'assistant',notice,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',notice)::text,'UTF8')),'hex'));
 INSERT INTO public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES(t.organization_id,t.owner_user_id,'agent.channel_route_reviewed','agent_conversation',conv.id::text,notice->'details');
 RETURN jsonb_build_object('id',route.id,'revision',route.revision);
END $function$
;

-- Exact business substitutions only; original operational checks retained.
CREATE OR REPLACE FUNCTION public.agent_save_channel_history(p_route uuid, p_revision integer, p_history jsonb, p_observed timestamp with time zone, p_complete boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.agent_conversation_channels%ROWTYPE;c public.agent_conversations%ROWTYPE;message jsonb;history_hash text;
BEGIN
 PERFORM public.agent_assert_control_scope();
 SELECT * INTO r FROM public.agent_conversation_channels WHERE id=p_route AND organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true) FOR UPDATE;
 SELECT * INTO c FROM public.agent_conversations WHERE id=r.conversation_id AND thread_id=r.thread_id FOR UPDATE;
 IF r.id IS NULL OR p_revision IS NULL OR r.revision<>p_revision OR p_observed IS NULL OR p_observed>public.local_simulator_business_now() OR p_observed<r.history_observed_at OR p_complete IS NULL OR jsonb_typeof(p_history) IS DISTINCT FROM 'array' OR jsonb_array_length(p_history)>200 OR octet_length(p_history::text)>1500000 THEN RAISE EXCEPTION 'Current bounded original-account history required';END IF;
 FOR message IN SELECT value FROM jsonb_array_elements(p_history) LOOP
  IF message->>'id' IS NULL OR message->>'direction' NOT IN('inbound','outbound') OR message->>'text' IS NULL OR (message->>'at')::timestamptz>p_observed THEN RAISE EXCEPTION 'Verified message metadata required';END IF;
  IF message->>'routeId' IS NULL THEN
   IF r.channel<>'email' OR r.binding_id<>c.binding_id OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.history) old WHERE old=message AND old->>'routeId' IS NULL) THEN RAISE EXCEPTION 'Only an unchanged original email source ID may be preserved';END IF;
  ELSIF message->>'routeId' IS DISTINCT FROM r.id::text OR message->>'channel' IS DISTINCT FROM r.channel OR message->>'bindingDigest' IS DISTINCT FROM r.binding_digest OR coalesce(message->>'providerMessageId','')='' OR message->>'id' IS DISTINCT FROM 'channel-message:'||encode(sha256(convert_to(public.agent_channel_canonical_json(jsonb_build_array(r.binding_digest,message->>'providerMessageId')),'UTF8')),'hex') THEN RAISE EXCEPTION 'Original route-scoped provider identity required';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_history))<>jsonb_array_length(p_history) OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) old WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_history) fresh WHERE fresh=old)) THEN RAISE EXCEPTION 'Complete immutable prior history required';END IF;
 history_hash:=encode(sha256(convert_to(public.agent_channel_canonical_json(p_history),'UTF8')),'hex');
 UPDATE public.agent_conversation_channels SET history=p_history,history_revision=history_hash,history_complete=p_complete,history_observed_at=p_observed,revision=revision+CASE WHEN history_revision<>history_hash OR history_complete<>p_complete THEN 1 ELSE 0 END,updated_at=clock_timestamp() WHERE id=r.id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_history) x WHERE x->>'direction'='inbound') THEN
  UPDATE public.agent_conversation_channels SET cold_cancelled_at=coalesce(cold_cancelled_at,clock_timestamp()),next_allowed_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE conversation_id=c.id AND cold_cancelled_at IS NULL;
 END IF;
END $function$
;
