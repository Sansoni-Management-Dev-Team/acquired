-- WF-02 / unit 001: additive execution identity and reservation uniqueness.
-- PROPOSED ONLY. Requires explicit approval of this exact hash and target before
-- application, including rehearsal. This file does not activate workflows.
-- Apply as the existing public.mandates owner, after the complete bundle's
-- catalog/hash/target preflight. Keep application activation disabled until
-- units 002/003 and application acceptance are complete. No historical data is
-- changed, no legacy mode is replaced, and no job or provider call is created.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $preflight$
BEGIN
  IF (
    (current_database()='postgres' AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='7678071634733212629')
    OR (current_database()='acquire_hosted_demo_rehearsal'
        AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='7699248227334438947'
        AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='acquire-hosted-demo-rehearsal-only')
  ) IS NOT TRUE THEN RAISE EXCEPTION 'Exact reviewed workflow migration target required'; END IF;
  IF to_regclass('public.mandates') IS NULL
     OR to_regclass('public.member') IS NULL
     OR to_regclass('public.agent_mandate_execution_modes') IS NULL THEN
    RAISE EXCEPTION 'Existing Acquire mandate and membership schema required';
  END IF;
  IF current_user IS DISTINCT FROM pg_get_userbyid(
    (SELECT relowner FROM pg_class WHERE oid = 'public.mandates'::regclass)
  ) THEN
    RAISE EXCEPTION 'Apply workflow expansion as the existing mandate schema owner';
  END IF;
  IF to_regclass('public.acquisition_workflow_executions') IS NOT NULL THEN
    RAISE EXCEPTION 'Workflow execution table already exists; reconcile the applied artifact';
  END IF;
END
$preflight$;

