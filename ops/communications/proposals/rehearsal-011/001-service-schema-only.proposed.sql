-- PROPOSED schema-only production communications capture; no rows or credentials.
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF current_database()<>'acquire_communications_rehearsal' OR (SELECT system_identifier::text FROM pg_control_system())<>'7699248227334438947'
 OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-communications-rehearsal-only'
 OR to_regnamespace('communications') IS NOT NULL THEN RAISE EXCEPTION 'Exact empty rehearsal schema required';END IF;
END $$;
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: communications; Type: SCHEMA; Schema: -; Owner: communications_admin
--

CREATE SCHEMA communications;


ALTER SCHEMA communications OWNER TO communications_admin;

--
-- Name: advance_reply_barrier(text, text); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.advance_reply_barrier(app text, tenant text) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE next_revision bigint;
BEGIN
  PERFORM communications.lock_reply_barrier(app,tenant);
  UPDATE communications.tenant_reply_barriers SET revision=revision+1,updated_at=clock_timestamp()
    WHERE application_id=app AND tenant_id=tenant RETURNING revision INTO next_revision;
  RETURN next_revision;
END $$;


ALTER FUNCTION communications.advance_reply_barrier(app text, tenant text) OWNER TO communications_admin;

--
-- Name: apply_retirement(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.apply_retirement() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  UPDATE communications.connections SET active=false,status='disconnected',status_observed_at=clock_timestamp()
    WHERE id=NEW.connection_id AND current_generation=NEW.generation AND account_id=NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retirement did not deactivate original current generation'; END IF;
  UPDATE communications.event_cursors SET invalidated=true,complete=false,initial_sync_complete=false,lease_token=NULL,lease_until=NULL WHERE account_id=NEW.account_id;
  PERFORM communications.advance_reply_barrier(NEW.application_id,NEW.tenant_id);
  RETURN NEW;
END $$;


ALTER FUNCTION communications.apply_retirement() OWNER TO communications_admin;

--
-- Name: assert_account_retirement_open(text); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.assert_account_retirement_open(physical text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=physical FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=physical AND state<>'disconnected') THEN
    RAISE EXCEPTION 'Physical account has an unresolved retirement intent';
  END IF;
END $$;


ALTER FUNCTION communications.assert_account_retirement_open(physical text) OWNER TO communications_admin;

--
-- Name: assert_dispatch_reply_barrier(text, text); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.assert_dispatch_reply_barrier(app text, tenant text) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE current_revision bigint;
BEGIN
  SELECT revision INTO current_revision FROM communications.tenant_reply_barriers
    WHERE application_id=app AND tenant_id=tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reply barrier is not initialized'; END IF;
  IF EXISTS (SELECT 1 FROM communications.webhook_receipt_routes r JOIN communications.webhook_inbox w ON w.id=r.webhook_inbox_id
      WHERE r.application_id=app AND r.tenant_id=tenant AND w.state<>'processed')
    OR EXISTS (SELECT 1 FROM communications.webhook_inbox w WHERE NOT EXISTS
      (SELECT 1 FROM communications.webhook_receipt_routes r WHERE r.webhook_inbox_id=w.id)
      AND EXISTS (SELECT 1 FROM communications.connection_generations g WHERE g.application_id=app AND g.tenant_id=tenant
        AND g.integration_id=w.integration_id AND g.backend=w.backend))
    OR EXISTS (SELECT 1 FROM communications.event_outbox o WHERE o.application_id=app AND o.tenant_id=tenant AND o.state<>'acknowledged')
    OR EXISTS (SELECT 1 FROM communications.reply_review_latches l WHERE l.application_id=app AND l.tenant_id=tenant AND l.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'Reply processing, application acknowledgement or review remains pending';
  END IF;
  RETURN current_revision;
END $$;


ALTER FUNCTION communications.assert_dispatch_reply_barrier(app text, tenant text) OWNER TO communications_admin;

--
-- Name: guard_account_runtime(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_account_runtime() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE g communications.connection_generations%ROWTYPE;c communications.connections%ROWTYPE;
BEGIN
 IF current_user<>'communications_control' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Restricted retained runtime history required'; END IF;
 IF TG_TABLE_NAME='setup_notification_inbox' THEN
  IF TG_OP='INSERT' THEN
   PERFORM 1 FROM communications.auth_states WHERE state_digest=NEW.state_digest AND backend='unipile' AND expires_at>clock_timestamp() FOR SHARE;
   IF NOT FOUND OR NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'Original unexpired setup state required'; END IF;
  ELSE
   IF (to_jsonb(NEW)-'processed_at')<>(to_jsonb(OLD)-'processed_at') OR OLD.processed_at IS NOT NULL OR NEW.processed_at IS NULL OR
    NOT EXISTS(SELECT 1 FROM communications.auth_states WHERE state_digest=NEW.state_digest AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Notification may only record original committed completion'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='account_runtime_metadata' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Canonical owner metadata is immutable'; END IF;
 SELECT * INTO g FROM communications.connection_generations WHERE connection_id=NEW.connection_id AND generation=NEW.generation;
 IF NOT FOUND OR g.backend<>'unipile' OR g.provider_api_version<>'v1' OR g.authority<>'service' THEN RAISE EXCEPTION 'Exact recorded service generation required'; END IF;
 PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
 SELECT * INTO c FROM communications.connections WHERE id=g.connection_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original connection required'; END IF;
 PERFORM 1 FROM communications.physical_accounts WHERE id=g.account_id AND channel=g.channel AND verified_at IS NOT NULL AND verified_at<=clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canonical verified physical owner required'; END IF;
 PERFORM 1 FROM communications.access_grants WHERE application_id=g.application_id AND tenant_id=g.tenant_id AND owner_id=g.owner_id
 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current owner grant required'; END IF;
 IF TG_TABLE_NAME='account_runtime_metadata' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('provider-webhook-spool',g.integration_id,g.provider_configuration_reference)::text,0));
  UPDATE communications.provider_webhook_spool SET bound_connection_id=g.connection_id,bound_generation=g.generation
   WHERE bound_connection_id IS NULL AND integration_id=g.integration_id AND provider_configuration_reference=g.provider_configuration_reference
    AND g.provider_account_digest=ANY(provider_account_digests) AND state IN('pending','processing');
 END IF;
 IF TG_TABLE_NAME='connection_defaults' THEN
  IF NEW.application_id<>g.application_id OR NEW.tenant_id<>g.tenant_id OR NEW.owner_id<>g.owner_id OR NEW.channel<>g.channel OR
   c.current_generation<>g.generation OR NOT c.active OR c.status<>'connected' OR
   EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=g.account_id AND state<>'disconnected') THEN
   RAISE EXCEPTION 'Exact current connected default required'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.channel) IS DISTINCT FROM ROW(OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.channel) THEN
   RAISE EXCEPTION 'Default scope is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_account_runtime() OWNER TO communications_admin;

