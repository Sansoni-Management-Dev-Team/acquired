CREATE TABLE "whatsapp_delivery_actions" (
	"connection_id" uuid NOT NULL,
	"action_key" text NOT NULL,
	"account_identity" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text NOT NULL,
	"encrypted_receipt" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_delivery_actions_connection_id_action_key_pk" PRIMARY KEY("connection_id","action_key"),
	CONSTRAINT "whatsapp_delivery_key_check" CHECK (length("whatsapp_delivery_actions"."action_key") BETWEEN 1 AND 200),
	CONSTRAINT "whatsapp_delivery_hash_check" CHECK (length("whatsapp_delivery_actions"."payload_hash") = 64),
	CONSTRAINT "whatsapp_delivery_state_check" CHECK ("whatsapp_delivery_actions"."state" IN ('submitting','submitted','unknown')),
	CONSTRAINT "whatsapp_delivery_receipt_check" CHECK (("whatsapp_delivery_actions"."state" = 'submitted') = ("whatsapp_delivery_actions"."encrypted_receipt" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_delivery_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_delivery_actions" ADD CONSTRAINT "whatsapp_delivery_actions_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_delivery_actions_capacity_idx" ON "whatsapp_delivery_actions" USING btree ("connection_id","claimed_at");