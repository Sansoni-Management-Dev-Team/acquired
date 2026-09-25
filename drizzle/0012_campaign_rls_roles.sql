-- Runtime connections use a database login that may have BYPASSRLS. Each
-- campaign transaction switches to one of these limited roles before queries.
CREATE ROLE acquire_campaign_user NOLOGIN NOBYPASSRLS;--> statement-breakpoint
CREATE ROLE acquire_campaign_worker NOLOGIN NOBYPASSRLS;--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT acquire_campaign_user TO %I', current_user);
  EXECUTE format('GRANT acquire_campaign_worker TO %I', current_user);
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO acquire_campaign_user, acquire_campaign_worker;--> statement-breakpoint
GRANT SELECT ON member, mandates, contacts, targets, mandate_targets, mailbox_connections, suppressions TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events TO acquire_campaign_user;--> statement-breakpoint
GRANT INSERT ON audit_events TO acquire_campaign_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON campaign_sequences TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT, INSERT ON campaign_sequence_versions TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON campaign_enrolments TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON campaign_send_attempts TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT ON campaign_inbound_events, campaign_contact_holds TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT, INSERT ON campaign_contact_assignments TO acquire_campaign_user;--> statement-breakpoint
GRANT SELECT ON campaign_enrolments, campaign_send_attempts TO acquire_campaign_worker;--> statement-breakpoint
GRANT UPDATE ON campaign_enrolments TO acquire_campaign_worker;--> statement-breakpoint
GRANT INSERT ON campaign_inbound_events TO acquire_campaign_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON campaign_contact_holds TO acquire_campaign_worker;--> statement-breakpoint
ALTER TABLE mailbox_connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_mailbox_owner" ON mailbox_connections TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
ALTER TABLE member ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_member_self" ON member TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
ALTER TABLE mandates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_mandate_org" ON mandates TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true));--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_contact_org" ON contacts TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true));--> statement-breakpoint
ALTER TABLE targets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_target_org" ON targets TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true));--> statement-breakpoint
ALTER TABLE mandate_targets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_mandate_target_org" ON mandate_targets TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true));--> statement-breakpoint
ALTER TABLE suppressions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_suppression_org" ON suppressions TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true));--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "campaign_audit_owner" ON audit_events TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND actor_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND actor_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_audit_worker" ON audit_events TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY "campaign_sequences_scope" ON campaign_sequences;--> statement-breakpoint
DROP POLICY "campaign_versions_scope" ON campaign_sequence_versions;--> statement-breakpoint
DROP POLICY "campaign_enrolments_scope" ON campaign_enrolments;--> statement-breakpoint
DROP POLICY "campaign_sends_scope" ON campaign_send_attempts;--> statement-breakpoint
DROP POLICY "campaign_inbound_scope" ON campaign_inbound_events;--> statement-breakpoint
DROP POLICY "campaign_contact_holds_scope" ON campaign_contact_holds;--> statement-breakpoint
DROP POLICY "campaign_contact_assignment_scope" ON campaign_contact_assignments;--> statement-breakpoint
CREATE POLICY "campaign_sequences_user" ON campaign_sequences TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_sequences_worker" ON campaign_sequences TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "campaign_versions_user" ON campaign_sequence_versions TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_versions_worker" ON campaign_sequence_versions TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "campaign_enrolments_user" ON campaign_enrolments TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_enrolments_worker" ON campaign_enrolments TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "campaign_sends_user" ON campaign_send_attempts TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_sends_worker" ON campaign_send_attempts TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "campaign_inbound_user" ON campaign_inbound_events TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_inbound_worker" ON campaign_inbound_events TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "campaign_holds_user" ON campaign_contact_holds TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true));--> statement-breakpoint
CREATE POLICY "campaign_holds_worker" ON campaign_contact_holds TO acquire_campaign_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "campaign_assignments_user" ON campaign_contact_assignments TO acquire_campaign_user USING (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true)) WITH CHECK (organization_id = current_setting('app.acquire_org', true) AND owner_user_id = current_setting('app.acquire_user', true));--> statement-breakpoint
CREATE POLICY "campaign_assignments_worker" ON campaign_contact_assignments TO acquire_campaign_worker USING (true) WITH CHECK (true);
