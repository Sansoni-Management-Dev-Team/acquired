-- Isolated local agent-build service storage, under standing user authority.
-- Exact target127.0.0.1:5437/acquire_agent_mode, marker acquire-agent-mode-local-only.
-- Service-only reviewed standalone001–008 bodies remain byte-for-byte intact
-- after their original fixture guards (outer transaction wrappers removed).
-- Public application schema is preserved; no provider accounts, credentials,
-- owner grants, defaults, send capacity or external action are provisioned.
DO $$ BEGIN
 IF current_database()<>'acquire_agent_mode' OR current_user<>'project_acquire' OR
 (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only' THEN RAISE EXCEPTION 'Exact isolated agent database required'; END IF;
 IF to_regnamespace('communications') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('communications_control','communications_scoped')) THEN RAISE EXCEPTION 'Service namespace and roles must be absent'; END IF;
 IF to_regclass('public.agent_conversations') IS NULL OR to_regclass('public.communication_bindings') IS NULL THEN RAISE EXCEPTION 'Existing approved native application schema required'; END IF;
END $$;

-- Reviewed source ops/communications/standalone/001-service-storage.local.sql

CREATE SCHEMA communications;
REVOKE ALL ON SCHEMA communications FROM PUBLIC;
CREATE ROLE communications_scoped NOLOGIN NOBYPASSRLS;
CREATE ROLE communications_control NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA communications TO communications_scoped, communications_control;

CREATE TABLE communications.access_grants (
  application_id text NOT NULL CHECK (length(application_id) BETWEEN 1 AND 200),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 200),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (application_id, tenant_id, owner_id)
);

-- Identity is HMAC(normalized physical identity) with a stable service key.
-- A provisional legacy record has NULL identity fields and cannot activate.
-- Namespace unifies email platforms/backends, e.g. mailbox_address, E164,
-- LinkedIn member ID. Backend provider account ID is NOT a physical identity.
CREATE TABLE communications.physical_accounts (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','linkedin')),
  identity_namespace text,
  identity_digest text CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
  identity_key_version text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, channel),
  UNIQUE (identity_namespace, identity_digest),
  CHECK ((identity_namespace IS NULL AND identity_digest IS NULL AND identity_key_version IS NULL AND verified_at IS NULL)
      OR (identity_namespace IS NOT NULL AND length(identity_namespace) > 0 AND identity_digest IS NOT NULL AND identity_key_version IS NOT NULL AND length(identity_key_version) > 0 AND verified_at IS NOT NULL))
);

CREATE TABLE communications.connections (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  account_id text NOT NULL,
  channel text NOT NULL,
  platform text NOT NULL,
  backend text NOT NULL CHECK (backend IN ('direct','baileys','browser','unipile')),
  current_generation integer NOT NULL CHECK (current_generation > 0),
  status text NOT NULL CHECK (status IN ('connecting','connected','syncing','verification_required','disconnected','failed')),
  status_observed_at timestamptz,
  -- Reserved ownership remains active even when disconnected. Retirement is
  -- explicit, and blocked while any operation may still have been accepted.
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (application_id, tenant_id, owner_id) REFERENCES communications.access_grants,
  FOREIGN KEY (account_id, channel) REFERENCES communications.physical_accounts (id, channel),
  UNIQUE (id, application_id, tenant_id, owner_id, channel, platform, backend),
  CHECK ((channel = 'email' AND platform IN ('gmail','outlook','imap') AND backend IN ('direct','unipile'))
      OR (channel = 'whatsapp' AND platform = 'whatsapp' AND backend IN ('baileys','unipile'))
      OR (channel = 'linkedin' AND platform = 'linkedin' AND backend IN ('browser','unipile')))
);
-- Initial rollout rejects simultaneous bindings across tenants and backends.
CREATE UNIQUE INDEX communications_one_active_account ON communications.connections (account_id) WHERE active;

