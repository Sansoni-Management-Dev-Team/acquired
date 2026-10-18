-- Explicit migration only. Local runner verifies a dedicated database marker.
-- No existing business rows or publication/enrolment state are changed.
CREATE ROLE acquire_agent_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE UNIQUE INDEX agent_mandate_scope_idx ON mandates(id, organization_id);
CREATE TABLE agent_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL,
 mandate_id uuid NOT NULL, owner_user_id text NOT NULL REFERENCES "user"(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,mandate_id,owner_user_id),
 UNIQUE(id,organization_id,mandate_id,owner_user_id),
 FOREIGN KEY(mandate_id,organization_id) REFERENCES mandates(id,organization_id)
);
CREATE TABLE agent_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),
 role text NOT NULL CHECK(role IN ('user','assistant')),
 content jsonb NOT NULL CHECK(octet_length(content::text) <= 64000),
 content_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(thread_id,request_key),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id) REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id) ON DELETE CASCADE
);
CREATE TABLE agent_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), name text NOT NULL,
 input jsonb NOT NULL, input_digest text NOT NULL,
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','rejected','running','complete','failed','uncertain')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(thread_id,request_key),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id) REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id) ON DELETE CASCADE
);
CREATE TABLE agent_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 200), kind text NOT NULL,
 payload jsonb NOT NULL, payload_digest text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','done')),
 available_at timestamptz NOT NULL DEFAULT now(), lease_owner uuid, lease_until timestamptz,
 fence bigint NOT NULL DEFAULT 0 CHECK(fence >= 0), attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(thread_id,event_key),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id) REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id) ON DELETE CASCADE
);
CREATE INDEX agent_events_due_idx ON agent_events(organization_id,owner_user_id,available_at) WHERE state <> 'done';
CREATE TABLE agent_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 trigger_event_id uuid REFERENCES agent_events(id),
 state text NOT NULL CHECK(state IN ('queued','running','waiting','complete','failed','uncertain','cancelled')),
 lease_owner uuid, lease_until timestamptz, fence bigint NOT NULL DEFAULT 0,
 model_config jsonb NOT NULL DEFAULT '{}', usage jsonb NOT NULL DEFAULT '{}', stop_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id) REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agent_runs_one_running_idx ON agent_runs(thread_id) WHERE state='running';
CREATE TABLE agent_responsibilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL UNIQUE,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 state text NOT NULL DEFAULT 'paused' CHECK(state IN ('paused','ready','waiting','human_owned','complete')),
 milestone text NOT NULL DEFAULT 'research', revision integer NOT NULL DEFAULT 1,
 mandate_revision text NOT NULL, authority_reference uuid, budget_reference uuid,
 sequence_id uuid REFERENCES campaign_sequences(id), version_id uuid REFERENCES campaign_sequence_versions(id),
 next_wakeup_at timestamptz, child_operations jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id) REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id) ON DELETE CASCADE
);
-- Actor role is entered only from authenticated server composition. No login or
-- BYPASSRLS. Membership is rechecked and locked in each repository transaction.
GRANT USAGE ON SCHEMA public TO acquire_agent_user;
GRANT SELECT ON member,mandates TO acquire_agent_user;
CREATE POLICY agent_member_read ON member FOR SELECT TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true) AND user_id=current_setting('app.acquire_user',true));
CREATE POLICY agent_mandate_read ON mandates FOR SELECT TO acquire_agent_user
 USING(organization_id=current_setting('app.acquire_org',true));
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['agent_threads','agent_messages','agent_operations','agent_events','agent_runs','agent_responsibilities'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO acquire_agent_user',name);
  EXECUTE format('CREATE POLICY agent_actor_scope ON %I TO acquire_agent_user USING (organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true))) WITH CHECK (organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
END $$;
GRANT USAGE ON SEQUENCE agent_messages_sequence_seq TO acquire_agent_user;
-- append-only history: no rewrite/delete through the user role.
REVOKE UPDATE,DELETE ON agent_messages FROM acquire_agent_user;
