-- BLOCKED PROPOSAL: not approved, not applied, intentionally non-executable.
-- Local predecessor definitions may differ from production clocks/schema.
-- Before preparing production DDL, capture both production pg_get_functiondef
-- values and hashes, review a minimal original-conversation GUC delta, rehearse
-- that exact version, then request explicit approval for its hash and target.
DO $$ BEGIN RAISE EXCEPTION 'Production006 requires exact production predecessor capture and approval'; END $$;
