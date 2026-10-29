-- Fresh dedicated DigitalOcean test database only. DBOS 5.3.0 plus research coordinator state.
-- Not a production upgrade script. Apply once, after specific approval.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'acquire_research_do_test' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('dbos','research_service')) THEN RAISE EXCEPTION 'Expected an empty research database'; END IF;
END $$;
CREATE SCHEMA research_service;
CREATE TABLE research_service.identity (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), marker text NOT NULL CHECK(marker='acquire-research-do-test-only'));
INSERT INTO research_service.identity(marker) VALUES ('acquire-research-do-test-only');
CREATE TABLE research_service.state(namespace text NOT NULL, key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(namespace,key));

-- SDK migration 1: 20240123182943_schema
CREATE SCHEMA IF NOT EXISTS "dbos";

-- SDK migration 2: 20240123182944_dbos_migrations
create table "dbos"."dbos_migrations" ("version" bigint not null, constraint "dbos_migrations_pkey" primary key ("version"));

-- SDK migration 3: 20240123183021_tables
create table "dbos"."operation_outputs" ("workflow_uuid" text not null, "function_id" int4 not null, "function_name" text not null default '', "output" text, "error" text, constraint "operation_outputs_pkey" primary key ("workflow_uuid", "function_id"));
create table "dbos"."workflow_inputs" ("workflow_uuid" text not null, "inputs" text not null, constraint "workflow_inputs_pkey" primary key ("workflow_uuid"));
create table "dbos"."workflow_status" ("workflow_uuid" text, "status" text, "name" text, "authenticated_user" text, "assumed_role" text, "authenticated_roles" text, "request" text, "output" text, "error" text, "executor_id" text, constraint "workflow_status_pkey" primary key ("workflow_uuid"));
create table "dbos"."notifications" ("message_uuid" text not null default gen_random_uuid(), "destination_uuid" text not null, "topic" text, "message" text not null, "created_at_epoch_ms" bigint not null default (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint);
create table "dbos"."workflow_events" ("workflow_uuid" text not null, "key" text not null, "value" text not null, constraint "workflow_events_pkey" primary key ("workflow_uuid", "key"));

-- SDK migration 4: 20240123183025_indexes
create index "idx_workflow_topic" on "dbos"."notifications" ("destination_uuid", "topic");

-- SDK migration 5: 20240123183030_triggers
CREATE OR REPLACE FUNCTION "dbos".notifications_function() RETURNS TRIGGER AS $$
    DECLARE
        payload text := NEW.destination_uuid || '::' || NEW.topic;
    BEGIN
        PERFORM pg_notify('dbos_notifications_channel', payload);
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;;
CREATE TRIGGER dbos_notifications_trigger
    AFTER INSERT ON "dbos".notifications
    FOR EACH ROW EXECUTE FUNCTION "dbos".notifications_function();;
CREATE OR REPLACE FUNCTION "dbos".workflow_events_function() RETURNS TRIGGER AS $$
    DECLARE
        payload text := NEW.workflow_uuid || '::' || NEW.key;
    BEGIN
        PERFORM pg_notify('dbos_workflow_events_channel', payload);
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;;
CREATE TRIGGER dbos_workflow_events_trigger
    AFTER INSERT ON "dbos".workflow_events
    FOR EACH ROW EXECUTE FUNCTION "dbos".workflow_events_function();;

-- SDK migration 6: 20240124015239_status_timestamp
alter table "dbos"."workflow_status" add column "created_at" bigint not null default (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint, add column "updated_at" bigint not null default (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint;

-- SDK migration 7: 20240201213211_replica_identity
alter table "dbos"."notifications" add column if not exists "message_uuid" text not null default gen_random_uuid();
alter table "dbos"."notifications" add constraint "notifications_pkey" primary key ("message_uuid");

-- SDK migration 8: 20240205223925_foreign_keys
create index "workflow_status_created_at_index" on "dbos"."workflow_status" ("created_at");
alter table "dbos"."operation_outputs" add constraint "operation_outputs_workflow_uuid_foreign" foreign key ("workflow_uuid") references "dbos"."workflow_status" ("workflow_uuid") on update CASCADE on delete CASCADE;
alter table "dbos"."workflow_inputs" add constraint "workflow_inputs_workflow_uuid_foreign" foreign key ("workflow_uuid") references "dbos"."workflow_status" ("workflow_uuid") on update CASCADE on delete CASCADE;
alter table "dbos"."notifications" add constraint "notifications_destination_uuid_fkey" foreign key ("destination_uuid") references "dbos"."workflow_status" ("workflow_uuid") on update CASCADE on delete CASCADE;
alter table "dbos"."workflow_events" add constraint "workflow_events_workflow_uuid_fkey" foreign key ("workflow_uuid") references "dbos"."workflow_status" ("workflow_uuid") on update CASCADE on delete CASCADE;

-- SDK migration 9: 20240207192338_executor_id_index
create index "workflow_status_executor_id_index" on "dbos"."workflow_status" ("executor_id");

-- SDK migration 10: 20240430090000_tables
create table "dbos"."scheduler_state" ("workflow_fn_name" text not null, "last_run_time" bigint not null, constraint "scheduler_state_pkey" primary key ("workflow_fn_name"));

-- SDK migration 11: 20240516004341_application_version
alter table "dbos"."workflow_status" add column "application_version" text, add column "application_id" text;

-- SDK migration 12: 20240517000000_status_class_config
alter table "dbos"."workflow_status" add column "class_name" varchar(255) default null, add column "config_name" varchar(255) default null;

-- SDK migration 13: 20240621000000_workflow_tries
alter table "dbos"."workflow_status" add column "recovery_attempts" bigint default 0;

-- SDK migration 14: 20240924000000_workflowqueue
alter table "dbos"."workflow_status" add column "queue_name" text default null;
create table "dbos"."workflow_queue" ("queue_name" text not null, "workflow_uuid" text not null, "created_at_epoch_ms" bigint not null default (EXTRACT(EPOCH FROM now())*1000)::bigint, "started_at_epoch_ms" bigint, "completed_at_epoch_ms" bigint, constraint "workflow_queue_pkey" primary key ("workflow_uuid"));
alter table "dbos"."workflow_queue" add constraint "workflow_queue_workflow_uuid_foreign" foreign key ("workflow_uuid") references "dbos"."workflow_status" ("workflow_uuid") on update CASCADE on delete CASCADE;

-- SDK migration 15: 20241009150000_event_dispatch_kv
create table "dbos"."event_dispatch_kv" ("service_name" text not null, "workflow_fn_name" text not null, "key" text not null, "value" text, "update_seq" decimal(38, 0), "update_time" decimal(38, 15), constraint "event_dispatch_kv_pkey" primary key ("service_name", "workflow_fn_name", "key"));

-- SDK migration 16: 20250312171547_function_name_op_outputs
alter table "dbos"."operation_outputs" add column if not exists "function_name" text not null default '';

-- SDK migration 17: 20250319190617_add_childid_opoutputs
alter table "dbos"."operation_outputs" add column "child_workflow_id" text;

-- SDK migration 18: 20252101000000_workflow_queues_executor_id
alter table "dbos"."workflow_queue" add column "executor_id" text;

-- SDK migration 19: 20252501190959_queue_dedup_id
alter table "dbos"."workflow_queue" add column "deduplication_id" text;
alter table "dbos"."workflow_queue" add constraint "workflow_queue_queue_name_deduplication_id_unique" unique ("queue_name", "deduplication_id");

-- SDK migration 20: 20252505000000_workflow_timeout
alter table "dbos"."workflow_status" add column "workflow_timeout_ms" bigint, add column "workflow_deadline_epoch_ms" bigint;

-- SDK migration 21: 20252512000000_queue_priority
alter table "dbos"."workflow_queue" add column "priority" int4 not null default '0';

-- SDK migration 22: 20252523000000_consolidate_inputs
alter table "dbos"."workflow_status" add column "inputs" text null;

-- SDK migration 23: 20252528000000_consolidate_queues
alter table "dbos"."workflow_status" add column "started_at_epoch_ms" bigint null, add column "deduplication_id" text null, add column "priority" int4 not null default '0';
alter table "dbos"."workflow_status" add constraint "uq_workflow_status_queue_name_dedup_id" unique ("queue_name", "deduplication_id");
create index "workflow_status_status_index" on "dbos"."workflow_status" ("status");

-- SDK migration 24: 20252806000000_streaming
create table "dbos"."streams" ("workflow_uuid" text not null, "key" text not null, "value" text not null, "offset" int4 not null, constraint "streams_pkey" primary key ("workflow_uuid", "key", "offset"));
alter table "dbos"."streams" add constraint "streams_workflow_uuid_fkey" foreign key ("workflow_uuid") references "dbos"."workflow_status" ("workflow_uuid") on update CASCADE on delete CASCADE;

-- SDK migration 25: 20252810000000_partitioned_queues
alter table "dbos"."workflow_status" add column "queue_partition_key" text;

-- SDK migration 26: 20252950000000_workflow_status_queue_status_started_index
create index "idx_workflow_status_queue_status_started" on "dbos"."workflow_status" ("queue_name", "status", "started_at_epoch_ms");

-- SDK migration 27: unnamed
ALTER TABLE "dbos".workflow_status ADD COLUMN forked_from TEXT;;
create index "idx_workflow_status_forked_from" on "dbos"."workflow_status" ("forked_from");

-- SDK migration 28: unnamed
ALTER TABLE "dbos".operation_outputs ADD COLUMN started_at_epoch_ms BIGINT, ADD COLUMN completed_at_epoch_ms BIGINT;;

-- SDK migration 29: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN "owner_xid" TEXT DEFAULT NULL;

-- SDK migration 30: unnamed

        CREATE TABLE "dbos".workflow_events_history (
            workflow_uuid TEXT NOT NULL,
            function_id INT4 NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (workflow_uuid, function_id, key),
            FOREIGN KEY (workflow_uuid) REFERENCES "dbos".workflow_status(workflow_uuid)
                ON UPDATE CASCADE ON DELETE CASCADE
        );
        ;
ALTER TABLE "dbos".streams ADD COLUMN function_id INT4 NOT NULL DEFAULT 0;;

-- SDK migration 31: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN "parent_workflow_id" TEXT DEFAULT NULL;;
CREATE INDEX "idx_workflow_status_parent_workflow_id" ON "dbos"."workflow_status" ("parent_workflow_id");;

-- SDK migration 32: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN "serialization" TEXT DEFAULT NULL;
ALTER TABLE "dbos"."notifications" ADD COLUMN "serialization" TEXT DEFAULT NULL;
ALTER TABLE "dbos"."workflow_events" ADD COLUMN "serialization" TEXT DEFAULT NULL;
ALTER TABLE "dbos"."workflow_events_history" ADD COLUMN "serialization" TEXT DEFAULT NULL;
ALTER TABLE "dbos"."operation_outputs" ADD COLUMN "serialization" TEXT DEFAULT NULL;
ALTER TABLE "dbos"."streams" ADD COLUMN "serialization" TEXT DEFAULT NULL;

-- SDK migration 33: unnamed
CREATE TABLE "dbos"."workflow_schedules" (
          schedule_id TEXT PRIMARY KEY,
          schedule_name TEXT NOT NULL UNIQUE,
          workflow_name TEXT NOT NULL,
          workflow_class_name TEXT,
          schedule TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          context TEXT NOT NULL
        );

-- SDK migration 34: unnamed
ALTER TABLE "dbos"."notifications" ADD COLUMN "consumed" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "idx_notifications" ON "dbos"."notifications" ("destination_uuid", "topic");

-- SDK migration 35: unnamed
CREATE TABLE "dbos"."application_versions" (
          "version_id" TEXT NOT NULL,
          "version_name" TEXT NOT NULL UNIQUE,
          "version_timestamp" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint,
          "created_at" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint,
          CONSTRAINT "application_versions_pkey" PRIMARY KEY ("version_id")
        );

-- SDK migration 36: unnamed
CREATE FUNCTION "dbos".enqueue_workflow(
            workflow_name TEXT,
            queue_name TEXT,
            positional_args JSON[] DEFAULT ARRAY[]::JSON[],
            named_args JSON DEFAULT '{}'::JSON,
            class_name TEXT DEFAULT NULL,
            config_name TEXT DEFAULT NULL,
            workflow_id TEXT DEFAULT NULL,
            app_version TEXT DEFAULT NULL,
            timeout_ms BIGINT DEFAULT NULL,
            deadline_epoch_ms BIGINT DEFAULT NULL,
            deduplication_id TEXT DEFAULT NULL,
            priority INTEGER DEFAULT NULL,
            queue_partition_key TEXT DEFAULT NULL
        ) RETURNS TEXT AS $$
        DECLARE
            v_workflow_id TEXT;
            v_serialized_inputs TEXT;
            v_owner_xid TEXT;
            v_now BIGINT;
            v_recovery_attempts INTEGER := 0;
            v_priority INTEGER;
        BEGIN

            -- Validate required parameters
            IF workflow_name IS NULL OR workflow_name = '' THEN
                RAISE EXCEPTION 'Workflow name cannot be null or empty';
            END IF;
            IF queue_name IS NULL OR queue_name = '' THEN
                RAISE EXCEPTION 'Queue name cannot be null or empty';
            END IF;
            IF named_args IS NOT NULL AND jsonb_typeof(named_args::jsonb) != 'object' THEN
                RAISE EXCEPTION 'Named args must be a JSON object';
            END IF;
            IF workflow_id IS NOT NULL AND workflow_id = '' THEN
                RAISE EXCEPTION 'Workflow ID cannot be an empty string if provided.';
            END IF;

            v_workflow_id := COALESCE(workflow_id, gen_random_uuid()::TEXT);
            v_owner_xid := gen_random_uuid()::TEXT;
            v_priority := COALESCE(priority, 0);
            v_serialized_inputs := json_build_object(
                'positionalArgs', positional_args,
                'namedArgs', named_args
            )::TEXT;
            v_now := EXTRACT(epoch FROM now()) * 1000;

            INSERT INTO "dbos".workflow_status (
                workflow_uuid, status, inputs,
                name, class_name, config_name,
                queue_name, deduplication_id, priority, queue_partition_key,
                application_version,
                created_at, updated_at, recovery_attempts,
                workflow_timeout_ms, workflow_deadline_epoch_ms,
                parent_workflow_id, owner_xid, serialization
            ) VALUES (
                v_workflow_id, 'ENQUEUED', v_serialized_inputs,
                workflow_name, class_name, config_name,
                queue_name, deduplication_id, v_priority, queue_partition_key,
                app_version,
                v_now, v_now, v_recovery_attempts,
                timeout_ms, deadline_epoch_ms,
                NULL, v_owner_xid, 'portable_json'
            )
            ON CONFLICT (workflow_uuid)
            DO UPDATE SET
                updated_at = EXCLUDED.updated_at;

            RETURN v_workflow_id;

        EXCEPTION
            WHEN unique_violation THEN
                RAISE EXCEPTION 'DBOS queue duplicated'
                   USING DETAIL = format('Workflow %s with queue %s and deduplication ID %s already exists', v_workflow_id, queue_name, deduplication_id),
                        ERRCODE = 'unique_violation';
        END;
        $$ LANGUAGE plpgsql;;
CREATE FUNCTION "dbos".send_message(
            destination_id TEXT,
            message JSON,
            topic TEXT DEFAULT NULL,
            message_id TEXT DEFAULT NULL
        ) RETURNS VOID AS $$
        DECLARE
            v_topic TEXT := COALESCE(topic, '__null__topic__');
            v_message_id TEXT := COALESCE(message_id, gen_random_uuid()::TEXT);
        BEGIN
            INSERT INTO "dbos".notifications (
                destination_uuid, topic, message, message_uuid, serialization
            ) VALUES (
                destination_id, v_topic, message, v_message_id, 'portable_json'
            )
            ON CONFLICT (message_uuid) DO NOTHING;
        EXCEPTION
            WHEN foreign_key_violation THEN
                RAISE EXCEPTION 'DBOS non-existent workflow'
                   USING DETAIL = format('Destination workflow %s does not exist', destination_id),
                        ERRCODE = 'foreign_key_violation';
        END;
        $$ LANGUAGE plpgsql;;

-- SDK migration 37: unnamed
ALTER TABLE "dbos"."workflow_schedules" ADD COLUMN "last_fired_at" TEXT DEFAULT NULL;
ALTER TABLE "dbos"."workflow_schedules" ADD COLUMN "automatic_backfill" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "dbos"."workflow_schedules" ADD COLUMN "cron_timezone" TEXT DEFAULT NULL;

-- SDK migration 38: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN "delay_until_epoch_ms" BIGINT DEFAULT NULL;
CREATE INDEX "idx_workflow_status_delayed" ON "dbos"."workflow_status" ("delay_until_epoch_ms") WHERE status = 'DELAYED';

-- SDK migration 39: unnamed
ALTER TABLE "dbos"."workflow_schedules" ADD COLUMN "queue_name" TEXT DEFAULT NULL;

-- SDK migration 40: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN "was_forked_from" BOOLEAN NOT NULL DEFAULT FALSE;

-- SDK migration 41: unnamed
CREATE INDEX "idx_operation_outputs_completed_at_function_name" ON "dbos"."operation_outputs" ("completed_at_epoch_ms", "function_name");

-- SDK migration 42: unnamed
ALTER FUNCTION "dbos".enqueue_workflow(
            TEXT, TEXT, JSON[], JSON, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, INTEGER, TEXT
        ) SET search_path = pg_catalog, pg_temp;;
ALTER FUNCTION "dbos".send_message(
            TEXT, JSON, TEXT, TEXT
        ) SET search_path = pg_catalog, pg_temp;;
ALTER FUNCTION "dbos".notifications_function() SET search_path = pg_catalog, pg_temp;;
ALTER FUNCTION "dbos".workflow_events_function() SET search_path = pg_catalog, pg_temp;;

-- SDK migration 43: unnamed
CREATE TABLE "dbos"."queues" (
          "queue_id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
          "name" TEXT NOT NULL UNIQUE,
          "concurrency" INT4,
          "worker_concurrency" INT4,
          "rate_limit_max" INT4,
          "rate_limit_period_sec" DOUBLE PRECISION,
          "priority_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
          "partition_queue" BOOLEAN NOT NULL DEFAULT FALSE,
          "polling_interval_sec" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
          "created_at" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint,
          "updated_at" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000.0)::bigint
        );

-- SDK migration 44: unnamed
DROP INDEX IF EXISTS "dbos"."idx_workflow_status_forked_from";

-- SDK migration 45: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_forked_from" ON "dbos"."workflow_status" ("forked_from") WHERE "forked_from" IS NOT NULL;

-- SDK migration 46: unnamed
DROP INDEX IF EXISTS "dbos"."idx_workflow_status_parent_workflow_id";

-- SDK migration 47: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_parent_workflow_id" ON "dbos"."workflow_status" ("parent_workflow_id") WHERE "parent_workflow_id" IS NOT NULL;

-- SDK migration 48: unnamed
DROP INDEX IF EXISTS "dbos"."workflow_status_executor_id_index";

-- SDK migration 49: unnamed
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workflow_status_dedup_id" ON "dbos"."workflow_status" ("queue_name", "deduplication_id") WHERE "deduplication_id" IS NOT NULL;

-- SDK migration 50: unnamed
ALTER TABLE "dbos"."workflow_status" DROP CONSTRAINT IF EXISTS "uq_workflow_status_queue_name_dedup_id";

-- SDK migration 51: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_pending" ON "dbos"."workflow_status" ("created_at") WHERE "status" = 'PENDING';

-- SDK migration 52: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_failed" ON "dbos"."workflow_status" ("status", "created_at") WHERE "status" IN ('ERROR', 'CANCELLED', 'MAX_RECOVERY_ATTEMPTS_EXCEEDED');

-- SDK migration 53: unnamed
DROP INDEX IF EXISTS "dbos"."workflow_status_status_index";

-- SDK migration 54: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_in_flight" ON "dbos"."workflow_status" ("queue_name", "status", "priority", "created_at") WHERE "status" IN ('ENQUEUED', 'PENDING');

-- SDK migration 55: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "rate_limited" BOOLEAN NOT NULL DEFAULT FALSE;

-- SDK migration 56: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_rate_limited" ON "dbos"."workflow_status" ("queue_name", "started_at_epoch_ms") WHERE "rate_limited" = TRUE;

-- SDK migration 57: unnamed
DROP INDEX IF EXISTS "dbos"."idx_workflow_status_queue_status_started";

-- SDK migration 58: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "completed_at" BIGINT;
CREATE INDEX IF NOT EXISTS "idx_workflow_status_completed_at" ON "dbos"."workflow_status" ("completed_at") WHERE "completed_at" IS NOT NULL;

-- SDK migration 59: unnamed
CREATE INDEX IF NOT EXISTS "idx_workflow_status_started_at" ON "dbos"."workflow_status" ("started_at_epoch_ms") WHERE "started_at_epoch_ms" IS NOT NULL;

-- SDK migration 60: unnamed
DROP FUNCTION IF EXISTS "dbos".enqueue_workflow(
            TEXT, TEXT, JSON[], JSON, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, INTEGER, TEXT
        );
CREATE OR REPLACE FUNCTION "dbos".enqueue_workflow(
            workflow_name TEXT,
            queue_name TEXT,
            positional_args JSON[] DEFAULT ARRAY[]::JSON[],
            named_args JSON DEFAULT '{}'::JSON,
            class_name TEXT DEFAULT NULL,
            config_name TEXT DEFAULT NULL,
            workflow_id TEXT DEFAULT NULL,
            app_version TEXT DEFAULT NULL,
            timeout_ms BIGINT DEFAULT NULL,
            deadline_epoch_ms BIGINT DEFAULT NULL,
            deduplication_id TEXT DEFAULT NULL,
            priority INT4 DEFAULT NULL,
            queue_partition_key TEXT DEFAULT NULL,
            authenticated_user TEXT DEFAULT NULL,
            authenticated_roles TEXT DEFAULT NULL,
            delay_until_epoch_ms BIGINT DEFAULT NULL
        ) RETURNS TEXT AS $$
        DECLARE
            v_workflow_id TEXT;
            v_serialized_inputs TEXT;
            v_owner_xid TEXT;
            v_now BIGINT;
            v_recovery_attempts INT4 := 0;
            v_priority INT4;
            v_status TEXT;
        BEGIN

            -- Validate required parameters
            IF workflow_name IS NULL OR workflow_name = '' THEN
                RAISE EXCEPTION 'Workflow name cannot be null or empty';
            END IF;
            IF queue_name IS NULL OR queue_name = '' THEN
                RAISE EXCEPTION 'Queue name cannot be null or empty';
            END IF;
            IF named_args IS NOT NULL AND jsonb_typeof(named_args::jsonb) != 'object' THEN
                RAISE EXCEPTION 'Named args must be a JSON object';
            END IF;
            IF workflow_id IS NOT NULL AND workflow_id = '' THEN
                RAISE EXCEPTION 'Workflow ID cannot be an empty string if provided.';
            END IF;
            IF delay_until_epoch_ms IS NOT NULL AND delay_until_epoch_ms < 0 THEN
                RAISE EXCEPTION 'delay_until_epoch_ms must be >= 0';
            END IF;

            v_workflow_id := COALESCE(workflow_id, gen_random_uuid()::TEXT);
            v_owner_xid := gen_random_uuid()::TEXT;
            v_priority := COALESCE(priority, 0);
            v_serialized_inputs := json_build_object(
                'positionalArgs', positional_args,
                'namedArgs', named_args
            )::TEXT;
            v_now := EXTRACT(epoch FROM now()) * 1000;
            v_status := CASE WHEN delay_until_epoch_ms IS NULL THEN 'ENQUEUED' ELSE 'DELAYED' END;

            INSERT INTO "dbos".workflow_status (
                workflow_uuid, status, inputs,
                name, class_name, config_name,
                queue_name, deduplication_id, priority, queue_partition_key,
                application_version,
                created_at, updated_at, recovery_attempts,
                workflow_timeout_ms, workflow_deadline_epoch_ms,
                parent_workflow_id, owner_xid, serialization,
                authenticated_user, authenticated_roles,
                delay_until_epoch_ms
            ) VALUES (
                v_workflow_id, v_status, v_serialized_inputs,
                workflow_name, class_name, config_name,
                queue_name, deduplication_id, v_priority, queue_partition_key,
                app_version,
                v_now, v_now, v_recovery_attempts,
                timeout_ms, deadline_epoch_ms,
                NULL, v_owner_xid, 'portable_json',
                authenticated_user, authenticated_roles,
                delay_until_epoch_ms
            )
            ON CONFLICT (workflow_uuid)
            DO UPDATE SET
                updated_at = EXCLUDED.updated_at;

            RETURN v_workflow_id;

        EXCEPTION
            WHEN unique_violation THEN
                RAISE EXCEPTION 'DBOS queue duplicated'
                   USING DETAIL = format('Workflow %s with queue %s and deduplication ID %s already exists', v_workflow_id, queue_name, deduplication_id),
                        ERRCODE = 'unique_violation';
        END;
        $$ LANGUAGE plpgsql;;
ALTER FUNCTION "dbos".enqueue_workflow(
            TEXT, TEXT, JSON[], JSON, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, INT4, TEXT, TEXT, TEXT, BIGINT
        ) SET search_path = pg_catalog, pg_temp;

-- SDK migration 61: 20250527_streams_trigger

    CREATE OR REPLACE FUNCTION "dbos".streams_function() RETURNS TRIGGER AS $$
    DECLARE
        payload text := NEW.workflow_uuid || '::' || NEW.key;
    BEGIN
        PERFORM pg_notify('dbos_streams_channel', payload);
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    ALTER FUNCTION "dbos".streams_function() SET search_path = pg_catalog, pg_temp;

    DROP TRIGGER IF EXISTS dbos_streams_trigger ON "dbos".streams;
    CREATE TRIGGER dbos_streams_trigger
    AFTER INSERT ON "dbos".streams
    FOR EACH ROW EXECUTE FUNCTION "dbos".streams_function();
  ;

-- SDK migration 62: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "attributes" JSONB;
CREATE INDEX IF NOT EXISTS "idx_workflow_status_attributes" ON "dbos"."workflow_status" USING GIN ("attributes") WHERE "attributes" IS NOT NULL;

-- SDK migration 63: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "schedule_name" TEXT;
CREATE INDEX IF NOT EXISTS "idx_workflow_status_schedule_name" ON "dbos"."workflow_status" ("schedule_name") WHERE "schedule_name" IS NOT NULL;

-- SDK migration 64: unnamed
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "debounce_deadline_epoch_ms" BIGINT DEFAULT NULL;
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "is_debounced" BOOLEAN NOT NULL DEFAULT FALSE;

-- SDK migration 65: 20250714_drop_streams_trigger
DROP TRIGGER IF EXISTS dbos_streams_trigger ON "dbos".streams;
DROP FUNCTION IF EXISTS "dbos".streams_function();

-- SDK migration 66: 20250716_drop_workflow_events_trigger
DROP TRIGGER IF EXISTS dbos_workflow_events_trigger ON "dbos".workflow_events;
DROP FUNCTION IF EXISTS "dbos".workflow_events_function();

-- SDK migration 67: 20250721_workflow_status_partition_dequeue_index
CREATE INDEX IF NOT EXISTS "idx_workflow_status_partition_dequeue" ON "dbos"."workflow_status" ("queue_name", "status", "queue_partition_key", "priority", "created_at") WHERE "status" IN ('ENQUEUED', 'PENDING') AND "queue_partition_key" IS NOT NULL;

-- SDK migration 68: 20250723_workflow_status_partition_dequeue_index_v2
CREATE INDEX IF NOT EXISTS "idx_workflow_status_partition_dequeue_v2" ON "dbos"."workflow_status" ("queue_name", "status", "queue_partition_key", "priority", "created_at", "workflow_uuid") WHERE "status" IN ('ENQUEUED', 'PENDING') AND "queue_partition_key" IS NOT NULL;

-- SDK migration 69: 20250723_drop_workflow_status_partition_dequeue_index
DROP INDEX IF EXISTS "dbos"."idx_workflow_status_partition_dequeue";

-- SDK migration 70: 20250725_drop_consolidated_tables
DROP TABLE IF EXISTS "dbos"."workflow_inputs";
DROP TABLE IF EXISTS "dbos"."workflow_queue";
DROP TABLE IF EXISTS "dbos"."scheduler_state";

-- SDK migration 100: 100_workflow_status_application_name
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "application_name" TEXT DEFAULT NULL;

-- SDK migration 101: 101_queues_application_name
ALTER TABLE "dbos"."queues" ADD COLUMN IF NOT EXISTS "application_name" TEXT DEFAULT NULL;

-- SDK migration 102: 102_workflow_schedules_application_name
ALTER TABLE "dbos"."workflow_schedules" ADD COLUMN IF NOT EXISTS "application_name" TEXT DEFAULT NULL;

-- SDK migration 103: 103_application_versions_application_name
ALTER TABLE "dbos"."application_versions" ADD COLUMN IF NOT EXISTS "application_name" TEXT DEFAULT NULL;

-- SDK migration 104: 104_operation_outputs_application_name
ALTER TABLE "dbos"."operation_outputs" ADD COLUMN IF NOT EXISTS "application_name" TEXT DEFAULT NULL;

-- SDK migration 105: 105_enqueue_workflow_application_name
DROP FUNCTION IF EXISTS "dbos".enqueue_workflow(
    TEXT, TEXT, JSON[], JSON, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, INT4, TEXT, TEXT, TEXT, BIGINT
);
CREATE OR REPLACE FUNCTION "dbos".enqueue_workflow(
    workflow_name TEXT,
    queue_name TEXT,
    positional_args JSON[] DEFAULT ARRAY[]::JSON[],
    named_args JSON DEFAULT '{}'::JSON,
    class_name TEXT DEFAULT NULL,
    config_name TEXT DEFAULT NULL,
    workflow_id TEXT DEFAULT NULL,
    app_version TEXT DEFAULT NULL,
    timeout_ms BIGINT DEFAULT NULL,
    deadline_epoch_ms BIGINT DEFAULT NULL,
    deduplication_id TEXT DEFAULT NULL,
    priority INT4 DEFAULT NULL,
    queue_partition_key TEXT DEFAULT NULL,
    authenticated_user TEXT DEFAULT NULL,
    authenticated_roles TEXT DEFAULT NULL,
    delay_until_epoch_ms BIGINT DEFAULT NULL,
    application_name TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
    v_workflow_id TEXT;
    v_serialized_inputs TEXT;
    v_owner_xid TEXT;
    v_now BIGINT;
    v_recovery_attempts INT4 := 0;
    v_priority INT4;
    v_status TEXT;
BEGIN

    -- Validate required parameters
    IF workflow_name IS NULL OR workflow_name = '' THEN
        RAISE EXCEPTION 'Workflow name cannot be null or empty';
    END IF;
    IF queue_name IS NULL OR queue_name = '' THEN
        RAISE EXCEPTION 'Queue name cannot be null or empty';
    END IF;
    IF named_args IS NOT NULL AND jsonb_typeof(named_args::jsonb) != 'object' THEN
        RAISE EXCEPTION 'Named args must be a JSON object';
    END IF;
    IF workflow_id IS NOT NULL AND workflow_id = '' THEN
        RAISE EXCEPTION 'Workflow ID cannot be an empty string if provided.';
    END IF;
    IF delay_until_epoch_ms IS NOT NULL AND delay_until_epoch_ms < 0 THEN
        RAISE EXCEPTION 'delay_until_epoch_ms must be >= 0';
    END IF;

    v_workflow_id := COALESCE(workflow_id, gen_random_uuid()::TEXT);
    v_owner_xid := gen_random_uuid()::TEXT;
    v_priority := COALESCE(priority, 0);
    v_serialized_inputs := json_build_object(
        'positionalArgs', positional_args,
        'namedArgs', named_args
    )::TEXT;
    v_now := EXTRACT(epoch FROM now()) * 1000;
    v_status := CASE WHEN delay_until_epoch_ms IS NULL THEN 'ENQUEUED' ELSE 'DELAYED' END;

    INSERT INTO "dbos".workflow_status (
        workflow_uuid, status, inputs,
        name, class_name, config_name,
        queue_name, deduplication_id, priority, queue_partition_key,
        application_version,
        created_at, updated_at, recovery_attempts,
        workflow_timeout_ms, workflow_deadline_epoch_ms,
        parent_workflow_id, owner_xid, serialization,
        authenticated_user, authenticated_roles,
        delay_until_epoch_ms, application_name
    ) VALUES (
        v_workflow_id, v_status, v_serialized_inputs,
        workflow_name, class_name, config_name,
        queue_name, deduplication_id, v_priority, queue_partition_key,
        app_version,
        v_now, v_now, v_recovery_attempts,
        timeout_ms, deadline_epoch_ms,
        NULL, v_owner_xid, 'portable_json',
        authenticated_user, authenticated_roles,
        delay_until_epoch_ms, application_name
    )
    ON CONFLICT (workflow_uuid)
    DO UPDATE SET
        updated_at = EXCLUDED.updated_at;

    RETURN v_workflow_id;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'DBOS queue duplicated'
            USING DETAIL = format('Workflow %s with queue %s and deduplication ID %s already exists', v_workflow_id, queue_name, deduplication_id),
                ERRCODE = 'unique_violation';
END;
$$ LANGUAGE plpgsql;;
ALTER FUNCTION "dbos".enqueue_workflow(
    TEXT, TEXT, JSON[], JSON, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, INT4, TEXT, TEXT, TEXT, BIGINT, TEXT
) SET search_path = pg_catalog, pg_temp;

-- SDK migration 106: 106_application_versions_owner_key
CREATE UNIQUE INDEX IF NOT EXISTS "uq_application_versions_owner_version"
    ON "dbos"."application_versions" ("application_name", "version_name")
    WHERE "application_name" IS NOT NULL;

-- SDK migration 107: 107_application_versions_unclaimed_key
CREATE UNIQUE INDEX IF NOT EXISTS "uq_application_versions_unclaimed_version"
    ON "dbos"."application_versions" ("version_name")
    WHERE "application_name" IS NULL;

-- SDK migration 108: 108_queue_partition_limits
ALTER TABLE "dbos"."queues" ADD COLUMN IF NOT EXISTS "partition_concurrency" INT4 DEFAULT NULL;
ALTER TABLE "dbos"."queues" ADD COLUMN IF NOT EXISTS "partition_worker_concurrency" INT4 DEFAULT NULL;
ALTER TABLE "dbos"."queues" ADD COLUMN IF NOT EXISTS "partition_rate_limit_max" INT4 DEFAULT NULL;
ALTER TABLE "dbos"."queues" ADD COLUMN IF NOT EXISTS "partition_rate_limit_period_sec" DOUBLE PRECISION DEFAULT NULL;

-- SDK migration 109: 109_workflow_payload_tables
CREATE TABLE IF NOT EXISTS "dbos"."workflow_input" (
    workflow_uuid TEXT NOT NULL PRIMARY KEY,
    inputs TEXT,
    retention_timestamp BIGINT NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000.0)::bigint
);
CREATE TABLE IF NOT EXISTS "dbos"."workflow_output" (
    workflow_uuid TEXT NOT NULL PRIMARY KEY,
    output TEXT,
    error TEXT,
    retention_timestamp BIGINT NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000.0)::bigint
);
CREATE INDEX IF NOT EXISTS "idx_workflow_input_retention"
    ON "dbos"."workflow_input" ("retention_timestamp");
CREATE INDEX IF NOT EXISTS "idx_workflow_output_retention"
    ON "dbos"."workflow_output" ("retention_timestamp");

-- SDK migration 110: 110_operation_outputs_retention_timestamp
ALTER TABLE "dbos"."operation_outputs"
    ADD COLUMN IF NOT EXISTS "retention_timestamp" BIGINT NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000.0)::bigint;