CREATE TABLE communications.connection_generations (
  connection_id text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  account_id text NOT NULL,
  channel text NOT NULL,
  platform text NOT NULL,
  backend text NOT NULL,
  integration_id text NOT NULL CHECK (length(integration_id) > 0),
  -- Explicit version plus an immutable, versioned vault/settings snapshot.
  -- The reference resolves endpoint/verified source/product configuration;
  -- neither this row nor its reference contains raw credentials or URLs.
  provider_api_version text CHECK (provider_api_version IN ('v1','v2')),
  provider_configuration_reference text CHECK (length(provider_configuration_reference) BETWEEN 1 AND 2000),
  provider_account_digest text CHECK (provider_account_digest ~ '^[0-9a-f]{64}$'),
  encrypted_provider_account_id text CHECK (length(encrypted_provider_account_id) > 0),
  provider_account_key_version text CHECK (length(provider_account_key_version) BETWEEN 1 AND 200),
  -- Opaque credential-store or legacy-port references, never credential values.
  credential_reference text CHECK (length(credential_reference) BETWEEN 1 AND 2000),
  authority text NOT NULL CHECK (authority IN ('legacy_port','service')),
  capabilities jsonb NOT NULL CHECK (jsonb_typeof(capabilities) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, generation),
  UNIQUE (connection_id, generation, application_id, tenant_id, owner_id, account_id),
  UNIQUE (connection_id, generation, application_id, tenant_id, owner_id),
  UNIQUE (connection_id, generation, application_id, tenant_id, owner_id, channel, platform, backend),
  FOREIGN KEY (connection_id, application_id, tenant_id, owner_id, channel, platform, backend)
    REFERENCES communications.connections (id, application_id, tenant_id, owner_id, channel, platform, backend),
  CHECK ((provider_account_digest IS NULL AND encrypted_provider_account_id IS NULL AND provider_account_key_version IS NULL)
      OR (provider_account_digest IS NOT NULL AND encrypted_provider_account_id IS NOT NULL AND provider_account_key_version IS NOT NULL)),
  CHECK ((backend = 'unipile' AND provider_api_version IS NOT NULL AND provider_configuration_reference IS NOT NULL)
      OR (backend <> 'unipile' AND provider_api_version IS NULL AND provider_configuration_reference IS NULL)),
  FOREIGN KEY (account_id, channel) REFERENCES communications.physical_accounts (id, channel)
);
ALTER TABLE communications.connections ADD CONSTRAINT communications_current_generation_fk
  FOREIGN KEY (id, current_generation, application_id, tenant_id, owner_id, account_id)
  REFERENCES communications.connection_generations (connection_id, generation, application_id, tenant_id, owner_id, account_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE communications.operation_journal (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  connection_id text NOT NULL,
  generation integer NOT NULL,
  account_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('message','invitation','draft_create','draft_update','draft_delete')),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  recipient_digest text NOT NULL CHECK (recipient_digest ~ '^[0-9a-f]{64}$'),
  digest_version text NOT NULL CHECK (length(digest_version) > 0),
  recipient_key_version text NOT NULL CHECK (length(recipient_key_version) > 0),
  -- Versioned encrypted claim-time recipient/RFC/chat/provider correlation.
  -- No message body. The digest is keyed; codecs must bind the exact snapshot.
  -- Unknown result IDs are not later injected into this immutable context.
  encrypted_operation_context text NOT NULL CHECK (length(encrypted_operation_context) > 0),
  operation_context_key_version text NOT NULL CHECK (length(operation_context_key_version) BETWEEN 1 AND 200),
  operation_context_digest text NOT NULL CHECK (operation_context_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','dispatching','submitted','unknown','blocked','rejected','skipped')),
  claim_token text NOT NULL,
  claim_until timestamptz NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  lease_owner_token text NOT NULL,
  quota_reserved boolean NOT NULL DEFAULT false,
  encrypted_receipt text,
  receipt_key_version text,
  -- Preserve the complete typed waiting/review/rejected/skipped outcome for
  -- replay. Machine status is safe metadata; all payload/reason remains encrypted.
  outcome_status text CHECK (outcome_status IN ('waiting','review','rejected','skipped')),
  encrypted_outcome text CHECK (length(encrypted_outcome) > 0),
  outcome_key_version text CHECK (length(outcome_key_version) BETWEEN 1 AND 200),
  resolution_evidence_digest text CHECK (resolution_evidence_digest ~ '^[0-9a-f]{64}$'),
  failure_code text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, tenant_id, owner_id, operation_key),
  FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id)
    REFERENCES communications.connection_generations (connection_id, generation, application_id, tenant_id, owner_id, account_id),
  CHECK ((state = 'submitted' AND encrypted_receipt IS NOT NULL AND receipt_key_version IS NOT NULL)
      OR (state <> 'submitted' AND encrypted_receipt IS NULL AND receipt_key_version IS NULL)),
  CHECK ((state IN ('blocked','rejected','skipped') AND outcome_status IS NOT NULL
        AND encrypted_outcome IS NOT NULL AND outcome_key_version IS NOT NULL
        AND ((state = 'blocked' AND outcome_status IN ('waiting','review'))
          OR (state = 'rejected' AND outcome_status = 'rejected')
          OR (state = 'skipped' AND outcome_status = 'skipped')))
      OR (state NOT IN ('blocked','rejected','skipped') AND outcome_status IS NULL
        AND encrypted_outcome IS NULL AND outcome_key_version IS NULL)),
  CHECK (state NOT IN ('dispatching','submitted') OR quota_reserved),
  CHECK (submitted_at IS NULL OR state = 'submitted'),
  CHECK (delivered_at IS NULL OR state = 'submitted'),
  CHECK (read_at IS NULL OR state = 'submitted')
);
CREATE INDEX communications_operation_account_pending ON communications.operation_journal (account_id, state, claimed_at);

-- One renewable/fenced worker ownership per physical account across adapters.
CREATE TABLE communications.account_leases (
  account_id text PRIMARY KEY REFERENCES communications.physical_accounts,
  owner_token text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  expires_at timestamptz NOT NULL
);
-- Account/app quota rows are charged only by the fenced dispatch-admission TX,
-- after claim and provider preflight; never by claim or historical replay.
-- bucket_kind='account' uses empty application_id; app windows use its ID.
-- Neither backend nor connection ID creates an independent allowance.
CREATE TABLE communications.quota_buckets (
  account_id text NOT NULL REFERENCES communications.physical_accounts,
  bucket_kind text NOT NULL CHECK (bucket_kind IN ('account','application')),
  application_id text NOT NULL,
  window_kind text NOT NULL CHECK (window_kind IN ('hour','day')),
  window_start timestamptz NOT NULL,
  used integer NOT NULL CHECK (used >= 0),
  limit_value integer NOT NULL CHECK (limit_value >= 0 AND used <= limit_value),
  PRIMARY KEY (account_id, bucket_kind, application_id, window_kind, window_start),
  CHECK ((bucket_kind = 'account' AND application_id = '') OR (bucket_kind = 'application' AND length(application_id) > 0))
);

CREATE TABLE communications.auth_states (
  state_digest text PRIMARY KEY CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','linkedin')),
  platform text NOT NULL,
  backend text NOT NULL CHECK (backend IN ('direct','baileys','browser','unipile')),
  redirect_origin text NOT NULL CHECK (redirect_origin ~ '^https?://'),
  reconnect_connection_id text,
  reconnect_generation integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (application_id, tenant_id, owner_id) REFERENCES communications.access_grants,
  FOREIGN KEY (reconnect_connection_id, reconnect_generation, application_id, tenant_id, owner_id, channel, platform, backend)
    REFERENCES communications.connection_generations (connection_id, generation, application_id, tenant_id, owner_id, channel, platform, backend),
  CHECK ((reconnect_connection_id IS NULL) = (reconnect_generation IS NULL)),
  CHECK ((channel = 'email' AND platform IN ('gmail','outlook','imap') AND backend IN ('direct','unipile'))
      OR (channel = 'whatsapp' AND platform = 'whatsapp' AND backend IN ('baileys','unipile'))
      OR (channel = 'linkedin' AND platform = 'linkedin' AND backend IN ('browser','unipile'))),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at))
);

CREATE TABLE communications.identity_aliases (
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  connection_id text NOT NULL,
  generation integer NOT NULL,
  account_id text NOT NULL,
  namespace text NOT NULL CHECK (length(namespace) > 0),
  alias_digest text NOT NULL CHECK (alias_digest ~ '^[0-9a-f]{64}$'),
  canonical_kind text NOT NULL CHECK (canonical_kind IN ('email','phone','linkedin_profile')),
  canonical_digest text NOT NULL CHECK (canonical_digest ~ '^[0-9a-f]{64}$'),
  encrypted_identity text NOT NULL,
  key_version text NOT NULL,
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (connection_id, generation, namespace, alias_digest),
  FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id)
    REFERENCES communications.connection_generations (connection_id, generation, application_id, tenant_id, owner_id, account_id)
);

CREATE TABLE communications.event_cursors (
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  connection_id text NOT NULL,
  generation integer NOT NULL,
  account_id text NOT NULL,
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
  encrypted_cursor text,
  cursor_key_version text,
  coverage_from timestamptz,
  coverage_through timestamptz,
  observed_at timestamptz,
  complete boolean NOT NULL DEFAULT false,
  initial_sync_complete boolean NOT NULL DEFAULT false,
  invalidated boolean NOT NULL DEFAULT true,
  lease_token text,
  lease_until timestamptz,
  PRIMARY KEY (connection_id, generation, scope_digest),
  FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id)
    REFERENCES communications.connection_generations (connection_id, generation, application_id, tenant_id, owner_id, account_id),
  CHECK ((encrypted_cursor IS NULL) = (cursor_key_version IS NULL)),
  CHECK (NOT complete OR (coverage_from IS NOT NULL AND coverage_through IS NOT NULL AND observed_at IS NOT NULL
    AND coverage_from <= coverage_through AND coverage_through <= observed_at))
);

