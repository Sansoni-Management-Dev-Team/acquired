import { assertSameBinding } from '../../contracts/src';
import type { CanonicalIdentity, CommunicationEvent, ConnectionBinding } from '../../contracts/src';

interface ScopedEvidence { binding: ConnectionBinding; providerAccountId: string }
interface CommonContext extends ScopedEvidence { timestampBounds: { from: string; through: string } }
export type V1ReplyEventContext =
  | (CommonContext & { channel: 'linkedin' | 'whatsapp'; ownerProviderId: string;
      product: 'classic' | 'sales_navigator' | 'recruiter' | 'organization' | 'whatsapp';
      chat?: ScopedEvidence & { id: string; type: 'direct' | 'group'; participantProviderIds: string[] };
      sender?: ScopedEvidence & { providerId: string; identity: CanonicalIdentity } })
  | (CommonContext & { channel: 'email'; ownerAddresses: string[];
      email?: ScopedEvidence & { id: string; complete: true; headersComplete: true; mail: unknown } });
export type V1ReplyEventResult =
  | { kind: 'event'; event: CommunicationEvent }
  | { kind: 'ignore'; reason: string }
  | { kind: 'review'; code: 'protocol' | 'account_changed' | 'identity_pending' };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.trim() === value && value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f]/.test(value);
const review = (code: 'protocol' | 'account_changed' | 'identity_pending' = 'protocol'): V1ReplyEventResult => ({ kind: 'review', code });
const ignore = (reason: string): V1ReplyEventResult => ({ kind: 'ignore', reason });
const nonReplies = new Set(['message_read', 'message_delivered', 'message_reaction', 'message_edited', 'message_deleted', 'mail_sent', 'mail_moved', 'new_relation']);
const linkedinProducts = new Set(['classic', 'sales_navigator', 'recruiter', 'organization']);
const accountTypes = { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL', linkedin: 'LINKEDIN', whatsapp: 'WHATSAPP' } as const;

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) return false;
  return (zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59)) && Number.isFinite(Date.parse(value));
}
function bounded(value: unknown, context: CommonContext): value is string {
  return timestamp(value) && object(context.timestampBounds) && timestamp(context.timestampBounds.from) && timestamp(context.timestampBounds.through) &&
    Date.parse(context.timestampBounds.from) <= Date.parse(value) && Date.parse(value) <= Date.parse(context.timestampBounds.through);
}
function sameScope(context: CommonContext, evidence: ScopedEvidence): boolean {
  try { assertSameBinding(context.binding, evidence.binding); return evidence.providerAccountId === context.providerAccountId; } catch { return false; }
}
// No display-name parsing, provider-specific dot/plus folding, or alias guessing.
function emailAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254 || value.trim() !== value || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)) return null;
  const [local, domain] = value.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.includes('..') || domain.split('.').some(part => part.startsWith('-') || part.endsWith('-') || part.length > 63)) return null;
  return value.toLowerCase();
}
function attendeeEmail(value: unknown): string | null {
  return object(value) && value.identifier_type === 'EMAIL_ADDRESS' ? emailAddress(value.identifier) : null;
}
function identityForSocial(context: Extract<V1ReplyEventContext, { channel: 'linkedin' | 'whatsapp' }>): boolean {
  const identity = context.sender?.identity;
  if (!identity || !id(identity.value)) return false;
  if (context.channel === 'whatsapp') return identity.kind === 'phone' && /^\+[1-9]\d{6,14}$/.test(identity.value);
  if (identity.kind !== 'linkedin_profile') return false;
  try { const url = new URL(identity.value); return url.protocol === 'https:' && ['linkedin.com', 'www.linkedin.com'].includes(url.hostname) && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/in\/[^/]+\/?$/.test(url.pathname); } catch { return false; }
}
function sanitizedBinding(binding: ConnectionBinding): ConnectionBinding {
  return { applicationId: binding.applicationId, tenantId: binding.tenantId, ownerId: binding.ownerId, connectionId: binding.connectionId, accountId: binding.accountId, generation: binding.generation, channel: binding.channel, platform: binding.platform, backend: binding.backend };
}
function event(binding: ConnectionBinding, messageId: string, sender: CanonicalIdentity, occurredAt: string, conversationId?: string): V1ReplyEventResult {
  return { kind: 'event', event: { type: 'message', reference: { binding: sanitizedBinding(binding), id: messageId },
    ...(conversationId ? { conversation: { binding: sanitizedBinding(binding), id: conversationId } } : {}), direction: 'inbound', sender: { kind: sender.kind, value: sender.value }, occurredAt } };
}

