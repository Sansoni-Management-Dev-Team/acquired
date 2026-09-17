CREATE TABLE "firmable_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"domain" text,
	"abn" text,
	"acn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firmable_company_people" (
	"firmable_company_id" text NOT NULL,
	"firmable_person_id" text NOT NULL,
	"latest_search_id" uuid,
	"search_record" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firmable_company_people_firmable_company_id_firmable_person_id_pk" PRIMARY KEY("firmable_company_id","firmable_person_id")
);
--> statement-breakpoint
CREATE TABLE "firmable_company_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"firmable_company_id" text,
	"logical_call_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb,
	"response_text" text,
	"http_status" integer,
	"successful" boolean DEFAULT false NOT NULL,
	"validation_error" text,
	"response_hash" text,
	"requested_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firmable_people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"linkedin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firmable_people_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"firmable_company_id" text,
	"logical_call_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb,
	"response_text" text,
	"http_status" integer,
	"successful" boolean DEFAULT false NOT NULL,
	"validation_error" text,
	"response_hash" text,
	"offset" integer,
	"requested_size" integer,
	"returned_count" integer,
	"reported_total" integer,
	"requested_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firmable_person_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"firmable_person_id" text,
	"logical_call_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb,
	"response_text" text,
	"http_status" integer,
	"successful" boolean DEFAULT false NOT NULL,
	"validation_error" text,
	"response_hash" text,
	"privacy_mode" text DEFAULT 'real' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firmable_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"target_id" uuid NOT NULL,
	"firmable_company_id" text,
	"request_key" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"company_status" text DEFAULT 'pending' NOT NULL,
	"search_status" text DEFAULT 'pending' NOT NULL,
	"profiles_found" integer DEFAULT 0 NOT NULL,
	"profiles_saved" integer DEFAULT 0 NOT NULL,
	"profiles_failed" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT 'Queued' NOT NULL,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "firmable_person_id" text;--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "firmable_company_id" text;--> statement-breakpoint
