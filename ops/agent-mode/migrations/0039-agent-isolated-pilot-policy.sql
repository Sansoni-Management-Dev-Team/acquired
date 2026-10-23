-- The initial pilot was correctly held by tenant-wide historical reply barriers.
-- Preserve it and authorize only the separately isolated second fixture ID.
DO $$ BEGIN
 IF current_database()<>'acquire_agent_mode' OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only' THEN RAISE EXCEPTION 'Exact marked isolated agent database required'; END IF;
END $$;
ALTER TABLE public.agent_simulator_test_policies DROP CONSTRAINT agent_simulator_test_policies_mandate_id_check;
ALTER TABLE public.agent_simulator_test_policies ADD CONSTRAINT agent_simulator_test_policies_mandate_id_check CHECK(mandate_id IN('e7da3f8c-8c45-4aef-bac4-392b918e0025'::uuid,'e7da3f8c-8c45-4aef-bac4-392b918e0026'::uuid));
-- No policy rows, owners, bindings, recipients, privileges, historical queues,
-- expiry bounds, initial/reply/follow-up rules or worker flags are changed.
