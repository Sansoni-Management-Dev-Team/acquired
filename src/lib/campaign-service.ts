import {commitCampaignPublication} from './campaign-publication-store';
import {createCampaignDraft,saveCampaignDraft} from './campaign-draft-store';
import {CampaignError} from './campaign-error';
import {mandateOutreachOwner} from './mandate-outreach-owner';
import {agentManagedOutreachReason} from '@/domain/mandate-outreach-owner';
export {CampaignError} from './campaign-error';
import {communicationReplyIdentity} from '../domain/communication-reply-identity';
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rows, withCampaignDb, withCampaignWorker, withCampaignTickLock, type CampaignActor } from "@/db/campaign-client";
import { outreachEmail } from "@/domain/outreach-contact";
import { campaignChannels, contactLinkedin, contactPhone, missingCampaignDetails, type CreateContactRequest } from "@/domain/contact-record";
import { campaignDraftDefinition, campaignDefinition, campaignFirstStepIndex, campaignStepEntries, campaignSendWindowOpen, nextAllowedCampaignSend, nextCampaignStepAfter, acceptancePath, normalizeEmail, renderCampaignTemplate, type CampaignDefinition } from "@/domain/campaign";
import { n8nCampaignEnabled, provisionSequenceWorkflow, removeSequenceWorkflow, startSequenceContact } from "@/lib/campaign-n8n";

import { campaignLinkedin, linkedinCampaignEnabled, linkedinProfileFor } from "@/lib/campaign-linkedin";
import { deliveryProvider } from "@/lib/channels/delivery-registry";
import type { PoolClient } from "pg";
import { checkContactReplyMonitors, assertContactReplyFresh, assertReplyCoverage, prepareReplyContact, prepareScheduledReplyContact, checkScheduledReplyContact, runReplyMonitorTick, type ReplyContact } from "@/lib/campaign-reply-monitor";
import { assertNoReplyHold, replyMonitorMode } from "@/lib/campaign-reply-store";
import { replyMonitorIssue, replyReviewCodes, type ReplyChannel } from "@/domain/campaign-replies";
import { assertCampaignWorkRemaining, campaignWorkDeferred, withCampaignWorkBudget, withCampaignWorkCleanup, withoutCampaignWorkBudget } from "@/lib/campaign-work-budget";
import { ReplyCheckPending, ReplyCheckReview, replyCheckFailure, replyCheckDiagnostic } from "@/lib/campaign-reply-status";

type SequenceRow = { id: string; organization_id: string; owner_user_id: string; mandate_id: string; name: string; draft: unknown; published_definition?: unknown; n8n_workflow_id?: string | null; published_version: number; updated_at: Date; draft_revision:string };
type VersionRow = { id: string; sequence_id: string; version: number; definition: unknown; n8n_workflow_id: string | null };
type EnrolmentRow = { id: string; organization_id: string; owner_user_id: string; sequence_id: string; version_id: string; mandate_id: string; contact_id: string; mailbox_connection_id: string | null; recipient_email: string | null; recipient_phone?: string | null; recipient_linkedin?: string | null; state: string; stop_reason: string | null; initial_conversation_reviewed: boolean; step_index: number; next_step_at: Date | null; started_at: Date; last_reply_checked_at: Date | null; runtime: "legacy" | "n8n"; n8n_started_at: Date | null };
type ContactRow = { id: string; target_id: string | null; display_name: string; role?: string | null; company_name: string; personal_data: unknown; fictionalised: boolean };


function communicationsRuntimeEnabled() { return process.env.COMMUNICATIONS_RUNTIME_ENABLED === 'true'; }
async function assertRecordedConnectionReady(actor: CampaignActor, channel: ReplyChannel, enrolmentId: string) {
  if (!communicationsRuntimeEnabled()) throw new ReplyCheckReview('delivery_disabled', channel);
  const { resolveRecordedApplicationConnection } = await import('./communications-bindings');
  const { actorCommunicationsClient } = await import('./communications-client');
  const original = await resolveRecordedApplicationConnection(actor, channel, { enrolmentId });
  if (!original) throw new ReplyCheckReview('account_changed', channel);
  if (original.recoveryOnly) throw new ReplyCheckReview('unresolved_send', channel);
  const readiness = await (await actorCommunicationsClient(actor)).ready(original.binding);
  if (readiness.status === 'waiting') throw new ReplyCheckPending(readiness.code, channel, readiness.retryAt ? new Date(readiness.retryAt) : undefined);
  if (readiness.status === 'review') throw new ReplyCheckReview(replyReviewCodes.includes(readiness.code as never) ? readiness.code as typeof replyReviewCodes[number] : 'protocol', channel);
  if (readiness.status !== 'ready') throw new ReplyCheckReview('protocol', channel);
}
async function configuredStudioMailbox(actor: CampaignActor) {
  try {
    const { readManagedDefaults } = await import('./communications-bindings');
    const { actorCommunicationsClient } = await import('./communications-client');
    const [defaults, snapshot] = await Promise.all([
      readManagedDefaults(actor),
      (await actorCommunicationsClient(actor)).connections({ applicationId: 'acquire', tenantId: actor.organizationId, ownerId: actor.userId }),
    ]);
    if (!snapshot.available) return null;
    const selected = snapshot.connections.find(c => c.binding.channel === 'email' && defaults.some(d => d.channel === 'email' && d.connectionId === c.binding.connectionId && d.accountId === c.binding.accountId && d.generation === c.binding.generation));
    if (!selected) return null;
    const ready = selected.status === 'connected' && selected.readiness.status === 'ready' && selected.capabilities.messaging.send;
    const limit = Number(process.env.COMMUNICATIONS_ACCOUNT_DAILY_LIMIT || 0);
    return { address: outreachEmail(selected.label), ready, status: ready ? 'ready' as const : selected.readiness.status === 'review' ? 'reconnect_required' as const : 'reply_access_needed' as const, dailyCap: Number.isSafeInteger(limit) && limit >= 0 ? limit : 0 };
  } catch { return null; }
}

