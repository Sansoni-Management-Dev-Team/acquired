import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

// Firmable identities and observations are shared across organisations. Buyer
// workflow state continues to live on organisation-scoped targets and contacts.
export const firmableCompanies = pgTable("firmable_companies", {
  id: text("id").primaryKey(), name: text("name"), domain: text("domain"), abn: text("abn"), acn: text("acn"), peopleGeneration: integer("people_generation").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("firmable_companies_domain_idx").on(table.domain), index("firmable_companies_abn_idx").on(table.abn)]);

export const firmablePeople = pgTable("firmable_people", {
  id: text("id").primaryKey(), name: text("name"), linkedin: text("linkedin"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("firmable_people_linkedin_idx").on(table.linkedin)]);

export const targets = pgTable("targets", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), mandateId: uuid("mandate_id").references(() => mandates.id),
  companyName: text("company_name").notNull(), domain: text("domain"), firmableCompanyId: text("firmable_company_id").references(() => firmableCompanies.id), identifiers: jsonb("identifiers").notNull().default({}), firmographics: jsonb("firmographics").notNull(),
  fitScore: integer("fit_score"), ripenessScore: integer("ripeness_score"), financeabilityScore: integer("financeability_score"), confidenceScore: integer("confidence_score"), band: targetBand("band"), qualification: opportunityQualification("qualification"), status: targetStatus("status").notNull().default("identified"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("targets_org_band_idx").on(table.organizationId, table.band), index("targets_firmable_company_idx").on(table.firmableCompanyId)]);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), targetId: uuid("target_id").references(() => targets.id, { onDelete: "cascade" }),
  mandateId: uuid("mandate_id").references(() => mandates.id, { onDelete: "cascade" }),
  firmablePersonId: text("firmable_person_id").references(() => firmablePeople.id), displayName: text("display_name").notNull().default(""), role: text("role"), personalData: jsonb("personal_data").notNull().default({}), provenance: jsonb("provenance").notNull(),
  fictionalised: boolean("fictionalised").notNull().default(true), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("contacts_org_mandate_idx").on(table.organizationId, table.mandateId), check("contacts_location_check", sql`${table.targetId} IS NOT NULL OR ${table.mandateId} IS NOT NULL`), index("contacts_org_target_idx").on(table.organizationId, table.targetId), index("contacts_firmable_person_idx").on(table.firmablePersonId), uniqueIndex("contacts_target_firmable_person_unique_idx").on(table.organizationId, table.targetId, table.firmablePersonId).where(sql`${table.firmablePersonId} IS NOT NULL`)]);

export const firmableSyncRuns = pgTable("firmable_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id), actorId: text("actor_id").notNull().references(() => user.id),
  targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }), firmableCompanyId: text("firmable_company_id").references(() => firmableCompanies.id),
  requestKey: text("request_key").notNull(), trigger: text("trigger").notNull().default("manual"), status: text("status").notNull().default("queued"), generation: integer("generation").notNull().default(1),
  companyStatus: text("company_status").notNull().default("pending"), searchStatus: text("search_status").notNull().default("pending"), profilesFound: integer("profiles_found").notNull().default(0), profilesSaved: integer("profiles_saved").notNull().default(0), profilesFailed: integer("profiles_failed").notNull().default(0),
  message: text("message").notNull().default("Queued"), error: jsonb("error"), startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("firmable_sync_runs_request_idx").on(table.organizationId, table.requestKey), uniqueIndex("firmable_sync_runs_active_target_unique_idx").on(table.organizationId, table.targetId).where(sql`${table.status} IN ('queued', 'running')`), index("firmable_sync_runs_target_idx").on(table.organizationId, table.targetId, table.createdAt), index("firmable_sync_runs_company_idx").on(table.firmableCompanyId, table.createdAt)]);

export const firmableCompanyResponses = pgTable("firmable_company_responses", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").references(() => firmableSyncRuns.id, { onDelete: "set null" }), firmableCompanyId: text("firmable_company_id").references(() => firmableCompanies.id),
  logicalCallId: text("logical_call_id").notNull(), attempt: integer("attempt").notNull().default(1), request: jsonb("request").notNull().default({}), response: jsonb("response"), responseText: text("response_text"), httpStatus: integer("http_status"), successful: boolean("successful").notNull().default(false), validationError: text("validation_error"), responseHash: text("response_hash"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(), fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("firmable_company_attempt_idx").on(table.runId, table.logicalCallId, table.attempt), uniqueIndex("firmable_company_backfill_idx").on(table.logicalCallId).where(sql`${table.runId} IS NULL`), index("firmable_company_latest_idx").on(table.firmableCompanyId, table.successful, table.fetchedAt)]);

