import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const targetBand = pgEnum("target_band", ["cold", "warm", "hot", "excluded"]);
export const opportunityQualification = pgEnum("opportunity_qualification", ["priority", "develop", "research", "excluded"]);
export const targetStatus = pgEnum("target_status", ["identified", "enriched", "outreach_queued", "contacted", "warm", "rfi_fulfilled", "modelled", "submission_packaged", "not_interested", "suppressed"]);
export const signalWeight = pgEnum("signal_weight", ["low", "medium", "high", "very_high"]);
export const mailboxProvider = pgEnum("mailbox_provider", ["mock", "gmail", "outlook"]);
export const enrolmentState = pgEnum("enrolment_state", ["draft", "awaiting_approval", "active", "manual_confirmation", "paused", "completed", "stopped"]);
export const messageState = pgEnum("message_state", ["draft", "approved", "queued", "sent", "cancelled", "failed"]);

export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), activeOrganizationId: text("active_organization_id"),
}, (table) => [index("session_user_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(), issuer: text("issuer").notNull(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }), scope: text("scope"), password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("account_user_idx").on(table.userId), uniqueIndex("account_issuer_account_id_idx").on(table.issuer, table.accountId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const organization = pgTable("organization", {
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique(), logo: text("logo"), metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const member = pgTable("member", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), role: text("role").notNull().default("member"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("member_org_user_idx").on(table.organizationId, table.userId)]);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }), email: text("email").notNull(),
  role: text("role"), status: text("status").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), inviterId: text("inviter_id").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mandates = pgTable("mandates", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), naturalLanguage: text("natural_language").notNull(),
  filters: jsonb("filters").notNull(), confirmation: text("confirmation"), provenance: jsonb("provenance").notNull(), createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("mandates_organization_idx").on(table.organizationId)]);

export const targets = pgTable("targets", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), mandateId: uuid("mandate_id").references(() => mandates.id),
  companyName: text("company_name").notNull(), domain: text("domain"), identifiers: jsonb("identifiers").notNull().default({}), firmographics: jsonb("firmographics").notNull(),
  fitScore: integer("fit_score"), ripenessScore: integer("ripeness_score"), financeabilityScore: integer("financeability_score"), confidenceScore: integer("confidence_score"), band: targetBand("band"), qualification: opportunityQualification("qualification"), status: targetStatus("status").notNull().default("identified"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("targets_org_band_idx").on(table.organizationId, table.band)]);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(), role: text("role"), personalData: jsonb("personal_data").notNull().default({}), provenance: jsonb("provenance").notNull(),
  fictionalised: boolean("fictionalised").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("contacts_org_target_idx").on(table.organizationId, table.targetId)]);

export const signals = pgTable("signals", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id), kind: text("kind").notNull(), value: text("value").notNull(), weight: signalWeight("weight").notNull(), direction: text("direction").notNull().default("positive"),
  confidence: real("confidence").notNull(), source: text("source").notNull(), sourceUrl: text("source_url"), capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
}, (table) => [index("signals_org_target_idx").on(table.organizationId, table.targetId)]);

export const sequences = pgTable("sequences", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), name: text("name").notNull(), steps: jsonb("steps").notNull(),
  active: boolean("active").notNull().default(true), createdBy: text("created_by").notNull().references(() => user.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sequenceEnrolments = pgTable("sequence_enrolments", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), sequenceId: uuid("sequence_id").notNull().references(() => sequences.id),
  mandateId: uuid("mandate_id").references(() => mandates.id),
  targetId: uuid("target_id").notNull().references(() => targets.id), contactId: uuid("contact_id").references(() => contacts.id), state: enrolmentState("state").notNull().default("draft"),
  stopReason: text("stop_reason"), approvedBy: text("approved_by").references(() => user.id), approvedAt: timestamp("approved_at", { withTimezone: true }), nextStepAt: timestamp("next_step_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("enrolment_target_sequence_idx").on(table.organizationId, table.targetId, table.sequenceId)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), enrolmentId: uuid("enrolment_id").notNull().references(() => sequenceEnrolments.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(), purpose: text("purpose").notNull(), subject: text("subject").notNull(), body: text("body").notNull(), signalIds: jsonb("signal_ids").notNull().default([]),
  state: messageState("state").notNull().default("draft"), approvedBy: text("approved_by").references(() => user.id), approvedAt: timestamp("approved_at", { withTimezone: true }), scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  providerMessageId: text("provider_message_id"), providerThreadId: text("provider_thread_id"), sentAt: timestamp("sent_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("message_enrolment_step_idx").on(table.enrolmentId, table.stepNumber)]);

export const mailboxConnections = pgTable("mailbox_connections", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), userId: text("user_id").notNull().references(() => user.id),
  provider: mailboxProvider("provider").notNull(), address: text("address"), encryptedRefreshToken: text("encrypted_refresh_token"), keyVersion: text("key_version"), scopes: text("scopes").array(),
  expiresAt: timestamp("expires_at", { withTimezone: true }), reconnectRequired: boolean("reconnect_required").notNull().default(false), dailyCap: integer("daily_cap").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("mailbox_user_provider_idx").on(table.userId, table.provider)]);

export const mockMailboxDeliveries = pgTable("mock_mailbox_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), messageId: uuid("message_id").notNull().references(() => messages.id),
  toAddress: text("to_address").notNull(), payload: jsonb("payload").notNull(), deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
});