-- Only the trusted verified-ingress worker can read/write this global inbox.
-- A persisted ciphertext row commits BEFORE HTTP acknowledgement. Routes must
-- verify provider authentication first; an unverified body never enters here.
CREATE TABLE communications.webhook_inbox (
  id text PRIMARY KEY,
  backend text NOT NULL CHECK (backend IN ('direct','baileys','browser','unipile')),
  integration_id text NOT NULL,
  dedupe_key text NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  encrypted_payload text NOT NULL,
  key_version text NOT NULL,
  authenticated_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','processed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  failure_code text,
  UNIQUE (backend, integration_id, dedupe_key),
  CHECK (expires_at > received_at)
);
CREATE INDEX communications_webhook_due ON communications.webhook_inbox (state, retry_at, received_at);

CREATE TABLE communications.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  connection_id text NOT NULL,
  generation integer NOT NULL,
  account_id text NOT NULL,
  source_namespace text NOT NULL,
  source_event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('message','receipt','account','email_change')),
  direction text CHECK (direction IN ('inbound','outbound','self','group')),
  occurred_at timestamptz NOT NULL,
  encrypted_event text NOT NULL,
  key_version text NOT NULL,
  webhook_inbox_id text REFERENCES communications.webhook_inbox,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, generation, source_namespace, source_event_key),
  UNIQUE (id, application_id, tenant_id, owner_id),
  FOREIGN KEY (connection_id, generation, application_id, tenant_id, owner_id, account_id)
    REFERENCES communications.connection_generations (connection_id, generation, application_id, tenant_id, owner_id, account_id),
  CHECK ((event_type = 'message' AND direction IS NOT NULL) OR (event_type <> 'message' AND direction IS NULL))
);
CREATE INDEX communications_event_scan ON communications.events (connection_id, generation, id);

CREATE TABLE communications.event_outbox (
  event_id bigint NOT NULL,
  subscriber_id text NOT NULL,
  application_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivering','acknowledged','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  acknowledged_at timestamptz,
  failure_code text,
  PRIMARY KEY (event_id, subscriber_id),
  FOREIGN KEY (event_id, application_id, tenant_id, owner_id)
    REFERENCES communications.events (id, application_id, tenant_id, owner_id),
  CHECK ((state = 'acknowledged') = (acknowledged_at IS NOT NULL))
);
CREATE INDEX communications_outbox_due ON communications.event_outbox (state, retry_at, event_id);

CREATE FUNCTION communications.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable communications history cannot be changed'; END $$;
CREATE TRIGGER communications_generation_immutable BEFORE UPDATE OR DELETE ON communications.connection_generations
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
-- A verified alias belongs to its original generation/account. Rebinding or
-- revising its identity requires separately verified new immutable history.
CREATE TRIGGER communications_alias_immutable BEFORE UPDATE OR DELETE ON communications.identity_aliases
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
CREATE TRIGGER communications_event_immutable BEFORE UPDATE OR DELETE ON communications.events
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();

CREATE FUNCTION communications.protect_operation() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.operation_journal
  FOR EACH ROW EXECUTE FUNCTION communications.protect_operation();

CREATE FUNCTION communications.protect_connection() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_connection_guard BEFORE INSERT OR UPDATE ON communications.connections
  FOR EACH ROW EXECUTE FUNCTION communications.protect_connection();

-- RLS scope derives from trusted service authentication, never a browser GUC.
-- Control workers handle account verification, raw ingress and reconciliation.
-- They have no BYPASSRLS and no DELETE permission.
CREATE FUNCTION communications.protect_physical_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.channel) IS DISTINCT FROM ROW(OLD.id, OLD.channel) OR
     (OLD.verified_at IS NOT NULL AND ROW(NEW.identity_namespace, NEW.identity_digest, NEW.identity_key_version, NEW.verified_at)
       IS DISTINCT FROM ROW(OLD.identity_namespace, OLD.identity_digest, OLD.identity_key_version, OLD.verified_at)) THEN
    RAISE EXCEPTION 'Verified physical identity is immutable; create a new account';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_identity_guard BEFORE UPDATE ON communications.physical_accounts
  FOR EACH ROW EXECUTE FUNCTION communications.protect_physical_identity();

CREATE FUNCTION communications.protect_lease() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_lease_guard BEFORE UPDATE ON communications.account_leases
  FOR EACH ROW EXECUTE FUNCTION communications.protect_lease();

CREATE FUNCTION communications.protect_auth_state() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER communications_auth_guard BEFORE UPDATE ON communications.auth_states
  FOR EACH ROW EXECUTE FUNCTION communications.protect_auth_state();

CREATE FUNCTION communications.protect_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.connection_id,NEW.generation,NEW.application_id,NEW.tenant_id,NEW.owner_id,NEW.account_id,NEW.scope_digest)
     IS DISTINCT FROM ROW(OLD.connection_id,OLD.generation,OLD.application_id,OLD.tenant_id,OLD.owner_id,OLD.account_id,OLD.scope_digest) THEN
    RAISE EXCEPTION 'Cursor account/generation/query scope is immutable; create an invalidated new row';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_cursor_guard BEFORE UPDATE ON communications.event_cursors
  FOR EACH ROW EXECUTE FUNCTION communications.protect_cursor();