function parseDefinition(value: unknown): CampaignDefinition { return campaignDefinition.parse(value); }
function personalData(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function emailForContact(contact: ContactRow) { return outreachEmail(personalData(contact.personal_data).email); }
function contactLabel(contact: ContactRow) { return contact.display_name || "Unnamed person"; }
function contactRecipients(contact: ContactRow, definition: CampaignDefinition) {
  const data = personalData(contact.personal_data);
  const missing = missingCampaignDetails(definition, { ...data, linkedinUrl: data.linkedinUrl || data.linkedin || data.linkedin_url });
  if (missing.length) throw new CampaignError(`${contactLabel(contact)} needs ${missing.join(" and ")} before enrolment`);
  const channels = campaignChannels(definition);
  return { email: emailForContact(contact), phone: channels.includes("whatsapp") ? contactPhone(data.phone) : null, linkedin: channels.includes("linkedin") ? contactLinkedin(data.linkedinUrl || data.linkedin || data.linkedin_url) : null };
}
function assertContactUnchanged(contact: ContactRow | undefined, enrolment: EnrolmentRow, definition: CampaignDefinition) {
  if (!contact || contact.fictionalised || personalData(contact.personal_data).doNotContact === true) throw new CampaignError("Contact changed; send held for review");
  const recipients = contactRecipients(contact, definition);
  if (recipients.email !== enrolment.recipient_email || (enrolment.recipient_phone != null && recipients.phone !== enrolment.recipient_phone) || (enrolment.recipient_linkedin != null && recipients.linkedin !== contactLinkedin(enrolment.recipient_linkedin))) throw new CampaignError("Contact changed; send held for review");
}

// Company-linked contacts remain shared across mandates. Manually added people
// can belong directly to a mandate without inventing a company record.
const contactColumns = "c.id, c.target_id, c.display_name, c.role, c.personal_data, c.fictionalised, COALESCE(t.company_name, c.personal_data->>'companyName', '') AS company_name";
const contactJoin = "FROM contacts c LEFT JOIN targets t ON t.id = c.target_id AND t.organization_id = c.organization_id";
const contactMandate = "(c.mandate_id = $3 OR EXISTS (SELECT 1 FROM mandate_targets mt WHERE mt.target_id = c.target_id AND mt.organization_id = c.organization_id AND mt.mandate_id = $3))";

function nextSendAt(input: Date) { return nextAllowedCampaignSend(input); }
function sendWindowOpen(input: Date) { return campaignSendWindowOpen(input); }
function nextCampaignAction(definition: CampaignDefinition, sentIndex: number, sentAt: Date, enrolmentId: string, path?: BranchDecision["path"]) {
  const next = nextCampaignStepAfter(definition, sentIndex, sentAt, enrolmentId, path);
  return next;
}

// A maintenance delay preserves the scheduled time. A due preflight moves it
// forward without losing the step. Record each transition atomically with its audit.
async function recordReplyCheckFailure(enrolment: EnrolmentRow, error: unknown, phase: "maintenance" | "preflight") {
  const failure = replyCheckFailure(error);
  const pending = failure instanceof ReplyCheckPending;
  const nextStepAt = pending && phase === "preflight" ? nextSendAt(new Date(Math.max(Date.now() + 1000, failure.retryAt.getTime()))) : enrolment.next_step_at;
  const metadata = JSON.stringify({ ...replyCheckDiagnostic(failure), phase, stepIndex: enrolment.step_index,
    transition: { from: enrolment.state, to: pending ? "active" : "needs_review" } });
  await withCampaignWorkCleanup(() => withCampaignWorker(client => client.query(
    pending ? `WITH changed AS (
      UPDATE campaign_enrolments SET stop_reason = 'reply_monitor_wait', next_step_at = COALESCE($4, next_step_at), updated_at = now()
      WHERE id = $1 AND state = 'active' AND (stop_reason IS DISTINCT FROM 'reply_monitor_wait' OR ($4::timestamptz IS NOT NULL AND next_step_at IS DISTINCT FROM $4)) RETURNING id
    ) INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
      SELECT $2,$3,'campaign.reply_check_waiting','campaign_enrolment',id,$5::jsonb FROM changed`
    : `WITH changed AS (
      UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = 'reply_check_failed', next_step_at = NULL, updated_at = now()
      WHERE id = $1 AND state = 'active' AND $4::timestamptz IS NULL RETURNING id
    ) INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
      SELECT $2,$3,'campaign.reply_check_failed','campaign_enrolment',id,$5::jsonb FROM changed`,
    [enrolment.id, enrolment.organization_id, enrolment.owner_user_id, pending && phase === "preflight" ? nextStepAt : null, metadata],
  ).then(() => undefined), enrolment.organization_id));
  return { outcome: pending ? "retry" as const : "needs_review" as const, nextStepAt: pending ? nextStepAt : null };
}

async function clearReplyWait(enrolment: EnrolmentRow) {
  if (enrolment.stop_reason !== "reply_monitor_wait") return;
  await withCampaignWorkCleanup(() => withCampaignWorker(client => client.query(`WITH changed AS (
    UPDATE campaign_enrolments SET stop_reason = NULL, updated_at = now() WHERE id = $1 AND state = 'active' AND stop_reason = 'reply_monitor_wait' RETURNING id
  ) INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id)
    SELECT $2,$3,'campaign.reply_check_ready','campaign_enrolment',id FROM changed`, [enrolment.id, enrolment.organization_id, enrolment.owner_user_id]).then(() => undefined), enrolment.organization_id));
}

async function contactInMandate(client: PoolClient, actor: CampaignActor, mandateId: string, contactId: string) {
  const [contact] = await rows<ContactRow>(client, `SELECT ${contactColumns} ${contactJoin} WHERE c.id = $1 AND c.organization_id = $2 AND ${contactMandate}`, [contactId, actor.organizationId, mandateId]);
  if (!contact || contact.fictionalised) throw new CampaignError("Contact is not a real person in this mandate");
  if (personalData(contact.personal_data).doNotContact === true) throw new CampaignError(`${contact.display_name} is marked do not contact`);
  return contact;
}

async function assertContactAllowed(client: PoolClient, actor: CampaignActor, email: string | null) {
  if (!email) return;
  const [hold] = await rows<{ reason: string }>(client, "SELECT reason FROM campaign_contact_holds WHERE organization_id = $1 AND email = $2 LIMIT 1", [actor.organizationId, email]);
  if (hold) throw new CampaignError(`Contact is held: ${hold.reason}`);
  const domain = email.split("@")[1];
  const [suppressed] = await rows<{ reason: string }>(client, "SELECT reason FROM suppressions WHERE organization_id = $1 AND (lower(address) = $2 OR lower(domain) = $3) LIMIT 1", [actor.organizationId, email, domain]);
  if (suppressed) throw new CampaignError(`Contact is suppressed: ${suppressed.reason}`);
}

export async function listCampaignStudio(actor: CampaignActor, mandateId: string) {
  const studio = await withCampaignDb(actor, async client => {
    const outreachOwner = await mandateOutreachOwner(client, actor, mandateId);
    const sequences = await rows<SequenceRow>(client, "SELECT s.*, s.xmin::text AS draft_revision, (SELECT v.definition FROM campaign_sequence_versions v WHERE v.sequence_id = s.id AND v.version = s.published_version) AS published_definition, (SELECT v.n8n_workflow_id FROM campaign_sequence_versions v WHERE v.sequence_id = s.id AND v.version = s.published_version) AS n8n_workflow_id FROM campaign_sequences s WHERE s.organization_id = $1 AND s.owner_user_id = $2 AND s.mandate_id = $3 ORDER BY s.updated_at DESC", [actor.organizationId, actor.userId, mandateId]);
    const enrolments = await rows<EnrolmentRow & { sequence_name: string; version: number; version_definition: unknown; last_sent_at: Date | null }>(client, "SELECT e.*, s.name AS sequence_name, v.version, v.definition AS version_definition, (SELECT max(a.sent_at) FROM campaign_send_attempts a WHERE a.enrolment_id = e.id AND a.state = 'sent') AS last_sent_at FROM campaign_enrolments e JOIN campaign_sequences s ON s.id = e.sequence_id JOIN campaign_sequence_versions v ON v.id = e.version_id WHERE e.organization_id = $1 AND e.owner_user_id = $2 AND e.mandate_id = $3 ORDER BY e.started_at DESC", [actor.organizationId, actor.userId, mandateId]);
    const contactRows = await rows<ContactRow>(client, `SELECT ${contactColumns} ${contactJoin} WHERE c.organization_id = $1 AND (c.mandate_id = $2 OR EXISTS (SELECT 1 FROM mandate_targets mt WHERE mt.target_id = c.target_id AND mt.organization_id = c.organization_id AND mt.mandate_id = $2)) ORDER BY company_name, c.display_name`, [actor.organizationId, mandateId]);
    const activity = enrolments.length ? await rows<{ entity_id: string; action: string; created_at: Date; metadata: { stepIndex?: number; splitId?: string; path?: "pathA" | "pathB"; channel?: ReplyChannel; receivedAt?: string } | null }>(client, "SELECT entity_id, action, created_at, metadata FROM audit_events WHERE organization_id = $1 AND actor_id = $2 AND entity_type = 'campaign_enrolment' AND entity_id = ANY($3::text[]) ORDER BY created_at DESC LIMIT 1000", [actor.organizationId, actor.userId, enrolments.map(row => row.id)]) : [];
    const attempts = enrolments.length ? await rows<{ enrolment_id: string; step_index: number; state: string; sent_at: Date | null }>(client, "SELECT enrolment_id, step_index, state, sent_at FROM campaign_send_attempts WHERE organization_id = $1 AND owner_user_id = $2 AND enrolment_id = ANY($3::uuid[])", [actor.organizationId, actor.userId, enrolments.map(row => row.id)]) : [];
    return {
      outreachOwner,
      sequences: sequences.map(row => ({ id: row.id, name: row.name, draft: campaignDraftDefinition.parse(row.draft), publishedDefinition: row.published_definition ? parseDefinition(row.published_definition) : null, publishedVersion: row.published_version, n8nWorkflowId: row.n8n_workflow_id || null, updatedAt: row.updated_at.toISOString(),draftRevision:row.draft_revision })),
      enrolments: enrolments.map(row => {
        const definition = parseDefinition(row.version_definition);
        const steps = campaignStepEntries(definition);
        const events = activity.filter(event => event.entity_id === row.id);
        const nextStepAt = row.next_step_at?.toISOString() || null;
        const reply = events.find(event => event.action === "campaign.reply_received");
        return {
          id: row.id, sequenceId: row.sequence_id, sequenceName: row.sequence_name, version: row.version, contactId: row.contact_id,
          state: row.state, stopReason: row.stop_reason, stepIndex: row.step_index, nextStepAt,
          lastReply: reply ? { channel: reply.metadata?.channel || "email", receivedAt: reply.metadata?.receivedAt || reply.created_at.toISOString() } : null,
          nextStepTitle: steps[row.step_index]?.step.title || null, totalSteps: steps.length, recipientEmail: row.recipient_email,
          startedAt: row.started_at.toISOString(), lastSentAt: row.last_sent_at?.toISOString() || null,
          activity: events.map(event => ({ action: event.action, at: event.created_at.toISOString() })),
          run: {
            id: row.id, label: contactRows.find(contact => contact.id === row.contact_id)?.display_name || row.recipient_email || "Unnamed person",
            version: row.version, definition, state: row.state, stopReason: row.stop_reason, stepIndex: row.step_index, nextStepAt,
            branchDecisions: Object.fromEntries(events.filter(event => event.action === "campaign.branch_decided" && event.metadata?.splitId && event.metadata?.path).map(event => [event.metadata!.splitId!, event.metadata!.path!])),
            retryStepIndex: events.find(event => event.action === "campaign.retry_scheduled")?.metadata?.stepIndex ?? null,
            attempts: attempts.filter(attempt => attempt.enrolment_id === row.id).map(attempt => ({ stepId: steps[attempt.step_index]?.step.id || "", state: attempt.state, sentAt: attempt.sent_at?.toISOString() || null, ...(steps[attempt.step_index]?.step.kind === "linkedin" ? { outcome: events.some(event => event.action === "campaign.linkedin_skipped" && event.metadata?.stepIndex === attempt.step_index) ? "skipped" as const : "submitted" as const } : {}) })),
          },
        };
      }),
      contacts: contactRows.map(row => ({ id: row.id, targetId: row.target_id, name: row.display_name, role: row.role || undefined, linkedinUrl: contactLinkedin(personalData(row.personal_data).linkedinUrl || personalData(row.personal_data).linkedin || personalData(row.personal_data).linkedin_url), company: row.company_name, email: z.email().safeParse(personalData(row.personal_data).email).success ? normalizeEmail(String(personalData(row.personal_data).email)) : null, phone: typeof personalData(row.personal_data).phone === "string" ? String(personalData(row.personal_data).phone).trim() || null : null, fictionalised: row.fictionalised, doNotContact: personalData(row.personal_data).doNotContact === true })),
    };
  });
  const mode = replyMonitorMode();
  const monitors = studio.outreachOwner === 'agent' || mode === "off" ? [] : await withCampaignDb(actor, client => rows<{ channel: ReplyChannel; last_success_at: Date | null; healthy: boolean; needs_review: boolean }>(client, `SELECT b.channel,min(m.observed_at) AS last_success_at,
 bool_and(m.complete AND m.initial_sync_complete AND NOT m.invalidated AND m.coverage_through>=clock_timestamp()-interval '5 minutes' AND m.coverage_through<=m.observed_at AND m.observed_at<=clock_timestamp() AND m.observed_at>=clock_timestamp()-interval '5 minutes') AS healthy,
 bool_or(m.failure_code IS NOT NULL) AS needs_review FROM public.communication_reply_monitors m JOIN public.communication_bindings b ON b.id=m.binding_id AND b.organization_id=m.organization_id AND b.owner_user_id=m.owner_user_id WHERE m.organization_id=$1 AND m.owner_user_id=$2 AND b.authority='service' AND b.backend='unipile' GROUP BY b.channel ORDER BY b.channel`, [actor.organizationId, actor.userId]));
  const mailbox = studio.outreachOwner !== 'agent' && communicationsRuntimeEnabled() ? await configuredStudioMailbox(actor) : null;
  return { ...studio, mailbox, replyMonitoring: { mode, monitors: monitors.map(item => ({ channel: item.channel, lastSuccessAt: item.last_success_at?.toISOString() || null, error: item.healthy ? null : item.needs_review ? "Reply monitoring needs review" : "Waiting for reply checks", healthy: item.healthy === true })) }, n8nUrl: process.env.CAMPAIGN_N8N_URL?.replace(/\/$/, "") || null };
}

export async function createMandateContact(actor: CampaignActor, mandateId: string, input: CreateContactRequest) {
  return withCampaignDb(actor, async client => {
    const [mandate] = await rows(client, "SELECT id FROM mandates WHERE id = $1 AND organization_id = $2", [mandateId, actor.organizationId]);
    if (!mandate) throw new CampaignError("Mandate not found", 404);
    const data = { email: outreachEmail(input.email), linkedinUrl: contactLinkedin(input.linkedinUrl), phone: input.phone || null, companyName: input.company || null, jobTitle: input.jobTitle || null, doNotContact: false };
    const [contact] = await rows<{ id: string }>(client, `INSERT INTO contacts (organization_id, mandate_id, display_name, role, personal_data, provenance, fictionalised) VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id`, [actor.organizationId, mandateId, input.fullName || "", input.jobTitle || null, JSON.stringify(data), JSON.stringify({ source: "Manual entry", capturedAt: new Date().toISOString(), createdBy: actor.userId })]);
    await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'contact.created','contact',$3,$4)", [actor.organizationId, actor.userId, contact.id, JSON.stringify({ mandateId, source: "Manual entry" })]);
    return contact;
  });
}