CREATE TABLE public.acquisition_workflow_executions (
  -- The idempotent start request UUID is also this execution ID. No default ID:
  -- retries must present the original ID rather than accidentally allocate one.
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  owner_user_id text NOT NULL REFERENCES public."user"(id),
  mandate_id uuid NOT NULL,
  input_digest text NOT NULL,
  preset text NOT NULL,
  presentation text NOT NULL,
  state text NOT NULL DEFAULT 'accepted',
  revision integer NOT NULL DEFAULT 1,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CONSTRAINT acquisition_workflow_mandate_fk
    FOREIGN KEY (mandate_id, organization_id)
    REFERENCES public.mandates(id, organization_id),
  CONSTRAINT acquisition_workflow_scope_unique
    UNIQUE (id, organization_id, mandate_id, owner_user_id),
  CONSTRAINT acquisition_workflow_input_digest_check
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT acquisition_workflow_preset_check
    CHECK (preset IN ('demo', 'live-research-test', 'live')),
  CONSTRAINT acquisition_workflow_presentation_check
    CHECK (presentation IN ('agent', 'workspace')),
  CONSTRAINT acquisition_workflow_state_check
    CHECK (state IN ('accepted', 'researching', 'ready', 'outreach',
                     'complete', 'failed', 'cancelled', 'uncertain')),
  CONSTRAINT acquisition_workflow_revision_check CHECK (revision > 0),
  CONSTRAINT acquisition_workflow_error_code_check
    CHECK (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  CONSTRAINT acquisition_workflow_research_only_state_check
    CHECK (preset <> 'live-research-test' OR state <> 'outreach'),
  CONSTRAINT acquisition_workflow_finished_check
    CHECK ((state IN ('complete', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CONSTRAINT acquisition_workflow_timestamps_check
    CHECK (isfinite(created_at) AND isfinite(updated_at)
           AND updated_at >= created_at
           AND (finished_at IS NULL OR
                (isfinite(finished_at) AND finished_at >= created_at
                 AND finished_at <= updated_at)))
);

-- The execution row itself is the reservation. Uncertain work keeps its slot.
-- Neither a timed-out HTTP request nor an expired worker lease releases it.
CREATE UNIQUE INDEX acquisition_workflow_active_mandate_idx
  ON public.acquisition_workflow_executions(mandate_id)
  WHERE state NOT IN ('complete', 'failed', 'cancelled');

-- Deliberately one lifetime outreach execution, including failed/cancelled
-- executions: retry that same execution rather than change delivery identity.
-- Research-only executions may precede it. Unit 003 admission must additionally
-- reject later research and all existing legacy outreach, under the same lock.
CREATE UNIQUE INDEX acquisition_workflow_outreach_mandate_idx
  ON public.acquisition_workflow_executions(mandate_id)
  WHERE preset IN ('demo', 'live');

ALTER TABLE public.acquisition_workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_workflow_executions FORCE ROW LEVEL SECURITY;
-- Explicitly undo Supabase default grants as well as PUBLIC/app-role grants.
REVOKE ALL ON TABLE public.acquisition_workflow_executions
  FROM PUBLIC, anon, authenticated, service_role,
       acquire_agent_user, acquire_campaign_user;
GRANT SELECT ON TABLE public.acquisition_workflow_executions
  TO acquire_agent_user, acquire_campaign_user;

CREATE POLICY acquisition_workflow_actor_read
  ON public.acquisition_workflow_executions FOR SELECT
  TO acquire_agent_user, acquire_campaign_user
  USING (
    organization_id = current_setting('app.acquire_org', true)
    AND owner_user_id = current_setting('app.acquire_user', true)
    AND EXISTS (
      SELECT 1 FROM public.member m
      WHERE m.organization_id = current_setting('app.acquire_org', true)
        AND m.user_id = current_setting('app.acquire_user', true)
    )
  );

-- Matches the existing forced-RLS SECURITY DEFINER owner pattern. This grants
-- no SQL privilege by itself. Later narrow owner functions must independently
-- validate actor membership, source ownership and held admission context.
CREATE POLICY acquisition_workflow_definer
  ON public.acquisition_workflow_executions TO PUBLIC
  USING (current_user = pg_get_userbyid(
    (SELECT relowner FROM pg_class
     WHERE oid = 'public.acquisition_workflow_executions'::regclass)
  ))
  WITH CHECK (current_user = pg_get_userbyid(
    (SELECT relowner FROM pg_class
     WHERE oid = 'public.acquisition_workflow_executions'::regclass)
  ));

CREATE FUNCTION public.acquisition_workflow_identity_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workflow execution identity and history cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS DISTINCT FROM 'accepted' OR NEW.revision IS DISTINCT FROM 1
       OR NEW.error_code IS NOT NULL OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION 'A workflow must start in its initial accepted state';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.organization_id, NEW.owner_user_id, NEW.mandate_id,
         NEW.input_digest, NEW.preset, NEW.presentation, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organization_id, OLD.owner_user_id, OLD.mandate_id,
         OLD.input_digest, OLD.preset, OLD.presentation, OLD.created_at) THEN
    RAISE EXCEPTION 'Workflow execution identity and preset are immutable';
  END IF;
  IF NEW.revision::bigint IS DISTINCT FROM OLD.revision::bigint + 1
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Workflow update requires the next revision and monotonic timestamp';
  END IF;
  -- Allowed transitions and release of uncertainty belong to unit 003's narrow
  -- admission/transition function. No actor role receives direct UPDATE rights.
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION public.acquisition_workflow_identity_guard()
  FROM PUBLIC, anon, authenticated, service_role,
       acquire_agent_user, acquire_campaign_user;
CREATE TRIGGER acquisition_workflow_identity_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.acquisition_workflow_executions
  FOR EACH ROW EXECUTE FUNCTION public.acquisition_workflow_identity_guard();

-- No application data is inserted and no compatibility function is replaced in
-- unit 001. The complete bundle's approved runner records artifact hashes after
-- application; this unit does not pretend to approve or activate units 002/003.
COMMIT;
