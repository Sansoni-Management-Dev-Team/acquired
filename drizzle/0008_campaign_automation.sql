CREATE TABLE "campaign_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"sequence_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"mailbox_connection_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"stop_reason" text,
	"step_index" integer DEFAULT 0 NOT NULL,
	"next_step_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"from_identity" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"state" text DEFAULT 'claimed' NOT NULL,
	"rfc_message_id" text NOT NULL,
	"provider_message_id" text,
	"provider_thread_id" text,
	"error" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_sequence_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"sequence_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"mandate_id" uuid NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb NOT NULL,
	"published_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_sequence_id_campaign_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."campaign_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_version_id_campaign_sequence_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."campaign_sequence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolments_mailbox_connection_id_mailbox_connections_id_fk" FOREIGN KEY ("mailbox_connection_id") REFERENCES "public"."mailbox_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_inbound_events" ADD CONSTRAINT "campaign_inbound_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_inbound_events" ADD CONSTRAINT "campaign_inbound_events_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_inbound_events" ADD CONSTRAINT "campaign_inbound_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ADD CONSTRAINT "campaign_send_attempts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ADD CONSTRAINT "campaign_send_attempts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ADD CONSTRAINT "campaign_send_attempts_enrolment_id_campaign_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."campaign_enrolments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" ADD CONSTRAINT "campaign_sequence_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" ADD CONSTRAINT "campaign_sequence_versions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" ADD CONSTRAINT "campaign_sequence_versions_sequence_id_campaign_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."campaign_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequences" ADD CONSTRAINT "campaign_sequences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequences" ADD CONSTRAINT "campaign_sequences_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequences" ADD CONSTRAINT "campaign_sequences_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_enrolment_active_idx" ON "campaign_enrolments" USING btree ("organization_id","contact_id","sequence_id") WHERE "campaign_enrolments"."state" IN ('active', 'paused', 'needs_review');--> statement-breakpoint
CREATE INDEX "campaign_enrolment_due_idx" ON "campaign_enrolments" USING btree ("state","next_step_at");--> statement-breakpoint
CREATE INDEX "campaign_enrolment_contact_idx" ON "campaign_enrolments" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_inbound_provider_idx" ON "campaign_inbound_events" USING btree ("owner_user_id","channel","provider_event_id");--> statement-breakpoint
CREATE INDEX "campaign_inbound_contact_idx" ON "campaign_inbound_events" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_send_step_idx" ON "campaign_send_attempts" USING btree ("enrolment_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_send_rfc_id_idx" ON "campaign_send_attempts" USING btree ("rfc_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sequence_version_idx" ON "campaign_sequence_versions" USING btree ("sequence_id","version");--> statement-breakpoint
CREATE INDEX "campaign_sequences_owner_idx" ON "campaign_sequences" USING btree ("organization_id","owner_user_id","mandate_id");
--> statement-breakpoint
-- A send can never point at another user's mailbox, even if an API route is wrong.
CREATE UNIQUE INDEX "mailbox_connection_owner_fk_idx" ON "mailbox_connections" ("id", "organization_id", "user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_organization_fk_idx" ON "contacts" ("id", "organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_organization_fk_idx" ON "mandates" ("id", "organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sequence_owner_fk_idx" ON "campaign_sequences" ("id", "organization_id", "owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_version_owner_fk_idx" ON "campaign_sequence_versions" ("id", "organization_id", "owner_user_id", "sequence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_enrolment_owner_fk_idx" ON "campaign_enrolments" ("id", "organization_id", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_sequences" ADD CONSTRAINT "campaign_sequence_mandate_org_fk" FOREIGN KEY ("mandate_id", "organization_id") REFERENCES "mandates" ("id", "organization_id");--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" ADD CONSTRAINT "campaign_version_sequence_owner_fk" FOREIGN KEY ("sequence_id", "organization_id", "owner_user_id") REFERENCES "campaign_sequences" ("id", "organization_id", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_sequence_owner_fk" FOREIGN KEY ("sequence_id", "organization_id", "owner_user_id") REFERENCES "campaign_sequences" ("id", "organization_id", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_version_owner_fk" FOREIGN KEY ("version_id", "organization_id", "owner_user_id", "sequence_id") REFERENCES "campaign_sequence_versions" ("id", "organization_id", "owner_user_id", "sequence_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_mailbox_owner_fk" FOREIGN KEY ("mailbox_connection_id", "organization_id", "owner_user_id") REFERENCES "mailbox_connections" ("id", "organization_id", "user_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_contact_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_mandate_org_fk" FOREIGN KEY ("mandate_id", "organization_id") REFERENCES "mandates" ("id", "organization_id");--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ADD CONSTRAINT "campaign_send_enrolment_owner_fk" FOREIGN KEY ("enrolment_id", "organization_id", "owner_user_id") REFERENCES "campaign_enrolments" ("id", "organization_id", "owner_user_id");--> statement-breakpoint
ALTER TABLE "campaign_inbound_events" ADD CONSTRAINT "campaign_inbound_contact_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "contacts" ("id", "organization_id");--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_enrolment_state_check" CHECK ("state" IN ('active', 'paused', 'needs_review', 'completed', 'stopped'));--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ADD CONSTRAINT "campaign_send_state_check" CHECK ("state" IN ('claimed', 'sent', 'unknown', 'cancelled'));--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ADD CONSTRAINT "campaign_step_index_check" CHECK ("step_index" >= 0);--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ADD CONSTRAINT "campaign_send_step_index_check" CHECK ("step_index" >= 0);--> statement-breakpoint
-- Request and worker transactions set these LOCAL values. No context means no rows.
ALTER TABLE "campaign_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_sequences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_sequence_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_enrolments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_send_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_inbound_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_inbound_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_sequences_scope" ON "campaign_sequences" USING (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on');--> statement-breakpoint
CREATE POLICY "campaign_versions_scope" ON "campaign_sequence_versions" USING (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on');--> statement-breakpoint
CREATE POLICY "campaign_enrolments_scope" ON "campaign_enrolments" USING (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on');--> statement-breakpoint
CREATE POLICY "campaign_sends_scope" ON "campaign_send_attempts" USING (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on');--> statement-breakpoint
CREATE POLICY "campaign_inbound_scope" ON "campaign_inbound_events" USING (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on') WITH CHECK (("organization_id" = current_setting('app.acquire_org', true) AND "owner_user_id" = current_setting('app.acquire_user', true)) OR current_setting('app.acquire_worker', true) = 'on');