--
-- Name: guard_dispatch_admission(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_dispatch_admission() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE operation communications.operation_journal%ROWTYPE; current_revision bigint;
BEGIN
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
 RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_dispatch_admission() OWNER TO communications_admin;

--
-- Name: guard_email_tracking_insert(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_email_tracking_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE operation communications.operation_journal%ROWTYPE;
        original_generation communications.connection_generations%ROWTYPE;
        ack communications.email_tracking_acknowledgements%ROWTYPE;
BEGIN
  IF current_user<>'communications_control' THEN
    RAISE EXCEPTION 'Email tracking writes require restricted control authority';
  END IF;
  IF TG_TABLE_NAME='email_tracking_associations' THEN
    SELECT * INTO ack FROM communications.email_tracking_acknowledgements WHERE id=NEW.acknowledgement_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original acknowledgement is required'; END IF;
    SELECT * INTO operation FROM communications.operation_journal WHERE id=ack.journal_id;
  ELSE
    SELECT * INTO operation FROM communications.operation_journal WHERE id=NEW.journal_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original operation is required'; END IF;
  PERFORM communications.lock_reply_barrier(operation.application_id,operation.tenant_id);
  PERFORM 1 FROM communications.connections WHERE id=operation.connection_id FOR SHARE;
  SELECT * INTO original_generation FROM communications.connection_generations
    WHERE connection_id=operation.connection_id AND generation=operation.generation FOR SHARE;
  IF NOT FOUND OR original_generation.channel<>'email' OR original_generation.backend<>'unipile'
     OR original_generation.provider_api_version<>'v1' OR original_generation.authority<>'service'
     OR original_generation.application_id<>operation.application_id
     OR original_generation.tenant_id<>operation.tenant_id OR original_generation.owner_id<>operation.owner_id
     OR original_generation.account_id<>operation.account_id THEN
    RAISE EXCEPTION 'Original service email generation is required';
  END IF;
  PERFORM 1 FROM communications.physical_accounts WHERE id=operation.account_id
    AND channel='email' AND verified_at IS NOT NULL AND verified_at<=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified original physical mailbox is required'; END IF;
  PERFORM 1 FROM communications.access_grants WHERE application_id=operation.application_id
    AND tenant_id=operation.tenant_id AND owner_id=operation.owner_id
    AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current original scoped authority is required'; END IF;
  SELECT * INTO operation FROM communications.operation_journal WHERE id=operation.id FOR SHARE;
  IF operation.operation<>'message' OR NOT operation.quota_reserved
     OR operation.state NOT IN ('dispatching','unknown','submitted') THEN
    RAISE EXCEPTION 'Only an already reserved original email operation can be associated';
  END IF;
  IF TG_TABLE_NAME='email_tracking_acknowledgements' THEN
    IF NEW.integration_id<>original_generation.integration_id OR
       NEW.provider_configuration_reference<>original_generation.provider_configuration_reference THEN
      RAISE EXCEPTION 'Provider configuration cannot be changed';
    END IF;
  ELSE
    IF ack.integration_id<>original_generation.integration_id OR
       ack.provider_configuration_reference<>original_generation.provider_configuration_reference THEN
      RAISE EXCEPTION 'Acknowledgement configuration cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_email_tracking_insert() OWNER TO communications_admin;

--
-- Name: guard_provider_spool_account_work(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_provider_spool_account_work() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='operation_journal' THEN
  IF NEW.state<>'dispatching' THEN RETURN NEW; END IF;
 END IF;
 aid:=NEW.account_id;
 IF EXISTS(SELECT 1 FROM communications.provider_webhook_spool w JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation WHERE g.account_id=aid AND w.state<>'routed') THEN RAISE EXCEPTION 'Pending provider evidence blocks account mutation'; END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_provider_spool_account_work() OWNER TO communications_admin;

--
-- Name: guard_provider_webhook_spool(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_provider_webhook_spool() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE g communications.connection_generations%ROWTYPE; matches integer;
BEGIN
 IF current_user<>'communications_control' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained restricted provider receipt required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.claim_token IS NOT NULL OR NEW.scoped_receipt_key IS NOT NULL OR NEW.bound_connection_id IS NOT NULL OR NEW.received_at>clock_timestamp() THEN RAISE EXCEPTION 'Only original passive capture permitted'; END IF;
  SELECT count(*) INTO matches FROM communications.connections c JOIN communications.connection_generations v ON v.connection_id=c.id AND v.generation=c.current_generation
   WHERE c.active AND v.backend='unipile' AND v.provider_api_version='v1' AND v.authority='service' AND v.integration_id=NEW.integration_id AND v.provider_configuration_reference=NEW.provider_configuration_reference AND v.provider_account_digest=ANY(NEW.provider_account_digests);
  IF matches>1 THEN RAISE EXCEPTION 'Ambiguous provider ownership'; END IF;
  IF matches=1 THEN
   SELECT v.* INTO g FROM communications.connections c JOIN communications.connection_generations v ON v.connection_id=c.id AND v.generation=c.current_generation
    WHERE c.active AND v.backend='unipile' AND v.provider_api_version='v1' AND v.authority='service' AND v.integration_id=NEW.integration_id AND v.provider_configuration_reference=NEW.provider_configuration_reference AND v.provider_account_digest=ANY(NEW.provider_account_digests);
   PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
   PERFORM 1 FROM communications.connections c WHERE c.id=g.connection_id AND c.current_generation=g.generation AND c.active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Provider binding changed'; END IF;
   NEW.bound_connection_id:=g.connection_id;NEW.bound_generation:=g.generation;
   UPDATE communications.event_cursors SET invalidated=true,complete=false,lease_token=NULL,lease_until=NULL WHERE connection_id=g.connection_id AND generation=g.generation;
   PERFORM communications.advance_reply_barrier(g.application_id,g.tenant_id);
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','claim_token','claim_until','retry_at','bound_connection_id','bound_generation','scoped_receipt_key']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claim_token','claim_until','retry_at','bound_connection_id','bound_generation','scoped_receipt_key']) OR OLD.state IN('routed','review') THEN RAISE EXCEPTION 'Provider receipt history immutable'; END IF;
  IF OLD.bound_connection_id IS NOT NULL AND ROW(NEW.bound_connection_id,NEW.bound_generation) IS DISTINCT FROM ROW(OLD.bound_connection_id,OLD.bound_generation) THEN RAISE EXCEPTION 'Original generation pin immutable'; END IF;
  IF NEW.bound_connection_id IS NOT NULL THEN
   SELECT * INTO g FROM communications.connection_generations WHERE connection_id=NEW.bound_connection_id AND generation=NEW.bound_generation;
   IF NOT FOUND OR g.backend<>'unipile' OR g.provider_api_version<>'v1' OR g.authority<>'service' OR g.integration_id<>NEW.integration_id OR g.provider_configuration_reference<>NEW.provider_configuration_reference OR NOT(g.provider_account_digest=ANY(NEW.provider_account_digests)) THEN RAISE EXCEPTION 'Original verified provider generation required'; END IF;
  END IF;
  IF OLD.bound_connection_id IS NULL AND NEW.bound_connection_id IS NOT NULL THEN
   PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
   UPDATE communications.event_cursors SET invalidated=true,complete=false,lease_token=NULL,lease_until=NULL WHERE connection_id=g.connection_id AND generation=g.generation;
   PERFORM communications.advance_reply_barrier(g.application_id,g.tenant_id);
  END IF;
  IF OLD.bound_connection_id IS NULL AND NEW.bound_connection_id IS NOT NULL AND ROW(NEW.state,NEW.claim_token,NEW.claim_until,NEW.retry_at,NEW.scoped_receipt_key) IS NOT DISTINCT FROM ROW(OLD.state,OLD.claim_token,OLD.claim_until,OLD.retry_at,OLD.scoped_receipt_key) THEN RETURN NEW; END IF;
  IF NEW.state='routed' THEN
   PERFORM communications.lock_reply_barrier(g.application_id,g.tenant_id);
   IF OLD.state<>'processing' OR OLD.claim_until<=clock_timestamp() OR OLD.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM communications.webhook_receipt_routes r WHERE r.webhook_inbox_id=NEW.scoped_receipt_key AND r.connection_id=g.connection_id AND r.generation=g.generation AND r.application_id=g.application_id AND r.tenant_id=g.tenant_id AND r.owner_id=g.owner_id AND r.account_id=g.account_id) THEN RAISE EXCEPTION 'Exact durable scoped receipt required'; END IF;
   PERFORM communications.advance_reply_barrier(g.application_id,g.tenant_id);
  ELSIF NEW.state='review' THEN
   IF OLD.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'Only expired receipt becomes unresolved review'; END IF;
  ELSIF NEW.state='processing' THEN
   IF OLD.state='processing' AND OLD.claim_until>clock_timestamp() OR NEW.claim_until<=clock_timestamp() OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Exact expiring receipt lease required'; END IF;
  ELSIF NEW.state='pending' THEN
   IF OLD.state<>'processing' OR OLD.claim_until<=clock_timestamp() OR OLD.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Only current worker may defer'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_provider_webhook_spool() OWNER TO communications_admin;

--
-- Name: guard_reply_dispatch(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_reply_dispatch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.state='claimed' AND NEW.state='dispatching' THEN
    PERFORM communications.assert_dispatch_reply_barrier(NEW.application_id,NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_reply_dispatch() OWNER TO communications_admin;

--
-- Name: guard_retirement_commit(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retirement_commit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE expires timestamptz; revoked timestamptz;
BEGIN
  PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id AND verified_at IS NOT NULL AND verified_at<=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified original physical account required at retirement commit'; END IF;
  PERFORM 1 FROM communications.connections WHERE id=NEW.connection_id AND current_generation=NEW.generation AND account_id=NEW.account_id
    AND application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND channel=NEW.channel AND platform=NEW.platform AND backend=NEW.backend
    AND NOT active AND status='disconnected' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original current retired generation required at commit'; END IF;
  SELECT expires_at,revoked_at INTO expires,revoked FROM communications.access_grants
    WHERE application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id FOR SHARE;
  IF NOT FOUND OR revoked IS NOT NULL OR expires<=clock_timestamp() THEN
    RAISE EXCEPTION 'Current retirement grant expired before commit';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retirement_commit() OWNER TO communications_admin;

--
-- Name: guard_retiring_account_write(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retiring_account_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  IF TG_TABLE_NAME='operation_journal' THEN
    IF TG_OP='INSERT' OR (NEW.state='dispatching' AND OLD.state<>'dispatching') OR (NEW.quota_reserved AND NOT OLD.quota_reserved) THEN
      PERFORM communications.assert_account_retirement_open(NEW.account_id);
    END IF;
  ELSE
    PERFORM communications.assert_account_retirement_open(NEW.account_id);
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retiring_account_write() OWNER TO communications_admin;

--
-- Name: guard_retiring_alias(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retiring_alias() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation) THEN
    RAISE EXCEPTION 'A retired generation cannot establish new aliases';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retiring_alias() OWNER TO communications_admin;

--
-- Name: guard_retiring_auth(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retiring_auth() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE physical text;
BEGIN
  PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
  IF NEW.reconnect_connection_id IS NOT NULL THEN
    SELECT account_id INTO STRICT physical FROM communications.connection_generations WHERE connection_id=NEW.reconnect_connection_id AND generation=NEW.reconnect_generation;
    PERFORM communications.assert_account_retirement_open(physical);
    IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.reconnect_connection_id AND generation=NEW.reconnect_generation) THEN
      RAISE EXCEPTION 'A retired generation cannot reconnect; explicit new setup is required';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND channel=NEW.channel AND state<>'disconnected') THEN
    RAISE EXCEPTION 'Unresolved owner/channel retirement prevents new authentication';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retiring_auth() OWNER TO communications_admin;

--
-- Name: guard_retiring_connection(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retiring_connection() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.current_generation<>OLD.current_generation OR NEW.account_id<>OLD.account_id) THEN
    PERFORM communications.assert_account_retirement_open(OLD.account_id);
  END IF;
  IF TG_OP='INSERT' OR NEW.active OR (TG_OP='UPDATE' AND (NEW.current_generation<>OLD.current_generation OR NEW.account_id<>OLD.account_id)) THEN
    PERFORM communications.assert_account_retirement_open(NEW.account_id);
  END IF;
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.id AND generation=NEW.current_generation)
    AND (NEW.active OR NEW.status<>'disconnected') THEN
    RAISE EXCEPTION 'A retired generation cannot reactivate or change status';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retiring_connection() OWNER TO communications_admin;

--
-- Name: guard_retiring_cursor(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retiring_cursor() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id FOR UPDATE;
  IF (EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=NEW.account_id AND state<>'disconnected') OR
      EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation))
    AND (NOT NEW.invalidated OR NEW.complete OR NEW.initial_sync_complete OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL) THEN
    RAISE EXCEPTION 'Retirement invalidates cursor coverage and leases';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retiring_cursor() OWNER TO communications_admin;

--
-- Name: guard_retiring_generation(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.guard_retiring_generation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  RETURN NEW;
END $$;


ALTER FUNCTION communications.guard_retiring_generation() OWNER TO communications_admin;

--
-- Name: history_coverage_commit_guard(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.history_coverage_commit_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
 IF NEW.complete THEN
  IF NOT NEW.initial_sync_complete OR NEW.invalidated OR NEW.encrypted_cursor IS NULL OR NEW.cursor_key_version IS NULL
   OR NEW.coverage_through>clock_timestamp() OR NEW.observed_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM communications.history_refreshes h WHERE h.connection_id=NEW.connection_id
    AND h.generation=NEW.generation AND h.scope_digest=NEW.scope_digest
    AND h.application_id=NEW.application_id AND h.tenant_id=NEW.tenant_id AND h.owner_id=NEW.owner_id
    AND h.account_id=NEW.account_id AND h.required_since=NEW.coverage_from
    AND date_trunc('milliseconds',h.started_at)=NEW.coverage_through AND h.finished_at IS NOT NULL
    AND h.finished_at>=NEW.observed_at)
   OR NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.access_grants g
    ON g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id
    WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active
    AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Complete history coverage lacks current finished original authorization';
  END IF;
 END IF;
 RETURN NULL;
END $$;


ALTER FUNCTION communications.history_coverage_commit_guard() OWNER TO communications_admin;

--
-- Name: history_refresh_commit_guard(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.history_refresh_commit_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.access_grants g
  ON g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id
  WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active
   AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'History refresh authorization expired before commit';
 END IF;
 RETURN NULL;
END $$;


ALTER FUNCTION communications.history_refresh_commit_guard() OWNER TO communications_admin;

--
-- Name: lock_reply_barrier(text, text); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.lock_reply_barrier(app text, tenant text) RETURNS bigint
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE current_revision bigint;
BEGIN
  INSERT INTO communications.tenant_reply_barriers (application_id,tenant_id) VALUES (app,tenant) ON CONFLICT DO NOTHING;
  SELECT revision INTO STRICT current_revision FROM communications.tenant_reply_barriers
    WHERE application_id=app AND tenant_id=tenant FOR UPDATE;
  RETURN current_revision;
END $$;


ALTER FUNCTION communications.lock_reply_barrier(app text, tenant text) OWNER TO communications_admin;

--
-- Name: protect_auth_state(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_auth_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ROW(NEW.state_digest, NEW.application_id, NEW.tenant_id, NEW.owner_id, NEW.channel, NEW.platform, NEW.backend,
         NEW.redirect_origin, NEW.reconnect_connection_id, NEW.reconnect_generation, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM ROW(OLD.state_digest, OLD.application_id, OLD.tenant_id, OLD.owner_id, OLD.channel, OLD.platform, OLD.backend,
         OLD.redirect_origin, OLD.reconnect_connection_id, OLD.reconnect_generation, OLD.created_at, OLD.expires_at) OR
     (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'Authentication state ownership and single-use consumption are immutable';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_auth_state() OWNER TO communications_admin;

--
-- Name: protect_connection(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_connection() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE identity_verified timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.application_id, NEW.tenant_id, NEW.owner_id, NEW.channel, NEW.platform, NEW.backend)
       IS DISTINCT FROM ROW(OLD.id, OLD.application_id, OLD.tenant_id, OLD.owner_id, OLD.channel, OLD.platform, OLD.backend) THEN
      RAISE EXCEPTION 'Connection ownership/platform/backend is immutable; create a new connection';
    END IF;
    IF NEW.current_generation = OLD.current_generation AND OLD.status_observed_at IS NOT NULL AND
       (NEW.status_observed_at IS NULL OR NEW.status_observed_at < OLD.status_observed_at OR
        (NEW.status <> OLD.status AND NEW.status_observed_at = OLD.status_observed_at)) THEN
      RAISE EXCEPTION 'Account status observations cannot regress';
    END IF;
    IF NEW.current_generation < OLD.current_generation OR
       (NEW.account_id <> OLD.account_id AND NEW.current_generation <= OLD.current_generation) THEN
      RAISE EXCEPTION 'Account changes require a new generation';
    END IF;
    IF OLD.active AND (NOT NEW.active OR NEW.account_id <> OLD.account_id) AND EXISTS (
      SELECT 1 FROM communications.operation_journal WHERE connection_id = OLD.id AND state IN ('claimed','dispatching','unknown')) THEN
      RAISE EXCEPTION 'Unresolved operations prevent retiring or changing this account';
    END IF;
  END IF;
  IF NEW.active THEN
    SELECT verified_at INTO identity_verified FROM communications.physical_accounts WHERE id = NEW.account_id FOR UPDATE;
    IF identity_verified IS NULL THEN RAISE EXCEPTION 'Physical identity verification is required before activation'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.current_generation > OLD.current_generation THEN
    UPDATE communications.event_cursors SET invalidated = true WHERE connection_id = OLD.id;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_connection() OWNER TO communications_admin;

--
-- Name: protect_cursor(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_cursor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ROW(NEW.connection_id,NEW.generation,NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.account_id,NEW.scope_digest)
     IS DISTINCT FROM ROW(OLD.connection_id,OLD.generation,OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.account_id,OLD.scope_digest) THEN
    RAISE EXCEPTION 'Cursor account/generation/query scope is immutable; create an invalidated new row';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_cursor() OWNER TO communications_admin;

--
-- Name: protect_history_initial_sync(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_history_initial_sync() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
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
 RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_history_initial_sync() OWNER TO communications_admin;

--
-- Name: protect_history_refresh(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_history_refresh() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE c communications.connections%ROWTYPE;
BEGIN
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
 RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_history_refresh() OWNER TO communications_admin;

--
-- Name: protect_lease(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_lease() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.account_id <> OLD.account_id THEN RAISE EXCEPTION 'Lease account cannot change'; END IF;
  -- Repository lease acquisition/renewal must lock account BEFORE updating
  -- the lease row, matching journal admission order; this check alone does
  -- not prove that protocol or eliminate transactional deadlock handling.
  IF OLD.expires_at > clock_timestamp() THEN
    IF NEW.owner_token <> OLD.owner_token OR NEW.fencing_token <> OLD.fencing_token THEN
      RAISE EXCEPTION 'An unexpired account lease cannot be stolen';
    END IF;
  ELSIF NEW.fencing_token <= OLD.fencing_token THEN
    RAISE EXCEPTION 'Reacquiring an expired lease requires a higher fencing token';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_lease() OWNER TO communications_admin;

--
-- Name: protect_operation(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_operation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE original_connection communications.connections%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Durable operation history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' OR (OLD.state = 'claimed' AND NEW.state = 'dispatching') THEN
    -- The shared connection lock serializes admission against retirement and
    -- generation change; account lock serializes quota/lease admission.
    SELECT * INTO original_connection FROM communications.connections WHERE id = NEW.connection_id FOR UPDATE;
    IF NOT FOUND OR NOT original_connection.active OR original_connection.status <> 'connected' OR
       original_connection.current_generation <> NEW.generation OR original_connection.account_id <> NEW.account_id THEN
      RAISE EXCEPTION 'Only the active connected current generation admits new work';
    END IF;
    PERFORM 1 FROM communications.physical_accounts WHERE id = NEW.account_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM communications.access_grants WHERE application_id = NEW.application_id
      AND tenant_id = NEW.tenant_id AND owner_id = NEW.owner_id AND revoked_at IS NULL AND expires_at > clock_timestamp()) THEN
      RAISE EXCEPTION 'A current scoped grant is required for operation admission';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM communications.account_leases WHERE account_id = NEW.account_id
      AND owner_token = NEW.lease_owner_token AND fencing_token = NEW.fencing_token AND expires_at > clock_timestamp()) OR
      NEW.claim_until <= clock_timestamp() THEN
      RAISE EXCEPTION 'A valid fenced account lease and unexpired claim are required';
    END IF;
    IF TG_OP = 'UPDATE' AND NOT NEW.quota_reserved THEN
      RAISE EXCEPTION 'Dispatch admission requires atomic quota reservation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quota_reserved THEN RAISE EXCEPTION 'Quota reservation follows unique claim insertion'; END IF;
    IF NEW.state <> 'claimed' THEN RAISE EXCEPTION 'New operations must start as undelivered claims'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.application_id, NEW.tenant_id, NEW.owner_id, NEW.operation_key, NEW.connection_id,
         NEW.generation, NEW.account_id, NEW.operation, NEW.payload_digest, NEW.recipient_digest, NEW.digest_version, NEW.recipient_key_version,
         NEW.encrypted_operation_context, NEW.operation_context_key_version, NEW.operation_context_digest)
     IS DISTINCT FROM ROW(OLD.id, OLD.application_id, OLD.tenant_id, OLD.owner_id, OLD.operation_key, OLD.connection_id,
         OLD.generation, OLD.account_id, OLD.operation, OLD.payload_digest, OLD.recipient_digest, OLD.digest_version, OLD.recipient_key_version,
         OLD.encrypted_operation_context, OLD.operation_context_key_version, OLD.operation_context_digest) THEN
    RAISE EXCEPTION 'Operation key, content and original binding are immutable';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'claimed' AND NEW.state IN ('dispatching','unknown','blocked','rejected','skipped'))
    OR (OLD.state = 'dispatching' AND NEW.state IN ('submitted','unknown','blocked','rejected','skipped'))
    OR (OLD.state = 'unknown' AND NEW.state = 'submitted' AND OLD.quota_reserved AND NEW.resolution_evidence_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'Unsafe operation transition';
  END IF;
  IF (OLD.state <> 'claimed' OR NEW.state <> 'claimed') AND ROW(NEW.claim_token, NEW.claim_until, NEW.fencing_token, NEW.lease_owner_token)
     IS DISTINCT FROM ROW(OLD.claim_token, OLD.claim_until, OLD.fencing_token, OLD.lease_owner_token) THEN
    RAISE EXCEPTION 'Dispatch claim and fencing ownership cannot change after admission';
  END IF;
  IF OLD.state = 'dispatching' AND NEW.state IN ('submitted','blocked','rejected','skipped') AND
     NEW.resolution_evidence_digest IS NULL AND NOT EXISTS (
       SELECT 1 FROM communications.account_leases WHERE account_id = OLD.account_id
         AND owner_token = OLD.lease_owner_token AND fencing_token = OLD.fencing_token AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'Stale worker needs read-only reconciliation evidence for a terminal result';
  END IF;
  IF OLD.state = 'submitted' AND ROW(NEW.encrypted_receipt, NEW.receipt_key_version, NEW.submitted_at)
     IS DISTINCT FROM ROW(OLD.encrypted_receipt, OLD.receipt_key_version, OLD.submitted_at) THEN
    RAISE EXCEPTION 'Accepted receipt/submission facts cannot be replaced';
  END IF;
  IF OLD.state IN ('blocked','rejected','skipped') AND
     ROW(NEW.outcome_status, NEW.encrypted_outcome, NEW.outcome_key_version, NEW.failure_code)
     IS DISTINCT FROM ROW(OLD.outcome_status, OLD.encrypted_outcome, OLD.outcome_key_version, OLD.failure_code) THEN
    RAISE EXCEPTION 'Completed typed outcome cannot be replaced';
  END IF;
  IF (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at) OR
     (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
    RAISE EXCEPTION 'Known delivery/read source timestamps cannot be reset or overwritten';
  END IF;
  IF NEW.quota_reserved IS DISTINCT FROM OLD.quota_reserved AND NOT
     (OLD.state = 'claimed' AND NEW.state = 'dispatching' AND NOT OLD.quota_reserved AND NEW.quota_reserved) THEN
    RAISE EXCEPTION 'Quota reservation changes only at fenced dispatch admission and cannot reset';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_operation() OWNER TO communications_admin;

--
-- Name: protect_physical_identity(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_physical_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ROW(NEW.id, NEW.channel) IS DISTINCT FROM ROW(OLD.id, OLD.channel) OR
     (OLD.verified_at IS NOT NULL AND ROW(NEW.identity_namespace, NEW.identity_digest, NEW.identity_key_version, NEW.verified_at)
       IS DISTINCT FROM ROW(OLD.identity_namespace, OLD.identity_digest, OLD.identity_key_version, OLD.verified_at)) THEN
    RAISE EXCEPTION 'Verified physical identity is immutable; create a new account';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_physical_identity() OWNER TO communications_admin;

--
-- Name: protect_reply_barrier(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_reply_barrier() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ROW(NEW.application_id,NEW.tenant_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.application_id,OLD.tenant_id,OLD.created_at)
     OR NEW.revision <> OLD.revision+1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Reply barrier identity is immutable and revisions advance one step';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_reply_barrier() OWNER TO communications_admin;

--
-- Name: protect_retirement(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.protect_retirement() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE c communications.connections%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.connection_id,NEW.generation,NEW.account_id,NEW.channel,NEW.platform,NEW.backend,
      NEW.operation_key,NEW.record_fingerprint,NEW.fingerprint_key_version,NEW.encrypted_record,NEW.record_key_version,NEW.token_hash,NEW.prepared_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.connection_id,OLD.generation,OLD.account_id,OLD.channel,OLD.platform,OLD.backend,
      OLD.operation_key,OLD.record_fingerprint,OLD.fingerprint_key_version,OLD.encrypted_record,OLD.record_key_version,OLD.token_hash,OLD.prepared_at)
      OR OLD.state<>'pending' OR NEW.state NOT IN ('unknown','rejected','disconnected') THEN
      RAISE EXCEPTION 'Retirement identity and terminal outcome are immutable';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM communications.lock_reply_barrier(NEW.application_id,NEW.tenant_id);
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  SELECT * INTO STRICT c FROM communications.connections WHERE id=NEW.connection_id FOR UPDATE;
  IF NOT c.active OR c.current_generation<>NEW.generation OR c.account_id<>NEW.account_id
    OR ROW(c.application_id,c.tenant_id,c.owner_id,c.channel,c.platform,c.backend) IS DISTINCT FROM
       ROW(NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.channel,NEW.platform,NEW.backend)
    OR (c.status_observed_at IS NOT NULL AND c.status_observed_at>clock_timestamp())
    OR NEW.state<>'pending' OR NEW.prepared_at>clock_timestamp()
    OR EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation)
    OR NOT EXISTS(SELECT 1 FROM communications.access_grants WHERE application_id=NEW.application_id AND tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id AND revoked_at IS NULL AND expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM communications.connections WHERE account_id=NEW.account_id AND id<>NEW.connection_id AND active)
    OR EXISTS(SELECT 1 FROM communications.operation_journal WHERE account_id=NEW.account_id AND state IN ('claimed','dispatching','unknown'))
    OR EXISTS(SELECT 1 FROM communications.account_leases WHERE account_id=NEW.account_id AND expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM communications.auth_states a LEFT JOIN communications.connection_generations g ON g.connection_id=a.reconnect_connection_id AND g.generation=a.reconnect_generation
      WHERE a.consumed_at IS NULL AND a.expires_at>clock_timestamp() AND
        ((a.application_id=NEW.application_id AND a.tenant_id=NEW.tenant_id AND a.owner_id=NEW.owner_id AND a.channel=NEW.channel) OR g.account_id=NEW.account_id)) THEN
    RAISE EXCEPTION 'Current exclusive account authority and settled work are required for retirement';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.protect_retirement() OWNER TO communications_admin;

--
-- Name: reject_mutation(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.reject_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Immutable communications history cannot be changed'; END $$;


ALTER FUNCTION communications.reject_mutation() OWNER TO communications_admin;

--
-- Name: reply_inbox_barrier_change(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.reply_inbox_barrier_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE original_route communications.webhook_receipt_routes%ROWTYPE;
BEGIN
  IF ROW(NEW.id,NEW.backend,NEW.integration_id,NEW.dedupe_key,NEW.payload_digest,NEW.encrypted_payload,
         NEW.key_version,NEW.authenticated_at,NEW.received_at,NEW.expires_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.backend,OLD.integration_id,OLD.dedupe_key,OLD.payload_digest,OLD.encrypted_payload,
         OLD.key_version,OLD.authenticated_at,OLD.received_at,OLD.expires_at) THEN
    RAISE EXCEPTION 'Original authenticated receipt and retention are immutable';
  END IF;
  IF OLD.state='processed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A completed webhook receipt cannot be replaced or reopened';
  END IF;
  SELECT * INTO original_route FROM communications.webhook_receipt_routes WHERE webhook_inbox_id=OLD.id;
  IF FOUND THEN
    PERFORM communications.advance_reply_barrier(original_route.application_id,original_route.tenant_id);
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION communications.reply_inbox_barrier_change() OWNER TO communications_admin;

--
-- Name: reply_outbox_barrier_change(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.reply_outbox_barrier_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.event_id,NEW.subscriber_id,NEW.application_id,NEW.tenant_id,NEW.owner_id)
      IS DISTINCT FROM ROW(OLD.event_id,OLD.subscriber_id,OLD.application_id,OLD.tenant_id,OLD.owner_id) THEN
    RAISE EXCEPTION 'Subscriber delivery identity and event scope are immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.state='acknowledged' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Application acknowledgement cannot regress or be replaced';
  END IF;
  PERFORM communications.advance_reply_barrier(NEW.application_id,NEW.tenant_id);
  RETURN NEW;
END $$;


ALTER FUNCTION communications.reply_outbox_barrier_change() OWNER TO communications_admin;

--
-- Name: reply_review_barrier_change(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.reply_review_barrier_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='INSERT' AND (NEW.resolved_at IS NOT NULL OR NEW.resolution_reference IS NOT NULL) THEN
    RAISE EXCEPTION 'A new service review must start unresolved';
  END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.event_id,NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.code,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.event_id,OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.code,OLD.created_at)
       OR (OLD.resolved_at IS NOT NULL AND ROW(NEW.resolved_at,NEW.resolution_reference)
         IS DISTINCT FROM ROW(OLD.resolved_at,OLD.resolution_reference))) THEN
    RAISE EXCEPTION 'Review provenance and recorded resolution are immutable';
  END IF;
  PERFORM communications.advance_reply_barrier(NEW.application_id,NEW.tenant_id);
  RETURN NEW;
END $$;


ALTER FUNCTION communications.reply_review_barrier_change() OWNER TO communications_admin;

--
-- Name: require_dispatch_admission(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.require_dispatch_admission() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
BEGIN
 IF OLD.state='claimed' AND NEW.state='dispatching' AND NOT EXISTS(SELECT 1 FROM communications.dispatch_admissions a WHERE a.journal_id=NEW.id AND a.application_id=NEW.application_id AND a.tenant_id=NEW.tenant_id AND a.owner_id=NEW.owner_id AND a.claim_token=NEW.claim_token AND a.fencing_token=NEW.fencing_token) THEN RAISE EXCEPTION 'Private application permit ledger required'; END IF; RETURN NEW;
END $$;


ALTER FUNCTION communications.require_dispatch_admission() OWNER TO communications_admin;

--
-- Name: rollup_application_quota(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.rollup_application_quota() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
DECLARE delta bigint; prior bigint;
BEGIN
 IF NEW.bucket_kind<>'application' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('communications.application-quota.v1:'||NEW.application_id,0));
 IF TG_OP='UPDATE' AND ROW(NEW.account_id,NEW.bucket_kind,NEW.application_id,NEW.window_kind,NEW.window_start,NEW.limit_value) IS DISTINCT FROM ROW(OLD.account_id,OLD.bucket_kind,OLD.application_id,OLD.window_kind,OLD.window_start,OLD.limit_value) THEN RAISE EXCEPTION 'Quota policy/window identity cannot be changed'; END IF;
 delta:=NEW.used-CASE WHEN TG_OP='UPDATE' THEN OLD.used ELSE 0 END;
 IF delta<0 THEN RAISE EXCEPTION 'Charged application quota cannot be reset'; END IF;
 -- AFTER fires exactly once for the actual INSERT or ON CONFLICT UPDATE.
 -- The changed per-account row is already included in SUM, so remove its delta.
 SELECT coalesce(sum(used),0) INTO prior FROM communications.quota_buckets WHERE bucket_kind='application' AND application_id=NEW.application_id AND window_kind=NEW.window_kind AND window_start=NEW.window_start;
 prior:=prior-delta;
 IF prior<0 THEN RAISE EXCEPTION 'Application quota history count conflict'; END IF;
 IF prior+delta>NEW.limit_value THEN RAISE EXCEPTION USING ERRCODE='PQUO1',MESSAGE='Application quota unavailable'; END IF;
 INSERT INTO communications.application_quota_buckets(application_id,window_kind,window_start,used,limit_value) VALUES(NEW.application_id,NEW.window_kind,NEW.window_start,prior,NEW.limit_value) ON CONFLICT DO NOTHING;
 UPDATE communications.application_quota_buckets SET used=used+delta WHERE application_id=NEW.application_id AND window_kind=NEW.window_kind AND window_start=NEW.window_start AND limit_value=NEW.limit_value AND used=prior AND used+delta<=limit_value;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PQUO1',MESSAGE='Application quota policy/count conflict'; END IF;
 RETURN NEW;
END $$;


ALTER FUNCTION communications.rollup_application_quota() OWNER TO communications_admin;

--
-- Name: route_webhook_receipt(); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.route_webhook_receipt() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM communications.webhook_inbox w JOIN communications.connection_generations g
      ON g.connection_id=NEW.connection_id AND g.generation=NEW.generation
      WHERE w.id=NEW.webhook_inbox_id AND w.backend=g.backend AND w.integration_id=g.integration_id
        AND g.application_id=NEW.application_id AND g.tenant_id=NEW.tenant_id AND g.owner_id=NEW.owner_id AND g.account_id=NEW.account_id) THEN
    RAISE EXCEPTION 'Receipt source and original generation routing must agree';
  END IF;
  NEW.capture_revision := communications.advance_reply_barrier(NEW.application_id,NEW.tenant_id);
  RETURN NEW;
END $$;


ALTER FUNCTION communications.route_webhook_receipt() OWNER TO communications_admin;

--
-- Name: scope_authorized(text, text, text); Type: FUNCTION; Schema: communications; Owner: communications_admin
--

CREATE FUNCTION communications.scope_authorized(app text, tenant text, owner text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'communications'
    AS $$
  SELECT app = current_setting('communications.application_id', true)
     AND tenant = current_setting('communications.tenant_id', true)
     AND owner = current_setting('communications.owner_id', true)
     AND EXISTS (SELECT 1 FROM communications.access_grants g
       WHERE g.application_id = app AND g.tenant_id = tenant AND g.owner_id = owner
         AND g.revoked_at IS NULL AND g.expires_at > statement_timestamp());
$$;


ALTER FUNCTION communications.scope_authorized(app text, tenant text, owner text) OWNER TO communications_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_grants; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.access_grants (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT access_grants_application_id_check CHECK (((length(application_id) >= 1) AND (length(application_id) <= 200))),
    CONSTRAINT access_grants_owner_id_check CHECK (((length(owner_id) >= 1) AND (length(owner_id) <= 200))),
    CONSTRAINT access_grants_tenant_id_check CHECK (((length(tenant_id) >= 1) AND (length(tenant_id) <= 200)))
);

ALTER TABLE ONLY communications.access_grants FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.access_grants OWNER TO communications_admin;

--
-- Name: account_leases; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.account_leases (
    account_id text NOT NULL,
    owner_token text NOT NULL,
    fencing_token bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT account_leases_fencing_token_check CHECK ((fencing_token > 0))
);

ALTER TABLE ONLY communications.account_leases FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.account_leases OWNER TO communications_admin;

--
-- Name: account_runtime_metadata; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.account_runtime_metadata (
    connection_id text NOT NULL,
    generation integer NOT NULL,
    encrypted_metadata text NOT NULL,
    metadata_key_version text NOT NULL,
    metadata_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT account_runtime_metadata_encrypted_metadata_check CHECK (((length(encrypted_metadata) >= 1) AND (length(encrypted_metadata) <= 2200000))),
    CONSTRAINT account_runtime_metadata_generation_check CHECK ((generation > 0)),
    CONSTRAINT account_runtime_metadata_metadata_digest_check CHECK ((metadata_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT account_runtime_metadata_metadata_key_version_check CHECK (((length(metadata_key_version) >= 1) AND (length(metadata_key_version) <= 64)))
);

ALTER TABLE ONLY communications.account_runtime_metadata FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.account_runtime_metadata OWNER TO communications_admin;

--
-- Name: application_quota_buckets; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.application_quota_buckets (
    application_id text NOT NULL,
    window_kind text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    used bigint NOT NULL,
    limit_value integer NOT NULL,
    CONSTRAINT application_quota_buckets_check CHECK (((limit_value >= 0) AND (used <= limit_value))),
    CONSTRAINT application_quota_buckets_used_check CHECK ((used >= 0)),
    CONSTRAINT application_quota_buckets_window_kind_check CHECK ((window_kind = ANY (ARRAY['hour'::text, 'day'::text])))
);

ALTER TABLE ONLY communications.application_quota_buckets FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.application_quota_buckets OWNER TO communications_admin;

--
-- Name: auth_states; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.auth_states (
    state_digest text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    channel text NOT NULL,
    platform text NOT NULL,
    backend text NOT NULL,
    redirect_origin text NOT NULL,
    reconnect_connection_id text,
    reconnect_generation integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT auth_states_backend_check CHECK ((backend = ANY (ARRAY['direct'::text, 'baileys'::text, 'browser'::text, 'unipile'::text]))),
    CONSTRAINT auth_states_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'linkedin'::text]))),
    CONSTRAINT auth_states_check CHECK (((reconnect_connection_id IS NULL) = (reconnect_generation IS NULL))),
    CONSTRAINT auth_states_check1 CHECK ((((channel = 'email'::text) AND (platform = ANY (ARRAY['gmail'::text, 'outlook'::text, 'imap'::text])) AND (backend = ANY (ARRAY['direct'::text, 'unipile'::text]))) OR ((channel = 'whatsapp'::text) AND (platform = 'whatsapp'::text) AND (backend = ANY (ARRAY['baileys'::text, 'unipile'::text]))) OR ((channel = 'linkedin'::text) AND (platform = 'linkedin'::text) AND (backend = ANY (ARRAY['browser'::text, 'unipile'::text]))))),
    CONSTRAINT auth_states_check2 CHECK ((expires_at > created_at)),
    CONSTRAINT auth_states_check3 CHECK (((consumed_at IS NULL) OR ((consumed_at >= created_at) AND (consumed_at < expires_at)))),
    CONSTRAINT auth_states_redirect_origin_check CHECK ((redirect_origin ~ '^https?://'::text)),
    CONSTRAINT auth_states_state_digest_check CHECK ((state_digest ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY communications.auth_states FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.auth_states OWNER TO communications_admin;

--
-- Name: connection_defaults; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.connection_defaults (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    channel text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT connection_defaults_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'linkedin'::text]))),
    CONSTRAINT connection_defaults_generation_check CHECK ((generation > 0))
);

ALTER TABLE ONLY communications.connection_defaults FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.connection_defaults OWNER TO communications_admin;

--
-- Name: connection_generations; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.connection_generations (
    connection_id text NOT NULL,
    generation integer NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    account_id text NOT NULL,
    channel text NOT NULL,
    platform text NOT NULL,
    backend text NOT NULL,
    integration_id text NOT NULL,
    provider_api_version text,
    provider_configuration_reference text,
    provider_account_digest text,
    encrypted_provider_account_id text,
    provider_account_key_version text,
    credential_reference text,
    authority text NOT NULL,
    capabilities jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connection_generations_authority_check CHECK ((authority = ANY (ARRAY['legacy_port'::text, 'service'::text]))),
    CONSTRAINT connection_generations_capabilities_check CHECK ((jsonb_typeof(capabilities) = 'object'::text)),
    CONSTRAINT connection_generations_check CHECK ((((provider_account_digest IS NULL) AND (encrypted_provider_account_id IS NULL) AND (provider_account_key_version IS NULL)) OR ((provider_account_digest IS NOT NULL) AND (encrypted_provider_account_id IS NOT NULL) AND (provider_account_key_version IS NOT NULL)))),
    CONSTRAINT connection_generations_check1 CHECK ((((backend = 'unipile'::text) AND (provider_api_version IS NOT NULL) AND (provider_configuration_reference IS NOT NULL)) OR ((backend <> 'unipile'::text) AND (provider_api_version IS NULL) AND (provider_configuration_reference IS NULL)))),
    CONSTRAINT connection_generations_credential_reference_check CHECK (((length(credential_reference) >= 1) AND (length(credential_reference) <= 2000))),
    CONSTRAINT connection_generations_encrypted_provider_account_id_check CHECK ((length(encrypted_provider_account_id) > 0)),
    CONSTRAINT connection_generations_generation_check CHECK ((generation > 0)),
    CONSTRAINT connection_generations_integration_id_check CHECK ((length(integration_id) > 0)),
    CONSTRAINT connection_generations_provider_account_digest_check CHECK ((provider_account_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT connection_generations_provider_account_key_version_check CHECK (((length(provider_account_key_version) >= 1) AND (length(provider_account_key_version) <= 200))),
    CONSTRAINT connection_generations_provider_api_version_check CHECK ((provider_api_version = ANY (ARRAY['v1'::text, 'v2'::text]))),
    CONSTRAINT connection_generations_provider_configuration_reference_check CHECK (((length(provider_configuration_reference) >= 1) AND (length(provider_configuration_reference) <= 2000)))
);

ALTER TABLE ONLY communications.connection_generations FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.connection_generations OWNER TO communications_admin;

--
-- Name: connection_retirements; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.connection_retirements (
    id text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    channel text NOT NULL,
    platform text NOT NULL,
    backend text NOT NULL,
    operation_key text NOT NULL,
    record_fingerprint text NOT NULL,
    fingerprint_key_version text NOT NULL,
    encrypted_record text NOT NULL,
    record_key_version text NOT NULL,
    token_hash text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    prepared_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finished_at timestamp with time zone,
    encrypted_outcome text,
    outcome_key_version text,
    CONSTRAINT connection_retirements_backend_check CHECK ((backend = 'unipile'::text)),
    CONSTRAINT connection_retirements_check CHECK ((((state = 'pending'::text) AND (finished_at IS NULL) AND (encrypted_outcome IS NULL) AND (outcome_key_version IS NULL)) OR ((state <> 'pending'::text) AND (finished_at IS NOT NULL) AND (finished_at >= prepared_at) AND (encrypted_outcome IS NOT NULL) AND (outcome_key_version IS NOT NULL)))),
    CONSTRAINT connection_retirements_encrypted_outcome_check CHECK (((length(encrypted_outcome) >= 1) AND (length(encrypted_outcome) <= 4096))),
    CONSTRAINT connection_retirements_encrypted_record_check CHECK (((length(encrypted_record) >= 1) AND (length(encrypted_record) <= 65536))),
    CONSTRAINT connection_retirements_fingerprint_key_version_check CHECK (((length(fingerprint_key_version) >= 1) AND (length(fingerprint_key_version) <= 64))),
    CONSTRAINT connection_retirements_id_check CHECK ((id ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT connection_retirements_operation_key_check CHECK (((length(operation_key) >= 1) AND (length(operation_key) <= 200))),
    CONSTRAINT connection_retirements_outcome_key_version_check CHECK (((length(outcome_key_version) >= 1) AND (length(outcome_key_version) <= 64))),
    CONSTRAINT connection_retirements_record_fingerprint_check CHECK ((record_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT connection_retirements_record_key_version_check CHECK (((length(record_key_version) >= 1) AND (length(record_key_version) <= 64))),
    CONSTRAINT connection_retirements_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'unknown'::text, 'rejected'::text, 'disconnected'::text]))),
    CONSTRAINT connection_retirements_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY communications.connection_retirements FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.connection_retirements OWNER TO communications_admin;

--
-- Name: connections; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.connections (
    id text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    account_id text NOT NULL,
    channel text NOT NULL,
    platform text NOT NULL,
    backend text NOT NULL,
    current_generation integer NOT NULL,
    status text NOT NULL,
    status_observed_at timestamp with time zone,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connections_backend_check CHECK ((backend = ANY (ARRAY['direct'::text, 'baileys'::text, 'browser'::text, 'unipile'::text]))),
    CONSTRAINT connections_check CHECK ((((channel = 'email'::text) AND (platform = ANY (ARRAY['gmail'::text, 'outlook'::text, 'imap'::text])) AND (backend = ANY (ARRAY['direct'::text, 'unipile'::text]))) OR ((channel = 'whatsapp'::text) AND (platform = 'whatsapp'::text) AND (backend = ANY (ARRAY['baileys'::text, 'unipile'::text]))) OR ((channel = 'linkedin'::text) AND (platform = 'linkedin'::text) AND (backend = ANY (ARRAY['browser'::text, 'unipile'::text]))))),
    CONSTRAINT connections_current_generation_check CHECK ((current_generation > 0)),
    CONSTRAINT connections_id_check CHECK (((length(id) >= 1) AND (length(id) <= 200))),
    CONSTRAINT connections_status_check CHECK ((status = ANY (ARRAY['connecting'::text, 'connected'::text, 'syncing'::text, 'verification_required'::text, 'disconnected'::text, 'failed'::text])))
);

ALTER TABLE ONLY communications.connections FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.connections OWNER TO communications_admin;

--
-- Name: dispatch_admissions; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.dispatch_admissions (
    id text NOT NULL,
    journal_id text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    operation_key text NOT NULL,
    payload_digest text NOT NULL,
    permit_id text NOT NULL,
    intent_digest text NOT NULL,
    claim_token text NOT NULL,
    fencing_token bigint NOT NULL,
    lease_owner_token text NOT NULL,
    service_revision bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT dispatch_admissions_id_check CHECK (((length(id) >= 1) AND (length(id) <= 200))),
    CONSTRAINT dispatch_admissions_intent_digest_check CHECK ((intent_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT dispatch_admissions_payload_digest_check CHECK ((payload_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT dispatch_admissions_service_revision_check CHECK ((service_revision >= 0))
);

ALTER TABLE ONLY communications.dispatch_admissions FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.dispatch_admissions OWNER TO communications_admin;

--
-- Name: email_tracking_acknowledgements; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.email_tracking_acknowledgements (
    id text NOT NULL,
    journal_id text NOT NULL,
    integration_id text NOT NULL,
    provider_configuration_reference text NOT NULL,
    tracking_digest text NOT NULL,
    tracking_key_version text NOT NULL,
    encrypted_ack text NOT NULL,
    ack_key_version text NOT NULL,
    ack_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT email_tracking_acknowledgeme_provider_configuration_refer_check CHECK (((length(provider_configuration_reference) >= 1) AND (length(provider_configuration_reference) <= 2000))),
    CONSTRAINT email_tracking_acknowledgements_ack_digest_check CHECK ((ack_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT email_tracking_acknowledgements_ack_key_version_check CHECK (((length(ack_key_version) >= 1) AND (length(ack_key_version) <= 64))),
    CONSTRAINT email_tracking_acknowledgements_encrypted_ack_check CHECK (((length(encrypted_ack) >= 1) AND (length(encrypted_ack) <= 2200000))),
    CONSTRAINT email_tracking_acknowledgements_id_check CHECK (((length(id) >= 1) AND (length(id) <= 200))),
    CONSTRAINT email_tracking_acknowledgements_integration_id_check CHECK (((length(integration_id) >= 1) AND (length(integration_id) <= 200))),
    CONSTRAINT email_tracking_acknowledgements_tracking_digest_check CHECK ((tracking_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT email_tracking_acknowledgements_tracking_key_version_check CHECK (((length(tracking_key_version) >= 1) AND (length(tracking_key_version) <= 64)))
);

ALTER TABLE ONLY communications.email_tracking_acknowledgements FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.email_tracking_acknowledgements OWNER TO communications_admin;

--
-- Name: email_tracking_associations; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.email_tracking_associations (
    acknowledgement_id text NOT NULL,
    encrypted_association text NOT NULL,
    association_key_version text NOT NULL,
    association_digest text NOT NULL,
    evidence_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT email_tracking_associations_association_digest_check CHECK ((association_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT email_tracking_associations_association_key_version_check CHECK (((length(association_key_version) >= 1) AND (length(association_key_version) <= 64))),
    CONSTRAINT email_tracking_associations_encrypted_association_check CHECK (((length(encrypted_association) >= 1) AND (length(encrypted_association) <= 2200000))),
    CONSTRAINT email_tracking_associations_evidence_digest_check CHECK ((evidence_digest ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY communications.email_tracking_associations FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.email_tracking_associations OWNER TO communications_admin;

--
-- Name: event_cursors; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.event_cursors (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    scope_digest text NOT NULL,
    encrypted_cursor text,
    cursor_key_version text,
    coverage_from timestamp with time zone,
    coverage_through timestamp with time zone,
    observed_at timestamp with time zone,
    complete boolean DEFAULT false NOT NULL,
    initial_sync_complete boolean DEFAULT false NOT NULL,
    invalidated boolean DEFAULT true NOT NULL,
    lease_token text,
    lease_until timestamp with time zone,
    CONSTRAINT event_cursors_check CHECK (((encrypted_cursor IS NULL) = (cursor_key_version IS NULL))),
    CONSTRAINT event_cursors_check1 CHECK (((NOT complete) OR ((coverage_from IS NOT NULL) AND (coverage_through IS NOT NULL) AND (observed_at IS NOT NULL) AND (coverage_from <= coverage_through) AND (coverage_through <= observed_at)))),
    CONSTRAINT event_cursors_scope_digest_check CHECK ((scope_digest ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY communications.event_cursors FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.event_cursors OWNER TO communications_admin;

--
-- Name: event_outbox; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.event_outbox (
    event_id bigint NOT NULL,
    subscriber_id text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    retry_at timestamp with time zone,
    lease_token text,
    lease_until timestamp with time zone,
    acknowledged_at timestamp with time zone,
    failure_code text,
    CONSTRAINT event_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT event_outbox_check CHECK (((state = 'acknowledged'::text) = (acknowledged_at IS NOT NULL))),
    CONSTRAINT event_outbox_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'delivering'::text, 'acknowledged'::text, 'dead_letter'::text])))
);

ALTER TABLE ONLY communications.event_outbox FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.event_outbox OWNER TO communications_admin;

--
-- Name: events; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.events (
    id bigint NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    source_namespace text NOT NULL,
    source_event_key text NOT NULL,
    event_type text NOT NULL,
    direction text,
    occurred_at timestamp with time zone NOT NULL,
    encrypted_event text NOT NULL,
    key_version text NOT NULL,
    webhook_inbox_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_check CHECK ((((event_type = 'message'::text) AND (direction IS NOT NULL)) OR ((event_type <> 'message'::text) AND (direction IS NULL)))),
    CONSTRAINT events_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'self'::text, 'group'::text]))),
    CONSTRAINT events_event_type_check CHECK ((event_type = ANY (ARRAY['message'::text, 'receipt'::text, 'account'::text, 'email_change'::text])))
);

ALTER TABLE ONLY communications.events FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.events OWNER TO communications_admin;

--
-- Name: events_id_seq; Type: SEQUENCE; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME communications.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: history_initial_sync; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.history_initial_sync (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    webhook_inbox_id text NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    encrypted_evidence text NOT NULL,
    key_version text NOT NULL,
    digest_key_version text NOT NULL,
    CONSTRAINT history_initial_sync_digest_key_version_check CHECK (((length(digest_key_version) >= 1) AND (length(digest_key_version) <= 64))),
    CONSTRAINT history_initial_sync_encrypted_evidence_check CHECK (((length(encrypted_evidence) >= 1) AND (length(encrypted_evidence) <= 65536))),
    CONSTRAINT history_initial_sync_key_version_check CHECK (((length(key_version) >= 1) AND (length(key_version) <= 64)))
);

ALTER TABLE ONLY communications.history_initial_sync FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.history_initial_sync OWNER TO communications_admin;

--
-- Name: history_refreshes; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.history_refreshes (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    scope_digest text NOT NULL,
    digest_key_version text NOT NULL,
    token_hash text NOT NULL,
    required_since timestamp with time zone NOT NULL,
    capture_revision bigint NOT NULL,
    started_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    lease_until timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    finished_revision bigint,
    CONSTRAINT history_refreshes_capture_revision_check CHECK ((capture_revision >= 0)),
    CONSTRAINT history_refreshes_check CHECK ((required_since <= started_at)),
    CONSTRAINT history_refreshes_check1 CHECK ((lease_until >= started_at)),
    CONSTRAINT history_refreshes_check2 CHECK (((finished_at IS NULL) = (finished_revision IS NULL))),
    CONSTRAINT history_refreshes_check3 CHECK (((finished_revision IS NULL) OR (finished_revision >= capture_revision))),
    CONSTRAINT history_refreshes_check4 CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT history_refreshes_digest_key_version_check CHECK (((length(digest_key_version) >= 1) AND (length(digest_key_version) <= 64))),
    CONSTRAINT history_refreshes_scope_digest_check CHECK ((scope_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT history_refreshes_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY communications.history_refreshes FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.history_refreshes OWNER TO communications_admin;

--
-- Name: identity_aliases; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.identity_aliases (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    namespace text NOT NULL,
    alias_digest text NOT NULL,
    canonical_kind text NOT NULL,
    canonical_digest text NOT NULL,
    encrypted_identity text NOT NULL,
    key_version text NOT NULL,
    verified_at timestamp with time zone NOT NULL,
    CONSTRAINT identity_aliases_alias_digest_check CHECK ((alias_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT identity_aliases_canonical_digest_check CHECK ((canonical_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT identity_aliases_canonical_kind_check CHECK ((canonical_kind = ANY (ARRAY['email'::text, 'phone'::text, 'linkedin_profile'::text]))),
    CONSTRAINT identity_aliases_namespace_check CHECK ((length(namespace) > 0))
);

ALTER TABLE ONLY communications.identity_aliases FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.identity_aliases OWNER TO communications_admin;

--
-- Name: operation_journal; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.operation_journal (
    id text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    operation_key text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    operation text NOT NULL,
    payload_digest text NOT NULL,
    recipient_digest text NOT NULL,
    digest_version text NOT NULL,
    recipient_key_version text NOT NULL,
    encrypted_operation_context text NOT NULL,
    operation_context_key_version text NOT NULL,
    operation_context_digest text NOT NULL,
    state text DEFAULT 'claimed'::text NOT NULL,
    claim_token text NOT NULL,
    claim_until timestamp with time zone NOT NULL,
    fencing_token bigint NOT NULL,
    lease_owner_token text NOT NULL,
    quota_reserved boolean DEFAULT false NOT NULL,
    encrypted_receipt text,
    receipt_key_version text,
    outcome_status text,
    encrypted_outcome text,
    outcome_key_version text,
    resolution_evidence_digest text,
    failure_code text,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operation_journal_check CHECK ((((state = 'submitted'::text) AND (encrypted_receipt IS NOT NULL) AND (receipt_key_version IS NOT NULL)) OR ((state <> 'submitted'::text) AND (encrypted_receipt IS NULL) AND (receipt_key_version IS NULL)))),
    CONSTRAINT operation_journal_check1 CHECK ((((state = ANY (ARRAY['blocked'::text, 'rejected'::text, 'skipped'::text])) AND (outcome_status IS NOT NULL) AND (encrypted_outcome IS NOT NULL) AND (outcome_key_version IS NOT NULL) AND (((state = 'blocked'::text) AND (outcome_status = ANY (ARRAY['waiting'::text, 'review'::text]))) OR ((state = 'rejected'::text) AND (outcome_status = 'rejected'::text)) OR ((state = 'skipped'::text) AND (outcome_status = 'skipped'::text)))) OR ((state <> ALL (ARRAY['blocked'::text, 'rejected'::text, 'skipped'::text])) AND (outcome_status IS NULL) AND (encrypted_outcome IS NULL) AND (outcome_key_version IS NULL)))),
    CONSTRAINT operation_journal_check2 CHECK (((state <> ALL (ARRAY['dispatching'::text, 'submitted'::text])) OR quota_reserved)),
    CONSTRAINT operation_journal_check3 CHECK (((submitted_at IS NULL) OR (state = 'submitted'::text))),
    CONSTRAINT operation_journal_check4 CHECK (((delivered_at IS NULL) OR (state = 'submitted'::text))),
    CONSTRAINT operation_journal_check5 CHECK (((read_at IS NULL) OR (state = 'submitted'::text))),
    CONSTRAINT operation_journal_digest_version_check CHECK ((length(digest_version) > 0)),
    CONSTRAINT operation_journal_encrypted_operation_context_check CHECK ((length(encrypted_operation_context) > 0)),
    CONSTRAINT operation_journal_encrypted_outcome_check CHECK ((length(encrypted_outcome) > 0)),
    CONSTRAINT operation_journal_fencing_token_check CHECK ((fencing_token > 0)),
    CONSTRAINT operation_journal_id_check CHECK (((length(id) >= 1) AND (length(id) <= 200))),
    CONSTRAINT operation_journal_operation_check CHECK ((operation = ANY (ARRAY['message'::text, 'invitation'::text, 'draft_create'::text, 'draft_update'::text, 'draft_delete'::text]))),
    CONSTRAINT operation_journal_operation_context_digest_check CHECK ((operation_context_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT operation_journal_operation_context_key_version_check CHECK (((length(operation_context_key_version) >= 1) AND (length(operation_context_key_version) <= 200))),
    CONSTRAINT operation_journal_operation_key_check CHECK (((length(operation_key) >= 1) AND (length(operation_key) <= 200))),
    CONSTRAINT operation_journal_outcome_key_version_check CHECK (((length(outcome_key_version) >= 1) AND (length(outcome_key_version) <= 200))),
    CONSTRAINT operation_journal_outcome_status_check CHECK ((outcome_status = ANY (ARRAY['waiting'::text, 'review'::text, 'rejected'::text, 'skipped'::text]))),
    CONSTRAINT operation_journal_payload_digest_check CHECK ((payload_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT operation_journal_recipient_digest_check CHECK ((recipient_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT operation_journal_recipient_key_version_check CHECK ((length(recipient_key_version) > 0)),
    CONSTRAINT operation_journal_resolution_evidence_digest_check CHECK ((resolution_evidence_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT operation_journal_state_check CHECK ((state = ANY (ARRAY['claimed'::text, 'dispatching'::text, 'submitted'::text, 'unknown'::text, 'blocked'::text, 'rejected'::text, 'skipped'::text])))
);

ALTER TABLE ONLY communications.operation_journal FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.operation_journal OWNER TO communications_admin;

--
-- Name: physical_accounts; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.physical_accounts (
    id text NOT NULL,
    channel text NOT NULL,
    identity_namespace text,
    identity_digest text,
    identity_key_version text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT physical_accounts_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'linkedin'::text]))),
    CONSTRAINT physical_accounts_check CHECK ((((identity_namespace IS NULL) AND (identity_digest IS NULL) AND (identity_key_version IS NULL) AND (verified_at IS NULL)) OR ((identity_namespace IS NOT NULL) AND (length(identity_namespace) > 0) AND (identity_digest IS NOT NULL) AND (identity_key_version IS NOT NULL) AND (length(identity_key_version) > 0) AND (verified_at IS NOT NULL)))),
    CONSTRAINT physical_accounts_id_check CHECK (((length(id) >= 1) AND (length(id) <= 200))),
    CONSTRAINT physical_accounts_identity_digest_check CHECK ((identity_digest ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY communications.physical_accounts FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.physical_accounts OWNER TO communications_admin;

--
-- Name: provider_webhook_spool; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.provider_webhook_spool (
    id text NOT NULL,
    integration_id text NOT NULL,
    provider_configuration_reference text NOT NULL,
    provider_account_digests text[] NOT NULL,
    encrypted_receipt text NOT NULL,
    key_version text NOT NULL,
    payload_digest text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    claim_token text,
    claim_until timestamp with time zone,
    retry_at timestamp with time zone,
    bound_connection_id text,
    bound_generation integer,
    scoped_receipt_key text,
    CONSTRAINT provider_webhook_spool_check CHECK (((expires_at > received_at) AND (expires_at <= (received_at + '24:00:00'::interval)))),
    CONSTRAINT provider_webhook_spool_check1 CHECK (((bound_connection_id IS NULL) = (bound_generation IS NULL))),
    CONSTRAINT provider_webhook_spool_check2 CHECK (((state = 'processing'::text) = ((claim_token IS NOT NULL) AND (claim_until IS NOT NULL)))),
    CONSTRAINT provider_webhook_spool_check3 CHECK (((claim_until IS NULL) OR (claim_until <= expires_at))),
    CONSTRAINT provider_webhook_spool_check4 CHECK (((state = 'routed'::text) = (scoped_receipt_key IS NOT NULL))),
    CONSTRAINT provider_webhook_spool_check5 CHECK (((state <> 'routed'::text) OR (bound_connection_id IS NOT NULL))),
    CONSTRAINT provider_webhook_spool_claim_token_check CHECK ((claim_token ~ '^[A-Za-z0-9_-]{43}$'::text)),
    CONSTRAINT provider_webhook_spool_encrypted_receipt_check CHECK (((length(encrypted_receipt) >= 1) AND (length(encrypted_receipt) <= 500000))),
    CONSTRAINT provider_webhook_spool_id_check CHECK ((id ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT provider_webhook_spool_integration_id_check CHECK (((length(integration_id) >= 1) AND (length(integration_id) <= 200))),
    CONSTRAINT provider_webhook_spool_key_version_check CHECK (((length(key_version) >= 1) AND (length(key_version) <= 64))),
    CONSTRAINT provider_webhook_spool_payload_digest_check CHECK ((payload_digest ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT provider_webhook_spool_provider_account_digests_check CHECK ((((cardinality(provider_account_digests) >= 1) AND (cardinality(provider_account_digests) <= 32)) AND (array_position(provider_account_digests, NULL::text) IS NULL) AND (array_to_string(provider_account_digests, ','::text) ~ '^[a-f0-9]{64}(,[a-f0-9]{64})*$'::text))),
    CONSTRAINT provider_webhook_spool_provider_configuration_reference_check CHECK (((length(provider_configuration_reference) >= 1) AND (length(provider_configuration_reference) <= 2000))),
    CONSTRAINT provider_webhook_spool_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'processing'::text, 'routed'::text, 'review'::text])))
);

ALTER TABLE ONLY communications.provider_webhook_spool FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.provider_webhook_spool OWNER TO communications_admin;

--
-- Name: quota_buckets; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.quota_buckets (
    account_id text NOT NULL,
    bucket_kind text NOT NULL,
    application_id text NOT NULL,
    window_kind text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    used integer NOT NULL,
    limit_value integer NOT NULL,
    CONSTRAINT quota_buckets_bucket_kind_check CHECK ((bucket_kind = ANY (ARRAY['account'::text, 'application'::text]))),
    CONSTRAINT quota_buckets_check CHECK (((limit_value >= 0) AND (used <= limit_value))),
    CONSTRAINT quota_buckets_check1 CHECK ((((bucket_kind = 'account'::text) AND (application_id = ''::text)) OR ((bucket_kind = 'application'::text) AND (length(application_id) > 0)))),
    CONSTRAINT quota_buckets_used_check CHECK ((used >= 0)),
    CONSTRAINT quota_buckets_window_kind_check CHECK ((window_kind = ANY (ARRAY['hour'::text, 'day'::text])))
);

ALTER TABLE ONLY communications.quota_buckets FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.quota_buckets OWNER TO communications_admin;

--
-- Name: reply_review_latches; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.reply_review_latches (
    event_id bigint NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    resolved_at timestamp with time zone,
    resolution_reference text,
    CONSTRAINT reply_review_latches_check CHECK (((resolved_at IS NULL) = (resolution_reference IS NULL))),
    CONSTRAINT reply_review_latches_check1 CHECK (((resolved_at IS NULL) OR (resolved_at >= created_at))),
    CONSTRAINT reply_review_latches_code_check CHECK ((code = ANY (ARRAY['protocol'::text, 'account_changed'::text, 'identity_pending'::text, 'semantic_conflict'::text, 'historical_binding'::text]))),
    CONSTRAINT reply_review_latches_resolution_reference_check CHECK (((length(resolution_reference) >= 1) AND (length(resolution_reference) <= 2000)))
);

ALTER TABLE ONLY communications.reply_review_latches FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.reply_review_latches OWNER TO communications_admin;

--
-- Name: setup_notification_inbox; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.setup_notification_inbox (
    state_digest text NOT NULL,
    encrypted_notification text NOT NULL,
    key_version text NOT NULL,
    payload_digest text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT setup_notification_inbox_check CHECK (((processed_at IS NULL) OR (processed_at >= created_at))),
    CONSTRAINT setup_notification_inbox_encrypted_notification_check CHECK (((length(encrypted_notification) >= 1) AND (length(encrypted_notification) <= 2200000))),
    CONSTRAINT setup_notification_inbox_key_version_check CHECK (((length(key_version) >= 1) AND (length(key_version) <= 64))),
    CONSTRAINT setup_notification_inbox_payload_digest_check CHECK ((payload_digest ~ '^[a-f0-9]{64}$'::text))
);

ALTER TABLE ONLY communications.setup_notification_inbox FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.setup_notification_inbox OWNER TO communications_admin;

--
-- Name: tenant_reply_barriers; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.tenant_reply_barriers (
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT tenant_reply_barriers_application_id_check CHECK (((length(application_id) >= 1) AND (length(application_id) <= 200))),
    CONSTRAINT tenant_reply_barriers_revision_check CHECK ((revision >= 0)),
    CONSTRAINT tenant_reply_barriers_tenant_id_check CHECK (((length(tenant_id) >= 1) AND (length(tenant_id) <= 200)))
);

ALTER TABLE ONLY communications.tenant_reply_barriers FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.tenant_reply_barriers OWNER TO communications_admin;

--
-- Name: webhook_inbox; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.webhook_inbox (
    id text NOT NULL,
    backend text NOT NULL,
    integration_id text NOT NULL,
    dedupe_key text NOT NULL,
    payload_digest text NOT NULL,
    encrypted_payload text NOT NULL,
    key_version text NOT NULL,
    authenticated_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    retry_at timestamp with time zone,
    lease_token text,
    lease_until timestamp with time zone,
    failure_code text,
    CONSTRAINT webhook_inbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT webhook_inbox_backend_check CHECK ((backend = ANY (ARRAY['direct'::text, 'baileys'::text, 'browser'::text, 'unipile'::text]))),
    CONSTRAINT webhook_inbox_check CHECK ((expires_at > received_at)),
    CONSTRAINT webhook_inbox_payload_digest_check CHECK ((payload_digest ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT webhook_inbox_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'dead_letter'::text])))
);

ALTER TABLE ONLY communications.webhook_inbox FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.webhook_inbox OWNER TO communications_admin;

--
-- Name: webhook_receipt_routes; Type: TABLE; Schema: communications; Owner: communications_admin
--

CREATE TABLE communications.webhook_receipt_routes (
    webhook_inbox_id text NOT NULL,
    application_id text NOT NULL,
    tenant_id text NOT NULL,
    owner_id text NOT NULL,
    connection_id text NOT NULL,
    generation integer NOT NULL,
    account_id text NOT NULL,
    capture_revision bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT webhook_receipt_routes_capture_revision_check CHECK ((capture_revision > 0))
);

ALTER TABLE ONLY communications.webhook_receipt_routes FORCE ROW LEVEL SECURITY;


ALTER TABLE communications.webhook_receipt_routes OWNER TO communications_admin;

--
-- Name: access_grants access_grants_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.access_grants
    ADD CONSTRAINT access_grants_pkey PRIMARY KEY (application_id, tenant_id, owner_id);


--
-- Name: account_leases account_leases_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.account_leases
    ADD CONSTRAINT account_leases_pkey PRIMARY KEY (account_id);


--
-- Name: account_runtime_metadata account_runtime_metadata_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.account_runtime_metadata
    ADD CONSTRAINT account_runtime_metadata_pkey PRIMARY KEY (connection_id, generation);


--
-- Name: application_quota_buckets application_quota_buckets_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.application_quota_buckets
    ADD CONSTRAINT application_quota_buckets_pkey PRIMARY KEY (application_id, window_kind, window_start);


--
-- Name: auth_states auth_states_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.auth_states
    ADD CONSTRAINT auth_states_pkey PRIMARY KEY (state_digest);


--
-- Name: connection_defaults connection_defaults_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_defaults
    ADD CONSTRAINT connection_defaults_pkey PRIMARY KEY (application_id, tenant_id, owner_id, channel);


--
-- Name: connection_generations connection_generations_connection_id_generation_applicatio_key1; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_generations
    ADD CONSTRAINT connection_generations_connection_id_generation_applicatio_key1 UNIQUE (connection_id, generation, application_id, tenant_id, owner_id);


--
-- Name: connection_generations connection_generations_connection_id_generation_applicatio_key2; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_generations
    ADD CONSTRAINT connection_generations_connection_id_generation_applicatio_key2 UNIQUE (connection_id, generation, application_id, tenant_id, owner_id, channel, platform, backend);


--
-- Name: connection_generations connection_generations_connection_id_generation_application_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_generations
    ADD CONSTRAINT connection_generations_connection_id_generation_application_key UNIQUE (connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: connection_generations connection_generations_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_generations
    ADD CONSTRAINT connection_generations_pkey PRIMARY KEY (connection_id, generation);


--
-- Name: connection_retirements connection_retirements_application_id_tenant_id_owner_id_op_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_retirements
    ADD CONSTRAINT connection_retirements_application_id_tenant_id_owner_id_op_key UNIQUE (application_id, tenant_id, owner_id, operation_key);


--
-- Name: connection_retirements connection_retirements_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_retirements
    ADD CONSTRAINT connection_retirements_pkey PRIMARY KEY (id);


--
-- Name: connections connections_id_application_id_tenant_id_owner_id_channel_pl_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connections
    ADD CONSTRAINT connections_id_application_id_tenant_id_owner_id_channel_pl_key UNIQUE (id, application_id, tenant_id, owner_id, channel, platform, backend);


--
-- Name: connections connections_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);


--
-- Name: dispatch_admissions dispatch_admissions_application_id_permit_id_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.dispatch_admissions
    ADD CONSTRAINT dispatch_admissions_application_id_permit_id_key UNIQUE (application_id, permit_id);


--
-- Name: dispatch_admissions dispatch_admissions_journal_id_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.dispatch_admissions
    ADD CONSTRAINT dispatch_admissions_journal_id_key UNIQUE (journal_id);


--
-- Name: dispatch_admissions dispatch_admissions_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.dispatch_admissions
    ADD CONSTRAINT dispatch_admissions_pkey PRIMARY KEY (id);


--
-- Name: email_tracking_acknowledgements email_tracking_acknowledgemen_integration_id_provider_confi_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.email_tracking_acknowledgements
    ADD CONSTRAINT email_tracking_acknowledgemen_integration_id_provider_confi_key UNIQUE (integration_id, provider_configuration_reference, tracking_key_version, tracking_digest);


--
-- Name: email_tracking_acknowledgements email_tracking_acknowledgements_journal_id_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.email_tracking_acknowledgements
    ADD CONSTRAINT email_tracking_acknowledgements_journal_id_key UNIQUE (journal_id);


--
-- Name: email_tracking_acknowledgements email_tracking_acknowledgements_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.email_tracking_acknowledgements
    ADD CONSTRAINT email_tracking_acknowledgements_pkey PRIMARY KEY (id);


--
-- Name: email_tracking_associations email_tracking_associations_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.email_tracking_associations
    ADD CONSTRAINT email_tracking_associations_pkey PRIMARY KEY (acknowledgement_id);


--
-- Name: event_cursors event_cursors_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.event_cursors
    ADD CONSTRAINT event_cursors_pkey PRIMARY KEY (connection_id, generation, scope_digest);


--
-- Name: event_outbox event_outbox_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.event_outbox
    ADD CONSTRAINT event_outbox_pkey PRIMARY KEY (event_id, subscriber_id);


--
-- Name: events events_connection_id_generation_source_namespace_source_eve_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.events
    ADD CONSTRAINT events_connection_id_generation_source_namespace_source_eve_key UNIQUE (connection_id, generation, source_namespace, source_event_key);


--
-- Name: events events_id_application_id_tenant_id_owner_id_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.events
    ADD CONSTRAINT events_id_application_id_tenant_id_owner_id_key UNIQUE (id, application_id, tenant_id, owner_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: history_initial_sync history_initial_sync_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.history_initial_sync
    ADD CONSTRAINT history_initial_sync_pkey PRIMARY KEY (connection_id, generation);


--
-- Name: history_refreshes history_refreshes_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.history_refreshes
    ADD CONSTRAINT history_refreshes_pkey PRIMARY KEY (connection_id, generation, scope_digest);


--
-- Name: identity_aliases identity_aliases_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.identity_aliases
    ADD CONSTRAINT identity_aliases_pkey PRIMARY KEY (connection_id, generation, namespace, alias_digest);


--
-- Name: operation_journal operation_journal_application_id_tenant_id_owner_id_operati_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.operation_journal
    ADD CONSTRAINT operation_journal_application_id_tenant_id_owner_id_operati_key UNIQUE (application_id, tenant_id, owner_id, operation_key);


--
-- Name: operation_journal operation_journal_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.operation_journal
    ADD CONSTRAINT operation_journal_pkey PRIMARY KEY (id);


--
-- Name: physical_accounts physical_accounts_id_channel_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.physical_accounts
    ADD CONSTRAINT physical_accounts_id_channel_key UNIQUE (id, channel);


--
-- Name: physical_accounts physical_accounts_identity_namespace_identity_digest_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.physical_accounts
    ADD CONSTRAINT physical_accounts_identity_namespace_identity_digest_key UNIQUE (identity_namespace, identity_digest);


--
-- Name: physical_accounts physical_accounts_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.physical_accounts
    ADD CONSTRAINT physical_accounts_pkey PRIMARY KEY (id);


--
-- Name: provider_webhook_spool provider_webhook_spool_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.provider_webhook_spool
    ADD CONSTRAINT provider_webhook_spool_pkey PRIMARY KEY (id);


--
-- Name: quota_buckets quota_buckets_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.quota_buckets
    ADD CONSTRAINT quota_buckets_pkey PRIMARY KEY (account_id, bucket_kind, application_id, window_kind, window_start);


--
-- Name: reply_review_latches reply_review_latches_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.reply_review_latches
    ADD CONSTRAINT reply_review_latches_pkey PRIMARY KEY (event_id);


--
-- Name: setup_notification_inbox setup_notification_inbox_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.setup_notification_inbox
    ADD CONSTRAINT setup_notification_inbox_pkey PRIMARY KEY (state_digest);


--
-- Name: tenant_reply_barriers tenant_reply_barriers_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.tenant_reply_barriers
    ADD CONSTRAINT tenant_reply_barriers_pkey PRIMARY KEY (application_id, tenant_id);


--
-- Name: webhook_inbox webhook_inbox_backend_integration_id_dedupe_key_key; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.webhook_inbox
    ADD CONSTRAINT webhook_inbox_backend_integration_id_dedupe_key_key UNIQUE (backend, integration_id, dedupe_key);


--
-- Name: webhook_inbox webhook_inbox_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.webhook_inbox
    ADD CONSTRAINT webhook_inbox_pkey PRIMARY KEY (id);


--
-- Name: webhook_receipt_routes webhook_receipt_routes_pkey; Type: CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.webhook_receipt_routes
    ADD CONSTRAINT webhook_receipt_routes_pkey PRIMARY KEY (webhook_inbox_id);


--
-- Name: communications_event_scan; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_event_scan ON communications.events USING btree (connection_id, generation, id);


--
-- Name: communications_one_active_account; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE UNIQUE INDEX communications_one_active_account ON communications.connections USING btree (account_id) WHERE active;


--
-- Name: communications_operation_account_pending; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_operation_account_pending ON communications.operation_journal USING btree (account_id, state, claimed_at);


--
-- Name: communications_outbox_due; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_outbox_due ON communications.event_outbox USING btree (state, retry_at, event_id);


--
-- Name: communications_provider_spool_work; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_provider_spool_work ON communications.provider_webhook_spool USING btree (integration_id, provider_configuration_reference, state, received_at);


--
-- Name: communications_receipt_route_tenant; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_receipt_route_tenant ON communications.webhook_receipt_routes USING btree (application_id, tenant_id, webhook_inbox_id);


--
-- Name: communications_retirement_account_open; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE UNIQUE INDEX communications_retirement_account_open ON communications.connection_retirements USING btree (account_id) WHERE (state <> 'disconnected'::text);


--
-- Name: communications_review_tenant_open; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_review_tenant_open ON communications.reply_review_latches USING btree (application_id, tenant_id) WHERE (resolved_at IS NULL);


--
-- Name: communications_webhook_due; Type: INDEX; Schema: communications; Owner: communications_admin
--

CREATE INDEX communications_webhook_due ON communications.webhook_inbox USING btree (state, retry_at, received_at);


--
-- Name: operation_journal communications_00_provider_spool_dispatch_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_00_provider_spool_dispatch_guard BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();


--
-- Name: connection_generations communications_00_provider_spool_generation_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_00_provider_spool_generation_guard BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();


--
-- Name: connection_retirements communications_00_provider_spool_retirement_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_00_provider_spool_retirement_guard BEFORE INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();


--
-- Name: operation_journal communications_00_reply_dispatch_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_00_reply_dispatch_guard BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_reply_dispatch();


--
-- Name: operation_journal communications_01_private_admission; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_01_private_admission BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.require_dispatch_admission();


--
-- Name: dispatch_admissions communications_admission_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_admission_commit AFTER INSERT ON communications.dispatch_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_dispatch_admission();


--
-- Name: dispatch_admissions communications_admission_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_admission_immutable BEFORE DELETE OR UPDATE ON communications.dispatch_admissions FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: identity_aliases communications_alias_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_alias_immutable BEFORE DELETE OR UPDATE ON communications.identity_aliases FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: application_quota_buckets communications_application_quota_no_delete; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_application_quota_no_delete BEFORE DELETE ON communications.application_quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: quota_buckets communications_application_quota_rollup; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_application_quota_rollup AFTER INSERT OR UPDATE ON communications.quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.rollup_application_quota();


--
-- Name: auth_states communications_auth_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_auth_guard BEFORE UPDATE ON communications.auth_states FOR EACH ROW EXECUTE FUNCTION communications.protect_auth_state();


--
-- Name: connections communications_connection_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_connection_guard BEFORE INSERT OR UPDATE ON communications.connections FOR EACH ROW EXECUTE FUNCTION communications.protect_connection();


--
-- Name: event_cursors communications_cursor_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_cursor_guard BEFORE UPDATE ON communications.event_cursors FOR EACH ROW EXECUTE FUNCTION communications.protect_cursor();


--
-- Name: email_tracking_acknowledgements communications_email_ack_commit_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_email_ack_commit_guard AFTER INSERT ON communications.email_tracking_acknowledgements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();


--
-- Name: email_tracking_acknowledgements communications_email_ack_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_email_ack_immutable BEFORE DELETE OR UPDATE ON communications.email_tracking_acknowledgements FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: email_tracking_acknowledgements communications_email_ack_insert_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_email_ack_insert_guard BEFORE INSERT ON communications.email_tracking_acknowledgements FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();


--
-- Name: email_tracking_associations communications_email_association_commit_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_email_association_commit_guard AFTER INSERT ON communications.email_tracking_associations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();


--
-- Name: email_tracking_associations communications_email_association_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_email_association_immutable BEFORE DELETE OR UPDATE ON communications.email_tracking_associations FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: email_tracking_associations communications_email_association_insert_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_email_association_insert_guard BEFORE INSERT ON communications.email_tracking_associations FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();


--
-- Name: events communications_event_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_event_immutable BEFORE DELETE OR UPDATE ON communications.events FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: connection_generations communications_generation_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_generation_immutable BEFORE DELETE OR UPDATE ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: identity_aliases communications_history_alias_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_history_alias_commit AFTER INSERT ON communications.identity_aliases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.namespace ~~ 'unipile.v1.history-peer.%'::text)) EXECUTE FUNCTION communications.history_refresh_commit_guard();


--
-- Name: event_cursors communications_history_coverage_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_history_coverage_commit AFTER INSERT OR UPDATE ON communications.event_cursors DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_coverage_commit_guard();


--
-- Name: history_initial_sync communications_history_initial_sync_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_history_initial_sync_guard BEFORE INSERT ON communications.history_initial_sync FOR EACH ROW EXECUTE FUNCTION communications.protect_history_initial_sync();


--
-- Name: history_refreshes communications_history_refresh_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_history_refresh_commit AFTER INSERT OR UPDATE ON communications.history_refreshes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_refresh_commit_guard();


--
-- Name: history_refreshes communications_history_refresh_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_history_refresh_guard BEFORE INSERT OR UPDATE ON communications.history_refreshes FOR EACH ROW EXECUTE FUNCTION communications.protect_history_refresh();


--
-- Name: history_initial_sync communications_history_sync_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_history_sync_commit AFTER INSERT ON communications.history_initial_sync DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_refresh_commit_guard();


--
-- Name: physical_accounts communications_identity_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_identity_guard BEFORE UPDATE ON communications.physical_accounts FOR EACH ROW EXECUTE FUNCTION communications.protect_physical_identity();


--
-- Name: account_leases communications_lease_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_lease_guard BEFORE UPDATE ON communications.account_leases FOR EACH ROW EXECUTE FUNCTION communications.protect_lease();


--
-- Name: operation_journal communications_operation_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_operation_guard BEFORE INSERT OR DELETE OR UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.protect_operation();


--
-- Name: provider_webhook_spool communications_provider_spool_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_provider_spool_guard BEFORE INSERT OR DELETE OR UPDATE ON communications.provider_webhook_spool FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_webhook_spool();


--
-- Name: webhook_receipt_routes communications_receipt_route_immutable; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_receipt_route_immutable BEFORE DELETE OR UPDATE ON communications.webhook_receipt_routes FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: webhook_receipt_routes communications_receipt_route_insert; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_receipt_route_insert BEFORE INSERT ON communications.webhook_receipt_routes FOR EACH ROW EXECUTE FUNCTION communications.route_webhook_receipt();


--
-- Name: tenant_reply_barriers communications_reply_barrier_delete_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_barrier_delete_guard BEFORE DELETE ON communications.tenant_reply_barriers FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: tenant_reply_barriers communications_reply_barrier_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_barrier_guard BEFORE UPDATE ON communications.tenant_reply_barriers FOR EACH ROW EXECUTE FUNCTION communications.protect_reply_barrier();


--
-- Name: webhook_inbox communications_reply_inbox_delete_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_inbox_delete_guard BEFORE DELETE ON communications.webhook_inbox FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: webhook_inbox communications_reply_inbox_fence; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_inbox_fence BEFORE UPDATE ON communications.webhook_inbox FOR EACH ROW EXECUTE FUNCTION communications.reply_inbox_barrier_change();


--
-- Name: event_outbox communications_reply_outbox_delete_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_outbox_delete_guard BEFORE DELETE ON communications.event_outbox FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: event_outbox communications_reply_outbox_fence; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_outbox_fence BEFORE INSERT OR UPDATE ON communications.event_outbox FOR EACH ROW EXECUTE FUNCTION communications.reply_outbox_barrier_change();


--
-- Name: reply_review_latches communications_reply_review_delete_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_review_delete_guard BEFORE DELETE ON communications.reply_review_latches FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: reply_review_latches communications_reply_review_fence; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_reply_review_fence BEFORE INSERT OR UPDATE ON communications.reply_review_latches FOR EACH ROW EXECUTE FUNCTION communications.reply_review_barrier_change();


--
-- Name: connection_retirements communications_retirement_apply; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retirement_apply AFTER INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.apply_retirement();


--
-- Name: connection_retirements communications_retirement_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_retirement_commit AFTER INSERT OR UPDATE ON communications.connection_retirements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_retirement_commit();


--
-- Name: connection_retirements communications_retirement_delete_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retirement_delete_guard BEFORE DELETE ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();


--
-- Name: connection_retirements communications_retirement_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retirement_guard BEFORE INSERT OR UPDATE ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.protect_retirement();


--
-- Name: identity_aliases communications_retiring_alias; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_alias BEFORE INSERT ON communications.identity_aliases FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_alias();


--
-- Name: auth_states communications_retiring_auth; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_auth BEFORE INSERT OR UPDATE ON communications.auth_states FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_auth();


--
-- Name: connections communications_retiring_connection; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_connection BEFORE INSERT OR UPDATE ON communications.connections FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_connection();


--
-- Name: event_cursors communications_retiring_cursor; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_cursor BEFORE INSERT OR UPDATE ON communications.event_cursors FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_cursor();


--
-- Name: connection_generations communications_retiring_generation; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_generation BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_generation();


--
-- Name: account_leases communications_retiring_lease; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_lease BEFORE INSERT OR UPDATE ON communications.account_leases FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();


--
-- Name: operation_journal communications_retiring_operation; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_operation BEFORE INSERT OR UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();


--
-- Name: quota_buckets communications_retiring_quota; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_retiring_quota BEFORE INSERT OR UPDATE ON communications.quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();


--
-- Name: connection_defaults communications_runtime_default_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_runtime_default_commit AFTER INSERT OR UPDATE ON communications.connection_defaults DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();


--
-- Name: connection_defaults communications_runtime_default_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_runtime_default_guard BEFORE INSERT OR DELETE OR UPDATE ON communications.connection_defaults FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();


--
-- Name: account_runtime_metadata communications_runtime_metadata_commit; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE CONSTRAINT TRIGGER communications_runtime_metadata_commit AFTER INSERT ON communications.account_runtime_metadata DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();


--
-- Name: account_runtime_metadata communications_runtime_metadata_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_runtime_metadata_guard BEFORE INSERT OR DELETE OR UPDATE ON communications.account_runtime_metadata FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();


--
-- Name: setup_notification_inbox communications_runtime_notification_guard; Type: TRIGGER; Schema: communications; Owner: communications_admin
--

CREATE TRIGGER communications_runtime_notification_guard BEFORE INSERT OR DELETE OR UPDATE ON communications.setup_notification_inbox FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();


--
-- Name: account_leases account_leases_account_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.account_leases
    ADD CONSTRAINT account_leases_account_id_fkey FOREIGN KEY (account_id) REFERENCES communications.physical_accounts(id);


--
-- Name: account_runtime_metadata account_runtime_metadata_connection_id_generation_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.account_runtime_metadata
    ADD CONSTRAINT account_runtime_metadata_connection_id_generation_fkey FOREIGN KEY (connection_id, generation) REFERENCES communications.connection_generations(connection_id, generation);


--
-- Name: auth_states auth_states_application_id_tenant_id_owner_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.auth_states
    ADD CONSTRAINT auth_states_application_id_tenant_id_owner_id_fkey FOREIGN KEY (application_id, tenant_id, owner_id) REFERENCES communications.access_grants(application_id, tenant_id, owner_id);


--
-- Name: auth_states auth_states_reconnect_connection_id_reconnect_generation_a_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.auth_states
    ADD CONSTRAINT auth_states_reconnect_connection_id_reconnect_generation_a_fkey FOREIGN KEY (reconnect_connection_id, reconnect_generation, application_id, tenant_id, owner_id, channel, platform, backend) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, channel, platform, backend);


--
-- Name: connections communications_current_generation_fk; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connections
    ADD CONSTRAINT communications_current_generation_fk FOREIGN KEY (id, current_generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: connection_defaults connection_defaults_application_id_tenant_id_owner_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_defaults
    ADD CONSTRAINT connection_defaults_application_id_tenant_id_owner_id_fkey FOREIGN KEY (application_id, tenant_id, owner_id) REFERENCES communications.access_grants(application_id, tenant_id, owner_id);


--
-- Name: connection_defaults connection_defaults_connection_id_generation_application_i_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_defaults
    ADD CONSTRAINT connection_defaults_connection_id_generation_application_i_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id);


--
-- Name: connection_generations connection_generations_account_id_channel_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_generations
    ADD CONSTRAINT connection_generations_account_id_channel_fkey FOREIGN KEY (account_id, channel) REFERENCES communications.physical_accounts(id, channel);


--
-- Name: connection_generations connection_generations_connection_id_application_id_tenant_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_generations
    ADD CONSTRAINT connection_generations_connection_id_application_id_tenant_fkey FOREIGN KEY (connection_id, application_id, tenant_id, owner_id, channel, platform, backend) REFERENCES communications.connections(id, application_id, tenant_id, owner_id, channel, platform, backend);


--
-- Name: connection_retirements connection_retirements_connection_id_generation_applicati_fkey1; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_retirements
    ADD CONSTRAINT connection_retirements_connection_id_generation_applicati_fkey1 FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, channel, platform, backend) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, channel, platform, backend);


--
-- Name: connection_retirements connection_retirements_connection_id_generation_applicatio_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connection_retirements
    ADD CONSTRAINT connection_retirements_connection_id_generation_applicatio_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: connections connections_account_id_channel_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connections
    ADD CONSTRAINT connections_account_id_channel_fkey FOREIGN KEY (account_id, channel) REFERENCES communications.physical_accounts(id, channel);


--
-- Name: connections connections_application_id_tenant_id_owner_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.connections
    ADD CONSTRAINT connections_application_id_tenant_id_owner_id_fkey FOREIGN KEY (application_id, tenant_id, owner_id) REFERENCES communications.access_grants(application_id, tenant_id, owner_id);


--
-- Name: dispatch_admissions dispatch_admissions_connection_id_generation_application_i_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.dispatch_admissions
    ADD CONSTRAINT dispatch_admissions_connection_id_generation_application_i_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: dispatch_admissions dispatch_admissions_journal_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.dispatch_admissions
    ADD CONSTRAINT dispatch_admissions_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES communications.operation_journal(id);


--
-- Name: email_tracking_acknowledgements email_tracking_acknowledgements_journal_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.email_tracking_acknowledgements
    ADD CONSTRAINT email_tracking_acknowledgements_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES communications.operation_journal(id);


--
-- Name: email_tracking_associations email_tracking_associations_acknowledgement_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.email_tracking_associations
    ADD CONSTRAINT email_tracking_associations_acknowledgement_id_fkey FOREIGN KEY (acknowledgement_id) REFERENCES communications.email_tracking_acknowledgements(id);


--
-- Name: event_cursors event_cursors_connection_id_generation_application_id_tena_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.event_cursors
    ADD CONSTRAINT event_cursors_connection_id_generation_application_id_tena_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: event_outbox event_outbox_event_id_application_id_tenant_id_owner_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.event_outbox
    ADD CONSTRAINT event_outbox_event_id_application_id_tenant_id_owner_id_fkey FOREIGN KEY (event_id, application_id, tenant_id, owner_id) REFERENCES communications.events(id, application_id, tenant_id, owner_id);


--
-- Name: events events_connection_id_generation_application_id_tenant_id_o_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.events
    ADD CONSTRAINT events_connection_id_generation_application_id_tenant_id_o_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: events events_webhook_inbox_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.events
    ADD CONSTRAINT events_webhook_inbox_id_fkey FOREIGN KEY (webhook_inbox_id) REFERENCES communications.webhook_inbox(id);


--
-- Name: history_initial_sync history_initial_sync_connection_id_generation_application__fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.history_initial_sync
    ADD CONSTRAINT history_initial_sync_connection_id_generation_application__fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: history_initial_sync history_initial_sync_webhook_inbox_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.history_initial_sync
    ADD CONSTRAINT history_initial_sync_webhook_inbox_id_fkey FOREIGN KEY (webhook_inbox_id) REFERENCES communications.webhook_receipt_routes(webhook_inbox_id);


--
-- Name: history_refreshes history_refreshes_connection_id_generation_application_id__fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.history_refreshes
    ADD CONSTRAINT history_refreshes_connection_id_generation_application_id__fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: identity_aliases identity_aliases_connection_id_generation_application_id_t_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.identity_aliases
    ADD CONSTRAINT identity_aliases_connection_id_generation_application_id_t_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: operation_journal operation_journal_connection_id_generation_application_id__fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.operation_journal
    ADD CONSTRAINT operation_journal_connection_id_generation_application_id__fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: provider_webhook_spool provider_webhook_spool_bound_connection_id_bound_generatio_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.provider_webhook_spool
    ADD CONSTRAINT provider_webhook_spool_bound_connection_id_bound_generatio_fkey FOREIGN KEY (bound_connection_id, bound_generation) REFERENCES communications.connection_generations(connection_id, generation);


--
-- Name: provider_webhook_spool provider_webhook_spool_scoped_receipt_key_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.provider_webhook_spool
    ADD CONSTRAINT provider_webhook_spool_scoped_receipt_key_fkey FOREIGN KEY (scoped_receipt_key) REFERENCES communications.webhook_inbox(id);


--
-- Name: quota_buckets quota_buckets_account_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.quota_buckets
    ADD CONSTRAINT quota_buckets_account_id_fkey FOREIGN KEY (account_id) REFERENCES communications.physical_accounts(id);


--
-- Name: reply_review_latches reply_review_latches_event_id_application_id_tenant_id_own_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.reply_review_latches
    ADD CONSTRAINT reply_review_latches_event_id_application_id_tenant_id_own_fkey FOREIGN KEY (event_id, application_id, tenant_id, owner_id) REFERENCES communications.events(id, application_id, tenant_id, owner_id);


--
-- Name: setup_notification_inbox setup_notification_inbox_state_digest_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.setup_notification_inbox
    ADD CONSTRAINT setup_notification_inbox_state_digest_fkey FOREIGN KEY (state_digest) REFERENCES communications.auth_states(state_digest);


--
-- Name: webhook_receipt_routes webhook_receipt_routes_application_id_tenant_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.webhook_receipt_routes
    ADD CONSTRAINT webhook_receipt_routes_application_id_tenant_id_fkey FOREIGN KEY (application_id, tenant_id) REFERENCES communications.tenant_reply_barriers(application_id, tenant_id);


--
-- Name: webhook_receipt_routes webhook_receipt_routes_connection_id_generation_applicatio_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.webhook_receipt_routes
    ADD CONSTRAINT webhook_receipt_routes_connection_id_generation_applicatio_fkey FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id) REFERENCES communications.connection_generations(connection_id, generation, application_id, tenant_id, owner_id, account_id);


--
-- Name: webhook_receipt_routes webhook_receipt_routes_webhook_inbox_id_fkey; Type: FK CONSTRAINT; Schema: communications; Owner: communications_admin
--

ALTER TABLE ONLY communications.webhook_receipt_routes
    ADD CONSTRAINT webhook_receipt_routes_webhook_inbox_id_fkey FOREIGN KEY (webhook_inbox_id) REFERENCES communications.webhook_inbox(id);


--
-- Name: access_grants; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.access_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: account_leases; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.account_leases ENABLE ROW LEVEL SECURITY;

--
-- Name: account_leases account_leases_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY account_leases_control ON communications.account_leases TO communications_control USING (true) WITH CHECK (true);


--
-- Name: account_runtime_metadata account_runtime_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY account_runtime_control ON communications.account_runtime_metadata TO communications_control USING (true) WITH CHECK (true);


--
-- Name: account_runtime_metadata; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.account_runtime_metadata ENABLE ROW LEVEL SECURITY;

--
-- Name: account_runtime_metadata account_runtime_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY account_runtime_scope ON communications.account_runtime_metadata FOR SELECT TO communications_scoped USING ((EXISTS ( SELECT 1
   FROM communications.connection_generations g
  WHERE ((g.connection_id = account_runtime_metadata.connection_id) AND (g.generation = account_runtime_metadata.generation) AND communications.scope_authorized(g.application_id, g.tenant_id, g.owner_id)))));


--
-- Name: application_quota_buckets; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.application_quota_buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_states; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.auth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_states auth_states_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY auth_states_control ON communications.auth_states TO communications_control USING (true) WITH CHECK (true);


--
-- Name: auth_states auth_states_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY auth_states_scope ON communications.auth_states TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: dispatch_admissions communications_admissions_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_admissions_control ON communications.dispatch_admissions TO communications_control USING (true) WITH CHECK (true);


--
-- Name: dispatch_admissions communications_admissions_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_admissions_scope ON communications.dispatch_admissions FOR SELECT TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: application_quota_buckets communications_app_quota_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_app_quota_control ON communications.application_quota_buckets TO communications_control USING (true) WITH CHECK (true);


--
-- Name: email_tracking_acknowledgements communications_email_ack_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_email_ack_control ON communications.email_tracking_acknowledgements TO communications_control USING (true) WITH CHECK (true);


--
-- Name: email_tracking_acknowledgements communications_email_ack_scoped_read; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_email_ack_scoped_read ON communications.email_tracking_acknowledgements FOR SELECT TO communications_scoped USING ((EXISTS ( SELECT 1
   FROM communications.operation_journal j
  WHERE ((j.id = email_tracking_acknowledgements.journal_id) AND communications.scope_authorized(j.application_id, j.tenant_id, j.owner_id)))));


--
-- Name: email_tracking_associations communications_email_association_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_email_association_control ON communications.email_tracking_associations TO communications_control USING (true) WITH CHECK (true);


--
-- Name: email_tracking_associations communications_email_association_scoped_read; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_email_association_scoped_read ON communications.email_tracking_associations FOR SELECT TO communications_scoped USING ((EXISTS ( SELECT 1
   FROM (communications.email_tracking_acknowledgements a
     JOIN communications.operation_journal j ON ((j.id = a.journal_id)))
  WHERE ((a.id = email_tracking_associations.acknowledgement_id) AND communications.scope_authorized(j.application_id, j.tenant_id, j.owner_id)))));


--
-- Name: access_grants communications_grant_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_grant_control ON communications.access_grants TO communications_control USING (true) WITH CHECK (true);


--
-- Name: access_grants communications_grant_self; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_grant_self ON communications.access_grants FOR SELECT TO communications_scoped USING (((application_id = current_setting('communications.application_id'::text, true)) AND (tenant_id = current_setting('communications.tenant_id'::text, true)) AND (owner_id = current_setting('communications.owner_id'::text, true)) AND (revoked_at IS NULL) AND (expires_at > statement_timestamp())));


--
-- Name: webhook_receipt_routes communications_receipt_route_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_receipt_route_control ON communications.webhook_receipt_routes TO communications_control USING (true) WITH CHECK (true);


--
-- Name: reply_review_latches communications_review_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_review_control ON communications.reply_review_latches TO communications_control USING (true) WITH CHECK (true);


--
-- Name: reply_review_latches communications_review_scope_read; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_review_scope_read ON communications.reply_review_latches FOR SELECT TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: tenant_reply_barriers communications_tenant_barrier_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_tenant_barrier_control ON communications.tenant_reply_barriers TO communications_control USING (true) WITH CHECK (true);


--
-- Name: tenant_reply_barriers communications_tenant_barrier_scope_read; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY communications_tenant_barrier_scope_read ON communications.tenant_reply_barriers FOR SELECT TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, current_setting('communications.owner_id'::text, true)));


--
-- Name: connection_defaults; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.connection_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: connection_defaults connection_defaults_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connection_defaults_control ON communications.connection_defaults TO communications_control USING (true) WITH CHECK (true);


--
-- Name: connection_defaults connection_defaults_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connection_defaults_scope ON communications.connection_defaults FOR SELECT TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: connection_generations; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.connection_generations ENABLE ROW LEVEL SECURITY;

--
-- Name: connection_generations connection_generations_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connection_generations_control ON communications.connection_generations TO communications_control USING (true) WITH CHECK (true);


--
-- Name: connection_generations connection_generations_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connection_generations_scope ON communications.connection_generations TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: connection_retirements; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.connection_retirements ENABLE ROW LEVEL SECURITY;

--
-- Name: connection_retirements connection_retirements_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connection_retirements_control ON communications.connection_retirements TO communications_control USING (true) WITH CHECK (true);


--
-- Name: connection_retirements connection_retirements_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connection_retirements_scope ON communications.connection_retirements FOR SELECT TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: connections; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.connections ENABLE ROW LEVEL SECURITY;

--
-- Name: connections connections_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connections_control ON communications.connections TO communications_control USING (true) WITH CHECK (true);


--
-- Name: connections connections_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY connections_scope ON communications.connections TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: dispatch_admissions; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.dispatch_admissions ENABLE ROW LEVEL SECURITY;

--
-- Name: email_tracking_acknowledgements; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.email_tracking_acknowledgements ENABLE ROW LEVEL SECURITY;

--
-- Name: email_tracking_associations; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.email_tracking_associations ENABLE ROW LEVEL SECURITY;

--
-- Name: event_cursors; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.event_cursors ENABLE ROW LEVEL SECURITY;

--
-- Name: event_cursors event_cursors_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY event_cursors_control ON communications.event_cursors TO communications_control USING (true) WITH CHECK (true);


--
-- Name: event_cursors event_cursors_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY event_cursors_scope ON communications.event_cursors TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: event_outbox; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.event_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: event_outbox event_outbox_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY event_outbox_control ON communications.event_outbox TO communications_control USING (true) WITH CHECK (true);


--
-- Name: event_outbox event_outbox_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY event_outbox_scope ON communications.event_outbox TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: events; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY events_control ON communications.events TO communications_control USING (true) WITH CHECK (true);


--
-- Name: events events_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY events_scope ON communications.events TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: history_initial_sync; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.history_initial_sync ENABLE ROW LEVEL SECURITY;

--
-- Name: history_initial_sync history_initial_sync_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY history_initial_sync_control ON communications.history_initial_sync TO communications_control USING (true) WITH CHECK (true);


--
-- Name: history_initial_sync history_initial_sync_scoped; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY history_initial_sync_scoped ON communications.history_initial_sync TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: history_refreshes history_refresh_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY history_refresh_control ON communications.history_refreshes TO communications_control USING (true) WITH CHECK (true);


--
-- Name: history_refreshes history_refresh_scoped; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY history_refresh_scoped ON communications.history_refreshes TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: history_refreshes; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.history_refreshes ENABLE ROW LEVEL SECURITY;

--
-- Name: identity_aliases; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.identity_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: identity_aliases identity_aliases_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY identity_aliases_control ON communications.identity_aliases TO communications_control USING (true) WITH CHECK (true);


--
-- Name: identity_aliases identity_aliases_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY identity_aliases_scope ON communications.identity_aliases TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: operation_journal; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.operation_journal ENABLE ROW LEVEL SECURITY;

--
-- Name: operation_journal operation_journal_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY operation_journal_control ON communications.operation_journal TO communications_control USING (true) WITH CHECK (true);


--
-- Name: operation_journal operation_journal_scope; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY operation_journal_scope ON communications.operation_journal TO communications_scoped USING (communications.scope_authorized(application_id, tenant_id, owner_id)) WITH CHECK (communications.scope_authorized(application_id, tenant_id, owner_id));


--
-- Name: physical_accounts; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.physical_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: physical_accounts physical_accounts_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY physical_accounts_control ON communications.physical_accounts TO communications_control USING (true) WITH CHECK (true);


--
-- Name: provider_webhook_spool provider_webhook_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY provider_webhook_control ON communications.provider_webhook_spool TO communications_control USING (true) WITH CHECK (true);


--
-- Name: provider_webhook_spool; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.provider_webhook_spool ENABLE ROW LEVEL SECURITY;

--
-- Name: quota_buckets; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.quota_buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: quota_buckets quota_buckets_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY quota_buckets_control ON communications.quota_buckets TO communications_control USING (true) WITH CHECK (true);


--
-- Name: reply_review_latches; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.reply_review_latches ENABLE ROW LEVEL SECURITY;

--
-- Name: setup_notification_inbox setup_notification_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY setup_notification_control ON communications.setup_notification_inbox TO communications_control USING (true) WITH CHECK (true);


--
-- Name: setup_notification_inbox; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.setup_notification_inbox ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_reply_barriers; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.tenant_reply_barriers ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_inbox; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.webhook_inbox ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_inbox webhook_inbox_control; Type: POLICY; Schema: communications; Owner: communications_admin
--

CREATE POLICY webhook_inbox_control ON communications.webhook_inbox TO communications_control USING (true) WITH CHECK (true);


--
-- Name: webhook_receipt_routes; Type: ROW SECURITY; Schema: communications; Owner: communications_admin
--

ALTER TABLE communications.webhook_receipt_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA communications; Type: ACL; Schema: -; Owner: communications_admin
--

GRANT USAGE ON SCHEMA communications TO communications_scoped;
GRANT USAGE ON SCHEMA communications TO communications_control;


--
-- Name: FUNCTION advance_reply_barrier(app text, tenant text); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.advance_reply_barrier(app text, tenant text) FROM PUBLIC;
GRANT ALL ON FUNCTION communications.advance_reply_barrier(app text, tenant text) TO communications_control;


--
-- Name: FUNCTION apply_retirement(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.apply_retirement() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.apply_retirement() TO communications_control;


--
-- Name: FUNCTION assert_account_retirement_open(physical text); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.assert_account_retirement_open(physical text) FROM PUBLIC;
GRANT ALL ON FUNCTION communications.assert_account_retirement_open(physical text) TO communications_control;


--
-- Name: FUNCTION assert_dispatch_reply_barrier(app text, tenant text); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.assert_dispatch_reply_barrier(app text, tenant text) FROM PUBLIC;
GRANT ALL ON FUNCTION communications.assert_dispatch_reply_barrier(app text, tenant text) TO communications_control;


--
-- Name: FUNCTION guard_account_runtime(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_account_runtime() FROM PUBLIC;


--
-- Name: FUNCTION guard_dispatch_admission(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_dispatch_admission() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_dispatch_admission() TO communications_control;


--
-- Name: FUNCTION guard_email_tracking_insert(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_email_tracking_insert() FROM PUBLIC;


--
-- Name: FUNCTION guard_provider_spool_account_work(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_provider_spool_account_work() FROM PUBLIC;


--
-- Name: FUNCTION guard_provider_webhook_spool(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_provider_webhook_spool() FROM PUBLIC;


--
-- Name: FUNCTION guard_reply_dispatch(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_reply_dispatch() FROM PUBLIC;


--
-- Name: FUNCTION guard_retirement_commit(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retirement_commit() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retirement_commit() TO communications_control;


--
-- Name: FUNCTION guard_retiring_account_write(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retiring_account_write() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retiring_account_write() TO communications_control;


--
-- Name: FUNCTION guard_retiring_alias(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retiring_alias() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retiring_alias() TO communications_control;


--
-- Name: FUNCTION guard_retiring_auth(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retiring_auth() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retiring_auth() TO communications_control;


--
-- Name: FUNCTION guard_retiring_connection(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retiring_connection() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retiring_connection() TO communications_control;


--
-- Name: FUNCTION guard_retiring_cursor(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retiring_cursor() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retiring_cursor() TO communications_control;


--
-- Name: FUNCTION guard_retiring_generation(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.guard_retiring_generation() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.guard_retiring_generation() TO communications_control;


--
-- Name: FUNCTION history_coverage_commit_guard(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.history_coverage_commit_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.history_coverage_commit_guard() TO communications_control;


--
-- Name: FUNCTION history_refresh_commit_guard(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.history_refresh_commit_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.history_refresh_commit_guard() TO communications_control;


--
-- Name: FUNCTION lock_reply_barrier(app text, tenant text); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.lock_reply_barrier(app text, tenant text) FROM PUBLIC;
GRANT ALL ON FUNCTION communications.lock_reply_barrier(app text, tenant text) TO communications_control;


--
-- Name: FUNCTION protect_auth_state(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_auth_state() FROM PUBLIC;


--
-- Name: FUNCTION protect_connection(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_connection() FROM PUBLIC;


--
-- Name: FUNCTION protect_cursor(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_cursor() FROM PUBLIC;


--
-- Name: FUNCTION protect_history_initial_sync(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_history_initial_sync() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.protect_history_initial_sync() TO communications_control;


--
-- Name: FUNCTION protect_history_refresh(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_history_refresh() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.protect_history_refresh() TO communications_control;


--
-- Name: FUNCTION protect_lease(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_lease() FROM PUBLIC;


--
-- Name: FUNCTION protect_operation(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_operation() FROM PUBLIC;


--
-- Name: FUNCTION protect_physical_identity(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_physical_identity() FROM PUBLIC;


--
-- Name: FUNCTION protect_reply_barrier(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_reply_barrier() FROM PUBLIC;


--
-- Name: FUNCTION protect_retirement(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.protect_retirement() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.protect_retirement() TO communications_control;


--
-- Name: FUNCTION reject_mutation(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.reject_mutation() FROM PUBLIC;


--
-- Name: FUNCTION reply_inbox_barrier_change(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.reply_inbox_barrier_change() FROM PUBLIC;


--
-- Name: FUNCTION reply_outbox_barrier_change(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.reply_outbox_barrier_change() FROM PUBLIC;


--
-- Name: FUNCTION reply_review_barrier_change(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.reply_review_barrier_change() FROM PUBLIC;


--
-- Name: FUNCTION require_dispatch_admission(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.require_dispatch_admission() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.require_dispatch_admission() TO communications_control;


--
-- Name: FUNCTION rollup_application_quota(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.rollup_application_quota() FROM PUBLIC;
GRANT ALL ON FUNCTION communications.rollup_application_quota() TO communications_control;


--
-- Name: FUNCTION route_webhook_receipt(); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.route_webhook_receipt() FROM PUBLIC;


--
-- Name: FUNCTION scope_authorized(app text, tenant text, owner text); Type: ACL; Schema: communications; Owner: communications_admin
--

REVOKE ALL ON FUNCTION communications.scope_authorized(app text, tenant text, owner text) FROM PUBLIC;
GRANT ALL ON FUNCTION communications.scope_authorized(app text, tenant text, owner text) TO communications_scoped;


--
-- Name: TABLE access_grants; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT ON TABLE communications.access_grants TO communications_scoped;
GRANT SELECT,INSERT,UPDATE ON TABLE communications.access_grants TO communications_control;


--
-- Name: TABLE account_leases; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.account_leases TO communications_control;


--
-- Name: TABLE account_runtime_metadata; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT ON TABLE communications.account_runtime_metadata TO communications_control;
GRANT SELECT ON TABLE communications.account_runtime_metadata TO communications_scoped;


--
-- Name: TABLE application_quota_buckets; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.application_quota_buckets TO communications_control;


--
-- Name: TABLE auth_states; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.auth_states TO communications_control;
GRANT SELECT ON TABLE communications.auth_states TO communications_scoped;


--
-- Name: TABLE connection_defaults; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.connection_defaults TO communications_control;
GRANT SELECT ON TABLE communications.connection_defaults TO communications_scoped;


--
-- Name: TABLE connection_generations; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.connection_generations TO communications_control;
GRANT SELECT ON TABLE communications.connection_generations TO communications_scoped;


--
-- Name: TABLE connection_retirements; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.connection_retirements TO communications_control;
GRANT SELECT ON TABLE communications.connection_retirements TO communications_scoped;


--
-- Name: TABLE connections; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.connections TO communications_control;
GRANT SELECT ON TABLE communications.connections TO communications_scoped;


--
-- Name: TABLE dispatch_admissions; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT ON TABLE communications.dispatch_admissions TO communications_control;
GRANT SELECT ON TABLE communications.dispatch_admissions TO communications_scoped;


--
-- Name: TABLE email_tracking_acknowledgements; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT ON TABLE communications.email_tracking_acknowledgements TO communications_control;
GRANT SELECT ON TABLE communications.email_tracking_acknowledgements TO communications_scoped;


--
-- Name: TABLE email_tracking_associations; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT ON TABLE communications.email_tracking_associations TO communications_control;
GRANT SELECT ON TABLE communications.email_tracking_associations TO communications_scoped;


--
-- Name: TABLE event_cursors; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.event_cursors TO communications_control;
GRANT SELECT ON TABLE communications.event_cursors TO communications_scoped;


--
-- Name: TABLE event_outbox; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.event_outbox TO communications_control;
GRANT SELECT ON TABLE communications.event_outbox TO communications_scoped;


--
-- Name: TABLE events; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.events TO communications_control;
GRANT SELECT ON TABLE communications.events TO communications_scoped;


--
-- Name: SEQUENCE events_id_seq; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,USAGE ON SEQUENCE communications.events_id_seq TO communications_control;
GRANT SELECT,USAGE ON SEQUENCE communications.events_id_seq TO communications_scoped;


--
-- Name: TABLE history_initial_sync; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT ON TABLE communications.history_initial_sync TO communications_control;
GRANT SELECT ON TABLE communications.history_initial_sync TO communications_scoped;


--
-- Name: TABLE history_refreshes; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.history_refreshes TO communications_control;
GRANT SELECT ON TABLE communications.history_refreshes TO communications_scoped;


--
-- Name: TABLE identity_aliases; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.identity_aliases TO communications_control;
GRANT SELECT ON TABLE communications.identity_aliases TO communications_scoped;


--
-- Name: TABLE operation_journal; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.operation_journal TO communications_control;
GRANT SELECT ON TABLE communications.operation_journal TO communications_scoped;


--
-- Name: TABLE physical_accounts; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.physical_accounts TO communications_control;


--
-- Name: TABLE provider_webhook_spool; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.provider_webhook_spool TO communications_control;


--
-- Name: TABLE quota_buckets; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.quota_buckets TO communications_control;


--
-- Name: TABLE reply_review_latches; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.reply_review_latches TO communications_control;
GRANT SELECT ON TABLE communications.reply_review_latches TO communications_scoped;


--
-- Name: TABLE setup_notification_inbox; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.setup_notification_inbox TO communications_control;


--
-- Name: TABLE tenant_reply_barriers; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.tenant_reply_barriers TO communications_control;
GRANT SELECT ON TABLE communications.tenant_reply_barriers TO communications_scoped;


--
-- Name: TABLE webhook_inbox; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT,UPDATE ON TABLE communications.webhook_inbox TO communications_control;


--
-- Name: TABLE webhook_receipt_routes; Type: ACL; Schema: communications; Owner: communications_admin
--

GRANT SELECT,INSERT ON TABLE communications.webhook_receipt_routes TO communications_control;


--
-- PostgreSQL database dump complete
--


COMMIT;