export const firmablePeopleSearches = pgTable("firmable_people_searches", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").references(() => firmableSyncRuns.id, { onDelete: "set null" }), firmableCompanyId: text("firmable_company_id").references(() => firmableCompanies.id),
  logicalCallId: text("logical_call_id").notNull(), attempt: integer("attempt").notNull().default(1), request: jsonb("request").notNull().default({}), response: jsonb("response"), responseText: text("response_text"), httpStatus: integer("http_status"), successful: boolean("successful").notNull().default(false), validationError: text("validation_error"), responseHash: text("response_hash"), offset: integer("offset"), requestedSize: integer("requested_size"), returnedCount: integer("returned_count"), reportedTotal: integer("reported_total"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(), fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("firmable_people_search_attempt_idx").on(table.runId, table.logicalCallId, table.attempt), uniqueIndex("firmable_people_search_backfill_idx").on(table.logicalCallId).where(sql`${table.runId} IS NULL`), index("firmable_people_search_latest_idx").on(table.firmableCompanyId, table.successful, table.fetchedAt)]);

export const firmablePersonResponses = pgTable("firmable_person_responses", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").references(() => firmableSyncRuns.id, { onDelete: "set null" }), firmablePersonId: text("firmable_person_id").references(() => firmablePeople.id),
  logicalCallId: text("logical_call_id").notNull(), attempt: integer("attempt").notNull().default(1), request: jsonb("request").notNull().default({}), response: jsonb("response"), responseText: text("response_text"), httpStatus: integer("http_status"), successful: boolean("successful").notNull().default(false), validationError: text("validation_error"), responseHash: text("response_hash"), privacyMode: text("privacy_mode").notNull().default("real"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(), fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("firmable_person_attempt_idx").on(table.runId, table.logicalCallId, table.attempt), uniqueIndex("firmable_person_backfill_idx").on(table.logicalCallId).where(sql`${table.runId} IS NULL`), index("firmable_person_latest_idx").on(table.firmablePersonId, table.successful, table.fetchedAt)]);

export const firmableCompanyPeople = pgTable("firmable_company_people", {
  firmableCompanyId: text("firmable_company_id").notNull().references(() => firmableCompanies.id, { onDelete: "cascade" }), firmablePersonId: text("firmable_person_id").notNull().references(() => firmablePeople.id, { onDelete: "cascade" }),
  latestSearchId: uuid("latest_search_id").references(() => firmablePeopleSearches.id, { onDelete: "set null" }), searchRecord: jsonb("search_record").notNull().default({}), active: boolean("active").notNull().default(true), generation: integer("generation").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(), lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.firmableCompanyId, table.firmablePersonId] }), index("firmable_company_people_active_idx").on(table.firmableCompanyId, table.active)]);

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

// Campaign automation is deliberately separate from the legacy draft-only
// sequences above. Published versions are immutable snapshots; enrolments
// retain their version even when the editable sequence is republished.
export const campaignSequences = pgTable("campaign_sequences", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id), mandateId: uuid("mandate_id").notNull().references(() => mandates.id),
  name: text("name").notNull(), draft: jsonb("draft").notNull(), publishedVersion: integer("published_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("campaign_sequences_owner_idx").on(table.organizationId, table.ownerUserId, table.mandateId)]);

export const campaignSequenceVersions = pgTable("campaign_sequence_versions", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id), sequenceId: uuid("sequence_id").notNull().references(() => campaignSequences.id),
  version: integer("version").notNull(), definition: jsonb("definition").notNull(), n8nWorkflowId: text("n8n_workflow_id"), publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("campaign_sequence_version_idx").on(table.sequenceId, table.version), uniqueIndex("campaign_version_n8n_workflow_idx").on(table.n8nWorkflowId).where(sql`${table.n8nWorkflowId} IS NOT NULL`)]);