export async function createCampaign(actor: CampaignActor, mandateId: string, name: string, definition: CampaignDefinition) {
  return withCampaignDb(actor, client => createCampaignDraft(client, actor, mandateId, name, definition, undefined, rows));
}

/** Builder and agent draft updates use the same locked xmin comparison. */
export async function saveCampaign(actor: CampaignActor, sequenceId: string, name: string, definition: CampaignDefinition,expectedRevision?:string) {
  return withCampaignDb(actor, client => saveCampaignDraft(client, actor, sequenceId, name, definition, expectedRevision, rows));
}

export async function publishCampaign(actor: CampaignActor, sequenceId: string) {
  const prepared = await withCampaignDb(actor, async client => {
    const [sequence] = await rows<SequenceRow>(client, "SELECT *,xmin::text AS draft_revision FROM campaign_sequences WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId, sequenceId]);
    if (!sequence) throw new CampaignError("Sequence not found", 404);
    return { definition: parseDefinition(sequence.draft), name: sequence.name, version: sequence.published_version + 1, updatedAt: sequence.updated_at,draftRevision:sequence.draft_revision };
  });
  if (campaignStepEntries(prepared.definition).some(({ step }) => step.kind === "whatsapp") && !communicationsRuntimeEnabled()) throw new CampaignError("WhatsApp campaign delivery must be configured before publishing.");
  if (campaignStepEntries(prepared.definition).some(({ step }) => step.kind === "linkedin") && !linkedinCampaignEnabled()) throw new CampaignError("LinkedIn campaign delivery must be configured and enabled before publishing.");
  const versionId = randomUUID();
  const workflowId = n8nCampaignEnabled() ? await provisionSequenceWorkflow({ versionId, sequenceName: prepared.name, version: prepared.version, definition: prepared.definition }) : null;
  try { return await withCampaignDb(actor, client => commitCampaignPublication(client, actor, {sequenceId,draftRevision:prepared.draftRevision,publishedVersion:prepared.version-1,updatedAt:prepared.updatedAt,versionId,workflowId},rows)); } catch (error) { if (workflowId) await removeSequenceWorkflow(workflowId).catch(() => undefined); throw error; }
}

export async function enrolContacts(actor: CampaignActor, sequenceId: string, contactIds: string[]) {
  const uniqueIds = [...new Set(contactIds)];
  const prepared = await withCampaignDb(actor, async client => {
    const [sequence] = await rows<SequenceRow>(client, "SELECT * FROM campaign_sequences WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId, sequenceId]);
    if (!sequence || !sequence.published_version) throw new CampaignError("Publish this sequence before adding contacts");
    if (await mandateOutreachOwner(client, actor, sequence.mandate_id) === 'agent') throw new CampaignError(agentManagedOutreachReason);
    const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE sequence_id = $1 AND version = $2", [sequenceId, sequence.published_version]);
    if (!version) throw new CampaignError("Published version is missing");
    if (n8nCampaignEnabled() && !version.n8n_workflow_id) throw new CampaignError("This published version must be synced to n8n before new contacts can be added");
    const definition = parseDefinition(version.definition);
    const contacts = [] as { contact: ContactRow; email: string | null; phone: string | null; linkedin: string | null }[];
    const seen = new Set<string>();
    for (const id of uniqueIds) {
      const contact = await contactInMandate(client, actor, sequence.mandate_id, id);
      const recipients = contactRecipients(contact, definition);
      await assertNoReplyHold(client, actor, contact.id);
      for (const [channel, value] of Object.entries(recipients)) {
        if (!value) continue;
        const key = `${channel}:${value}`;
        if (seen.has(key)) throw new CampaignError(`Selected contacts contain the same ${channel === "linkedin" ? "LinkedIn profile" : channel} more than once`);
        seen.add(key);
      }
      await assertContactAllowed(client, actor, recipients.email);
      const [running] = await rows<{ id: string }>(client, "SELECT id FROM campaign_enrolments WHERE organization_id = $1 AND (contact_id = $2 OR recipient_email = $3 OR recipient_phone = $4 OR recipient_linkedin = $5) AND state IN ('active', 'paused', 'needs_review') LIMIT 1", [actor.organizationId, contact.id, recipients.email, recipients.phone, recipients.linkedin]);
      if (running) throw new CampaignError(`${contactLabel(contact)} already has active outreach`);
      contacts.push({ contact, ...recipients });
    }
    return { sequence, version, definition, contacts };
  });
  for (const channel of campaignChannels(prepared.definition)) await deliveryProvider(channel).ready(actor);
  if (!communicationsRuntimeEnabled()) throw new ReplyCheckReview('delivery_disabled');
  const enrolled = await withCampaignDb(actor, async client => {
    if (await mandateOutreachOwner(client, actor, prepared.sequence.mandate_id) === 'agent') throw new CampaignError(agentManagedOutreachReason);
    const results = [] as { id: string; contactId: string; state: string; nextStepAt: Date | null; firstAction: string }[];
    for (const { contact, email, phone, linkedin } of prepared.contacts) {
      await assertNoReplyHold(client, actor, contact.id);
      await assertContactAllowed(client, actor, email);
      const [running] = await rows<{ id: string }>(client, "SELECT id FROM campaign_enrolments WHERE organization_id = $1 AND (contact_id = $2 OR recipient_email = $3 OR recipient_phone = $4 OR recipient_linkedin = $5) AND state IN ('active', 'paused', 'needs_review') LIMIT 1", [actor.organizationId, contact.id, email, phone, linkedin]);
      if (running) throw new CampaignError(`${contact.display_name} already has active outreach`);
      await client.query("INSERT INTO campaign_contact_assignments (organization_id, contact_id, email, owner_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [actor.organizationId, contact.id, email, actor.userId]);
      const [assignment] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_assignments WHERE organization_id = $1 AND contact_id = $2 AND email IS NOT DISTINCT FROM $3 AND owner_user_id = $4", [actor.organizationId, contact.id, email, actor.userId]);
      if (!assignment) throw new CampaignError(`${contact.display_name} is assigned to another sender`);
      const enrolmentId = randomUUID();
      const firstIndex = campaignFirstStepIndex(prepared.definition, enrolmentId);
      const firstStep = campaignStepEntries(prepared.definition)[firstIndex].step;
      const nextAt = null;
      const [enrolment] = await rows<EnrolmentRow>(client, `INSERT INTO campaign_enrolments (organization_id, owner_user_id, sequence_id, version_id, mandate_id, contact_id, mailbox_connection_id, recipient_email, state, stop_reason, next_step_at, runtime, id, step_index, recipient_phone, recipient_linkedin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [actor.organizationId, actor.userId, sequenceId, prepared.version.id, prepared.sequence.mandate_id, contact.id, null, email, "needs_review", "initial_conversation_requires_review", nextAt, n8nCampaignEnabled() ? "n8n" : "legacy", enrolmentId, firstIndex, phone, linkedin]);
      for (const channel of campaignChannels(prepared.definition)) {
        const bound = await client.query(`INSERT INTO public.campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id)
 SELECT $1,d.organization_id,d.owner_user_id,d.channel,d.binding_id FROM public.communication_defaults d JOIN public.communication_bindings b ON b.id=d.binding_id
 WHERE d.organization_id=$2 AND d.owner_user_id=$3 AND d.channel=$4 AND b.authority='service' AND b.backend='unipile' AND b.organization_id=d.organization_id AND b.owner_user_id=d.owner_user_id AND b.channel=d.channel RETURNING binding_id`, [enrolment.id, actor.organizationId, actor.userId, channel]);
        if (bound.rowCount !== 1) throw new CampaignError(`A recorded ${channel} connection is required before enrollment`);
        const canonical=channel==='email'?email:channel==='whatsapp'?phone:linkedin, identity=canonical?communicationReplyIdentity(channel,canonical):null; if(!canonical||!identity)throw new CampaignError(`A canonical ${channel} reply identity is required`);
        await client.query("INSERT INTO public.campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) SELECT $1,$2,$3,$4,$5,$6,$7,started_at FROM public.campaign_enrolments WHERE id=$8 AND organization_id=$1 AND owner_user_id=$2 ON CONFLICT DO NOTHING",[actor.organizationId,actor.userId,contact.id,channel,identity,canonical,email||'',enrolment.id]);
      }
      await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.subscribed','campaign_enrolment',$3,$4)", [actor.organizationId, actor.userId, enrolment.id, JSON.stringify({ sequenceId, version: prepared.version.version, contactId: contact.id, firstAction: firstStep.title, existingConversation: false })]);
      results.push({ id: enrolment.id, contactId: contact.id, state: enrolment.state, nextStepAt: enrolment.next_step_at, firstAction: "Review the first conversation before sending" });
    }
    return results;
  });
  if (replyMonitorMode() !== "off") for (const result of enrolled) {
    const preparedContact = prepared.contacts.find(item => item.contact.id === result.contactId)!;
    try {
      const [enrolment] = await withCampaignDb(actor, client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [result.id]));
      await prepareReplyContact(actor, { id: result.contactId, email: preparedContact.email, data: personalData(preparedContact.contact.personal_data), since: enrolment.started_at, requiredChannels: campaignChannels(prepared.definition) });
      await assertContactReplyFresh(actor, result.contactId, campaignChannels(prepared.definition), enrolment.started_at);
    } catch (error) {
      if (replyMonitorMode() === "enforce" && result.state === "active") {
        const [enrolment] = await withCampaignDb(actor, client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [result.id]));
        const transition = await recordReplyCheckFailure(enrolment, error, "maintenance");
        if (transition.outcome === "needs_review") { result.state = "needs_review"; result.nextStepAt = null; }
        result.firstAction = transition.outcome === "retry" ? "Waiting for reply checks" : "Reply monitoring needs review before sending";
      }
    }
  }
  return enrolled;
}

function assertRetryableHold(enrolment: EnrolmentRow) {
  if (enrolment.state !== "needs_review" || ["existing_conversation", "initial_conversation_requires_review", "send_result_unknown", "linkedin_result_requires_review", "linkedin_result_unknown", "whatsapp_result_unknown", "manual_outbound_detected", "reply_identity_ambiguous"].includes(enrolment.stop_reason || "")) throw new CampaignError("This hold needs manual review, not an automatic retry");
}
async function assertRecoveryAttempts(client: PoolClient, enrolment: EnrolmentRow) {
  const attempts = await rows<{ state: string }>(client, "SELECT state FROM campaign_send_attempts WHERE enrolment_id = $1 AND (state IN ('claimed','unknown') OR (step_index = $2 AND state = 'sent'))", [enrolment.id, enrolment.step_index]);
  if (attempts.length) throw new ReplyCheckReview("unresolved_send");
}

export async function changeEnrolment(actor: CampaignActor, enrolmentId: string, action: "pause" | "resume" | "stop" | "review_existing_conversation" | "retry_preflight") {
  let recoveryChannels: ReplyChannel[] | undefined;
  if (action === "retry_preflight") {
    const loaded = await withCampaignDb(actor, async client => {
      const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId, enrolmentId]);
      if (!enrolment) throw new CampaignError("Enrolment not found", 404);
      assertRetryableHold(enrolment);
      if (replyMonitorMode() !== "enforce") throw new CampaignError("Enable enforced reply checks before recovering this schedule");
      const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [enrolment.version_id]);
      if (!version) throw new CampaignError("Sequence version is unavailable");
      const definition = parseDefinition(version.definition);
      const [contact] = await rows<ContactRow>(client, `SELECT ${contactColumns} ${contactJoin} WHERE c.id = $1 AND c.organization_id = $2`, [enrolment.contact_id, actor.organizationId]);
      assertContactUnchanged(contact, enrolment, definition);
      await assertContactAllowed(client, actor, enrolment.recipient_email); await assertNoReplyHold(client, actor, enrolment.contact_id);
      await assertRecoveryAttempts(client, enrolment);
      return { enrolment, contact, channels: campaignChannels(definition) };
    });
    await checkContactReplyMonitors(actor, { id: loaded.contact.id, email: loaded.enrolment.recipient_email, data: personalData(loaded.contact.personal_data), since: loaded.enrolment.started_at, requiredChannels: loaded.channels });
    for (const channel of loaded.channels) await assertRecordedConnectionReady(actor, channel, loaded.enrolment.id);
    recoveryChannels = loaded.channels;
  }
  return withCampaignDb(actor, async client => {
    const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 FOR UPDATE", [actor.organizationId, actor.userId, enrolmentId]);
    if (!enrolment) throw new CampaignError("Enrolment not found", 404);
    if (action === "pause" && enrolment.state !== "active") throw new CampaignError("Only active automation can be paused");
    if (action === "resume" && enrolment.state !== "paused") throw new CampaignError("Only manually paused automation can be resumed");
    if (action === "review_existing_conversation" && (enrolment.state !== "needs_review" || !["existing_conversation", "initial_conversation_requires_review"].includes(enrolment.stop_reason || ""))) throw new CampaignError("There is no existing conversation to review");
    if (action === "retry_preflight") {
      assertRetryableHold(enrolment); await assertRecoveryAttempts(client, enrolment);
      await assertReplyCoverage(client, actor, enrolment.contact_id, recoveryChannels, enrolment.started_at);
    }
    if (action === "stop" && !["active", "paused", "needs_review"].includes(enrolment.state)) throw new CampaignError("Automation is already stopped");
    if (action !== "stop") { await assertContactAllowed(client, actor, enrolment.recipient_email); await assertNoReplyHold(client, actor, enrolment.contact_id); }
    const state = action === "pause" ? "paused" : action === "stop" ? "stopped" : "active";
    const nextAt = action === "pause" ? enrolment.next_step_at : state === "active" ? nextSendAt(new Date(Math.max(Date.now(), enrolment.next_step_at?.getTime() || 0))) : null;
    const reviewed = action === "review_existing_conversation" || enrolment.initial_conversation_reviewed;
    if(communicationsRuntimeEnabled()) await client.query("UPDATE campaign_enrolments SET state=$2,stop_reason=$3,next_step_at=$4,initial_conversation_reviewed=$5,communication_initial_reviewed_at=CASE WHEN $6::boolean THEN clock_timestamp() ELSE communication_initial_reviewed_at END,updated_at=now() WHERE id=$1",[enrolmentId,state,action === "stop" ? "manual_stop" : action === "pause" ? "manual_pause" : null,nextAt,reviewed,action==='review_existing_conversation']);
    else await client.query("UPDATE campaign_enrolments SET state = $2, stop_reason = $3, next_step_at = $4, initial_conversation_reviewed = $5, updated_at = now() WHERE id = $1", [enrolmentId, state, action === "stop" ? "manual_stop" : action === "pause" ? "manual_pause" : null, nextAt, reviewed]);
    await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id) VALUES ($1,$2,$3,'campaign_enrolment',$4)", [actor.organizationId, actor.userId, `campaign.${action}`, enrolmentId]);
    return { id: enrolmentId, state, nextStepAt: nextAt };
  });
}

async function claimSend(actor: CampaignActor, enrolmentId: string, expectedIndex: number) {
  return withCampaignDb(actor, async client => {
    const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 FOR UPDATE", [actor.organizationId, actor.userId, enrolmentId]);
    if (!enrolment || enrolment.state !== "active" || enrolment.step_index !== expectedIndex || !enrolment.next_step_at || enrolment.next_step_at > new Date()) return null;
    if (!sendWindowOpen(new Date())) {
      await client.query("UPDATE campaign_enrolments SET next_step_at = $2, updated_at = now() WHERE id = $1", [enrolment.id, nextSendAt(new Date())]);
      return null;
    }
    await assertContactAllowed(client, actor, enrolment.recipient_email);
    await assertNoReplyHold(client, actor, enrolment.contact_id);
    const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [enrolment.version_id]);
    if (!version) throw new CampaignError("Sequence version is unavailable");
    const definition = parseDefinition(version.definition);
    const [contact] = await rows<ContactRow>(client, `SELECT ${contactColumns} ${contactJoin} WHERE c.id = $1 AND c.organization_id = $2`, [enrolment.contact_id, actor.organizationId]);
    assertContactUnchanged(contact, enrolment, definition);
    const [assignment] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_assignments WHERE organization_id = $1 AND contact_id = $2 AND email IS NOT DISTINCT FROM $3 AND owner_user_id = $4", [actor.organizationId, enrolment.contact_id, enrolment.recipient_email, actor.userId]);
    if (!assignment) throw new CampaignError("Contact is not assigned to this sender");
    const [existing] = await rows<{ id: string; state: string }>(client, "SELECT id, state FROM campaign_send_attempts WHERE enrolment_id = $1 AND step_index = $2", [enrolment.id, expectedIndex]);
    const messageId = `<${randomUUID()}@acquire.mlai.au>`;
    if (existing && existing.state !== "cancelled") return null;
    const [attempt] = existing
      ? await rows<{ id: string }>(client, "UPDATE campaign_send_attempts SET state = 'claimed', rfc_message_id = $2, claimed_at = now(), error = NULL WHERE id = $1 AND state = 'cancelled' RETURNING id", [existing.id, messageId])
      : await rows<{ id: string }>(client, "INSERT INTO campaign_send_attempts (organization_id, owner_user_id, enrolment_id, step_index, rfc_message_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [actor.organizationId, actor.userId, enrolment.id, expectedIndex, messageId]);
    return { attemptId: attempt.id, messageId, contact };
  });
}

async function claimStillEligible(actor: CampaignActor, enrolment: EnrolmentRow, attemptId: string, definition: CampaignDefinition) {
  try { await assertContactReplyFresh(actor, enrolment.contact_id, campaignChannels(definition), enrolment.started_at); }
  catch (error) {
    await withCampaignDb(actor, client => client.query("UPDATE campaign_send_attempts SET state = 'cancelled', error = 'Reply monitoring changed before send' WHERE id = $1 AND state = 'claimed'", [attemptId]).then(() => undefined));
    throw error;
  }
  return withCampaignDb(actor, async client => {
    const [current] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [enrolment.id]);
    const [hold] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_holds WHERE organization_id = $1 AND email = $2", [actor.organizationId, enrolment.recipient_email]);
    if (current?.state === "active" && current.step_index === enrolment.step_index && !hold) {
      try { await assertContactAllowed(client, actor, enrolment.recipient_email); }
      catch (error) {
        await client.query("UPDATE campaign_send_attempts SET state = 'cancelled', error = 'Contact suppression changed before send' WHERE id = $1 AND state = 'claimed'", [attemptId]);
        // Commit the cancelled claim before propagating the preflight failure.
        return { error };
      }
      return true;
    }
    await client.query("UPDATE campaign_send_attempts SET state = 'cancelled', error = 'Enrolment changed before send' WHERE id = $1 AND state = 'claimed'", [attemptId]);
    return false;
  }).then(result => {
    if (typeof result === "object") throw result.error;
    return result;
  });
}

type BranchDecision = { splitId: string; path: "pathA" | "pathB"; decidedAt: string };
async function savedBranch(actor: CampaignActor, enrolmentId: string, splitId: string) {
  return withCampaignDb(actor, async client => {
    const [event] = await rows<{ metadata: BranchDecision }>(client, "SELECT metadata FROM audit_events WHERE organization_id = $1 AND actor_id = $2 AND entity_type = 'campaign_enrolment' AND entity_id = $3 AND action = 'campaign.branch_decided' AND metadata->>'splitId' = $4 ORDER BY created_at LIMIT 1", [actor.organizationId, actor.userId, enrolmentId, splitId]);
    return event?.metadata;
  });
}
async function advanceCampaign(actor: CampaignActor, enrolment: EnrolmentRow, definition: CampaignDefinition, contact: ContactRow, sentAt: Date) {
  const step = campaignStepEntries(definition)[enrolment.step_index].step;
  const split = definition.splits?.find(split => split.afterStepId === step.id && split.condition);
  let decision = split ? await savedBranch(actor, enrolment.id, split.id) : undefined;
  if (split?.condition && !decision) {
    const observed = await campaignLinkedin(actor, { operation: "status", profile: linkedinProfileFor(personalData(contact.personal_data)), enrolmentId:enrolment.id });
    if (observed.status !== "retry" && observed.connected == null) throw new CampaignError("LinkedIn connection status is unknown; review before continuing");
    const path = acceptancePath(observed.connected ?? null, sentAt, split.condition.timeoutDays, new Date());
    if (!path) {
      const retryAt = new Date(Math.max(Date.now() + 5 * 60_000, (observed.nextEligibleAt || 0) * 1000));
      await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET next_step_at = $2, updated_at = now() WHERE id = $1 AND state = 'active' AND step_index = $3", [enrolment.id, retryAt, enrolment.step_index]).then(() => undefined));
      return { outcome: "waiting_for_acceptance" as const };
    }
    decision = await withCampaignDb(actor, async client => {
      await client.query("SELECT id FROM campaign_enrolments WHERE id = $1 FOR UPDATE", [enrolment.id]);
      const [existing] = await rows<{ metadata: BranchDecision }>(client, "SELECT metadata FROM audit_events WHERE entity_type = 'campaign_enrolment' AND entity_id = $1 AND action = 'campaign.branch_decided' AND metadata->>'splitId' = $2 ORDER BY created_at LIMIT 1", [enrolment.id, split.id]);
      if (existing) return existing.metadata;
      const metadata: BranchDecision = { splitId: split.id, path, decidedAt: new Date().toISOString() };
      await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.branch_decided','campaign_enrolment',$3,$4)", [actor.organizationId, actor.userId, enrolment.id, JSON.stringify(metadata)]);
      return metadata;
    });
  }
  const next = nextCampaignAction(definition, enrolment.step_index, decision ? new Date(decision.decidedAt) : sentAt, enrolment.id, decision?.path);
  await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET state = $2, step_index = $3, next_step_at = $4, updated_at = now() WHERE id = $1 AND state = 'active' AND step_index = $5", [enrolment.id, next ? "active" : "completed", next?.index ?? campaignStepEntries(definition).length, next ? nextSendAt(next.at) : null, enrolment.step_index]).then(() => undefined));
  return { outcome: "sent" as const };
}

async function processDeliveryStep(actor: CampaignActor, enrolment: EnrolmentRow, definition: CampaignDefinition, contact: ContactRow) {
  const step = campaignStepEntries(definition)[enrolment.step_index].step;
  if (step.kind === "wait") throw new CampaignError("Invalid delivery step");
  const channel = step.kind;
  const recipientFor = (contact:ContactRow) => channel === "whatsapp" ? contactPhone(personalData(contact.personal_data).phone) : channel === "linkedin" ? linkedinProfileFor(personalData(contact.personal_data)) : emailForContact(contact);
  const recipient = recipientFor(contact);
  if (!recipient) throw new CampaignError("Delivery recipient is unavailable");
  const templateContact = {displayName:contact.display_name,companyName:contact.company_name};
  const text = renderCampaignTemplate(step.body,templateContact);
  if (channel === "linkedin" && text.length > (step.action === "connect" ? 200 : 4000)) throw new CampaignError("Personalised LinkedIn text exceeds the action's character limit");
  if (channel === "whatsapp" && (!text.trim() || text.length > 4000)) throw new CampaignError("Personalised WhatsApp text must contain 1–4000 characters");
  const provider = deliveryProvider(channel);
  const claim = await claimSend(actor,enrolment.id,enrolment.step_index);
  if (!claim || !await claimStillEligible(actor,enrolment,claim.attemptId,definition)) return {outcome:"not_due" as const};
  let sameRecipient = false;
  try { sameRecipient = recipientFor(claim.contact) === recipient; } catch { /* Cancel invalid changed identities too. */ }
  if (!sameRecipient) {
    const label = channel === "whatsapp" ? "phone" : channel === "linkedin" ? "LinkedIn profile" : "email";
    await withCampaignDb(actor,client=>client.query("UPDATE campaign_send_attempts SET state = 'cancelled', error = $2 WHERE id = $1 AND state = 'claimed'",[claim.attemptId,`Contact ${label} changed before send`]));
    throw new CampaignError(`Contact ${label} changed; send held for review`);
  }
  let sentAt:Date;
  let providerMessageId:string;
  try {
    const result = await provider.submit({actor,key:`campaign:${enrolment.id}:${step.id}`,recipient,text,messageId:claim.messageId,
      ...(step.kind === "email" ? {subject:renderCampaignTemplate(step.subject,templateContact)} : {}),
      operation:step.kind === "linkedin" ? step.action : "message",
      ...(communicationsRuntimeEnabled() ? {attemptId:claim.attemptId,enrolmentId:enrolment.id,stepIndex:enrolment.step_index,stepId:step.id,runtime:enrolment.runtime,sourceVersionId:enrolment.version_id} : {})});
    if (result.status === "waiting" || result.status === "review") {
      // These results explicitly establish that no submission occurred.
      await withCampaignDb(actor,client=>client.query("UPDATE campaign_send_attempts SET state = 'cancelled' WHERE id = $1 AND state = 'claimed'",[claim.attemptId]));
      return recordReplyCheckFailure(enrolment,result.status === "waiting" ? new ReplyCheckPending(result.code,channel,new Date(result.retryAt)) : new ReplyCheckReview(result.code,channel),"preflight");
    }
    if (result.status === "unknown") throw new Error(`Unknown ${channel} submission result`);
    sentAt = new Date(result.sentAt);
    providerMessageId = channel === "email" ? result.id : `${channel}:${result.id}`;
    await withCampaignDb(actor,async client=>{
      await client.query("UPDATE campaign_send_attempts SET state = 'sent', provider_message_id = $2, provider_thread_id = $3, sent_at = $4 WHERE id = $1 AND state = 'claimed'",[claim.attemptId,providerMessageId,result.threadId||null,sentAt]);
      const action = channel === "email" ? "campaign.email_sent" : `campaign.${channel}_${result.status}`;
      await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,'campaign_enrolment',$4,$5)",[actor.organizationId,actor.userId,action,enrolment.id,JSON.stringify({channel,stepIndex:enrolment.step_index,providerMessageId:result.id})]);
    });
  } catch (error) {
    // Once a provider might have accepted a submission, only receipt lookup may recover it.
    const reason = channel === "email" ? "send_result_unknown" : channel === "whatsapp" ? "whatsapp_result_unknown" : "linkedin_result_requires_review";
    await withCampaignDb(actor,async client=>{
      await client.query("UPDATE campaign_send_attempts SET state = 'unknown', error = $2 WHERE id = $1 AND state = 'claimed'",[claim.attemptId,error instanceof Error ? error.message : `Unknown ${channel} result`]);
      await client.query(`UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = '${reason}', next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'`,[enrolment.id]);
      await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.send_result_unknown','campaign_enrolment',$3,$4)",[actor.organizationId,actor.userId,enrolment.id,JSON.stringify({channel,category:"review",code:"unresolved_send",stepIndex:enrolment.step_index,transition:{from:enrolment.state,to:"needs_review"}})]);
    });
    return {outcome:channel === "email" ? "send_result_unknown" as const : "needs_review" as const};
  }
  const advanced = await advanceCampaign(actor,enrolment,definition,contact,sentAt);
  return channel === "email" && advanced.outcome === "sent" ? {...advanced,providerMessageId} : advanced;
}

export async function processCampaignEnrolment(actor: CampaignActor, enrolmentId: string) {
  const loaded = await withCampaignDb(actor, async client => {
    const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId, enrolmentId]);
    if (!enrolment || enrolment.state !== "active" || !enrolment.next_step_at || enrolment.next_step_at > new Date()) return null;
    const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [enrolment.version_id]);
    if (!version) throw new CampaignError("Sequence version is unavailable");
    parseDefinition(version.definition);
    const [contact] = await rows<ContactRow>(client, `SELECT ${contactColumns} ${contactJoin} WHERE c.id = $1 AND c.organization_id = $2`, [enrolment.contact_id, actor.organizationId]);
    await assertContactAllowed(client, actor, enrolment.recipient_email);
    await assertNoReplyHold(client, actor, enrolment.contact_id);
    return { enrolment, version, contact };
  });
  if (!loaded) return { outcome: "not_due" as const };
  const { enrolment, contact } = loaded;
  try {
    const required = campaignChannels(parseDefinition(loaded.version.definition));
    try { assertContactUnchanged(contact, enrolment, parseDefinition(loaded.version.definition)); }
    catch { throw new ReplyCheckReview("account_changed", required.length === 1 ? required[0] : undefined); }
    await checkContactReplyMonitors(actor, { id: contact.id, email: enrolment.recipient_email, data: personalData(contact.personal_data), since: enrolment.started_at, requiredChannels: campaignChannels(parseDefinition(loaded.version.definition)) });
    await clearReplyWait(enrolment);
    const [current] = await withCampaignDb(actor, client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [enrolment.id]));
    if (current?.state === "stopped") return { outcome: "reply_received" as const };
    if (current?.state !== "active") return { outcome: "not_due" as const };
    const definition = parseDefinition(loaded.version.definition);
    const step = campaignStepEntries(definition)[enrolment.step_index]?.step;
    if (step && step.kind !== "wait") {
      const [previous] = await withCampaignDb(actor, client => rows<{ state: string; sent_at: Date }>(client, "SELECT state, sent_at FROM campaign_send_attempts WHERE enrolment_id = $1 AND step_index = $2", [enrolment.id, enrolment.step_index]));
      if (previous?.state === "sent") return await advanceCampaign(actor, enrolment, definition, contact, previous.sent_at);
      if (previous && ["claimed", "unknown"].includes(previous.state)) throw new CampaignError("Sequence has an unresolved send attempt; review before continuing");
    }
    if (!step || step.kind === "wait") throw new CampaignError("Published sequence step is invalid");
    if (step.kind === "email" && !enrolment.recipient_email) throw new CampaignError("Email recipient is unavailable");
    await assertRecordedConnectionReady(actor, step.kind, enrolment.id);
    assertCampaignWorkRemaining();
    // Admitted submissions finish their journal outside the scheduler admission budget.
    return await withoutCampaignWorkBudget(()=>processDeliveryStep(actor,enrolment,definition,contact));
  } catch (error) {
    if (campaignWorkDeferred(error)) throw error;
    if (error instanceof ReplyCheckPending || error instanceof ReplyCheckReview) return recordReplyCheckFailure(enrolment, error, "preflight");
    const message = error instanceof Error ? error.message : "Pre-send check failed";
    await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = $2, next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id, message]).then(() => undefined));
    return { outcome: "needs_review" as const, reason: message };
  }
}

