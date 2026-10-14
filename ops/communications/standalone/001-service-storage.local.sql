-- PROVISIONAL REVIEW ARTIFACT. NOT APPROVED OR APPLIED. No startup invokes this file.
-- Proposed target: new owned OrbStack 127.0.0.1:5446/communications_fixture ONLY.
-- A new exact file/hash/target approval is required, including empty fixture database startup.
-- Source: approved local 001 body; target guard is independently reviewed below.
-- No Acquire tables, credentials, bindings, defaults or live account changes are created.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'communications_fixture' THEN
    RAISE EXCEPTION 'Requires exact standalone communications fixture target';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')) THEN
    RAISE EXCEPTION 'Standalone fixture requires no application tables in public';
  END IF;
END $$;
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
COMMIT;