CREATE FUNCTION communications.scope_authorized(app text, tenant text, owner text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, communications AS $$
  SELECT app = current_setting('communications.application_id', true)
     AND tenant = current_setting('communications.tenant_id', true)
     AND owner = current_setting('communications.owner_id', true)
     AND EXISTS (SELECT 1 FROM communications.access_grants g
       WHERE g.application_id = app AND g.tenant_id = tenant AND g.owner_id = owner
         AND g.revoked_at IS NULL AND g.expires_at > statement_timestamp());
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA communications FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.scope_authorized(text,text,text) TO communications_scoped;

ALTER TABLE communications.access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_grant_self ON communications.access_grants FOR SELECT TO communications_scoped
  USING (application_id = current_setting('communications.application_id', true)
     AND tenant_id = current_setting('communications.tenant_id', true)
     AND owner_id = current_setting('communications.owner_id', true)
     AND revoked_at IS NULL AND expires_at > statement_timestamp());
CREATE POLICY communications_grant_control ON communications.access_grants TO communications_control USING (true) WITH CHECK (true);
GRANT SELECT ON communications.access_grants TO communications_scoped;

ALTER TABLE communications.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.connections FORCE ROW LEVEL SECURITY;
CREATE POLICY connections_control ON communications.connections TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY connections_scope ON communications.connections TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.connection_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_generations FORCE ROW LEVEL SECURITY;
CREATE POLICY connection_generations_control ON communications.connection_generations TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY connection_generations_scope ON communications.connection_generations TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.operation_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.operation_journal FORCE ROW LEVEL SECURITY;
CREATE POLICY operation_journal_control ON communications.operation_journal TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY operation_journal_scope ON communications.operation_journal TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.auth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_states_control ON communications.auth_states TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY auth_states_scope ON communications.auth_states TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.identity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.identity_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_aliases_control ON communications.identity_aliases TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY identity_aliases_scope ON communications.identity_aliases TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.event_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.event_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY event_cursors_control ON communications.event_cursors TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY event_cursors_scope ON communications.event_cursors TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.events FORCE ROW LEVEL SECURITY;
CREATE POLICY events_control ON communications.events TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY events_scope ON communications.events TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.event_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY event_outbox_control ON communications.event_outbox TO communications_control USING (true) WITH CHECK (true);
CREATE POLICY event_outbox_scope ON communications.event_outbox TO communications_scoped
  USING (communications.scope_authorized(application_id,tenant_id,owner_id))
  WITH CHECK (communications.scope_authorized(application_id,tenant_id,owner_id));

ALTER TABLE communications.physical_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.physical_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY physical_accounts_control ON communications.physical_accounts TO communications_control USING (true) WITH CHECK (true);

ALTER TABLE communications.account_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.account_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY account_leases_control ON communications.account_leases TO communications_control USING (true) WITH CHECK (true);

ALTER TABLE communications.quota_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.quota_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY quota_buckets_control ON communications.quota_buckets TO communications_control USING (true) WITH CHECK (true);

ALTER TABLE communications.webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.webhook_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_inbox_control ON communications.webhook_inbox TO communications_control USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA communications TO communications_control;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA communications TO communications_control;
GRANT SELECT ON communications.connections,communications.connection_generations TO communications_scoped;
GRANT SELECT ON communications.operation_journal TO communications_scoped;
-- Journal admission/mutation is control-only. The API never exposes arbitrary
-- control SQL; the reviewed repository transaction owns quota/lease updates.
GRANT SELECT, INSERT, UPDATE ON communications.auth_states,
  communications.event_cursors,communications.event_outbox TO communications_scoped;
GRANT SELECT, INSERT ON communications.identity_aliases,communications.events TO communications_scoped;
GRANT USAGE, SELECT ON SEQUENCE communications.events_id_seq TO communications_scoped;
-- Runtime LOGIN creation, authentication, TLS, role membership and credential
-- stores are provisioned separately. No application is granted control-role
-- credentials. Every pooled request must SET LOCAL ROLE + trusted scope.

-- Reviewed source ops/communications/standalone/002-reply-barrier.local.sql

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


REVOKE ALL ON FUNCTION communications.lock_reply_barrier(text,text),communications.advance_reply_barrier(text,text),
 communications.protect_reply_barrier(),communications.route_webhook_receipt(),communications.reply_inbox_barrier_change(),communications.reply_outbox_barrier_change(),
 communications.reply_review_barrier_change(),communications.assert_dispatch_reply_barrier(text,text),communications.guard_reply_dispatch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.lock_reply_barrier(text,text),communications.advance_reply_barrier(text,text),
 communications.assert_dispatch_reply_barrier(text,text) TO communications_control;

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



-- Reviewed source ops/communications/standalone/003-connection-retirement.local.sql


CREATE TABLE communications.connection_retirements (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  application_id text NOT NULL, tenant_id text NOT NULL, owner_id text NOT NULL,
  connection_id text NOT NULL, generation integer NOT NULL, account_id text NOT NULL,
  channel text NOT NULL, platform text NOT NULL, backend text NOT NULL CHECK (backend='unipile'),
  operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
  record_fingerprint text NOT NULL CHECK (record_fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_key_version text NOT NULL CHECK (length(fingerprint_key_version) BETWEEN 1 AND 64),
  encrypted_record text NOT NULL CHECK (length(encrypted_record) BETWEEN 1 AND 65536),
  record_key_version text NOT NULL CHECK (length(record_key_version) BETWEEN 1 AND 64),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','unknown','rejected','disconnected')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  encrypted_outcome text CHECK (length(encrypted_outcome) BETWEEN 1 AND 4096),
  outcome_key_version text CHECK (length(outcome_key_version) BETWEEN 1 AND 64),
  UNIQUE(application_id,tenant_id,owner_id,operation_key),
  FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id)
    REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id),
  FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,channel,platform,backend)
    REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,channel,platform,backend),
  CHECK ((state='pending' AND finished_at IS NULL AND encrypted_outcome IS NULL AND outcome_key_version IS NULL)
    OR (state<>'pending' AND finished_at IS NOT NULL AND finished_at>=prepared_at AND encrypted_outcome IS NOT NULL AND outcome_key_version IS NOT NULL))
);
CREATE UNIQUE INDEX communications_retirement_account_open ON communications.connection_retirements(account_id) WHERE state<>'disconnected';

-- All writers must lock tenant barrier first, then physical account before target rows.
-- BEFORE row triggers cannot reverse a row lock already taken by an uncoordinated writer;
-- such conflicts can deadlock and MUST fail boundedly, never authorize provider work.
CREATE FUNCTION communications.assert_account_retirement_open(physical text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=physical FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=physical AND state<>'disconnected') THEN
    RAISE EXCEPTION 'Physical account has an unresolved retirement intent';
  END IF;
END $$;

CREATE FUNCTION communications.protect_retirement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_retirement_guard BEFORE INSERT OR UPDATE ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.protect_retirement();
CREATE TRIGGER communications_retirement_delete_guard BEFORE DELETE ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();

CREATE FUNCTION communications.apply_retirement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  UPDATE communications.connections SET active=false,status='disconnected',status_observed_at=clock_timestamp()
    WHERE id=NEW.connection_id AND current_generation=NEW.generation AND account_id=NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retirement did not deactivate original current generation'; END IF;
  UPDATE communications.event_cursors SET invalidated=true,complete=false,initial_sync_complete=false,lease_token=NULL,lease_until=NULL WHERE account_id=NEW.account_id;
  PERFORM communications.advance_reply_barrier(NEW.application_id,NEW.tenant_id);
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retirement_apply AFTER INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.apply_retirement();

