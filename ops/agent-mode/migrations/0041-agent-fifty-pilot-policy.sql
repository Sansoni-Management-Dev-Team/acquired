-- Extend the exact local fixture registry; no policy row or permission is created.
DO $$ BEGIN
 IF current_database()<>'acquire_agent_mode' OR (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM 'acquire-agent-mode-local-only' THEN RAISE EXCEPTION 'Exact marked isolated agent database required'; END IF;
END $$;
ALTER TABLE public.agent_simulator_test_policies
 DROP CONSTRAINT agent_simulator_test_policies_mandate_id_check,
 DROP CONSTRAINT agent_simulator_test_policies_integration_id_check,
 DROP CONSTRAINT agent_simulator_test_policies_recipient_domain_check;
ALTER TABLE public.agent_simulator_test_policies
 ADD CONSTRAINT agent_simulator_test_policies_fixture_check CHECK(
  (mandate_id IN('e7da3f8c-8c45-4aef-bac4-392b918e0025'::uuid,'e7da3f8c-8c45-4aef-bac4-392b918e0026'::uuid)
   AND integration_id='sim-agent-conversations-25-20261017'
   AND recipient_domain='agent-conversations-25-20261017.leads.acquire.test')
  OR
  (mandate_id='e7da3f8c-8c45-4aef-bac4-392b918e0050'::uuid
   AND integration_id='sim-agent-conversations-50-20261017'
   AND recipient_domain='agent-conversations-50-20261017.leads.acquire.test')
 );
-- Original ownership, binding/digest/generation, expiry, grants, RLS, chronology,
-- native sending policy, service quota and historical data remain unchanged.
