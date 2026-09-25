CREATE TABLE "campaign_contact_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" ADD CONSTRAINT "campaign_contact_assignments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" ADD CONSTRAINT "campaign_contact_assignments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" ADD CONSTRAINT "campaign_contact_assignments_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contact_assignment_unique_idx" ON "campaign_contact_assignments" USING btree ("organization_id","contact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_contact_assignment_owner_fk_idx" ON "campaign_contact_assignments" ("organization_id", "contact_id", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" ADD CONSTRAINT "campaign_contact_assignment_contact_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_assigned_owner_fk" FOREIGN KEY ("organization_id", "contact_id", "owner_user_id") REFERENCES "campaign_contact_assignments" ("organization_id", "contact_id", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_contact_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_contact_assignment_scope" ON "campaign_contact_assignments" USING (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on');
