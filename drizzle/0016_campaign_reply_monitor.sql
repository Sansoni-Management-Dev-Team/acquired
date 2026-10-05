CREATE TABLE "campaign_reply_holds" (
	"organization_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "campaign_reply_holds_organization_id_contact_id_pk" PRIMARY KEY("organization_id","contact_id"),
	CONSTRAINT "campaign_reply_hold_channel_check" CHECK ("campaign_reply_holds"."channel" IN ('email','whatsapp','linkedin')),
	CONSTRAINT "campaign_reply_hold_reason_check" CHECK ("campaign_reply_holds"."reason" IN ('reply_received','reply_identity_ambiguous'))
);
--> statement-breakpoint
ALTER TABLE "campaign_reply_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_reply_identities" (
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"identity" text NOT NULL,
	"source_identity" text NOT NULL,
	"email" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	CONSTRAINT "campaign_reply_identities_organization_id_owner_user_id_contact_id_channel_identity_email_pk" PRIMARY KEY("organization_id","owner_user_id","contact_id","channel","identity","email"),
	CONSTRAINT "campaign_reply_identity_channel_check" CHECK ("campaign_reply_identities"."channel" IN ('email','whatsapp','linkedin'))
);
--> statement-breakpoint
ALTER TABLE "campaign_reply_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_reply_monitors" (
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_identity" text,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	CONSTRAINT "campaign_reply_monitors_organization_id_owner_user_id_channel_pk" PRIMARY KEY("organization_id","owner_user_id","channel"),
	CONSTRAINT "campaign_reply_monitor_channel_check" CHECK ("campaign_reply_monitors"."channel" IN ('email','whatsapp','linkedin'))
);
--> statement-breakpoint
ALTER TABLE "campaign_reply_monitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_reply_receipts" (
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_identity" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"from_identity" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "campaign_reply_receipts_organization_id_owner_user_id_channel_account_identity_provider_event_id_pk" PRIMARY KEY("organization_id","owner_user_id","channel","account_identity","provider_event_id"),
	CONSTRAINT "campaign_reply_receipt_channel_check" CHECK ("campaign_reply_receipts"."channel" IN ('email','whatsapp','linkedin'))
);
--> statement-breakpoint
ALTER TABLE "campaign_reply_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_reply_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"account_identity" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"remote_identity" text NOT NULL,
	"from_identity" text,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_reply_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_reply_holds" ADD CONSTRAINT "campaign_reply_holds_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_holds" ADD CONSTRAINT "campaign_reply_holds_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_identities" ADD CONSTRAINT "campaign_reply_identities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_identities" ADD CONSTRAINT "campaign_reply_identities_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_identities" ADD CONSTRAINT "campaign_reply_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_monitors" ADD CONSTRAINT "campaign_reply_monitors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_monitors" ADD CONSTRAINT "campaign_reply_monitors_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_receipts" ADD CONSTRAINT "campaign_reply_receipts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reply_receipts" ADD CONSTRAINT "campaign_reply_receipts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_reply_events" ADD CONSTRAINT "whatsapp_reply_events_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_reply_identity_match_idx" ON "campaign_reply_identities" USING btree ("organization_id","owner_user_id","channel","identity");--> statement-breakpoint
CREATE INDEX "campaign_reply_receipt_identity_idx" ON "campaign_reply_receipts" USING btree ("organization_id","owner_user_id","channel","from_identity","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_reply_event_provider_idx" ON "whatsapp_reply_events" USING btree ("connection_id","account_identity","provider_event_id");--> statement-breakpoint
CREATE INDEX "whatsapp_reply_event_cursor_idx" ON "whatsapp_reply_events" USING btree ("connection_id","account_identity","id");
--> statement-breakpoint
ALTER TABLE campaign_reply_identities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaign_reply_identities_user ON campaign_reply_identities TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));
--> statement-breakpoint
CREATE POLICY campaign_reply_identities_worker ON campaign_reply_identities TO acquire_campaign_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE campaign_reply_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaign_reply_receipts_user ON campaign_reply_receipts TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));
--> statement-breakpoint
CREATE POLICY campaign_reply_receipts_worker ON campaign_reply_receipts TO acquire_campaign_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE campaign_reply_monitors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaign_reply_monitors_user ON campaign_reply_monitors TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));
--> statement-breakpoint
CREATE POLICY campaign_reply_monitors_worker ON campaign_reply_monitors TO acquire_campaign_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE campaign_reply_holds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaign_reply_holds_user ON campaign_reply_holds TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true));
--> statement-breakpoint
CREATE POLICY campaign_reply_holds_worker ON campaign_reply_holds TO acquire_campaign_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE campaign_reply_identities ADD CONSTRAINT campaign_reply_identities_contact_org_fk FOREIGN KEY (contact_id,organization_id) REFERENCES contacts(id,organization_id);
--> statement-breakpoint
ALTER TABLE campaign_reply_holds ADD CONSTRAINT campaign_reply_holds_contact_org_fk FOREIGN KEY (contact_id,organization_id) REFERENCES contacts(id,organization_id);
--> statement-breakpoint
GRANT SELECT ON member TO acquire_campaign_worker;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON campaign_reply_identities,campaign_reply_monitors TO acquire_campaign_user;
--> statement-breakpoint
GRANT SELECT ON campaign_reply_receipts,campaign_reply_holds TO acquire_campaign_user;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON campaign_reply_identities,campaign_reply_monitors,campaign_reply_receipts,campaign_reply_holds TO acquire_campaign_worker;
