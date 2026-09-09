-- One discovery job (slot 0) and two enrichment jobs (slots 1, 2) per organisation.
-- Existing jobs without executionSlot retain slot 0; no rows or evidence are removed.
CREATE UNIQUE INDEX "research_jobs_active_slot_idx" ON "research_jobs" USING btree ("organization_id", (COALESCE("config"->>'executionSlot', '0'))) WHERE "status" NOT IN ('complete', 'partial', 'failed', 'cancelled');
--> statement-breakpoint
DROP INDEX "research_jobs_active_org_idx";
