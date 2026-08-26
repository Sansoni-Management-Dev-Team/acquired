CREATE TYPE "public"."opportunity_qualification" AS ENUM('priority', 'develop', 'research', 'excluded');--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "financeability_score" integer;--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "qualification" "opportunity_qualification";