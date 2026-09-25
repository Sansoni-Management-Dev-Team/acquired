CREATE TABLE "campaign_contact_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD COLUMN "initial_conversation_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD COLUMN "last_reply_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_contact_holds" ADD CONSTRAINT "campaign_contact_holds_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contact_hold_email_idx" ON "campaign_contact_holds" USING btree ("organization_id","email");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_one_active_email_idx" ON "campaign_enrolments" ("organization_id", "recipient_email") WHERE "state" IN ('active', 'paused', 'needs_review');--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_recipient_email_lower_check" CHECK ("recipient_email" = lower("recipient_email"));
--> statement-breakpoint
ALTER TABLE "campaign_contact_holds" ADD CONSTRAINT "campaign_contact_holds_email_lower_check" CHECK ("email" = lower("email"));--> statement-breakpoint
ALTER TABLE "campaign_contact_holds" ADD CONSTRAINT "campaign_contact_holds_reason_check" CHECK ("reason" IN ('reply_received', 'opt_out'));--> statement-breakpoint
ALTER TABLE "campaign_contact_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_contact_holds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_contact_holds_scope" ON "campaign_contact_holds" USING ("organization_id" = current_setting('app.acquire_org', true) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK ("organization_id" = current_setting('app.acquire_org', true) OR current_setting('app.acquire_worker', true) = 'on');
