-- FOR REVIEW: not applied. New agent state only; no historical sequence/runtime changes.
-- The application must still revalidate current revisions and communications admission.
CREATE TABLE agent_review_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','invalidated')),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='array' AND jsonb_array_length(manifest) BETWEEN 1 AND 50),
 manifest_digest text NOT NULL CHECK(length(manifest_digest)=64),
 decided_by text REFERENCES "user"(id), decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(thread_id,request_key),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id)
 REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id),
 CHECK((state IN ('approved','rejected'))=(decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE TABLE agent_authority_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL,
 organization_id text NOT NULL, mandate_id uuid NOT NULL, owner_user_id text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 channel text NOT NULL CHECK(channel='email'),
 actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 2 AND actions <@ '["initial_email","reply_email"]'::jsonb),
 recipient_keys jsonb NOT NULL CHECK(jsonb_typeof(recipient_keys)='array' AND jsonb_array_length(recipient_keys) BETWEEN 1 AND 200),
 binding_digest text NOT NULL CHECK(length(binding_digest)=64),
 max_sends integer NOT NULL CHECK(max_sends BETWEEN 1 AND 100),
 used_sends integer NOT NULL DEFAULT 0 CHECK(used_sends>=0 AND used_sends<=max_sends),
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 approved_by text NOT NULL REFERENCES "user"(id), approved_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(thread_id,organization_id,mandate_id,owner_user_id)
 REFERENCES agent_threads(id,organization_id,mandate_id,owner_user_id),
 CHECK(expires_at>approved_at AND expires_at<=approved_at+interval '7 days')
);
CREATE INDEX agent_authority_scope_idx ON agent_authority_grants(thread_id) WHERE revoked_at IS NULL;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['agent_review_batches','agent_authority_grants'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO acquire_agent_user',name);
  EXECUTE format('CREATE POLICY agent_actor_scope ON %I TO acquire_agent_user USING (organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true))) WITH CHECK (organization_id=current_setting(''app.acquire_org'',true) AND owner_user_id=current_setting(''app.acquire_user'',true) AND EXISTS(SELECT 1 FROM member WHERE organization_id=current_setting(''app.acquire_org'',true) AND user_id=current_setting(''app.acquire_user'',true)))',name);
 END LOOP;
END $$;