/** Pure, content-free normalization of authenticated default-format v1 webhook JSON.
 * Context is service-owned evidence: never populate it from unverified webhook names/URLs.
 * Evidence is scoped to the original binding generation/account. Social chat evidence must be
 * obtained by a verified direct-chat participant read; canonical sender aliases require separate
 * verification. Email evidence must come from a full authenticated include_headers lookup of the
 * exact email. headersComplete asserts actual fetch completeness, not mere headers-array presence.
 * Timestamp bounds reject malformed/out-of-scope events; they do not certify coverage or freshness.
 * Inbox role is the only currently normalized email folder; other received-mail roles require
 * review rather than being dropped. Sent/draft roles establish nonreply activity. This restriction
 * cannot prove complete email coverage.
 * Parent email/RFC references are not conversation/thread IDs and are deliberately omitted.
 */
export function normalizeV1ReplyEvent(raw: unknown, context: V1ReplyEventContext): V1ReplyEventResult {
  try { return normalize(raw, context); } catch { return review(); }
}
function normalize(raw: unknown, context: V1ReplyEventContext): V1ReplyEventResult {
  if (!context || !object(raw) || !id(context.providerAccountId)) return review();
  try { assertSameBinding(context.binding, context.binding); } catch { return review(); }
  if (context.binding.backend !== 'unipile' || context.binding.channel !== context.channel) return review();
  if (!id(raw.account_id)) return review();
  if (raw.account_id !== context.providerAccountId) return review('account_changed');
  if (raw.account_type !== undefined && raw.account_type !== accountTypes[context.binding.platform]) return review('account_changed');
  if (typeof raw.event !== 'string') return review();
  if (nonReplies.has(raw.event)) return ignore('non_reply_event');
  if (context.channel === 'email') return emailEvent(raw, context);
  if (raw.event !== 'message_received' || !id(raw.message_id) || !id(raw.chat_id) || !bounded(raw.timestamp, context)) return review();
  if (raw.account_type !== accountTypes[context.binding.platform] || !object(raw.account_info) || !id(context.ownerProviderId)) return review();
  if (raw.account_info.type !== accountTypes[context.binding.platform] || raw.account_info.user_id !== context.ownerProviderId ||
      (context.channel === 'linkedin' && (!linkedinProducts.has(context.product) || raw.account_info.feature !== context.product)) ||
      (context.channel === 'whatsapp' && context.product !== 'whatsapp')) return review('account_changed');
  if (!object(raw.sender) || !id(raw.sender.attendee_provider_id)) return review();
  if (raw.is_sender !== undefined && raw.is_sender !== 0 && raw.is_sender !== 1) return review();
  const senderId = raw.sender.attendee_provider_id;
  if (senderId === context.ownerProviderId) return raw.is_sender === 0 ? review() : ignore('self_message');
  if (raw.is_sender === 1) return review();
  for (const flag of ['is_event', 'deleted', 'hidden']) {
    if (raw[flag] !== undefined && raw[flag] !== 0 && raw[flag] !== 1) return review();
    if (raw[flag] === 1) return ignore('non_reply_message');
  }
  if (!context.chat) return review('identity_pending');
  if (!sameScope(context, context.chat) || context.chat.id !== raw.chat_id) return review('account_changed');
  if (context.chat.type === 'group') return ignore('group_message');
  if (context.chat.type !== 'direct' || !Array.isArray(context.chat.participantProviderIds) || context.chat.participantProviderIds.length !== 2 ||
      !context.chat.participantProviderIds.every(id) || new Set(context.chat.participantProviderIds).size !== 2 ||
      !context.chat.participantProviderIds.includes(context.ownerProviderId) || !context.chat.participantProviderIds.includes(senderId)) return review('identity_pending');
  if (!context.sender) return review('identity_pending');
  if (!sameScope(context, context.sender)) return review('account_changed');
  if (context.sender.providerId !== senderId || !identityForSocial(context)) return review('identity_pending');
  if (raw.attendees !== undefined) {
    if (!Array.isArray(raw.attendees)) return review();
    for (const attendee of raw.attendees) {
      if (!object(attendee) || !id(attendee.attendee_provider_id)) return review();
      if (!context.chat.participantProviderIds.includes(attendee.attendee_provider_id)) return review('identity_pending');
    }
  }
  return event(context.binding, raw.message_id, context.sender.identity, raw.timestamp, raw.chat_id);
}
function emailEvent(raw: Record<string, unknown>, context: Extract<V1ReplyEventContext, { channel: 'email' }>): V1ReplyEventResult {
  if (raw.event !== 'mail_received' || !id(raw.email_id) || !bounded(raw.date, context)) return review();
  if (!context.email || context.email.complete !== true || context.email.headersComplete !== true || !object(context.email.mail)) return review();
  if (!sameScope(context, context.email) || context.email.id !== raw.email_id) return review('account_changed');
  const mail = context.email.mail;
  if (mail.account_id !== context.providerAccountId || mail.id !== raw.email_id) return review('account_changed');
  // Full GET's documented 2_full variant has no required is_complete field. Completeness
  // remains service-owned fetch evidence; an explicit false/invalid vendor flag contradicts it.
  const completeVariant = mail.kind === '2_full'
    ? mail.is_complete === undefined || mail.is_complete === true
    : mail.kind === undefined && mail.is_complete === true;
  if (mail.object !== 'Email' || !completeVariant || !bounded(mail.date, context) || Date.parse(mail.date) !== Date.parse(raw.date as string)) return review();
  const sender = attendeeEmail(mail.from_attendee);
  if (!sender || (raw.from_attendee !== undefined && attendeeEmail(raw.from_attendee) !== sender)) return review();
  if (!Array.isArray(context.ownerAddresses) || context.ownerAddresses.length === 0) return review('identity_pending');
  const owners = context.ownerAddresses.map(emailAddress);
  if (owners.some(owner => owner === null)) return review('identity_pending');
  if (owners.includes(sender)) return ignore('self_email');
  if (typeof mail.role !== 'string' || (raw.role !== undefined && raw.role !== mail.role)) return review();
  if (['sent', 'drafts', 'draft'].includes(mail.role.toLowerCase())) return ignore('non_inbound_email');
  if (mail.role.toLowerCase() !== 'inbox') return review();
  const recipients: string[] = [];
  for (const key of ['to_attendees', 'cc_attendees', 'bcc_attendees']) {
    if (!Array.isArray(mail[key]) || mail[key].length > 1000) return review();
    if (raw[key] !== undefined) {
      if (!Array.isArray(raw[key]) || raw[key].length !== mail[key].length) return review();
      const actual = raw[key].map(attendeeEmail).sort();
      const expected = mail[key].map(attendeeEmail).sort();
      if (actual.some((address, index) => !address || address !== expected[index])) return review();
    }
    for (const attendee of mail[key]) { const address = attendeeEmail(attendee); if (!address) return review(); recipients.push(address); }
  }
  if (!recipients.some(address => owners.includes(address))) return review('identity_pending');
  if (!Array.isArray(mail.headers) || mail.headers.length > 512) return review();
  const headers: { name: string; value: string }[] = [];
  for (const header of mail.headers) {
    if (!object(header) || typeof header.name !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(header.name) || typeof header.value !== 'string' || header.value.length > 16384 || /[\u0000-\u001f\u007f]/.test(header.value)) return review();
    headers.push({ name: header.name.toLowerCase(), value: header.value.trim().toLowerCase() });
  }
  if (raw.headers !== undefined) {
    if (!Array.isArray(raw.headers) || raw.headers.length > 512) return review();
    const unmatched = [...headers];
    for (const header of raw.headers) {
      if (!object(header) || typeof header.name !== 'string' || typeof header.value !== 'string') return review();
      const index = unmatched.findIndex(known => known.name === (header.name as string).toLowerCase() && known.value === (header.value as string).trim().toLowerCase());
      if (index < 0) return review();
      unmatched.splice(index, 1);
    }
  }
  const system = headers.some(header =>
    (header.name === 'auto-submitted' && header.value !== 'no') ||
    (header.name === 'precedence' && ['bulk', 'list', 'junk'].includes(header.value)) ||
    (['x-autoreply', 'x-autorespond', 'x-auto-response', 'x-failed-recipients', 'list-id'].includes(header.name)) ||
    (header.name === 'return-path' && header.value === '<>') ||
    (header.name === 'content-type' && /(?:delivery-status|disposition-notification|multipart\/report)/.test(header.value)));
  if (system || /^(?:mailer-daemon|postmaster)(?:[+.-].*)?@/.test(sender)) return ignore('system_email');
  return event(context.binding, raw.email_id, { kind: 'email', value: sender }, mail.date);
}
