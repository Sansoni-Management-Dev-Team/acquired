-- PROPOSED ONLY. New empty service rehearsal on existing network-none cluster.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'postgres' OR (SELECT system_identifier::text FROM pg_control_system())<>'7699248227334438947'
 OR EXISTS(SELECT 1 FROM pg_database WHERE datname='acquire_communications_rehearsal')
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('communications_admin','communications_control','communications_scoped'))
 THEN RAISE EXCEPTION 'Exact empty isolated service rehearsal required';END IF;
END $$;
CREATE ROLE communications_admin NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE communications_control NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE communications_scoped NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE acquire_communications_rehearsal OWNER communications_admin;
COMMENT ON DATABASE acquire_communications_rehearsal IS 'acquire-communications-rehearsal-only';
