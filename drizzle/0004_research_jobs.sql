-- Requires explicit approval before applying to any database.
CREATE TABLE "research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"mandate_id" uuid NOT NULL,
	"target_id" uuid,
	"evidence_key" text NOT NULL,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence" jsonb NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mandate_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"config" jsonb NOT NULL,
	"seeds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovery_started" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT 'Queued' NOT NULL,
	"crawl_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_findings_evidence_idx" ON "research_findings" USING btree ("job_id","evidence_key");--> statement-breakpoint
CREATE INDEX "research_findings_mandate_idx" ON "research_findings" USING btree ("organization_id","mandate_id");--> statement-breakpoint
CREATE INDEX "research_jobs_mandate_idx" ON "research_jobs" USING btree ("organization_id","mandate_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_jobs_active_org_idx" ON "research_jobs" USING btree ("organization_id") WHERE "research_jobs"."status" NOT IN ('complete', 'partial', 'failed', 'cancelled');