export async function processN8nCampaignStep(enrolmentId: string, versionId: string, stepIndex: number) {
  const [job] = await withCampaignWorker(client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1 AND version_id = $2 AND runtime = 'n8n'", [enrolmentId, versionId]));
  if (!job) throw new CampaignError("n8n enrolment not found", 404);
  const retryAt = () => new Date(Date.now() + (60 * 60_000));
  if (job.state === "stopped" || job.state === "completed") return { outcome: "finished" as const, nextStepAt: null };
  const retryResponse = async (nextStepAt: Date) => {
    if (job.state === "active") await withCampaignDb({ organizationId: job.organization_id, userId: job.owner_user_id }, client => client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.retry_scheduled','campaign_enrolment',$3,$4)", [job.organization_id, job.owner_user_id, enrolmentId, JSON.stringify({ stepIndex, nextStepAt: nextStepAt.toISOString() })]).then(() => undefined));
    return { outcome: "retry" as const, nextStepAt };
  };
  const sentResponse = async (current: EnrolmentRow) => {
    const loaded = await withCampaignWorker(async client => {
      const [attempt] = await rows<{ sent_at: Date }>(client, "SELECT sent_at FROM campaign_send_attempts WHERE enrolment_id = $1 AND step_index = $2 AND state = 'sent'", [enrolmentId, stepIndex]);
      const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [versionId]);
      return { attempt, version };
    });
    // A larger index may be on the other path. Never acknowledge an unsent
    // node or route a replay using the enrolment's later current index.
    if (!loaded.attempt || !loaded.version) return { outcome: "finished" as const, nextStepAt: null };
    const definition = parseDefinition(loaded.version.definition);
    const split = definition.splits?.find(split => split.afterStepId === campaignStepEntries(definition)[stepIndex].step.id && split.condition);
    const decision = split ? await savedBranch({ organizationId: job.organization_id, userId: job.owner_user_id }, enrolmentId, split.id) : undefined;
    if (split && !decision) return retryResponse(current.next_step_at || retryAt());
    const next = nextCampaignAction(definition, stepIndex, decision ? new Date(decision.decidedAt) : loaded.attempt.sent_at, enrolmentId, decision?.path);
    return { outcome: "sent" as const, nextStepIndex: next?.index ?? null, nextStepAt: next ? (current.step_index === next.index && current.next_step_at ? current.next_step_at : nextSendAt(next.at)) : null };
  };
  if (job.step_index > stepIndex) return sentResponse(job);
  if (job.step_index < stepIndex) return { outcome: "finished" as const, nextStepAt: null };
  if (job.state !== "active") return retryResponse(retryAt());
  const result = await processCampaignEnrolment({ organizationId: job.organization_id, userId: job.owner_user_id }, enrolmentId);
  const [current] = await withCampaignWorker(client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [enrolmentId]));
  if (result.outcome === "sent" || current.step_index > stepIndex) return sentResponse(current);
  if (current.state === "stopped" || current.state === "completed") return { outcome: "finished" as const, nextStepAt: null };
  return retryResponse(current.state === "active" && current.next_step_at && current.next_step_at > new Date() ? current.next_step_at : retryAt());
}

