-- Prepared 2026-10-12 from a read-only remote/local comparison. NOT APPLIED.
-- Target ONLY: OrbStack 127.0.0.1:5434/project_acquire.
-- Requires explicit user approval for this exact artifact and target.
-- Enables the 24 RLS flags present on existing remote public tables.
-- No policies, grants, rows, credentials or Supabase provisioning hooks change.
-- Existing table owner remains exempt unless FORCE RLS is separately specified.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'project_acquire' THEN
    RAISE EXCEPTION 'Wrong database: expected project_acquire';
  END IF;
END $$;

ALTER TABLE public."account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."coverage_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."daily_send_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_company_people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_company_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_people_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_person_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."firmable_sync_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mock_mailbox_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."replies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."research_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."research_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sequence_enrolments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."valuation_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."verification" ENABLE ROW LEVEL SECURITY;
COMMIT;
