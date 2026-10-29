-- PROPOSED ONLY. Specific approval required for the pinned AWS app Aurora cluster.
-- Run once on maintenance database postgres with the verified cluster administrator.
-- psql reads the new role password from a private process environment, never argv/source.
\set ON_ERROR_STOP on
\getenv research_password RESEARCH_BOOTSTRAP_PASSWORD
BEGIN;
DO $$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> '7619074599616174976' THEN RAISE EXCEPTION 'Wrong AWS cluster system identifier'; END IF;
 IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'Wrong maintenance database'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='research') THEN RAISE EXCEPTION 'Research role already exists; refuse reuse/rotation'; END IF;
 IF EXISTS (SELECT 1 FROM pg_database WHERE datname='acquire_research_uat') THEN RAISE EXCEPTION 'Research database already exists; refuse initialization'; END IF;
END $$;
SET LOCAL password_encryption='scram-sha-256';
CREATE ROLE research LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'research_password';
-- Aurora's administrator is not a PostgreSQL superuser. SET membership is
-- required to assign the new database to the restricted research owner.
GRANT research TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
COMMIT;
-- PostgreSQL CREATE DATABASE must be outside a transaction. Failure preserves the
-- created role and requires inspection; do not blindly retry or drop anything.
CREATE DATABASE acquire_research_uat OWNER research TEMPLATE template0 ENCODING 'UTF8';
REVOKE ALL ON DATABASE acquire_research_uat FROM PUBLIC;
