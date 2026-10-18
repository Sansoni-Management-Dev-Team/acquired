-- Forward-only correction: related references carry the same tenant/mandate/owner.
CREATE UNIQUE INDEX agent_event_scope_idx ON agent_events(id,organization_id,mandate_id,owner_user_id);
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_trigger_event_id_fkey;
ALTER TABLE agent_runs ADD CONSTRAINT agent_run_trigger_scope_fk
 FOREIGN KEY(trigger_event_id,organization_id,mandate_id,owner_user_id)
 REFERENCES agent_events(id,organization_id,mandate_id,owner_user_id);
CREATE UNIQUE INDEX agent_sequence_scope_idx ON campaign_sequences(id,organization_id,mandate_id,owner_user_id);
CREATE UNIQUE INDEX agent_version_scope_idx ON campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id);
ALTER TABLE agent_responsibilities DROP CONSTRAINT agent_responsibilities_sequence_id_fkey;
ALTER TABLE agent_responsibilities DROP CONSTRAINT agent_responsibilities_version_id_fkey;
ALTER TABLE agent_responsibilities ADD CONSTRAINT agent_responsibility_sequence_scope_fk
 FOREIGN KEY(sequence_id,organization_id,mandate_id,owner_user_id)
 REFERENCES campaign_sequences(id,organization_id,mandate_id,owner_user_id);
ALTER TABLE agent_responsibilities ADD CONSTRAINT agent_responsibility_version_scope_fk
 FOREIGN KEY(version_id,organization_id,owner_user_id,sequence_id)
 REFERENCES campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id);
ALTER TABLE agent_responsibilities ADD CONSTRAINT agent_version_requires_sequence CHECK(version_id IS NULL OR sequence_id IS NOT NULL);
-- Narrow definer operation: lock only the server-scoped membership, return no data.
-- This serializes membership removal with short agent repository transactions
-- without granting UPDATE on the member table to the agent role.
CREATE FUNCTION agent_lock_member() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.member
 WHERE organization_id=current_setting('app.acquire_org',true)
 AND user_id=current_setting('app.acquire_user',true) FOR SHARE;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION agent_lock_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_lock_member() TO acquire_agent_user;
