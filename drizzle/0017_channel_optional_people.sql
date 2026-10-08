ALTER TABLE "campaign_contact_assignments" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ALTER COLUMN "mailbox_connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ALTER COLUMN "recipient_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "target_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "display_name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD COLUMN "recipient_phone" text;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD COLUMN "recipient_linkedin" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_one_active_phone_idx" ON "campaign_enrolments" USING btree ("organization_id","recipient_phone") WHERE "campaign_enrolments"."state" IN ('active', 'paused', 'needs_review');--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_one_active_linkedin_idx" ON "campaign_enrolments" USING btree ("organization_id","recipient_linkedin") WHERE "campaign_enrolments"."state" IN ('active', 'paused', 'needs_review');--> statement-breakpoint
CREATE INDEX "contacts_org_mandate_idx" ON "contacts" USING btree ("organization_id","mandate_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_location_check" CHECK ("contacts"."target_id" IS NOT NULL OR "contacts"."mandate_id" IS NOT NULL);
--> statement-breakpoint
GRANT INSERT ON contacts TO acquire_campaign_user;