async function reconcileUnknownAttempt(actor: CampaignActor, attemptId: string) {
  const loaded = await withCampaignDb(actor,async client=>{
    const [attempt] = await rows<{id:string;enrolment_id:string;step_index:number;rfc_message_id:string;state:string;error?:string|null}>(client,"SELECT * FROM campaign_send_attempts WHERE id = $1 AND (state = 'unknown' OR (state = 'claimed' AND claimed_at < now() - interval '10 minutes'))",[attemptId]);
    if (!attempt) return null;
    const [enrolment] = await rows<EnrolmentRow>(client,"SELECT * FROM campaign_enrolments WHERE id = $1",[attempt.enrolment_id]);
    if (!enrolment) return null;
    const [version] = await rows<VersionRow>(client,"SELECT * FROM campaign_sequence_versions WHERE id = $1",[enrolment.version_id]);
    if (!version) return null;
    const definition = parseDefinition(version.definition);
    const step = campaignStepEntries(definition)[attempt.step_index]?.step;
    if (!step || step.kind === "wait") return null;
    return {attempt,enrolment,definition,step};
  });
  if (!loaded) return false;
  const {attempt,enrolment,definition,step}=loaded;
  const waiting=replyMonitorIssue(attempt.error);
  if (waiting?.category === "retry" && waiting.retryAt && Date.parse(waiting.retryAt) > Date.now()) return false;
  const provider=deliveryProvider(step.kind);
  const found=await provider.lookup({actor,key:`campaign:${enrolment.id}:${step.id}`,messageId:attempt.rfc_message_id,...(communicationsRuntimeEnabled()?{attemptId:attempt.id,enrolmentId:enrolment.id,stepIndex:attempt.step_index,stepId:step.id,runtime:enrolment.runtime,sourceVersionId:enrolment.version_id}:{})});
  if (found?.status === "waiting") throw new ReplyCheckPending(found.code, step.kind, new Date(found.retryAt));
  if (found?.status === "review") throw new ReplyCheckReview(found.code, step.kind);
  if (!found || (found.status !== "submitted" && found.status !== "skipped")) return false;
  const sentAt=new Date(found.sentAt);
  // Keep this attempt eligible for later receipt checks while coverage waits.
  // Recovery reads never dispatch; a temporary preflight failure cannot lose the recovery job.
  await assertContactReplyFresh(actor,enrolment.contact_id,campaignChannels(definition),enrolment.started_at);
  const recorded=await withCampaignDb(actor,async client=>{
    const updated=await client.query("UPDATE campaign_send_attempts SET state = 'sent', provider_message_id = $2, provider_thread_id = $3, sent_at = $4, error = NULL WHERE id = $1 AND state IN ('unknown','claimed')",[attemptId,step.kind === "email" ? found.id : `${step.kind}:${found.id}`,found.threadId||null,sentAt]);
    if (!updated.rowCount) return false;
    await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.receipt_recovered','campaign_enrolment',$3,$4)",[actor.organizationId,actor.userId,enrolment.id,JSON.stringify({channel:step.kind,stepIndex:attempt.step_index,status:found.status,providerMessageId:found.id})]);
    return true;
  });
  if (!recorded) return false;
  const contact=await withCampaignDb(actor,async client=>{
    const [contact]=await rows<ContactRow>(client,`SELECT ${contactColumns} ${contactJoin} WHERE c.id = $1 AND c.organization_id = $2`,[enrolment.contact_id,actor.organizationId]);
    assertContactUnchanged(contact,enrolment,definition);
    await assertContactAllowed(client,actor,enrolment.recipient_email);
    await assertNoReplyHold(client,actor,enrolment.contact_id);
    const resumed=await client.query("UPDATE campaign_enrolments SET state = 'active', stop_reason = NULL, next_step_at = now(), updated_at = now() WHERE id = $1 AND step_index = $2 AND (state = 'active' OR (state = 'needs_review' AND stop_reason IN ('send_result_unknown','whatsapp_result_unknown','linkedin_result_requires_review')))",[enrolment.id,attempt.step_index]);
    return resumed.rowCount ? contact : null;
  });
  if (contact) await advanceCampaign(actor,enrolment,definition,contact,sentAt);
  return true;
}

