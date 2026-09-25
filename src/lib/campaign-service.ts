import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rows, withCampaignDb, withCampaignWorker, type CampaignActor } from "@/db/campaign-client";
import { campaignDefinition, campaignSendWindowOpen, nextAllowedCampaignSend, nextEmailAfter, normalizeEmail, renderCampaignTemplate, type CampaignDefinition } from "@/domain/campaign";
import { connectionCanMonitorReplies } from "@/lib/gmail-connection";
import { campaignMailboxForConnection, campaignTestSendAnytime } from "@/lib/campaign-mailbox";
import type { PoolClient } from "pg";

type SequenceRow = { id: string; organization_id: string; owner_user_id: string; mandate_id: string; name: string; draft: unknown; published_definition?: unknown; published_version: number; updated_at: Date };
type VersionRow = { id: string; sequence_id: string; version: number; definition: unknown };
type EnrolmentRow = { id: string; organization_id: string; owner_user_id: string; sequence_id: string; version_id: string; mandate_id: string; contact_id: string; mailbox_connection_id: string; recipient_email: string; state: string; stop_reason: string | null; initial_conversation_reviewed: boolean; step_index: number; next_step_at: Date | null; started_at: Date; last_reply_checked_at: Date | null };
type ContactRow = { id: string; display_name: string; company_name: string; personal_data: unknown; fictionalised: boolean };
type MailboxRow = { id: string; organization_id: string; user_id: string; address: string | null; encrypted_refresh_token: string | null; reconnect_required: boolean; scopes: string[] | null; daily_cap: number };

export class CampaignError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