export const replies = pgTable("replies", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), enrolmentId: uuid("enrolment_id").notNull().references(() => sequenceEnrolments.id),
  messageId: uuid("message_id").references(() => messages.id), providerReplyId: text("provider_reply_id").notNull(), fromAddress: text("from_address").notNull(), subject: text("subject"), bodyText: text("body_text"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), rawMetadata: jsonb("raw_metadata").notNull().default({}),
}, (table) => [uniqueIndex("reply_provider_id_idx").on(table.providerReplyId)]);

export const suppressions = pgTable("suppressions", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), address: text("address"), domain: text("domain"),
  reason: text("reason").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("suppressions_org_address_idx").on(table.organizationId, table.address), uniqueIndex("suppressions_org_domain_idx").on(table.organizationId, table.domain)]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), actorId: text("actor_id").notNull(), action: text("action").notNull(),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), before: jsonb("before"), after: jsonb("after"), metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_events_org_entity_idx").on(table.organizationId, table.entityType, table.entityId)]);

export const dailySendCounters = pgTable("daily_send_counters", {
  mailboxConnectionId: uuid("mailbox_connection_id").notNull().references(() => mailboxConnections.id), date: text("date").notNull(), count: integer("count").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.mailboxConnectionId, table.date] })]);

// A company is shared; all buyer decisions belong to its mandate membership.
export const mandateTargets = pgTable("mandate_targets", {
  organizationId: text("organization_id").notNull().references(() => organization.id),
  mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  assessment: jsonb("assessment").notNull().default({}),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.mandateId, table.targetId] }), index("mandate_targets_org_idx").on(table.organizationId)]);

export const coverageRuns = pgTable("coverage_runs", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  sources: jsonb("sources").notNull().default([]), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("coverage_runs_mandate_idx").on(table.organizationId, table.mandateId)]);

export const valuationObservations = pgTable("valuation_observations", {
  id: uuid("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id),
  mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  observation: jsonb("observation").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("valuations_mandate_idx").on(table.organizationId, table.mandateId)]);

export const researchJobs = pgTable("research_jobs", {
  id: uuid("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id),
  mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => user.id),
  status: text("status").notNull().default("queued"), config: jsonb("config").notNull(),
  seeds: jsonb("seeds").notNull().default([]), discoveryStarted: boolean("discovery_started").notNull().default(false),
  revision: integer("revision").notNull().default(0), pages: integer("pages").notNull().default(0), modelCalls: integer("model_calls").notNull().default(0),
  message: text("message").notNull().default("Queued"), crawlId: text("crawl_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("research_jobs_mandate_idx").on(table.organizationId, table.mandateId), uniqueIndex("research_jobs_active_slot_idx").on(table.organizationId, sql`COALESCE(${table.config}->>'executionSlot', '0')`).where(sql`${table.status} NOT IN ('complete', 'partial', 'failed', 'cancelled')`)]);

export const researchFindings = pgTable("research_findings", {
  id: uuid("id").primaryKey().defaultRandom(), jobId: uuid("job_id").notNull().references(() => researchJobs.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organization.id), mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").references(() => targets.id, { onDelete: "set null" }),
  evidenceKey: text("evidence_key").notNull(), sourceUrl: text("source_url").notNull(), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  evidence: jsonb("evidence").notNull(), confidence: real("confidence").notNull().default(0.5),
}, table => [uniqueIndex("research_findings_evidence_idx").on(table.jobId, table.evidenceKey), index("research_findings_mandate_idx").on(table.organizationId, table.mandateId)]);