-- Natural grant expiry cannot be locked away. Recheck at the deferred precommit
-- authorization linearization point, after all retirement/cursor/outcome writes.
CREATE FUNCTION communications.guard_retirement_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE CONSTRAINT TRIGGER communications_retirement_commit AFTER INSERT OR UPDATE ON communications.connection_retirements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_retirement_commit();

CREATE FUNCTION communications.guard_retiring_connection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_retiring_connection BEFORE INSERT OR UPDATE ON communications.connections FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_connection();

CREATE FUNCTION communications.guard_retiring_generation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_generation BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_generation();

CREATE FUNCTION communications.guard_retiring_account_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_retiring_lease BEFORE INSERT OR UPDATE ON communications.account_leases FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();
CREATE TRIGGER communications_retiring_quota BEFORE INSERT OR UPDATE ON communications.quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();
CREATE TRIGGER communications_retiring_operation BEFORE INSERT OR UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_account_write();

CREATE FUNCTION communications.guard_retiring_auth() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_retiring_auth BEFORE INSERT OR UPDATE ON communications.auth_states FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_auth();

CREATE FUNCTION communications.guard_retiring_cursor() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM 1 FROM communications.physical_accounts WHERE id=NEW.account_id FOR UPDATE;
  IF (EXISTS(SELECT 1 FROM communications.connection_retirements WHERE account_id=NEW.account_id AND state<>'disconnected') OR
      EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation))
    AND (NOT NEW.invalidated OR NEW.complete OR NEW.initial_sync_complete OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL) THEN
    RAISE EXCEPTION 'Retirement invalidates cursor coverage and leases';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_cursor BEFORE INSERT OR UPDATE ON communications.event_cursors FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_cursor();

CREATE FUNCTION communications.guard_retiring_alias() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
  PERFORM communications.assert_account_retirement_open(NEW.account_id);
  IF EXISTS(SELECT 1 FROM communications.connection_retirements WHERE connection_id=NEW.connection_id AND generation=NEW.generation) THEN
    RAISE EXCEPTION 'A retired generation cannot establish new aliases';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER communications_retiring_alias BEFORE INSERT ON communications.identity_aliases FOR EACH ROW EXECUTE FUNCTION communications.guard_retiring_alias();

-- Control-only writers can see global physical fences; scoped RLS must not hide another owner's intent.
REVOKE INSERT,UPDATE ON communications.auth_states,communications.event_cursors FROM communications_scoped;
REVOKE INSERT ON communications.identity_aliases FROM communications_scoped;
ALTER TABLE communications.connection_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_retirements FORCE ROW LEVEL SECURITY;
CREATE POLICY connection_retirements_control ON communications.connection_retirements TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY connection_retirements_scope ON communications.connection_retirements FOR SELECT TO communications_scoped USING(communications.scope_authorized(application_id,tenant_id,owner_id));
GRANT SELECT,INSERT,UPDATE ON communications.connection_retirements TO communications_control;
GRANT SELECT ON communications.connection_retirements TO communications_scoped;
REVOKE DELETE ON communications.connection_retirements FROM communications_control,communications_scoped;
REVOKE ALL ON FUNCTION communications.assert_account_retirement_open(text),communications.protect_retirement(),communications.apply_retirement(),communications.guard_retirement_commit(),communications.guard_retiring_connection(),communications.guard_retiring_generation(),communications.guard_retiring_account_write(),communications.guard_retiring_auth(),communications.guard_retiring_cursor(),communications.guard_retiring_alias() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.assert_account_retirement_open(text),communications.protect_retirement(),communications.apply_retirement(),communications.guard_retirement_commit(),communications.guard_retiring_connection(),communications.guard_retiring_generation(),communications.guard_retiring_account_write(),communications.guard_retiring_auth(),communications.guard_retiring_cursor(),communications.guard_retiring_alias() TO communications_control;

-- Reviewed source ops/communications/standalone/004-email-tracking.local.sql