export async function runCampaignTick(limit = 3, options: { budgetMs?: number } = {}) {
  const started = Date.now();
  const output = {
    processed: 0, results: [] as { id: string; outcome: string }[], n8nDispatches: 0, replyScans: 0, unknownChecks: 0,
    replyMonitoring: { scanned: 0, complete: 0, incomplete: 0, failed: 0, skipped: 0, deferred: 0 },
    scheduler: { skipped: false, deferred: false, durationMs: 0 },
  };
  const locked = await withCampaignTickLock(() => withCampaignWorkBudget(options.budgetMs ?? 20_000, async () => {
    try {
      const dispatch = await withCampaignWorker(client => rows<{ id: string; version_id: string }>(client, "SELECT id, version_id FROM campaign_enrolments WHERE runtime = 'n8n' AND n8n_started_at IS NULL AND state IN ('active','paused','needs_review') ORDER BY started_at LIMIT $1", [limit]));
      const jobs = await withCampaignWorker(client => rows<{ id: string; organization_id: string; owner_user_id: string }>(client, "SELECT id, organization_id, owner_user_id FROM campaign_enrolments WHERE runtime = 'legacy' AND state = 'active' AND next_step_at <= now() ORDER BY next_step_at LIMIT $1", [limit]));
      // Register/replay a small contact batch before selecting account scans.
      // One contact per tick keeps the existing multi-transaction RLS checks
      // affordable; account scans still cover all registered contacts.
      const scans = await withCampaignWorker(client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE (state = 'active' OR ($2 AND state IN ('paused','needs_review'))) AND (last_reply_checked_at IS NULL OR last_reply_checked_at < now() - interval '5 minutes') ORDER BY (state = 'active' AND next_step_at <= now() + interval '5 minutes') DESC, last_reply_checked_at NULLS FIRST, started_at, id LIMIT $1", [replyMonitorMode() === "off" ? limit * 2 : 1, replyMonitorMode() !== "off"]));
      const prepared: { enrolment: EnrolmentRow; actor: CampaignActor; contact: ReplyContact }[] = [];
      const finishScan = async (enrolment: EnrolmentRow, failure?: unknown) => {
        if (replyMonitorMode() !== "off") await withCampaignWorkCleanup(() => withCampaignWorker(client =>
          client.query("UPDATE campaign_enrolments SET last_reply_checked_at = now() WHERE id = $1",[enrolment.id]).then(()=>undefined)));
        if (failure) await recordReplyCheckFailure(enrolment, failure, "maintenance");
        else await clearReplyWait(enrolment);
        output.replyScans++;
      };
      for (const enrolment of scans) {
        assertCampaignWorkRemaining();
        try {
          const actor = { organizationId: enrolment.organization_id, userId: enrolment.owner_user_id };
          const loaded = await withCampaignDb(actor, async client => {
            const [contact] = await rows<ContactRow>(client, "SELECT * FROM contacts WHERE id = $1 AND organization_id = $2", [enrolment.contact_id, actor.organizationId]);
            const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [enrolment.version_id]);
            if (!contact || !version) throw new Error("Reply monitoring contact unavailable");
            const channels = campaignChannels(parseDefinition(version.definition));
            return { contact: { id: contact.id, email: enrolment.recipient_email, data: personalData(contact.personal_data), since: enrolment.started_at, requiredChannels: channels } };
          });
          if (replyMonitorMode() !== "off") await prepareScheduledReplyContact(actor, loaded.contact);
          prepared.push({ enrolment, actor, ...loaded });
        } catch (error) {
          if (campaignWorkDeferred(error)) throw error;
          await finishScan(enrolment, error);
        }
      }
      assertCampaignWorkRemaining();
      output.replyMonitoring = await runReplyMonitorTick(limit);
      if (output.replyMonitoring.deferred) output.scheduler.deferred = true;
      for (const { enrolment, actor, contact } of prepared) {
        assertCampaignWorkRemaining();
        try {
          await checkScheduledReplyContact(actor, contact);
          await finishScan(enrolment);
        } catch (error) {
          if (campaignWorkDeferred(error)) throw error;
          await finishScan(enrolment, error);
        }
      }
      // Dispatch only after maintenance has finished; a new webhook must not
      // race a scheduled freshness check for the same contact/account.
      for (const job of jobs) {
        assertCampaignWorkRemaining();
        try {
          const result = await processCampaignEnrolment({ organizationId: job.organization_id, userId: job.owner_user_id }, job.id);
          output.results.push({ id: job.id, outcome: result.outcome });
        } catch (error) {
          if (campaignWorkDeferred(error)) throw error;
          const reason = error instanceof Error ? error.message : "Worker failed";
          output.results.push({ id: job.id, outcome: reason });
          await withCampaignWorkCleanup(() => withCampaignWorker(client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = $2, next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [job.id, reason.slice(0, 250)]).then(() => undefined)));
        }
        output.processed = output.results.length;
      }
      for (const job of dispatch) {
        assertCampaignWorkRemaining();
        output.n8nDispatches++;
        try {
          await startSequenceContact(job.version_id, job.id);
          // Persist acceptance even if it used the final milliseconds of work.
          await withCampaignWorkCleanup(() => withCampaignWorker(client => client.query("UPDATE campaign_enrolments SET n8n_started_at = now() WHERE id = $1 AND n8n_started_at IS NULL", [job.id]).then(() => undefined)));
        } catch (error) {
          if (campaignWorkDeferred(error)) throw error;
          // Keep unstarted for the next scheduler pass.
        }
      }
      const unknown = await withCampaignWorker(client => rows<{ id: string; organization_id: string; owner_user_id: string }>(client, "SELECT id, organization_id, owner_user_id FROM campaign_send_attempts WHERE state = 'unknown' OR (state = 'claimed' AND claimed_at < now() - interval '10 minutes') ORDER BY claimed_at DESC LIMIT $1", [limit]));
      for (const attempt of unknown) {
        assertCampaignWorkRemaining();
        output.unknownChecks++;
        try { await reconcileUnknownAttempt({ organizationId: attempt.organization_id, userId: attempt.owner_user_id }, attempt.id); }
        catch (error) {
          if (campaignWorkDeferred(error)) throw error;
          const diagnostic=replyCheckDiagnostic(error);
          const metadata=JSON.stringify({...diagnostic,attemptId:attempt.id,phase:"receipt_recovery"});
          await withCampaignWorkCleanup(()=>withCampaignDb({organizationId:attempt.organization_id,userId:attempt.owner_user_id},client=>client.query(`WITH changed AS (
            UPDATE campaign_send_attempts SET error=$2 WHERE id=$1 AND state IN ('unknown','claimed') AND error IS DISTINCT FROM $2 RETURNING enrolment_id
          ) INSERT INTO audit_events (organization_id,actor_id,action,entity_type,entity_id,metadata)
            SELECT $3,$4,$5,'campaign_enrolment',enrolment_id,$2::jsonb FROM changed`,[attempt.id,metadata,attempt.organization_id,attempt.owner_user_id,diagnostic.category === "retry" ? "campaign.receipt_recovery_waiting" : "campaign.receipt_recovery_failed"]).then(()=>undefined))).catch(()=>undefined);
          // Reconciliation reads receipts only; neither an outage nor a missing receipt submits again.
        }
      }
    } catch (error) {
      if (!campaignWorkDeferred(error)) throw error;
      output.scheduler.deferred = true;
    }
  }));
  output.scheduler.skipped = !locked.acquired;
  output.scheduler.durationMs = Date.now() - started;
  return output;
}

// Called once at cutover for versions published before n8n owned the runtime.
// Existing enrolments retain their legacy runtime and version pin.
export async function syncPublishedCampaignWorkflows() {
  const versions = await withCampaignWorker(client => rows<VersionRow & { sequence_name: string }>(client, "SELECT v.*, s.name AS sequence_name FROM campaign_sequence_versions v JOIN campaign_sequences s ON s.id = v.sequence_id WHERE v.n8n_workflow_id IS NULL ORDER BY v.published_at"));
  const synced = [] as { versionId: string; workflowId: string }[];
  for (const version of versions) {
    const workflowId = await provisionSequenceWorkflow({ versionId: version.id, sequenceName: version.sequence_name, version: version.version, definition: parseDefinition(version.definition) });
    try {
      const updated = await withCampaignWorker(client => client.query("UPDATE campaign_sequence_versions SET n8n_workflow_id = $2 WHERE id = $1 AND n8n_workflow_id IS NULL", [version.id, workflowId]).then(result => result.rowCount));
      if (!updated) { await removeSequenceWorkflow(workflowId); continue; }
      synced.push({ versionId: version.id, workflowId });
    } catch (error) { await removeSequenceWorkflow(workflowId).catch(() => undefined); throw error; }
  }
  return { synced };
}