ALTER TABLE "firmable_company_people" ADD CONSTRAINT "firmable_company_people_firmable_company_id_firmable_companies_id_fk" FOREIGN KEY ("firmable_company_id") REFERENCES "public"."firmable_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_company_people" ADD CONSTRAINT "firmable_company_people_firmable_person_id_firmable_people_id_fk" FOREIGN KEY ("firmable_person_id") REFERENCES "public"."firmable_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_company_people" ADD CONSTRAINT "firmable_company_people_latest_search_id_firmable_people_searches_id_fk" FOREIGN KEY ("latest_search_id") REFERENCES "public"."firmable_people_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_company_responses" ADD CONSTRAINT "firmable_company_responses_run_id_firmable_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."firmable_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_company_responses" ADD CONSTRAINT "firmable_company_responses_firmable_company_id_firmable_companies_id_fk" FOREIGN KEY ("firmable_company_id") REFERENCES "public"."firmable_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_people_searches" ADD CONSTRAINT "firmable_people_searches_run_id_firmable_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."firmable_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_people_searches" ADD CONSTRAINT "firmable_people_searches_firmable_company_id_firmable_companies_id_fk" FOREIGN KEY ("firmable_company_id") REFERENCES "public"."firmable_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_person_responses" ADD CONSTRAINT "firmable_person_responses_run_id_firmable_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."firmable_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_person_responses" ADD CONSTRAINT "firmable_person_responses_firmable_person_id_firmable_people_id_fk" FOREIGN KEY ("firmable_person_id") REFERENCES "public"."firmable_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_sync_runs" ADD CONSTRAINT "firmable_sync_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_sync_runs" ADD CONSTRAINT "firmable_sync_runs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_sync_runs" ADD CONSTRAINT "firmable_sync_runs_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firmable_sync_runs" ADD CONSTRAINT "firmable_sync_runs_firmable_company_id_firmable_companies_id_fk" FOREIGN KEY ("firmable_company_id") REFERENCES "public"."firmable_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firmable_companies_domain_idx" ON "firmable_companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "firmable_companies_abn_idx" ON "firmable_companies" USING btree ("abn");--> statement-breakpoint
CREATE INDEX "firmable_company_people_active_idx" ON "firmable_company_people" USING btree ("firmable_company_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_company_attempt_idx" ON "firmable_company_responses" USING btree ("run_id","logical_call_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_company_backfill_idx" ON "firmable_company_responses" USING btree ("logical_call_id") WHERE "run_id" IS NULL;--> statement-breakpoint
CREATE INDEX "firmable_company_latest_idx" ON "firmable_company_responses" USING btree ("firmable_company_id","successful","fetched_at");--> statement-breakpoint
CREATE INDEX "firmable_people_linkedin_idx" ON "firmable_people" USING btree ("linkedin");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_people_search_attempt_idx" ON "firmable_people_searches" USING btree ("run_id","logical_call_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_people_search_backfill_idx" ON "firmable_people_searches" USING btree ("logical_call_id") WHERE "run_id" IS NULL;--> statement-breakpoint
CREATE INDEX "firmable_people_search_latest_idx" ON "firmable_people_searches" USING btree ("firmable_company_id","successful","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_person_attempt_idx" ON "firmable_person_responses" USING btree ("run_id","logical_call_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_person_backfill_idx" ON "firmable_person_responses" USING btree ("logical_call_id") WHERE "run_id" IS NULL;--> statement-breakpoint
CREATE INDEX "firmable_person_latest_idx" ON "firmable_person_responses" USING btree ("firmable_person_id","successful","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "firmable_sync_runs_request_idx" ON "firmable_sync_runs" USING btree ("organization_id","request_key");--> statement-breakpoint
CREATE INDEX "firmable_sync_runs_target_idx" ON "firmable_sync_runs" USING btree ("organization_id","target_id","created_at");--> statement-breakpoint
CREATE INDEX "firmable_sync_runs_company_idx" ON "firmable_sync_runs" USING btree ("firmable_company_id","created_at");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_firmable_person_id_firmable_people_id_fk" FOREIGN KEY ("firmable_person_id") REFERENCES "public"."firmable_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_firmable_company_id_firmable_companies_id_fk" FOREIGN KEY ("firmable_company_id") REFERENCES "public"."firmable_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_firmable_person_idx" ON "contacts" USING btree ("firmable_person_id");--> statement-breakpoint
CREATE INDEX "contacts_target_firmable_person_idx" ON "contacts" USING btree ("organization_id","target_id","firmable_person_id");--> statement-breakpoint
CREATE INDEX "targets_firmable_company_idx" ON "targets" USING btree ("firmable_company_id");
--> statement-breakpoint
-- Backfill shared company identities before linking organisation targets. Raw
-- legacy JSON remains in place for rollback and comparison.
INSERT INTO "firmable_companies" ("id", "name", "domain", "abn", "acn", "created_at", "updated_at")
SELECT DISTINCT ON (firmable_id)
  firmable_id,
  COALESCE(NULLIF(firmable->>'name', ''), t."company_name"),
  NULLIF(lower(regexp_replace(COALESCE(NULLIF(firmable->>'domain', ''), NULLIF(t."domain", '')), '^www\.', '')), ''),
  NULLIF(regexp_replace(COALESCE(NULLIF(firmable->>'abn', ''), t."identifiers"->>'abn', ''), '\D', '', 'g'), ''),
  NULLIF(COALESCE(firmable->>'acn', t."identifiers"->>'acn'), ''),
  t."created_at", t."updated_at"
FROM "targets" t
CROSS JOIN LATERAL (SELECT COALESCE(t."firmographics"->'firmable', '{}'::jsonb) AS firmable) source
CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(source.firmable->>'firmableId', ''), NULLIF(t."identifiers"->>'firmableId', ''), NULLIF(source.firmable->'rawResponse'->>'id', '')) AS firmable_id) identity
WHERE firmable_id IS NOT NULL
ORDER BY firmable_id, t."updated_at" DESC
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "targets" t
SET "firmable_company_id" = COALESCE(NULLIF(t."firmographics"->'firmable'->>'firmableId', ''), NULLIF(t."identifiers"->>'firmableId', ''), NULLIF(t."firmographics"->'firmable'->'rawResponse'->>'id', ''))
WHERE "firmable_company_id" IS NULL
  AND COALESCE(NULLIF(t."firmographics"->'firmable'->>'firmableId', ''), NULLIF(t."identifiers"->>'firmableId', ''), NULLIF(t."firmographics"->'firmable'->'rawResponse'->>'id', '')) IN (SELECT "id" FROM "firmable_companies");
--> statement-breakpoint
INSERT INTO "firmable_company_responses" ("firmable_company_id", "logical_call_id", "attempt", "request", "response", "http_status", "successful", "response_hash", "requested_at", "fetched_at")
SELECT t."firmable_company_id", 'backfill:target:' || t."id"::text, 1, jsonb_build_object('source', 'backfill', 'targetId', t."id"), raw.raw_response, 200, true, md5(raw.raw_response::text), captured.fetched_at, captured.fetched_at
FROM "targets" t
CROSS JOIN LATERAL (SELECT t."firmographics"->'firmable'->'rawResponse' AS raw_response) raw
CROSS JOIN LATERAL (SELECT COALESCE(CASE WHEN t."firmographics"->'firmable'->>'capturedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (t."firmographics"->'firmable'->>'capturedAt')::timestamptz END, t."updated_at") AS fetched_at) captured
WHERE t."firmable_company_id" IS NOT NULL AND jsonb_typeof(raw.raw_response) = 'object'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "firmable_people" ("id", "name", "linkedin", "created_at", "updated_at")
SELECT DISTINCT ON (person_id) person_id,
  COALESCE(NULLIF(profile->>'name', ''), NULLIF(profile->>'full_name', ''), NULLIF(c."display_name", '')),
  COALESCE(NULLIF(profile->>'linkedin', ''), NULLIF(profile->>'linkedin_url', '')),
  c."created_at", c."created_at"
FROM "contacts" c
CROSS JOIN LATERAL (SELECT c."personal_data"->'firmable'->'personProfile' AS profile) raw
CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(raw.profile->>'id', ''), NULLIF(c."personal_data"->>'firmablePersonId', '')) AS person_id) identity
WHERE person_id IS NOT NULL
ORDER BY person_id, c."created_at" DESC
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "contacts" c
SET "firmable_person_id" = COALESCE(NULLIF(c."personal_data"->'firmable'->'personProfile'->>'id', ''), NULLIF(c."personal_data"->>'firmablePersonId', ''))
WHERE "firmable_person_id" IS NULL
  AND COALESCE(NULLIF(c."personal_data"->'firmable'->'personProfile'->>'id', ''), NULLIF(c."personal_data"->>'firmablePersonId', '')) IN (SELECT "id" FROM "firmable_people");
--> statement-breakpoint
INSERT INTO "firmable_person_responses" ("firmable_person_id", "logical_call_id", "attempt", "request", "response", "http_status", "successful", "response_hash", "privacy_mode", "requested_at", "fetched_at")
SELECT c."firmable_person_id", 'backfill:contact:' || c."id"::text, 1, jsonb_build_object('source', 'backfill', 'contactId', c."id"), raw.profile, 200, true, md5(raw.profile::text), 'real', captured.fetched_at, captured.fetched_at
FROM "contacts" c
CROSS JOIN LATERAL (SELECT c."personal_data"->'firmable'->'personProfile' AS profile) raw
CROSS JOIN LATERAL (SELECT COALESCE(CASE WHEN c."provenance"->>'capturedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (c."provenance"->>'capturedAt')::timestamptz END, c."created_at") AS fetched_at) captured
WHERE c."firmable_person_id" IS NOT NULL AND jsonb_typeof(raw.profile) = 'object'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "firmable_people_searches" ("firmable_company_id", "logical_call_id", "attempt", "request", "response", "http_status", "successful", "response_hash", "returned_count", "requested_at", "fetched_at")
SELECT t."firmable_company_id", 'backfill:contact-search:' || c."id"::text, 1, jsonb_build_object('source', 'backfill', 'contactId', c."id", 'complete', false), raw.search_result, 200, true, md5(raw.search_result::text), 1, captured.fetched_at, captured.fetched_at
FROM "contacts" c
JOIN "targets" t ON t."id" = c."target_id"
CROSS JOIN LATERAL (SELECT c."personal_data"->'firmable'->'searchResult' AS search_result) raw
CROSS JOIN LATERAL (SELECT COALESCE(CASE WHEN c."provenance"->>'capturedAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN (c."provenance"->>'capturedAt')::timestamptz END, c."created_at") AS fetched_at) captured
WHERE t."firmable_company_id" IS NOT NULL AND jsonb_typeof(raw.search_result) = 'object'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "firmable_company_people" ("firmable_company_id", "firmable_person_id", "latest_search_id", "search_record", "active", "generation", "first_seen_at", "last_seen_at")
SELECT t."firmable_company_id", c."firmable_person_id", search."id", COALESCE(c."personal_data"->'firmable'->'searchResult', '{}'::jsonb), true, 1, c."created_at", c."created_at"
FROM "contacts" c
JOIN "targets" t ON t."id" = c."target_id"
LEFT JOIN "firmable_people_searches" search ON search."logical_call_id" = 'backfill:contact-search:' || c."id"::text
WHERE t."firmable_company_id" IS NOT NULL AND c."firmable_person_id" IS NOT NULL
ON CONFLICT ("firmable_company_id", "firmable_person_id") DO UPDATE SET
  "search_record" = EXCLUDED."search_record",
  "latest_search_id" = COALESCE(EXCLUDED."latest_search_id", "firmable_company_people"."latest_search_id"),
  "active" = true,
  "last_seen_at" = GREATEST("firmable_company_people"."last_seen_at", EXCLUDED."last_seen_at"),
  "updated_at" = now();