export const campaignEnrolments = pgTable("campaign_enrolments", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id), sequenceId: uuid("sequence_id").notNull().references(() => campaignSequences.id),
  versionId: uuid("version_id").notNull().references(() => campaignSequenceVersions.id), mandateId: uuid("mandate_id").notNull().references(() => mandates.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id), mailboxConnectionId: uuid("mailbox_connection_id").references(() => mailboxConnections.id),
  recipientEmail: text("recipient_email"), recipientPhone: text("recipient_phone"), recipientLinkedin: text("recipient_linkedin"), state: text("state").notNull().default("active"), stopReason: text("stop_reason"),
  initialConversationReviewed: boolean("initial_conversation_reviewed").notNull().default(false),
  runtime: text("runtime").notNull().default("legacy"), n8nStartedAt: timestamp("n8n_started_at", { withTimezone: true }),
  lastReplyCheckedAt: timestamp("last_reply_checked_at", { withTimezone: true }),
  stepIndex: integer("step_index").notNull().default(0), nextStepAt: timestamp("next_step_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("campaign_one_active_phone_idx").on(table.organizationId, table.recipientPhone).where(sql`${table.state} IN ('active', 'paused', 'needs_review')`),
  uniqueIndex("campaign_one_active_linkedin_idx").on(table.organizationId, table.recipientLinkedin).where(sql`${table.state} IN ('active', 'paused', 'needs_review')`),
  uniqueIndex("campaign_enrolment_active_idx").on(table.organizationId, table.contactId, table.sequenceId).where(sql`${table.state} IN ('active', 'paused', 'needs_review')`),
  index("campaign_enrolment_due_idx").on(table.state, table.nextStepAt),
  index("campaign_enrolment_contact_idx").on(table.organizationId, table.contactId),
  index("campaign_n8n_dispatch_idx").on(table.startedAt).where(sql`${table.runtime} = 'n8n' AND ${table.n8nStartedAt} IS NULL AND ${table.state} IN ('active', 'paused', 'needs_review')`),
  check("campaign_enrolment_runtime_check", sql`${table.runtime} IN ('legacy', 'n8n')`),
]);

export const campaignSendAttempts = pgTable("campaign_send_attempts", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id), enrolmentId: uuid("enrolment_id").notNull().references(() => campaignEnrolments.id),
  stepIndex: integer("step_index").notNull(), state: text("state").notNull().default("claimed"), rfcMessageId: text("rfc_message_id").notNull(),
  providerMessageId: text("provider_message_id"), providerThreadId: text("provider_thread_id"), error: text("error"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(), sentAt: timestamp("sent_at", { withTimezone: true }),
}, table => [uniqueIndex("campaign_send_step_idx").on(table.enrolmentId, table.stepIndex), uniqueIndex("campaign_send_rfc_id_idx").on(table.rfcMessageId)]);

export const campaignInboundEvents = pgTable("campaign_inbound_events", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  ownerUserId: text("owner_user_id").notNull().references(() => user.id), contactId: uuid("contact_id").notNull().references(() => contacts.id),
  channel: text("channel").notNull(), providerEventId: text("provider_event_id").notNull(), fromIdentity: text("from_identity").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("campaign_inbound_provider_idx").on(table.ownerUserId, table.channel, table.providerEventId), index("campaign_inbound_contact_idx").on(table.organizationId, table.contactId)]);

export const campaignContactHolds = pgTable("campaign_contact_holds", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  email: text("email").notNull(), reason: text("reason").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("campaign_contact_hold_email_idx").on(table.organizationId, table.email)]);

export const campaignReplyIdentities = pgTable("campaign_reply_identities", {
  organizationId: text("organization_id").notNull().references(() => organization.id), ownerUserId: text("owner_user_id").notNull().references(() => user.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id), channel: text("channel").notNull(), identity: text("identity").notNull(), sourceIdentity: text("source_identity").notNull(), email: text("email").notNull(), since: timestamp("since", { withTimezone: true }).notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.ownerUserId, table.contactId, table.channel, table.identity, table.email] }), index("campaign_reply_identity_match_idx").on(table.organizationId, table.ownerUserId, table.channel, table.identity), check("campaign_reply_identity_channel_check", sql`${table.channel} IN ('email','whatsapp','linkedin')`)]).enableRLS();

export const campaignReplyReceipts = pgTable("campaign_reply_receipts", {
  organizationId: text("organization_id").notNull().references(() => organization.id), ownerUserId: text("owner_user_id").notNull().references(() => user.id),
  channel: text("channel").notNull(), accountIdentity: text("account_identity").notNull(), providerEventId: text("provider_event_id").notNull(), fromIdentity: text("from_identity").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.ownerUserId, table.channel, table.accountIdentity, table.providerEventId] }), index("campaign_reply_receipt_identity_idx").on(table.organizationId, table.ownerUserId, table.channel, table.fromIdentity, table.receivedAt), check("campaign_reply_receipt_channel_check", sql`${table.channel} IN ('email','whatsapp','linkedin')`)]).enableRLS();

export const campaignReplyHolds = pgTable("campaign_reply_holds", {
  organizationId: text("organization_id").notNull().references(() => organization.id), contactId: uuid("contact_id").notNull().references(() => contacts.id),
  channel: text("channel").notNull(), providerEventId: text("provider_event_id").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), reason: text("reason").notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.contactId] }), check("campaign_reply_hold_channel_check", sql`${table.channel} IN ('email','whatsapp','linkedin')`), check("campaign_reply_hold_reason_check", sql`${table.reason} IN ('reply_received','reply_identity_ambiguous')`)]).enableRLS();

