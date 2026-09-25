ALTER TABLE "campaign_contact_assignments" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contact_assignment_email_idx" ON "campaign_contact_assignments" USING btree ("organization_id","email");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contact_assignment_email_owner_fk_idx" ON "campaign_contact_assignments" ("organization_id", "email", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" ADD CONSTRAINT "campaign_contact_assignment_email_lower_check" CHECK ("email" = lower("email"));--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_email_owner_fk" FOREIGN KEY ("organization_id", "recipient_email", "owner_user_id") REFERENCES "campaign_contact_assignments" ("organization_id", "email", "owner_user_id");
