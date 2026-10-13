-- PROVISIONAL REVIEW ARTIFACT. UNAPPROVED / UNAPPLIED. No startup invokes this file.
-- Proposed exact existing standalone target: OrbStack 127.0.0.1:5446/communications_fixture,
-- system identifier 7696118996713136162, following approved standalone001/002.
-- No provider activity, journal/quota transition, account rebinding or application data.
BEGIN;
DO $$ BEGIN
  IF current_user<>'communications_fixture' OR pg_catalog.current_database()<>'communications_fixture' OR
     (SELECT system_identifier::text FROM pg_catalog.pg_control_system())<>'7696118996713136162' OR
     to_regclass('communications.operation_journal') IS NULL OR
     to_regprocedure('communications.lock_reply_barrier(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Requires exact approved standalone service fixture';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')) THEN
    RAISE EXCEPTION 'Standalone fixture cannot contain public application relations';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN('communications_control','communications_scoped')
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin)<>2 THEN
    RAISE EXCEPTION 'Requires exact restricted service roles';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='communications' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
      AND c.relname IN('access_grants','physical_accounts','connections','connection_generations','operation_journal',
        'account_leases','quota_buckets','auth_states','identity_aliases','event_cursors','webhook_inbox','events',
        'event_outbox','tenant_reply_barriers','webhook_receipt_routes','reply_review_latches'))<>16 THEN
    RAISE EXCEPTION 'Requires exact FORCE RLS standalone001/002 prerequisites';
  END IF;
  IF to_regclass('communications.email_tracking_acknowledgements') IS NOT NULL OR
     to_regclass('communications.email_tracking_associations') IS NOT NULL THEN
    RAISE EXCEPTION 'Email tracking storage must not already exist';
  END IF;
END $$;

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
COMMIT;