function parseDefinition(value: unknown): CampaignDefinition { return campaignDefinition.parse(value); }
function personalData(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function emailForContact(contact: ContactRow) {
  const value = personalData(contact.personal_data).email;
  const parsed = z.email().safeParse(value);
  if (!parsed.success) throw new CampaignError(`${contact.display_name} needs an email address before enrolment`);
  return normalizeEmail(parsed.data);
}

function nextSendAt(input: Date) { return campaignTestSendAnytime() ? input : nextAllowedCampaignSend(input); }
function sendWindowOpen(input: Date) { return campaignTestSendAnytime() || campaignSendWindowOpen(input); }

async function ownMailbox(client: PoolClient, actor: CampaignActor) {
  const [mailbox] = await rows<MailboxRow>(client, "SELECT id, organization_id, user_id, address, encrypted_refresh_token, reconnect_required, scopes, daily_cap FROM mailbox_connections WHERE organization_id = $1 AND user_id = $2 AND provider = 'gmail' LIMIT 1", [actor.organizationId, actor.userId]);
  if (!mailbox || !connectionCanMonitorReplies({ encryptedRefreshToken: mailbox.encrypted_refresh_token, reconnectRequired: mailbox.reconnect_required, scopes: mailbox.scopes })) {
    throw new CampaignError("Reconnect your own Gmail in Settings with compose and read-only access before starting automation");
  }
  return mailbox;
}

async function contactInMandate(client: PoolClient, actor: CampaignActor, mandateId: string, contactId: string) {
  const [contact] = await rows<ContactRow>(client, `SELECT c.id, c.display_name, c.personal_data, c.fictionalised, t.company_name FROM contacts c JOIN targets t ON t.id = c.target_id JOIN mandate_targets mt ON mt.target_id = t.id AND mt.organization_id = c.organization_id WHERE c.id = $1 AND c.organization_id = $2 AND mt.mandate_id = $3`, [contactId, actor.organizationId, mandateId]);
  if (!contact || contact.fictionalised) throw new CampaignError("Contact is not a real person in this mandate");
  if (personalData(contact.personal_data).doNotContact === true) throw new CampaignError(`${contact.display_name} is marked do not contact`);
  return contact;
}

async function assertContactAllowed(client: PoolClient, actor: CampaignActor, email: string) {
  const [hold] = await rows<{ reason: string }>(client, "SELECT reason FROM campaign_contact_holds WHERE organization_id = $1 AND email = $2 LIMIT 1", [actor.organizationId, email]);
  if (hold) throw new CampaignError(`Contact is held: ${hold.reason}`);
  const domain = email.split("@")[1];
  const [suppressed] = await rows<{ reason: string }>(client, "SELECT reason FROM suppressions WHERE organization_id = $1 AND (lower(address) = $2 OR lower(domain) = $3) LIMIT 1", [actor.organizationId, email, domain]);
  if (suppressed) throw new CampaignError(`Contact is suppressed: ${suppressed.reason}`);
}

export async function listCampaignStudio(actor: CampaignActor, mandateId: string) {
  return withCampaignDb(actor, async client => {
    const [sequences, enrolments, contactRows, mailbox] = await Promise.all([
      rows<SequenceRow>(client, "SELECT s.*, (SELECT v.definition FROM campaign_sequence_versions v WHERE v.sequence_id = s.id AND v.version = s.published_version) AS published_definition FROM campaign_sequences s WHERE s.organization_id = $1 AND s.owner_user_id = $2 AND s.mandate_id = $3 ORDER BY s.updated_at DESC", [actor.organizationId, actor.userId, mandateId]),
      rows<EnrolmentRow & { sequence_name: string; version: number; version_definition: unknown; last_sent_at: Date | null }>(client, "SELECT e.*, s.name AS sequence_name, v.version, v.definition AS version_definition, (SELECT max(a.sent_at) FROM campaign_send_attempts a WHERE a.enrolment_id = e.id AND a.state = 'sent') AS last_sent_at FROM campaign_enrolments e JOIN campaign_sequences s ON s.id = e.sequence_id JOIN campaign_sequence_versions v ON v.id = e.version_id WHERE e.organization_id = $1 AND e.owner_user_id = $2 AND e.mandate_id = $3 ORDER BY e.started_at DESC", [actor.organizationId, actor.userId, mandateId]),
      rows<ContactRow>(client, "SELECT c.id, c.display_name, c.personal_data, c.fictionalised, t.company_name FROM contacts c JOIN targets t ON t.id = c.target_id JOIN mandate_targets mt ON mt.target_id = t.id AND mt.organization_id = c.organization_id WHERE c.organization_id = $1 AND mt.mandate_id = $2 ORDER BY t.company_name, c.display_name", [actor.organizationId, mandateId]),
      rows<MailboxRow>(client, "SELECT id, organization_id, user_id, address, encrypted_refresh_token, reconnect_required, scopes, daily_cap FROM mailbox_connections WHERE organization_id = $1 AND user_id = $2 AND provider = 'gmail'", [actor.organizationId, actor.userId]),
    ]);
    const activity = enrolments.length ? await rows<{ entity_id: string; action: string; created_at: Date }>(client, "SELECT entity_id, action, created_at FROM audit_events WHERE organization_id = $1 AND actor_id = $2 AND entity_type = 'campaign_enrolment' AND entity_id = ANY($3::text[]) ORDER BY created_at DESC LIMIT 1000", [actor.organizationId, actor.userId, enrolments.map(row => row.id)]) : [];
    return {
      sequences: sequences.map(row => ({ id: row.id, name: row.name, draft: parseDefinition(row.draft), publishedDefinition: row.published_definition ? parseDefinition(row.published_definition) : null, publishedVersion: row.published_version, updatedAt: row.updated_at })),
      enrolments: enrolments.map(row => ({ id: row.id, sequenceId: row.sequence_id, sequenceName: row.sequence_name, version: row.version, contactId: row.contact_id, state: row.state, stopReason: row.stop_reason, stepIndex: row.step_index, nextStepAt: row.next_step_at, nextStepTitle: parseDefinition(row.version_definition).steps[row.step_index]?.title || null, totalSteps: parseDefinition(row.version_definition).steps.length, recipientEmail: row.recipient_email, startedAt: row.started_at, lastSentAt: row.last_sent_at, activity: activity.filter(event => event.entity_id === row.id).map(event => ({ action: event.action, at: event.created_at })) })),
      contacts: contactRows.map(row => ({ id: row.id, name: row.display_name, company: row.company_name, email: z.email().safeParse(personalData(row.personal_data).email).success ? normalizeEmail(String(personalData(row.personal_data).email)) : null, fictionalised: row.fictionalised, doNotContact: personalData(row.personal_data).doNotContact === true })),
      mailbox: mailbox[0] ? { address: mailbox[0].address, ready: connectionCanMonitorReplies({ encryptedRefreshToken: mailbox[0].encrypted_refresh_token, reconnectRequired: mailbox[0].reconnect_required, scopes: mailbox[0].scopes }), dailyCap: mailbox[0].daily_cap } : null,
    };
  });
}

export async function createCampaign(actor: CampaignActor, mandateId: string, name: string, definition: CampaignDefinition) {
  return withCampaignDb(actor, async client => {
    const [mandate] = await rows<{ id: string }>(client, "SELECT id FROM mandates WHERE id = $1 AND organization_id = $2", [mandateId, actor.organizationId]);
    if (!mandate) throw new CampaignError("Mandate not found", 404);
    const [sequence] = await rows<SequenceRow>(client, "INSERT INTO campaign_sequences (organization_id, owner_user_id, mandate_id, name, draft) VALUES ($1, $2, $3, $4, $5) RETURNING *", [actor.organizationId, actor.userId, mandateId, name, JSON.stringify(definition)]);
    return sequence;
  });
}

export async function saveCampaign(actor: CampaignActor, sequenceId: string, name: string, definition: CampaignDefinition) {
  return withCampaignDb(actor, async client => {
    const [sequence] = await rows<SequenceRow>(client, "UPDATE campaign_sequences SET name = $4, draft = $5, updated_at = now() WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 RETURNING *", [actor.organizationId, actor.userId, sequenceId, name, JSON.stringify(definition)]);
    if (!sequence) throw new CampaignError("Sequence not found", 404);
    return sequence;
  });
}

export async function publishCampaign(actor: CampaignActor, sequenceId: string) {
  return withCampaignDb(actor, async client => {
    const [sequence] = await rows<SequenceRow>(client, "SELECT * FROM campaign_sequences WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 FOR UPDATE", [actor.organizationId, actor.userId, sequenceId]);
    if (!sequence) throw new CampaignError("Sequence not found", 404);
    const definition = parseDefinition(sequence.draft);
    const version = sequence.published_version + 1;
    const [snapshot] = await rows<VersionRow>(client, "INSERT INTO campaign_sequence_versions (organization_id, owner_user_id, sequence_id, version, definition) VALUES ($1, $2, $3, $4, $5) RETURNING *", [actor.organizationId, actor.userId, sequenceId, version, JSON.stringify(definition)]);
    await client.query("UPDATE campaign_sequences SET published_version = $2, updated_at = now() WHERE id = $1", [sequenceId, version]);
    return { id: snapshot.id, version };
  });
}

export async function enrolContacts(actor: CampaignActor, sequenceId: string, contactIds: string[]) {
  const uniqueIds = [...new Set(contactIds)];
  const prepared = await withCampaignDb(actor, async client => {
    const [sequence] = await rows<SequenceRow>(client, "SELECT * FROM campaign_sequences WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId, sequenceId]);
    if (!sequence || !sequence.published_version) throw new CampaignError("Publish this sequence before adding contacts");
    const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE sequence_id = $1 AND version = $2", [sequenceId, sequence.published_version]);
    if (!version) throw new CampaignError("Published version is missing");
    const definition = parseDefinition(version.definition);
    const mailbox = await ownMailbox(client, actor);
    const contacts = [] as { contact: ContactRow; email: string }[];
    const seenEmails = new Set<string>();
    for (const id of uniqueIds) {
      const contact = await contactInMandate(client, actor, sequence.mandate_id, id);
      const email = emailForContact(contact);
      if (seenEmails.has(email)) throw new CampaignError("Selected contacts contain the same email address more than once");
      seenEmails.add(email);
      await assertContactAllowed(client, actor, email);
      const [running] = await rows<{ id: string }>(client, "SELECT id FROM campaign_enrolments WHERE organization_id = $1 AND recipient_email = $2 AND state IN ('active', 'paused', 'needs_review') LIMIT 1", [actor.organizationId, email]);
      if (running) throw new CampaignError(`${contact.display_name} already has active outreach`);
      contacts.push({ contact, email });
    }
    return { sequence, version, definition, mailbox, contacts };
  });
  // A prior conversation is checked before enrolment, then checked again at send.
  const gmail = campaignMailboxForConnection({ encryptedRefreshToken: prepared.mailbox.encrypted_refresh_token, reconnectRequired: prepared.mailbox.reconnect_required, scopes: prepared.mailbox.scopes }, prepared.mailbox.id);
  const conversationChecks: { email: string; existing: boolean }[] = [];
  for (let offset = 0; offset < prepared.contacts.length; offset += 3) {
    conversationChecks.push(...await Promise.all(prepared.contacts.slice(offset, offset + 3).map(async ({ email }) => ({ email, existing: await gmail.hasConversation(email) }))));
  }
  return withCampaignDb(actor, async client => {
    const results = [] as { id: string; contactId: string; state: string; nextStepAt: Date | null; firstAction: string }[];
    for (const { contact, email } of prepared.contacts) {
      await assertContactAllowed(client, actor, email);
      const [running] = await rows<{ id: string }>(client, "SELECT id FROM campaign_enrolments WHERE organization_id = $1 AND recipient_email = $2 AND state IN ('active', 'paused', 'needs_review') LIMIT 1", [actor.organizationId, email]);
      if (running) throw new CampaignError(`${contact.display_name} already has active outreach`);
      await client.query("INSERT INTO campaign_contact_assignments (organization_id, contact_id, email, owner_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [actor.organizationId, contact.id, email, actor.userId]);
      const [assignment] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_assignments WHERE organization_id = $1 AND contact_id = $2 AND email = $3 AND owner_user_id = $4", [actor.organizationId, contact.id, email, actor.userId]);
      if (!assignment) throw new CampaignError(`${contact.display_name} is assigned to another sender`);
      const existing = conversationChecks.find(check => check.email === email)?.existing || false;
      const nextAt = existing ? null : nextSendAt(new Date());
      const [enrolment] = await rows<EnrolmentRow>(client, `INSERT INTO campaign_enrolments (organization_id, owner_user_id, sequence_id, version_id, mandate_id, contact_id, mailbox_connection_id, recipient_email, state, stop_reason, next_step_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [actor.organizationId, actor.userId, sequenceId, prepared.version.id, prepared.sequence.mandate_id, contact.id, prepared.mailbox.id, email, existing ? "needs_review" : "active", existing ? "existing_conversation" : null, nextAt]);
      await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.subscribed','campaign_enrolment',$3,$4)", [actor.organizationId, actor.userId, enrolment.id, JSON.stringify({ sequenceId, version: prepared.version.version, contactId: contact.id, firstAction: prepared.definition.steps[0].title, existingConversation: existing })]);
      results.push({ id: enrolment.id, contactId: contact.id, state: enrolment.state, nextStepAt: enrolment.next_step_at, firstAction: existing ? "Existing Gmail conversation found — review before sending" : `Send email: ${prepared.definition.steps[0].title}` });
    }
    return results;
  });
}

export async function changeEnrolment(actor: CampaignActor, enrolmentId: string, action: "pause" | "resume" | "stop" | "review_existing_conversation" | "retry_preflight") {
  return withCampaignDb(actor, async client => {
    const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2 FOR UPDATE", [actor.organizationId, actor.userId, enrolmentId]);
    if (!enrolment) throw new CampaignError("Enrolment not found", 404);
    if (action === "pause" && enrolment.state !== "active") throw new CampaignError("Only active automation can be paused");
    if (action === "resume" && enrolment.state !== "paused") throw new CampaignError("Only manually paused automation can be resumed");
    if (action === "review_existing_conversation" && (enrolment.state !== "needs_review" || enrolment.stop_reason !== "existing_conversation")) throw new CampaignError("There is no existing conversation to review");
    if (action === "retry_preflight" && (enrolment.state !== "needs_review" || ["existing_conversation", "send_result_unknown"].includes(enrolment.stop_reason || ""))) throw new CampaignError("This hold needs manual review, not an automatic retry");
    if (action === "stop" && !["active", "paused", "needs_review"].includes(enrolment.state)) throw new CampaignError("Automation is already stopped");
    if (action !== "stop") await assertContactAllowed(client, actor, enrolment.recipient_email);
    const state = action === "pause" ? "paused" : action === "stop" ? "stopped" : "active";
    const nextAt = action === "pause" ? enrolment.next_step_at : state === "active" ? nextSendAt(new Date(Math.max(Date.now(), enrolment.next_step_at?.getTime() || 0))) : null;
    const reviewed = action === "review_existing_conversation" || enrolment.initial_conversation_reviewed;
    await client.query("UPDATE campaign_enrolments SET state = $2, stop_reason = $3, next_step_at = $4, initial_conversation_reviewed = $5, updated_at = now() WHERE id = $1", [enrolmentId, state, action === "stop" ? "manual_stop" : action === "pause" ? "manual_pause" : null, nextAt, reviewed]);
    await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id) VALUES ($1,$2,$3,'campaign_enrolment',$4)", [actor.organizationId, actor.userId, `campaign.${action}`, enrolmentId]);
    return { id: enrolmentId, state, nextStepAt: nextAt };
  });
}

async function stopForReply(actor: CampaignActor, enrolment: EnrolmentRow, providerEventId: string, receivedAt: Date) {
  return withCampaignWorker(async client => {
    const inserted = (await client.query(`INSERT INTO campaign_inbound_events (organization_id, owner_user_id, contact_id, channel, provider_event_id, from_identity, received_at) VALUES ($1,$2,$3,'email',$4,$5,$6) ON CONFLICT DO NOTHING`, [actor.organizationId, actor.userId, enrolment.contact_id, providerEventId, enrolment.recipient_email, receivedAt])).rowCount === 1;
    if (inserted) {
      await client.query("INSERT INTO campaign_contact_holds (organization_id, email, reason) VALUES ($1,$2,'reply_received') ON CONFLICT (organization_id, email) DO UPDATE SET reason = 'reply_received'", [actor.organizationId, enrolment.recipient_email]);
      await client.query(`WITH stopped AS (UPDATE campaign_enrolments SET state = 'stopped', stop_reason = 'reply_received', next_step_at = NULL, updated_at = now() WHERE organization_id = $1 AND recipient_email = $2 AND state IN ('active','paused','needs_review') RETURNING id, owner_user_id) INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) SELECT $1, owner_user_id, 'campaign.reply_received', 'campaign_enrolment', id, jsonb_build_object('channel','email','providerEventId',$3::text) FROM stopped`, [actor.organizationId, enrolment.recipient_email, providerEventId]);
    }
    return inserted;
  });
}

async function checkReplies(actor: CampaignActor, enrolment: EnrolmentRow, mailbox: MailboxRow) {
  const gmail = campaignMailboxForConnection({ encryptedRefreshToken: mailbox.encrypted_refresh_token, reconnectRequired: mailbox.reconnect_required, scopes: mailbox.scopes }, mailbox.id);
  const incoming = await gmail.inboundFrom(enrolment.recipient_email, enrolment.started_at);
  if (incoming.length) {
    for (const item of incoming) await stopForReply(actor, enrolment, item.id, item.receivedAt);
    return { stopped: true, gmail };
  }
  await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET last_reply_checked_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id]).then(() => undefined));
  return { stopped: false, gmail };
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
    const [mailbox] = await rows<MailboxRow>(client, "SELECT id, organization_id, user_id, address, encrypted_refresh_token, reconnect_required, scopes, daily_cap FROM mailbox_connections WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND provider = 'gmail'", [enrolment.mailbox_connection_id, actor.organizationId, actor.userId]);
    if (!mailbox || !connectionCanMonitorReplies({ encryptedRefreshToken: mailbox.encrypted_refresh_token, reconnectRequired: mailbox.reconnect_required, scopes: mailbox.scopes })) throw new CampaignError("Sending mailbox needs reconnection");
    const [contact] = await rows<ContactRow>(client, "SELECT c.id, c.display_name, c.personal_data, c.fictionalised, t.company_name FROM contacts c JOIN targets t ON t.id = c.target_id WHERE c.id = $1 AND c.organization_id = $2", [enrolment.contact_id, actor.organizationId]);
    if (!contact || contact.fictionalised || personalData(contact.personal_data).doNotContact === true || emailForContact(contact) !== enrolment.recipient_email) throw new CampaignError("Contact changed; send held for review");
    const [assignment] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_assignments WHERE organization_id = $1 AND contact_id = $2 AND email = $3 AND owner_user_id = $4", [actor.organizationId, enrolment.contact_id, enrolment.recipient_email, actor.userId]);
    if (!assignment) throw new CampaignError("Contact is not assigned to this sender");
    // Per-account lock makes the count and spacing safe across parallel workers.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [mailbox.id]);
    const [count] = await rows<{ used: string }>(client, "SELECT count(*)::text AS used FROM campaign_send_attempts a JOIN campaign_enrolments e ON e.id = a.enrolment_id WHERE e.mailbox_connection_id = $1 AND a.state IN ('claimed','sent','unknown') AND a.claimed_at >= now() - interval '24 hours'", [mailbox.id]);
    if (Number(count.used) >= mailbox.daily_cap) {
      await client.query("UPDATE campaign_enrolments SET next_step_at = $2, updated_at = now() WHERE id = $1", [enrolment.id, nextSendAt(new Date(Date.now() + 60 * 60_000))]);
      return null;
    }
    const [last] = await rows<{ claimed_at: Date }>(client, "SELECT a.claimed_at FROM campaign_send_attempts a JOIN campaign_enrolments e ON e.id = a.enrolment_id WHERE e.mailbox_connection_id = $1 AND a.state IN ('claimed','sent','unknown') ORDER BY a.claimed_at DESC LIMIT 1", [mailbox.id]);
    if (last && Date.now() - last.claimed_at.getTime() < 60_000) {
      await client.query("UPDATE campaign_enrolments SET next_step_at = $2, updated_at = now() WHERE id = $1", [enrolment.id, nextSendAt(new Date(last.claimed_at.getTime() + 60_000))]);
      return null;
    }
    const [existing] = await rows<{ id: string; state: string }>(client, "SELECT id, state FROM campaign_send_attempts WHERE enrolment_id = $1 AND step_index = $2", [enrolment.id, expectedIndex]);
    const messageId = `<${randomUUID()}@acquire.mlai.au>`;
    if (existing && existing.state !== "cancelled") return null;
    const [attempt] = existing
      ? await rows<{ id: string }>(client, "UPDATE campaign_send_attempts SET state = 'claimed', rfc_message_id = $2, claimed_at = now(), error = NULL WHERE id = $1 AND state = 'cancelled' RETURNING id", [existing.id, messageId])
      : await rows<{ id: string }>(client, "INSERT INTO campaign_send_attempts (organization_id, owner_user_id, enrolment_id, step_index, rfc_message_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [actor.organizationId, actor.userId, enrolment.id, expectedIndex, messageId]);
    return { attemptId: attempt.id, messageId, mailbox };
  });
}

async function claimStillEligible(actor: CampaignActor, enrolment: EnrolmentRow, attemptId: string) {
  return withCampaignDb(actor, async client => {
    const [current] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [enrolment.id]);
    const [hold] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_holds WHERE organization_id = $1 AND email = $2", [actor.organizationId, enrolment.recipient_email]);
    if (current?.state === "active" && current.step_index === enrolment.step_index && !hold) return true;
    await client.query("UPDATE campaign_send_attempts SET state = 'cancelled', error = 'Enrolment changed before send' WHERE id = $1 AND state = 'claimed'", [attemptId]);
    return false;
  });
}

export async function processCampaignEnrolment(actor: CampaignActor, enrolmentId: string) {
  const loaded = await withCampaignDb(actor, async client => {
    const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $3 AND organization_id = $1 AND owner_user_id = $2", [actor.organizationId, actor.userId, enrolmentId]);
    if (!enrolment || enrolment.state !== "active" || !enrolment.next_step_at || enrolment.next_step_at > new Date()) return null;
    const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [enrolment.version_id]);
    const [mailbox] = await rows<MailboxRow>(client, "SELECT id, organization_id, user_id, address, encrypted_refresh_token, reconnect_required, scopes, daily_cap FROM mailbox_connections WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND provider = 'gmail'", [enrolment.mailbox_connection_id, actor.organizationId, actor.userId]);
    if (!version || !mailbox) throw new CampaignError("Sequence version or owner's mailbox is unavailable");
    const [contact] = await rows<ContactRow>(client, "SELECT c.id, c.display_name, c.personal_data, c.fictionalised, t.company_name FROM contacts c JOIN targets t ON t.id = c.target_id WHERE c.id = $1 AND c.organization_id = $2", [enrolment.contact_id, actor.organizationId]);
    if (!contact || contact.fictionalised || personalData(contact.personal_data).doNotContact === true || emailForContact(contact) !== enrolment.recipient_email) throw new CampaignError("Contact changed; send held for review");
    await assertContactAllowed(client, actor, enrolment.recipient_email);
    return { enrolment, version, mailbox, contact };
  });
  if (!loaded) return { outcome: "not_due" as const };
  const { enrolment, mailbox, contact } = loaded;
  try {
    const checked = await checkReplies(actor, enrolment, mailbox);
    if (checked.stopped) return { outcome: "reply_received" as const };
    if (enrolment.step_index === 0 && !enrolment.initial_conversation_reviewed && await checked.gmail.hasConversation(enrolment.recipient_email)) {
      await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = 'existing_conversation', next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id]).then(() => undefined));
      return { outcome: "existing_conversation" as const };
    }
    {
      const outbound = await checked.gmail.outboundToSince(enrolment.recipient_email, enrolment.started_at);
      const known = await withCampaignDb(actor, client => rows<{ provider_message_id: string }>(client, "SELECT provider_message_id FROM campaign_send_attempts WHERE enrolment_id = $1 AND state = 'sent' AND provider_message_id IS NOT NULL", [enrolment.id]));
      const knownIds = new Set(known.map(item => item.provider_message_id));
      if (outbound.some(id => !knownIds.has(id))) {
        await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = 'manual_outbound_detected', next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id]).then(() => undefined));
        return { outcome: "manual_outbound_detected" as const };
      }
    }
    const definition = parseDefinition(loaded.version.definition);
    const step = definition.steps[enrolment.step_index];
    if (!step || step.kind !== "email") throw new CampaignError("Published sequence step is invalid");
    const claim = await claimSend(actor, enrolment.id, enrolment.step_index);
    if (!claim) return { outcome: "not_due" as const };
    if (!await claimStillEligible(actor, enrolment, claim.attemptId)) return { outcome: "not_due" as const };
    try {
      const templateContact = { displayName: contact.display_name, companyName: contact.company_name };
      const delivery = await checked.gmail.send(actor.userId, { to: enrolment.recipient_email, subject: renderCampaignTemplate(step.subject, templateContact), text: renderCampaignTemplate(step.body, templateContact), messageId: claim.messageId });
      const next = nextEmailAfter(definition, enrolment.step_index, delivery.sentAt);
      await withCampaignDb(actor, async client => {
        await client.query("UPDATE campaign_send_attempts SET state = 'sent', provider_message_id = $2, provider_thread_id = $3, sent_at = $4 WHERE id = $1 AND state = 'claimed'", [claim.attemptId, delivery.providerMessageId, delivery.providerThreadId, delivery.sentAt]);
        await client.query("UPDATE campaign_enrolments SET state = $2, step_index = $3, next_step_at = $4, updated_at = now() WHERE id = $1 AND state = 'active' AND step_index = $5", [enrolment.id, next ? "active" : "completed", next?.index ?? enrolment.step_index + 1, next ? nextSendAt(next.at) : null, enrolment.step_index]);
        await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.email_sent','campaign_enrolment',$3,$4)", [actor.organizationId, actor.userId, enrolment.id, JSON.stringify({ stepIndex: enrolment.step_index, providerMessageId: delivery.providerMessageId })]);
      });
      return { outcome: "sent" as const, providerMessageId: delivery.providerMessageId };
    } catch (error) {
      // No automatic retry after a potentially accepted network request.
      const message = error instanceof Error ? error.message : "Unknown Gmail send result";
      await withCampaignDb(actor, async client => {
        await client.query("UPDATE campaign_send_attempts SET state = 'unknown', error = $2 WHERE id = $1 AND state = 'claimed'", [claim.attemptId, message]);
        await client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = 'send_result_unknown', next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id]);
        await client.query("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'campaign.send_result_unknown','campaign_enrolment',$3,$4)", [actor.organizationId, actor.userId, enrolment.id, JSON.stringify({ stepIndex: enrolment.step_index })]);
      });
      return { outcome: "send_result_unknown" as const };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pre-send check failed";
    await withCampaignDb(actor, client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = $2, next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id, message]).then(() => undefined));
    return { outcome: "needs_review" as const, reason: message };
  }
}

async function reconcileUnknownAttempt(actor: CampaignActor, attemptId: string) {
  const loaded = await withCampaignDb(actor, async client => {
    const [attempt] = await rows<{ id: string; enrolment_id: string; step_index: number; rfc_message_id: string; state: string }>(client, "SELECT * FROM campaign_send_attempts WHERE id = $1 AND state = 'unknown'", [attemptId]);
    if (!attempt) return null;
    const [enrolment] = await rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE id = $1", [attempt.enrolment_id]);
    if (!enrolment) return null;
    const [mailbox] = await rows<MailboxRow>(client, "SELECT id, organization_id, user_id, address, encrypted_refresh_token, reconnect_required, scopes, daily_cap FROM mailbox_connections WHERE id = $1 AND organization_id = $2 AND user_id = $3", [enrolment.mailbox_connection_id, actor.organizationId, actor.userId]);
    const [version] = await rows<VersionRow>(client, "SELECT * FROM campaign_sequence_versions WHERE id = $1", [enrolment.version_id]);
    if (!mailbox || !version) return null;
    return { attempt, enrolment, mailbox, version };
  });
  if (!loaded) return false;
  const gmail = campaignMailboxForConnection({ encryptedRefreshToken: loaded.mailbox.encrypted_refresh_token, reconnectRequired: loaded.mailbox.reconnect_required, scopes: loaded.mailbox.scopes }, loaded.mailbox.id);
  const found = await gmail.findByRfcMessageId(loaded.attempt.rfc_message_id);
  if (!found) return false;
  const next = nextEmailAfter(parseDefinition(loaded.version.definition), loaded.attempt.step_index, new Date());
  await withCampaignDb(actor, async client => {
    await client.query("UPDATE campaign_send_attempts SET state = 'sent', provider_message_id = $2, provider_thread_id = $3, sent_at = now(), error = NULL WHERE id = $1 AND state = 'unknown'", [attemptId, found.id, found.threadId]);
    const [hold] = await rows<{ id: string }>(client, "SELECT id FROM campaign_contact_holds WHERE organization_id = $1 AND email = $2", [actor.organizationId, loaded.enrolment.recipient_email]);
    if (!hold) await client.query("UPDATE campaign_enrolments SET state = $2, stop_reason = NULL, step_index = $3, next_step_at = $4, updated_at = now() WHERE id = $1 AND state = 'needs_review' AND stop_reason = 'send_result_unknown' AND step_index = $5", [loaded.enrolment.id, next ? "active" : "completed", next?.index ?? loaded.attempt.step_index + 1, next ? nextSendAt(next.at) : null, loaded.attempt.step_index]);
  });
  return true;
}

export async function runCampaignTick(limit = 3) {
  const jobs = await withCampaignWorker(client => rows<{ id: string; organization_id: string; owner_user_id: string }>(client, "SELECT id, organization_id, owner_user_id FROM campaign_enrolments WHERE state = 'active' AND next_step_at <= now() ORDER BY next_step_at LIMIT $1", [limit]));
  const results = [] as { id: string; outcome: string }[];
  for (const job of jobs) {
    try {
      const result = await processCampaignEnrolment({ organizationId: job.organization_id, userId: job.owner_user_id }, job.id);
      results.push({ id: job.id, outcome: result.outcome });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Worker failed";
      results.push({ id: job.id, outcome: reason });
      await withCampaignWorker(client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = $2, next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [job.id, reason.slice(0, 250)]).then(() => undefined));
    }
  }
  const scans = await withCampaignWorker(client => rows<EnrolmentRow>(client, "SELECT * FROM campaign_enrolments WHERE state = 'active' AND (last_reply_checked_at IS NULL OR last_reply_checked_at < now() - interval '5 minutes') ORDER BY last_reply_checked_at NULLS FIRST LIMIT $1", [limit * 2]));
  for (const enrolment of scans) {
    try {
      const actor = { organizationId: enrolment.organization_id, userId: enrolment.owner_user_id };
      const mailbox = await withCampaignDb(actor, async client => {
        const [mailbox] = await rows<MailboxRow>(client, "SELECT id, organization_id, user_id, address, encrypted_refresh_token, reconnect_required, scopes, daily_cap FROM mailbox_connections WHERE id = $1 AND organization_id = $2 AND user_id = $3", [enrolment.mailbox_connection_id, enrolment.organization_id, enrolment.owner_user_id]);
        if (!mailbox) throw new Error("Mailbox unavailable");
        return mailbox;
      });
      await checkReplies(actor, enrolment, mailbox);
    } catch {
      await withCampaignWorker(client => client.query("UPDATE campaign_enrolments SET state = 'needs_review', stop_reason = 'reply_check_failed', next_step_at = NULL, updated_at = now() WHERE id = $1 AND state = 'active'", [enrolment.id]).then(() => undefined));
    }
  }
  const unknown = await withCampaignWorker(client => rows<{ id: string; organization_id: string; owner_user_id: string }>(client, "SELECT id, organization_id, owner_user_id FROM campaign_send_attempts WHERE state = 'unknown' ORDER BY claimed_at DESC LIMIT $1", [limit]));
  for (const attempt of unknown) {
    try { await reconcileUnknownAttempt({ organizationId: attempt.organization_id, userId: attempt.owner_user_id }, attempt.id); }
    catch { /* Unknown remains held; it is never retried as a send. */ }
  }
  return { processed: results.length, results, replyScans: scans.length, unknownChecks: unknown.length };
}
