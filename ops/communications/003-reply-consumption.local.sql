-- PROVISIONAL REVIEW ARTIFACT. NOT APPROVED OR APPLIED. No startup invokes this file.
-- Exact target: OrbStack 127.0.0.1:5445/acquire_channels after exact 001/002 approval/application.
-- Local combined fixture only: service objects reference communications; app objects reference public.
-- No credentials, binding/default backfill, hold changes, live sends or activation are performed.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'acquire_channels' OR
     to_regclass('communications.webhook_inbox') IS NULL OR
     to_regclass('public.communication_event_receipts') IS NULL THEN
    RAISE EXCEPTION 'Requires exact approved local communications service and Acquire schemas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.communication_event_receipts) THEN
    RAISE EXCEPTION 'Populated receipts need a separately reviewed fingerprint backfill';
  END IF;
END $$;

-- Exact replay comparison, including sender/conversation/direction; never overwrite a receipt.
ALTER TABLE public.communication_event_receipts
  ADD COLUMN payload_fingerprint text NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD COLUMN fingerprint_version text NOT NULL CHECK (length(fingerprint_version) BETWEEN 1 AND 64);

-- Presence/revision alone is not readiness. This row serializes receipt capture,
-- event/outbox/review changes and new dispatch admission for ALL tenant channels/owners.
CREATE TABLE communications.tenant_reply_barriers (
  application_id text NOT NULL CHECK (length(application_id) BETWEEN 1 AND 200),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 200),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (application_id,tenant_id)
);
CREATE TABLE communications.webhook_receipt_routes (
  webhook_inbox_id text PRIMARY KEY REFERENCES communications.webhook_inbox,
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  connection_id text NOT NULL,
  generation integer NOT NULL,
  account_id text NOT NULL,
  capture_revision bigint NOT NULL CHECK (capture_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (connection_id,generation,application_id,tenant_id,owner_id,account_id)
    REFERENCES communications.connection_generations (connection_id,generation,application_id,tenant_id,owner_id,account_id),
  FOREIGN KEY (application_id,tenant_id) REFERENCES communications.tenant_reply_barriers
);
CREATE INDEX communications_receipt_route_tenant ON communications.webhook_receipt_routes (application_id,tenant_id,webhook_inbox_id);

-- Review details stay inside the authenticated encrypted service event. No person IDs.
CREATE TABLE communications.reply_review_latches (
  event_id bigint PRIMARY KEY,
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  code text NOT NULL CHECK (code IN ('protocol','account_changed','identity_pending','semantic_conflict','historical_binding')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolution_reference text CHECK (length(resolution_reference) BETWEEN 1 AND 2000),
  FOREIGN KEY (event_id,application_id,tenant_id,owner_id)
    REFERENCES communications.events (id,application_id,tenant_id,owner_id),
  CHECK ((resolved_at IS NULL) = (resolution_reference IS NULL)),
  CHECK (resolved_at IS NULL OR resolved_at >= created_at)
);
CREATE INDEX communications_review_tenant_open ON communications.reply_review_latches (application_id,tenant_id) WHERE resolved_at IS NULL;

CREATE TABLE public.communication_consumer_checkpoints (
  binding_id uuid NOT NULL,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  subscriber_id text NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 200),
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
  encrypted_cursor text CHECK (length(encrypted_cursor) > 0),
  cursor_key_version text CHECK (length(cursor_key_version) BETWEEN 1 AND 200),
  -- Observed service snapshot only, NOT a proof all lower global event IDs committed/applied.
  observed_service_revision bigint NOT NULL DEFAULT 0 CHECK (observed_service_revision >= 0),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (binding_id,subscriber_id,scope_digest),
  FOREIGN KEY (binding_id,organization_id,owner_user_id)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id),
  CHECK ((encrypted_cursor IS NULL) = (cursor_key_version IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (updated_at >= created_at)
);
CREATE TABLE public.communication_reply_review_latches (
  binding_id uuid NOT NULL,
  service_event_id text NOT NULL,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL,
  code text NOT NULL CHECK (code IN ('protocol','account_changed','identity_pending','semantic_conflict','historical_binding')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolution_reference text CHECK (length(resolution_reference) BETWEEN 1 AND 2000),
  PRIMARY KEY (binding_id,service_event_id),
  FOREIGN KEY (binding_id,service_event_id)
    REFERENCES public.communication_event_receipts (binding_id,service_event_id),
  FOREIGN KEY (binding_id,organization_id,owner_user_id)
    REFERENCES public.communication_bindings (id,organization_id,owner_user_id),
  CHECK ((resolved_at IS NULL) = (resolution_reference IS NULL)),
  CHECK (resolved_at IS NULL OR resolved_at >= created_at)
);
CREATE INDEX communication_review_org_open ON public.communication_reply_review_latches (organization_id) WHERE resolved_at IS NULL;

-- Control repositories MUST acquire this mutex BEFORE connection/account/grant/inbox locks.
-- Repositories authenticate scope first; this function never authorizes supplied application IDs.
CREATE FUNCTION communications.lock_reply_barrier(app text, tenant text) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, communications AS $$
DECLARE current_revision bigint;
BEGIN
  INSERT INTO communications.tenant_reply_barriers (application_id,tenant_id) VALUES (app,tenant) ON CONFLICT DO NOTHING;
  SELECT revision INTO STRICT current_revision FROM communications.tenant_reply_barriers
    WHERE application_id=app AND tenant_id=tenant FOR UPDATE;
  RETURN current_revision;
END $$;
CREATE FUNCTION communications.advance_reply_barrier(app text, tenant text) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, communications AS $$
DECLARE next_revision bigint;
BEGIN
  PERFORM communications.lock_reply_barrier(app,tenant);
  UPDATE communications.tenant_reply_barriers SET revision=revision+1,updated_at=clock_timestamp()
    WHERE application_id=app AND tenant_id=tenant RETURNING revision INTO next_revision;
  RETURN next_revision;
END $$;
CREATE FUNCTION communications.protect_reply_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.application_id,NEW.tenant_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.application_id,OLD.tenant_id,OLD.created_at)
     OR NEW.revision <> OLD.revision+1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Reply barrier identity is immutable and revisions advance one step';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_reply_barrier_guard BEFORE UPDATE ON communications.tenant_reply_barriers
  FOR EACH ROW EXECUTE FUNCTION communications.protect_reply_barrier();
CREATE TRIGGER communications_reply_barrier_delete_guard BEFORE DELETE ON communications.tenant_reply_barriers
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
CREATE FUNCTION communications.route_webhook_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_receipt_route_insert BEFORE INSERT ON communications.webhook_receipt_routes
  FOR EACH ROW EXECUTE FUNCTION communications.route_webhook_receipt();
CREATE TRIGGER communications_receipt_route_immutable BEFORE UPDATE OR DELETE ON communications.webhook_receipt_routes
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();

CREATE FUNCTION communications.reply_inbox_barrier_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_reply_inbox_fence BEFORE UPDATE ON communications.webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION communications.reply_inbox_barrier_change();
CREATE TRIGGER communications_reply_inbox_delete_guard BEFORE DELETE ON communications.webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();

CREATE FUNCTION communications.reply_outbox_barrier_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_reply_outbox_fence BEFORE INSERT OR UPDATE ON communications.event_outbox
  FOR EACH ROW EXECUTE FUNCTION communications.reply_outbox_barrier_change();
CREATE TRIGGER communications_reply_outbox_delete_guard BEFORE DELETE ON communications.event_outbox
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
CREATE FUNCTION communications.reply_review_barrier_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_reply_review_fence BEFORE INSERT OR UPDATE ON communications.reply_review_latches
  FOR EACH ROW EXECUTE FUNCTION communications.reply_review_barrier_change();
CREATE TRIGGER communications_reply_review_delete_guard BEFORE DELETE ON communications.reply_review_latches
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();

-- This is a necessary pending-work gate; exact monitor coverage/member/approval checks remain separate.
-- Missing barrier is blocked. All owners/channels/subscribers within the tenant are considered.
CREATE FUNCTION communications.assert_dispatch_reply_barrier(app text, tenant text) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, communications AS $$
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
CREATE FUNCTION communications.guard_reply_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.state='claimed' AND NEW.state='dispatching' THEN
    PERFORM communications.assert_dispatch_reply_barrier(NEW.application_id,NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
-- Alphabetical order puts the tenant fence before the existing connection/account admission guard.
CREATE TRIGGER communications_00_reply_dispatch_guard BEFORE UPDATE ON communications.operation_journal
  FOR EACH ROW EXECUTE FUNCTION communications.guard_reply_dispatch();

-- Narrow authority lock for the authenticated owner transaction. No table UPDATE grant is added.
-- SECURITY DEFINER permits only the exact trusted actor GUCs and acquire_campaign_user role;
-- the fully-qualified membership row stays SHARE-locked against revocation until transaction end.
CREATE FUNCTION public.communications_lock_reply_member(org text, actor text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE allowed boolean;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'acquire_campaign_user'
     OR org IS DISTINCT FROM current_setting('app.acquire_org',true)
     OR actor IS DISTINCT FROM current_setting('app.acquire_user',true) THEN
    RAISE EXCEPTION 'Authenticated owner scope is required';
  END IF;
  SELECT true INTO allowed FROM public.member m WHERE m.organization_id=org AND m.user_id=actor FOR SHARE;
  RETURN COALESCE(allowed,false);
END $$;
REVOKE ALL ON FUNCTION public.communications_lock_reply_member(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communications_lock_reply_member(text,text) TO acquire_campaign_user;

CREATE FUNCTION public.communications_checkpoint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.binding_id,NEW.organization_id,NEW.owner_user_id,NEW.subscriber_id,NEW.scope_digest,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.binding_id,OLD.organization_id,OLD.owner_user_id,OLD.subscriber_id,OLD.scope_digest,OLD.created_at)
     OR NEW.observed_service_revision < OLD.observed_service_revision OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Consumer scope is immutable and observed revisions cannot regress';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_checkpoint_scope_guard BEFORE UPDATE ON public.communication_consumer_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.communications_checkpoint_guard();
CREATE TRIGGER communications_checkpoint_delete_guard BEFORE DELETE ON public.communication_consumer_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();
CREATE FUNCTION public.communications_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.resolved_at IS NOT NULL OR NEW.resolution_reference IS NOT NULL THEN
      RAISE EXCEPTION 'A new application review must start unresolved';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.binding_id,NEW.service_event_id,NEW.organization_id,NEW.owner_user_id,NEW.code,NEW.created_at)
       IS DISTINCT FROM ROW(OLD.binding_id,OLD.service_event_id,OLD.organization_id,OLD.owner_user_id,OLD.code,OLD.created_at)
     OR (OLD.resolved_at IS NOT NULL AND ROW(NEW.resolved_at,NEW.resolution_reference)
       IS DISTINCT FROM ROW(OLD.resolved_at,OLD.resolution_reference)) THEN
    RAISE EXCEPTION 'Application review provenance and resolution are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_app_review_guard BEFORE INSERT OR UPDATE ON public.communication_reply_review_latches
  FOR EACH ROW EXECUTE FUNCTION public.communications_review_guard();
CREATE TRIGGER communications_app_review_delete_guard BEFORE DELETE ON public.communication_reply_review_latches
  FOR EACH ROW EXECUTE FUNCTION public.communications_binding_immutable();

REVOKE ALL ON FUNCTION communications.lock_reply_barrier(text,text),communications.advance_reply_barrier(text,text),
 communications.protect_reply_barrier(),communications.route_webhook_receipt(),communications.reply_inbox_barrier_change(),communications.reply_outbox_barrier_change(),
 communications.reply_review_barrier_change(),communications.assert_dispatch_reply_barrier(text,text),communications.guard_reply_dispatch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.lock_reply_barrier(text,text),communications.advance_reply_barrier(text,text),
 communications.assert_dispatch_reply_barrier(text,text) TO communications_control;
REVOKE ALL ON FUNCTION public.communications_checkpoint_guard(),public.communications_review_guard() FROM PUBLIC;

ALTER TABLE communications.tenant_reply_barriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.tenant_reply_barriers FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_tenant_barrier_control ON communications.tenant_reply_barriers TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY communications_tenant_barrier_scope_read ON communications.tenant_reply_barriers FOR SELECT TO communications_scoped
 USING (communications.scope_authorized(application_id,tenant_id,current_setting('communications.owner_id',true)));
GRANT SELECT,INSERT,UPDATE ON communications.tenant_reply_barriers TO communications_control;
GRANT SELECT ON communications.tenant_reply_barriers TO communications_scoped;
ALTER TABLE communications.webhook_receipt_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.webhook_receipt_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_receipt_route_control ON communications.webhook_receipt_routes TO communications_control USING (true) WITH CHECK (true);
GRANT SELECT,INSERT ON communications.webhook_receipt_routes TO communications_control;
ALTER TABLE communications.reply_review_latches ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.reply_review_latches FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_review_control ON communications.reply_review_latches TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY communications_review_scope_read ON communications.reply_review_latches FOR SELECT TO communications_scoped
 USING (communications.scope_authorized(application_id,tenant_id,owner_id));
-- Subscriber ACK mutations now require the authenticated/fenced control repository.
REVOKE INSERT,UPDATE ON communications.event_outbox FROM communications_scoped;
-- Normalization must append events and required outbox/reviews atomically in the control repository.
REVOKE INSERT ON communications.events FROM communications_scoped;
GRANT SELECT,INSERT,UPDATE ON communications.reply_review_latches TO communications_control;
GRANT SELECT ON communications.reply_review_latches TO communications_scoped;

ALTER TABLE public.communication_consumer_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_consumer_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_consumer_checkpoints_user ON public.communication_consumer_checkpoints TO acquire_campaign_user
 USING (organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
   AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id=communication_consumer_checkpoints.organization_id AND m.user_id=communication_consumer_checkpoints.owner_user_id))
 WITH CHECK (organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
   AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id=communication_consumer_checkpoints.organization_id AND m.user_id=communication_consumer_checkpoints.owner_user_id));
CREATE POLICY communication_consumer_checkpoints_worker_read ON public.communication_consumer_checkpoints FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT,INSERT,UPDATE ON public.communication_consumer_checkpoints TO acquire_campaign_user;
GRANT SELECT ON public.communication_consumer_checkpoints TO acquire_campaign_worker;
ALTER TABLE public.communication_reply_review_latches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_reply_review_latches FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_reply_review_latches_user ON public.communication_reply_review_latches TO acquire_campaign_user
 USING (organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
   AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id=communication_reply_review_latches.organization_id AND m.user_id=communication_reply_review_latches.owner_user_id))
 WITH CHECK (organization_id=current_setting('app.acquire_org',true) AND owner_user_id=current_setting('app.acquire_user',true)
   AND EXISTS (SELECT 1 FROM public.member m WHERE m.organization_id=communication_reply_review_latches.organization_id AND m.user_id=communication_reply_review_latches.owner_user_id));
CREATE POLICY communication_reply_review_latches_worker_read ON public.communication_reply_review_latches FOR SELECT TO acquire_campaign_worker USING (true);
GRANT SELECT,INSERT,UPDATE ON public.communication_reply_review_latches TO acquire_campaign_user;
GRANT SELECT ON public.communication_reply_review_latches TO acquire_campaign_worker;
-- No DELETE grants, automatic grants/backfill, live account changes, or hold clearing.
COMMIT;
