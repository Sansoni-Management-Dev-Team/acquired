-- Requires explicit approval before applying to any database.
CREATE TABLE "coverage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"mandate_id" uuid NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandate_targets" (
	"organization_id" text NOT NULL,
	"mandate_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"assessment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandate_targets_mandate_id_target_id_pk" PRIMARY KEY("mandate_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "valuation_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mandate_id" uuid NOT NULL,
	"observation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "coverage_runs" ADD CONSTRAINT "coverage_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_runs" ADD CONSTRAINT "coverage_runs_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_targets" ADD CONSTRAINT "mandate_targets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_targets" ADD CONSTRAINT "mandate_targets_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_targets" ADD CONSTRAINT "mandate_targets_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_observations" ADD CONSTRAINT "valuation_observations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_observations" ADD CONSTRAINT "valuation_observations_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coverage_runs_mandate_idx" ON "coverage_runs" USING btree ("organization_id","mandate_id");--> statement-breakpoint
CREATE INDEX "mandate_targets_org_idx" ON "mandate_targets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "valuations_mandate_idx" ON "valuation_observations" USING btree ("organization_id","mandate_id");--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "sequence_enrolments_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Preserve known historical membership without inventing additional relationships.
INSERT INTO "mandate_targets" ("organization_id", "mandate_id", "target_id")
SELECT t."organization_id", t."mandate_id", t."id" FROM "targets" t
JOIN "mandates" m ON m."id" = t."mandate_id" AND m."organization_id" = t."organization_id";
--> statement-breakpoint
UPDATE "sequence_enrolments" e SET "mandate_id" = t."mandate_id" FROM "targets" t
JOIN "mandates" m ON m."id" = t."mandate_id" AND m."organization_id" = t."organization_id"
WHERE e."target_id" = t."id" AND e."organization_id" = t."organization_id";