export const campaignReplyMonitors = pgTable("campaign_reply_monitors", {
  organizationId: text("organization_id").notNull().references(() => organization.id), ownerUserId: text("owner_user_id").notNull().references(() => user.id), channel: text("channel").notNull(),
  accountIdentity: text("account_identity"), cursor: text("cursor"), lastSuccessAt: timestamp("last_success_at", { withTimezone: true }), lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }), lastError: text("last_error"),
  leaseToken: uuid("lease_token"), leaseUntil: timestamp("lease_until", { withTimezone: true }),
}, table => [primaryKey({ columns: [table.organizationId, table.ownerUserId, table.channel] }), check("campaign_reply_monitor_channel_check", sql`${table.channel} IN ('email','whatsapp','linkedin')`)]).enableRLS();

export const campaignContactAssignments = pgTable("campaign_contact_assignments", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organization.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id), email: text("email"), ownerUserId: text("owner_user_id").notNull().references(() => user.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("campaign_contact_assignment_unique_idx").on(table.organizationId, table.contactId), uniqueIndex("campaign_contact_assignment_email_idx").on(table.organizationId, table.email)]);

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

// WhatsApp credentials are read only by the trusted container service.
export const whatsappConnections = pgTable("whatsapp_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  address: text("address"), status: text("status").notNull().default("disconnected"), encryptedCreds: text("encrypted_creds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("whatsapp_connection_owner_idx").on(table.organizationId, table.userId),
  check("whatsapp_connection_status_check", sql`${table.status} IN ('disconnected','connecting','qr','connected','reconnecting','reconnect_required','error')`)]).enableRLS();

export const whatsappAuthKeys = pgTable("whatsapp_auth_keys", {
  connectionId: uuid("connection_id").notNull().references(() => whatsappConnections.id, { onDelete: "cascade" }),
  keyType: text("key_type").notNull(), keyId: text("key_id").notNull(), encryptedValue: text("encrypted_value").notNull(),
}, table => [primaryKey({ columns: [table.connectionId, table.keyType, table.keyId] })]).enableRLS();

// Renewable ownership; no database connection is reserved for an idle account.
export const whatsappSessionLeases = pgTable("whatsapp_session_leases", {
  connectionId: uuid("connection_id").primaryKey().references(() => whatsappConnections.id, { onDelete: "cascade" }),
  ownerToken: uuid("owner_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [index("whatsapp_session_lease_expiry_idx").on(table.expiresAt)]).enableRLS();

// Durable inbound metadata only. WhatsApp message bodies remain in the channel.
export const whatsappReplyEvents = pgTable("whatsapp_reply_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(), connectionId: uuid("connection_id").notNull().references(() => whatsappConnections.id, { onDelete: "cascade" }),
  accountIdentity: text("account_identity").notNull(), providerEventId: text("provider_event_id").notNull(), remoteIdentity: text("remote_identity").notNull(), fromIdentity: text("from_identity"), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
}, table => [uniqueIndex("whatsapp_reply_event_provider_idx").on(table.connectionId, table.accountIdentity, table.providerEventId), index("whatsapp_reply_event_cursor_idx").on(table.connectionId, table.accountIdentity, table.id)]).enableRLS();

// Stable action keys survive worker/service restarts. Only the trusted WhatsApp service reads receipts.
export const whatsappDeliveryActions = pgTable("whatsapp_delivery_actions", {
  connectionId: uuid("connection_id").notNull().references(() => whatsappConnections.id, {onDelete:"cascade"}),
  actionKey: text("action_key").notNull(), accountIdentity: text("account_identity").notNull(),
  payloadHash: text("payload_hash").notNull(), state: text("state").notNull(), encryptedReceipt:text("encrypted_receipt"),
  claimedAt: timestamp("claimed_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},table=>[primaryKey({columns:[table.connectionId,table.actionKey]}),
  index("whatsapp_delivery_actions_capacity_idx").on(table.connectionId,table.claimedAt),
  check("whatsapp_delivery_key_check",sql`length(${table.actionKey}) BETWEEN 1 AND 200`),
  check("whatsapp_delivery_hash_check",sql`length(${table.payloadHash}) = 64`),
  check("whatsapp_delivery_state_check",sql`${table.state} IN ('submitting','submitted','unknown')`),
  check("whatsapp_delivery_receipt_check",sql`(${table.state} = 'submitted') = (${table.encryptedReceipt} IS NOT NULL)`),
]).enableRLS();
