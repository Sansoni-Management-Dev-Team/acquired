CREATE TABLE "whatsapp_session_leases" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"owner_token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_session_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_session_leases" ADD CONSTRAINT "whatsapp_session_leases_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_session_lease_expiry_idx" ON "whatsapp_session_leases" USING btree ("expires_at");