CREATE TABLE communications.email_tracking_acknowledgements (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  journal_id text NOT NULL UNIQUE REFERENCES communications.operation_journal(id),
  integration_id text NOT NULL CHECK (length(integration_id) BETWEEN 1 AND 200),
  provider_configuration_reference text NOT NULL CHECK (length(provider_configuration_reference) BETWEEN 1 AND 2000),
  -- Stable, independently keyed identity over integration/config/provider-account/tracking ID.
  -- No tracking ID or provider account ID is stored in plaintext.
  tracking_digest text NOT NULL CHECK (tracking_digest ~ '^[0-9a-f]{64}$'),
  tracking_key_version text NOT NULL CHECK (length(tracking_key_version) BETWEEN 1 AND 64),
  encrypted_ack text NOT NULL CHECK (length(encrypted_ack) BETWEEN 1 AND 2200000),
  ack_key_version text NOT NULL CHECK (length(ack_key_version) BETWEEN 1 AND 64),
  ack_digest text NOT NULL CHECK (ack_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (integration_id,provider_configuration_reference,tracking_key_version,tracking_digest)
);
CREATE TABLE communications.email_tracking_associations (
  acknowledgement_id text PRIMARY KEY REFERENCES communications.email_tracking_acknowledgements(id),
  encrypted_association text NOT NULL CHECK (length(encrypted_association) BETWEEN 1 AND 2200000),
  association_key_version text NOT NULL CHECK (length(association_key_version) BETWEEN 1 AND 64),
  association_digest text NOT NULL CHECK (association_digest ~ '^[0-9a-f]{64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Necessary SQL boundary only. Authentication, retained-key crypto, mailbox owner identity,
-- cross-version tracking identity comparison and read-only provider corroboration are REQUIRED
-- repository ports. Plain SQL cannot manufacture that cryptographic or provider evidence.
CREATE FUNCTION communications.guard_email_tracking_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
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
CREATE TRIGGER communications_email_ack_insert_guard BEFORE INSERT ON communications.email_tracking_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();
CREATE TRIGGER communications_email_association_insert_guard BEFORE INSERT ON communications.email_tracking_associations
  FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();
-- Revalidate natural grant expiry and original reserved provenance at COMMIT, even when
-- a direct control transaction holds the grant row and expiry advances after INSERT.
CREATE CONSTRAINT TRIGGER communications_email_ack_commit_guard AFTER INSERT ON communications.email_tracking_acknowledgements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();
CREATE CONSTRAINT TRIGGER communications_email_association_commit_guard AFTER INSERT ON communications.email_tracking_associations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_email_tracking_insert();
CREATE TRIGGER communications_email_ack_immutable BEFORE UPDATE OR DELETE ON communications.email_tracking_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
CREATE TRIGGER communications_email_association_immutable BEFORE UPDATE OR DELETE ON communications.email_tracking_associations
  FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
REVOKE ALL ON FUNCTION communications.guard_email_tracking_insert() FROM PUBLIC;

ALTER TABLE communications.email_tracking_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.email_tracking_acknowledgements FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.email_tracking_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.email_tracking_associations FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_email_ack_control ON communications.email_tracking_acknowledgements TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY communications_email_association_control ON communications.email_tracking_associations TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY communications_email_ack_scoped_read ON communications.email_tracking_acknowledgements FOR SELECT TO communications_scoped
  USING(EXISTS(SELECT 1 FROM communications.operation_journal j WHERE j.id=journal_id
    AND communications.scope_authorized(j.application_id,j.tenant_id,j.owner_id)));
CREATE POLICY communications_email_association_scoped_read ON communications.email_tracking_associations FOR SELECT TO communications_scoped
  USING(EXISTS(SELECT 1 FROM communications.email_tracking_acknowledgements a
    JOIN communications.operation_journal j ON j.id=a.journal_id WHERE a.id=acknowledgement_id
    AND communications.scope_authorized(j.application_id,j.tenant_id,j.owner_id)));
REVOKE ALL ON communications.email_tracking_acknowledgements,communications.email_tracking_associations FROM PUBLIC,communications_scoped,communications_control;
GRANT SELECT,INSERT ON communications.email_tracking_acknowledgements,communications.email_tracking_associations TO communications_control;
GRANT SELECT ON communications.email_tracking_acknowledgements,communications.email_tracking_associations TO communications_scoped;

-- Reviewed source ops/communications/standalone/005-send-admission.local.sql

CREATE TABLE communications.dispatch_admissions(
 id text PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 200),journal_id text NOT NULL UNIQUE REFERENCES communications.operation_journal(id),
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,connection_id text NOT NULL,generation integer NOT NULL,account_id text NOT NULL,
 operation_key text NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),
 permit_id text NOT NULL,intent_digest text NOT NULL CHECK(intent_digest~'^[a-f0-9]{64}$'),
 claim_token text NOT NULL,fencing_token bigint NOT NULL,lease_owner_token text NOT NULL,service_revision bigint NOT NULL CHECK(service_revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(application_id,permit_id),
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id) REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id)
);
CREATE TABLE communications.application_quota_buckets(
 application_id text NOT NULL,window_kind text NOT NULL CHECK(window_kind IN('hour','day')),window_start timestamptz NOT NULL,
 used bigint NOT NULL CHECK(used>=0),limit_value integer NOT NULL CHECK(limit_value>=0 AND used<=limit_value),
 PRIMARY KEY(application_id,window_kind,window_start)
);
CREATE FUNCTION communications.rollup_application_quota() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_application_quota_rollup AFTER INSERT OR UPDATE ON communications.quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.rollup_application_quota();
CREATE FUNCTION communications.guard_dispatch_admission() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE CONSTRAINT TRIGGER communications_admission_commit AFTER INSERT ON communications.dispatch_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_dispatch_admission();
CREATE FUNCTION communications.require_dispatch_admission() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 IF OLD.state='claimed' AND NEW.state='dispatching' AND NOT EXISTS(SELECT 1 FROM communications.dispatch_admissions a WHERE a.journal_id=NEW.id AND a.application_id=NEW.application_id AND a.tenant_id=NEW.tenant_id AND a.owner_id=NEW.owner_id AND a.claim_token=NEW.claim_token AND a.fencing_token=NEW.fencing_token) THEN RAISE EXCEPTION 'Private application permit ledger required'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER communications_01_private_admission BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.require_dispatch_admission();
CREATE TRIGGER communications_admission_immutable BEFORE UPDATE OR DELETE ON communications.dispatch_admissions FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
CREATE TRIGGER communications_application_quota_no_delete BEFORE DELETE ON communications.application_quota_buckets FOR EACH ROW EXECUTE FUNCTION communications.reject_mutation();
ALTER TABLE communications.dispatch_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.dispatch_admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.application_quota_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.application_quota_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY communications_admissions_control ON communications.dispatch_admissions TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY communications_admissions_scope ON communications.dispatch_admissions FOR SELECT TO communications_scoped USING(communications.scope_authorized(application_id,tenant_id,owner_id));
CREATE POLICY communications_app_quota_control ON communications.application_quota_buckets TO communications_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON communications.dispatch_admissions TO communications_control;
GRANT SELECT ON communications.dispatch_admissions TO communications_scoped;
GRANT SELECT,INSERT,UPDATE ON communications.application_quota_buckets TO communications_control;
REVOKE DELETE ON communications.dispatch_admissions,communications.application_quota_buckets FROM communications_control,communications_scoped;
REVOKE ALL ON FUNCTION communications.rollup_application_quota(),communications.guard_dispatch_admission(),communications.require_dispatch_admission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.rollup_application_quota(),communications.guard_dispatch_admission(),communications.require_dispatch_admission() TO communications_control;

-- Reviewed source ops/communications/standalone/006-account-runtime.local.sql

