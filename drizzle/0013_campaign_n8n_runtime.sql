ALTER TABLE "campaign_enrolments" ADD COLUMN "runtime" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD COLUMN "n8n_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" ADD COLUMN "n8n_workflow_id" text;--> statement-breakpoint
CREATE INDEX "campaign_n8n_dispatch_idx" ON "campaign_enrolments" USING btree ("started_at") WHERE "campaign_enrolments"."runtime" = 'n8n' AND "campaign_enrolments"."n8n_started_at" IS NULL AND "campaign_enrolments"."state" IN ('active', 'paused', 'needs_review');--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_version_n8n_workflow_idx" ON "campaign_sequence_versions" USING btree ("n8n_workflow_id") WHERE "campaign_sequence_versions"."n8n_workflow_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_runtime_check" CHECK ("campaign_enrolments"."runtime" IN ('legacy', 'n8n'));--> statement-breakpoint
GRANT SELECT, UPDATE ON campaign_sequence_versions TO acquire_campaign_worker;--> statement-breakpoint
GRANT SELECT ON campaign_sequences TO acquire_campaign_worker;