-- SDK migration 111: 111_operation_outputs_retention_index
CREATE INDEX IF NOT EXISTS "idx_operation_outputs_retention"
    ON "dbos"."operation_outputs" ("retention_timestamp");

-- SDK migration 112: 112_drop_operation_outputs_foreign_key
ALTER TABLE "dbos"."operation_outputs"
    DROP CONSTRAINT IF EXISTS "operation_outputs_workflow_uuid_foreign";
ALTER TABLE "dbos"."operation_outputs"
    DROP CONSTRAINT IF EXISTS "operation_outputs_workflow_uuid_fkey";

-- SDK migration 113: 113_enqueue_workflow_split_input
CREATE OR REPLACE FUNCTION "dbos".enqueue_workflow(
    workflow_name TEXT,
    queue_name TEXT,
    positional_args JSON[] DEFAULT ARRAY[]::JSON[],
    named_args JSON DEFAULT '{}'::JSON,
    class_name TEXT DEFAULT NULL,
    config_name TEXT DEFAULT NULL,
    workflow_id TEXT DEFAULT NULL,
    app_version TEXT DEFAULT NULL,
    timeout_ms BIGINT DEFAULT NULL,
    deadline_epoch_ms BIGINT DEFAULT NULL,
    deduplication_id TEXT DEFAULT NULL,
    priority INT4 DEFAULT NULL,
    queue_partition_key TEXT DEFAULT NULL,
    authenticated_user TEXT DEFAULT NULL,
    authenticated_roles TEXT DEFAULT NULL,
    delay_until_epoch_ms BIGINT DEFAULT NULL,
    application_name TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
    v_workflow_id TEXT;
    v_serialized_inputs TEXT;
    v_owner_xid TEXT;
    v_now BIGINT;
    v_recovery_attempts INT4 := 0;
    v_priority INT4;
    v_status TEXT;
BEGIN

    -- Validate required parameters
    IF workflow_name IS NULL OR workflow_name = '' THEN
        RAISE EXCEPTION 'Workflow name cannot be null or empty';
    END IF;
    IF queue_name IS NULL OR queue_name = '' THEN
        RAISE EXCEPTION 'Queue name cannot be null or empty';
    END IF;
    IF named_args IS NOT NULL AND jsonb_typeof(named_args::jsonb) != 'object' THEN
        RAISE EXCEPTION 'Named args must be a JSON object';
    END IF;
    IF workflow_id IS NOT NULL AND workflow_id = '' THEN
        RAISE EXCEPTION 'Workflow ID cannot be an empty string if provided.';
    END IF;
    IF delay_until_epoch_ms IS NOT NULL AND delay_until_epoch_ms < 0 THEN
        RAISE EXCEPTION 'delay_until_epoch_ms must be >= 0';
    END IF;

    v_workflow_id := COALESCE(workflow_id, gen_random_uuid()::TEXT);
    v_owner_xid := gen_random_uuid()::TEXT;
    v_priority := COALESCE(priority, 0);
    v_serialized_inputs := json_build_object(
        'positionalArgs', positional_args,
        'namedArgs', named_args
    )::TEXT;
    v_now := EXTRACT(epoch FROM now()) * 1000;
    v_status := CASE WHEN delay_until_epoch_ms IS NULL THEN 'ENQUEUED' ELSE 'DELAYED' END;

    INSERT INTO "dbos".workflow_status (
        workflow_uuid, status,
        name, class_name, config_name,
        queue_name, deduplication_id, priority, queue_partition_key,
        application_version,
        created_at, updated_at, recovery_attempts,
        workflow_timeout_ms, workflow_deadline_epoch_ms,
        parent_workflow_id, owner_xid, serialization,
        authenticated_user, authenticated_roles,
        delay_until_epoch_ms, application_name
    ) VALUES (
        v_workflow_id, v_status,
        workflow_name, class_name, config_name,
        queue_name, deduplication_id, v_priority, queue_partition_key,
        app_version,
        v_now, v_now, v_recovery_attempts,
        timeout_ms, deadline_epoch_ms,
        NULL, v_owner_xid, 'portable_json',
        authenticated_user, authenticated_roles,
        delay_until_epoch_ms, application_name
    )
    ON CONFLICT (workflow_uuid)
    DO UPDATE SET
        updated_at = EXCLUDED.updated_at;

    INSERT INTO "dbos".workflow_input (
        workflow_uuid, inputs, retention_timestamp
    ) VALUES (
        v_workflow_id, v_serialized_inputs, v_now
    )
    ON CONFLICT (workflow_uuid) DO NOTHING;

    RETURN v_workflow_id;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'DBOS queue duplicated'
            USING DETAIL = format('Workflow %s with queue %s and deduplication ID %s already exists', v_workflow_id, queue_name, deduplication_id),
                ERRCODE = 'unique_violation';
END;
$$ LANGUAGE plpgsql;;
ALTER FUNCTION "dbos".enqueue_workflow(
    TEXT, TEXT, JSON[], JSON, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT, INT4, TEXT, TEXT, TEXT, BIGINT, TEXT
) SET search_path = pg_catalog, pg_temp;

-- SDK migration 114: 114_drop_idx_notifications
DROP INDEX IF EXISTS "dbos"."idx_notifications";

-- SDK migration 115: 115_workflow_status_in_flight_index_v2
CREATE INDEX IF NOT EXISTS "idx_workflow_status_in_flight_v2" ON "dbos"."workflow_status" ("queue_name", "status", "priority", "created_at") INCLUDE ("application_name") WHERE "status" IN ('ENQUEUED', 'PENDING');

-- SDK migration 116: 116_drop_workflow_status_in_flight_index
DROP INDEX IF EXISTS "dbos"."idx_workflow_status_in_flight";

-- SDK migration 117: 117_workflow_status_partition_dequeue_index_v3
CREATE INDEX IF NOT EXISTS "idx_workflow_status_partition_dequeue_v3" ON "dbos"."workflow_status" ("queue_name", "status", "queue_partition_key", "priority", "created_at", "workflow_uuid") INCLUDE ("application_name") WHERE "status" IN ('ENQUEUED', 'PENDING') AND "queue_partition_key" IS NOT NULL;

-- SDK migration 118: 118_drop_workflow_status_partition_dequeue_index_v2
DROP INDEX IF EXISTS "dbos"."idx_workflow_status_partition_dequeue_v2";

-- SDK migration 119: 119_operation_outputs_completed_at_function_name_index_v2
CREATE INDEX IF NOT EXISTS "idx_operation_outputs_completed_at_function_name_v2" ON "dbos"."operation_outputs" ("completed_at_epoch_ms", "function_name") INCLUDE ("application_name");

-- SDK migration 120: 120_drop_operation_outputs_completed_at_function_name_index
DROP INDEX IF EXISTS "dbos"."idx_operation_outputs_completed_at_function_name";

-- SDK migration 121: 121_notifications_consumed_by_function_id
ALTER TABLE "dbos"."notifications" ADD COLUMN IF NOT EXISTS "consumed_by_function_id" INT4;

-- SDK migration 122: 122_workflow_status_deadline_index
CREATE INDEX IF NOT EXISTS "idx_workflow_status_deadline" ON "dbos"."workflow_status" ("workflow_deadline_epoch_ms") WHERE "status" IN ('ENQUEUED', 'PENDING', 'DELAYED') AND "workflow_deadline_epoch_ms" IS NOT NULL;

-- SDK migration 123: 123_workflow_status_creator_xid
ALTER TABLE "dbos"."workflow_status" ADD COLUMN IF NOT EXISTS "creator_xid" TEXT DEFAULT NULL;

DELETE FROM dbos.dbos_migrations;
INSERT INTO dbos.dbos_migrations(version) VALUES (123);
REVOKE ALL ON SCHEMA research_service, dbos FROM PUBLIC;
COMMIT;