CREATE TABLE communications.account_runtime_metadata(
 connection_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 encrypted_metadata text NOT NULL CHECK(length(encrypted_metadata) BETWEEN 1 AND 2200000),
 metadata_key_version text NOT NULL CHECK(length(metadata_key_version) BETWEEN 1 AND 64),
 metadata_digest text NOT NULL CHECK(metadata_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(connection_id,generation),FOREIGN KEY(connection_id,generation) REFERENCES communications.connection_generations
);
CREATE TABLE communications.connection_defaults(
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 channel text NOT NULL CHECK(channel IN('email','whatsapp','linkedin')),connection_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(application_id,tenant_id,owner_id,channel),
 FOREIGN KEY(application_id,tenant_id,owner_id) REFERENCES communications.access_grants,
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id) REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id)
);
CREATE TABLE communications.setup_notification_inbox(
 state_digest text PRIMARY KEY REFERENCES communications.auth_states(state_digest),
 encrypted_notification text NOT NULL CHECK(length(encrypted_notification) BETWEEN 1 AND 2200000),
 key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 64),payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),processed_at timestamptz,
 CHECK(processed_at IS NULL OR processed_at>=created_at)
);
CREATE TABLE communications.provider_webhook_spool(
 id text PRIMARY KEY CHECK(id~'^[a-f0-9]{64}$'),
 integration_id text NOT NULL CHECK(length(integration_id) BETWEEN 1 AND 200),
 provider_configuration_reference text NOT NULL CHECK(length(provider_configuration_reference) BETWEEN 1 AND 2000),
 provider_account_digests text[] NOT NULL CHECK(cardinality(provider_account_digests) BETWEEN 1 AND 32 AND array_position(provider_account_digests,NULL) IS NULL AND array_to_string(provider_account_digests,',')~'^[a-f0-9]{64}(,[a-f0-9]{64})*$'),
 encrypted_receipt text NOT NULL CHECK(length(encrypted_receipt) BETWEEN 1 AND 500000),
 key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 64),payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','routed','review')),
 claim_token text CHECK(claim_token~'^[A-Za-z0-9_-]{43}$'),claim_until timestamptz,retry_at timestamptz,
 bound_connection_id text,bound_generation integer,scoped_receipt_key text REFERENCES communications.webhook_inbox(id),
 FOREIGN KEY(bound_connection_id,bound_generation) REFERENCES communications.connection_generations,
 CHECK(expires_at>received_at AND expires_at<=received_at+interval '24 hours'),
 CHECK((bound_connection_id IS NULL)=(bound_generation IS NULL)),
 CHECK((state='processing')=(claim_token IS NOT NULL AND claim_until IS NOT NULL)),
 CHECK(claim_until IS NULL OR claim_until<=expires_at),
 CHECK((state='routed')=(scoped_receipt_key IS NOT NULL)),CHECK(state<>'routed' OR bound_connection_id IS NOT NULL)
);
CREATE INDEX communications_provider_spool_work ON communications.provider_webhook_spool(integration_id,provider_configuration_reference,state,received_at);
-- An authenticated integration receipt is passive evidence, not owner authority. Pinning uses only
-- recorded provider digests/current generations, never account/tenant/owner fields from the body.
CREATE FUNCTION communications.guard_provider_webhook_spool() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
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
CREATE TRIGGER communications_provider_spool_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.provider_webhook_spool FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_webhook_spool();
CREATE FUNCTION communications.guard_provider_spool_account_work() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='operation_journal' AND NEW.state<>'dispatching' THEN RETURN NEW; END IF;
 aid:=NEW.account_id;
 IF EXISTS(SELECT 1 FROM communications.provider_webhook_spool w JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation WHERE g.account_id=aid AND w.state<>'routed') THEN RAISE EXCEPTION 'Pending provider evidence blocks account mutation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER communications_00_provider_spool_dispatch_guard BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();
CREATE TRIGGER communications_00_provider_spool_generation_guard BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();
CREATE TRIGGER communications_00_provider_spool_retirement_guard BEFORE INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work();
ALTER TABLE communications.provider_webhook_spool ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.provider_webhook_spool FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_webhook_control ON communications.provider_webhook_spool TO communications_control USING(true) WITH CHECK(true);
REVOKE ALL ON communications.provider_webhook_spool FROM PUBLIC;
REVOKE ALL ON FUNCTION communications.guard_provider_webhook_spool(),communications.guard_provider_spool_account_work() FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON communications.provider_webhook_spool TO communications_control;
-- Provider/callback authentication and encrypted canonical identity validation are concrete runtime
-- responsibilities. SQL cannot treat account_id/name JSON or ciphertext as independent owner proof.
CREATE FUNCTION communications.guard_account_runtime() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
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
CREATE TRIGGER communications_runtime_metadata_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.account_runtime_metadata FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE TRIGGER communications_runtime_default_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.connection_defaults FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE TRIGGER communications_runtime_notification_guard BEFORE INSERT OR UPDATE OR DELETE ON communications.setup_notification_inbox FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE CONSTRAINT TRIGGER communications_runtime_metadata_commit AFTER INSERT ON communications.account_runtime_metadata DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
CREATE CONSTRAINT TRIGGER communications_runtime_default_commit AFTER INSERT OR UPDATE ON communications.connection_defaults DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.guard_account_runtime();
ALTER TABLE communications.account_runtime_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.account_runtime_metadata FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.connection_defaults FORCE ROW LEVEL SECURITY;
ALTER TABLE communications.setup_notification_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.setup_notification_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY account_runtime_control ON communications.account_runtime_metadata TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY connection_defaults_control ON communications.connection_defaults TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY setup_notification_control ON communications.setup_notification_inbox TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY account_runtime_scope ON communications.account_runtime_metadata FOR SELECT TO communications_scoped USING(EXISTS(
 SELECT 1 FROM communications.connection_generations g WHERE g.connection_id=account_runtime_metadata.connection_id AND g.generation=account_runtime_metadata.generation
 AND communications.scope_authorized(g.application_id,g.tenant_id,g.owner_id)));
CREATE POLICY connection_defaults_scope ON communications.connection_defaults FOR SELECT TO communications_scoped USING(communications.scope_authorized(application_id,tenant_id,owner_id));
REVOKE ALL ON communications.account_runtime_metadata,communications.connection_defaults,communications.setup_notification_inbox FROM PUBLIC;
REVOKE ALL ON FUNCTION communications.guard_account_runtime() FROM PUBLIC;
GRANT SELECT,INSERT ON communications.account_runtime_metadata TO communications_control;
GRANT SELECT,INSERT,UPDATE ON communications.connection_defaults,communications.setup_notification_inbox TO communications_control;
GRANT SELECT ON communications.account_runtime_metadata,communications.connection_defaults TO communications_scoped;

-- Reviewed source ops/communications/standalone/007-history-checkpoints.local.sql

CREATE TABLE communications.history_initial_sync (
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 connection_id text NOT NULL,generation integer NOT NULL,account_id text NOT NULL,
 webhook_inbox_id text NOT NULL REFERENCES communications.webhook_receipt_routes(webhook_inbox_id),
 completed_at timestamptz NOT NULL,
 encrypted_evidence text NOT NULL CHECK(length(encrypted_evidence) BETWEEN 1 AND 65536),
 key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 64),
 digest_key_version text NOT NULL CHECK(length(digest_key_version) BETWEEN 1 AND 64),
 PRIMARY KEY(connection_id,generation),
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id)
 REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id)
);
-- Completed_at is authenticated webhook capture/observed completion time, not an invented vendor
-- event timestamp. Exact generation routing and retained receipt are immutable; no status-OK proof.
CREATE FUNCTION communications.protect_history_initial_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_history_initial_sync_guard BEFORE INSERT ON communications.history_initial_sync
 FOR EACH ROW EXECUTE FUNCTION communications.protect_history_initial_sync();
ALTER TABLE communications.history_initial_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.history_initial_sync FORCE ROW LEVEL SECURITY;
CREATE POLICY history_initial_sync_control ON communications.history_initial_sync TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY history_initial_sync_scoped ON communications.history_initial_sync TO communications_scoped
 USING(communications.scope_authorized(application_id,tenant_id,owner_id));
REVOKE ALL ON communications.history_initial_sync FROM PUBLIC,communications_control,communications_scoped;
GRANT SELECT,INSERT ON communications.history_initial_sync TO communications_control;
GRANT SELECT ON communications.history_initial_sync TO communications_scoped;
REVOKE ALL ON FUNCTION communications.protect_history_initial_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.protect_history_initial_sync() TO communications_control;

