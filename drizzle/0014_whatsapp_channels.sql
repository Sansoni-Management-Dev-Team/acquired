CREATE TABLE "whatsapp_auth_keys" (
	"connection_id" uuid NOT NULL,
	"key_type" text NOT NULL,
	"key_id" text NOT NULL,
	"encrypted_value" text NOT NULL,
	CONSTRAINT "whatsapp_auth_keys_connection_id_key_type_key_id_pk" PRIMARY KEY("connection_id","key_type","key_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_auth_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"address" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"encrypted_creds" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connection_status_check" CHECK ("whatsapp_connections"."status" IN ('disconnected','connecting','qr','connected','reconnecting','reconnect_required','error'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_auth_keys" ADD CONSTRAINT "whatsapp_auth_keys_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_owner_idx" ON "whatsapp_connections" USING btree ("organization_id","user_id");