CREATE TABLE communications.history_refreshes (
 application_id text NOT NULL,tenant_id text NOT NULL,owner_id text NOT NULL,
 connection_id text NOT NULL,generation integer NOT NULL,account_id text NOT NULL,
 scope_digest text NOT NULL CHECK(scope_digest~'^[0-9a-f]{64}$'),
 digest_key_version text NOT NULL CHECK(length(digest_key_version) BETWEEN 1 AND 64),
 token_hash text NOT NULL CHECK(token_hash~'^[0-9a-f]{64}$'),
 required_since timestamptz NOT NULL,capture_revision bigint NOT NULL CHECK(capture_revision>=0),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_until timestamptz NOT NULL,
 finished_at timestamptz,finished_revision bigint,
 PRIMARY KEY(connection_id,generation,scope_digest),
 FOREIGN KEY(connection_id,generation,application_id,tenant_id,owner_id,account_id)
 REFERENCES communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id),
 CHECK(required_since<=started_at),CHECK(lease_until>=started_at),
 CHECK((finished_at IS NULL)=(finished_revision IS NULL)),CHECK(finished_revision IS NULL OR finished_revision>=capture_revision),
 CHECK(finished_at IS NULL OR finished_at>=started_at)
);
CREATE FUNCTION communications.protect_history_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE TRIGGER communications_history_refresh_guard BEFORE INSERT OR UPDATE ON communications.history_refreshes
 FOR EACH ROW EXECUTE FUNCTION communications.protect_history_refresh();
-- Rechecks natural access expiry at transaction precommit; never claims post-WAL authorization.
CREATE FUNCTION communications.history_refresh_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM communications.connections c JOIN communications.access_grants g
  ON g.application_id=c.application_id AND g.tenant_id=c.tenant_id AND g.owner_id=c.owner_id
  WHERE c.id=NEW.connection_id AND c.current_generation=NEW.generation AND c.account_id=NEW.account_id AND c.active
   AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'History refresh authorization expired before commit';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER communications_history_sync_commit AFTER INSERT ON communications.history_initial_sync
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_refresh_commit_guard();
CREATE CONSTRAINT TRIGGER communications_history_refresh_commit AFTER INSERT OR UPDATE ON communications.history_refreshes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_refresh_commit_guard();
ALTER TABLE communications.history_refreshes ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications.history_refreshes FORCE ROW LEVEL SECURITY;
CREATE POLICY history_refresh_control ON communications.history_refreshes TO communications_control USING(true) WITH CHECK(true);
CREATE POLICY history_refresh_scoped ON communications.history_refreshes TO communications_scoped
 USING(communications.scope_authorized(application_id,tenant_id,owner_id));
REVOKE ALL ON communications.history_refreshes FROM PUBLIC,communications_control,communications_scoped;
GRANT SELECT,INSERT,UPDATE ON communications.history_refreshes TO communications_control;
GRANT SELECT ON communications.history_refreshes TO communications_scoped;
REVOKE ALL ON FUNCTION communications.protect_history_refresh(),communications.history_refresh_commit_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.protect_history_refresh(),communications.history_refresh_commit_guard() TO communications_control;

-- Prevent accidental direct control UPDATE from publishing authorized complete coverage after expiry.
-- SQL metadata does not authenticate encrypted provider evidence; only the configured worker may
-- supply that evidence. EventCodec/cursor-AEAD verification remains a concrete repository duty.
CREATE FUNCTION communications.history_coverage_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,communications AS $$
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
CREATE CONSTRAINT TRIGGER communications_history_coverage_commit AFTER INSERT OR UPDATE ON communications.event_cursors
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION communications.history_coverage_commit_guard();
REVOKE ALL ON FUNCTION communications.history_coverage_commit_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION communications.history_coverage_commit_guard() TO communications_control;

CREATE CONSTRAINT TRIGGER communications_history_alias_commit AFTER INSERT ON communications.identity_aliases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.namespace LIKE 'unipile.v1.history-peer.%')
 EXECUTE FUNCTION communications.history_refresh_commit_guard();

DO $$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('communications_control','communications_scoped') AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)<>2 THEN
  RAISE EXCEPTION 'Existing restricted service roles required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('communications.guard_provider_spool_account_work()')
  AND md5(p.prosrc)='aa568c195ae4a03d576a6966baa09b3d' AND NOT p.prosecdef
  AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_get_userbyid(p.proowner)='project_acquire'
  AND p.prorettype='pg_catalog.trigger'::regtype) THEN
  RAISE EXCEPTION 'Unchanged approved006 trigger function required; do not reapply or overwrite other repairs';
 END IF;
 IF (SELECT count(*) FROM pg_class c WHERE c.oid IN('communications.provider_webhook_spool'::regclass,'communications.connection_generations'::regclass,'communications.connection_retirements'::regclass,'communications.operation_journal'::regclass) AND c.relrowsecurity AND c.relforcerowsecurity)<>4 THEN
  RAISE EXCEPTION 'Approved FORCE-RLS prerequisites required';
 END IF;
 IF (SELECT array_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t
  WHERE t.tgfoid='communications.guard_provider_spool_account_work()'::regprocedure AND NOT t.tgisinternal)
  IS DISTINCT FROM ARRAY[
   'CREATE TRIGGER communications_00_provider_spool_dispatch_guard BEFORE UPDATE ON communications.operation_journal FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work()',
   'CREATE TRIGGER communications_00_provider_spool_generation_guard BEFORE INSERT ON communications.connection_generations FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work()',
   'CREATE TRIGGER communications_00_provider_spool_retirement_guard BEFORE INSERT ON communications.connection_retirements FOR EACH ROW EXECUTE FUNCTION communications.guard_provider_spool_account_work()']::text[] THEN
  RAISE EXCEPTION 'Unchanged three reviewed trigger bindings required';
 END IF;
END $$;

-- Reviewed source ops/communications/standalone/008-provider-spool-record-guard.local.sql

CREATE OR REPLACE FUNCTION communications.guard_provider_spool_account_work() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='operation_journal' THEN
  IF NEW.state<>'dispatching' THEN RETURN NEW; END IF;
 END IF;
 aid:=NEW.account_id;
 IF EXISTS(SELECT 1 FROM communications.provider_webhook_spool w JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation WHERE g.account_id=aid AND w.state<>'routed') THEN RAISE EXCEPTION 'Pending provider evidence blocks account mutation'; END IF;
 RETURN NEW;
END $$;

-- Runtime always SET LOCAL ROLE; no login or unrestricted provider identity.
GRANT communications_control,communications_scoped TO project_acquire;
