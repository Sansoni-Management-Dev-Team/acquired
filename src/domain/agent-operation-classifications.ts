/** Operation families describe one boundary each; they never grant send authority. */
export const AGENT_LEGACY_EMAIL_OPERATION_NAMES = Object.freeze([
  "email.initial",
  "email.reply",
  "email.follow_up",
] as const);

export const AGENT_CHANNEL_MESSAGE_OPERATION_NAMES = Object.freeze([
  ...AGENT_LEGACY_EMAIL_OPERATION_NAMES,
  "whatsapp.initial",
  "whatsapp.reply",
  "whatsapp.follow_up",
  "linkedin.initial",
  "linkedin.reply",
  "linkedin.follow_up",
] as const);

/** Invitations participate in dispatch, pending-work and send-window checks, but
 * retain their own human-review, relationship, budget and invalidation fences. */
export const AGENT_NATIVE_DISPATCH_OPERATION_NAMES = Object.freeze([
  ...AGENT_CHANNEL_MESSAGE_OPERATION_NAMES,
  "linkedin.invitation",
] as const);

/** The booking-link proposal is editable/reviewable, but uses a human handoff;
 * it must not become ordinary native dispatch or pending automated message work. */
export const AGENT_EDITABLE_MESSAGE_OPERATION_NAMES = Object.freeze([
  ...AGENT_NATIVE_DISPATCH_OPERATION_NAMES,
  "email.manual_link",
] as const);

export const AGENT_REVIEWABLE_OPERATION_NAMES = Object.freeze([
  "target.select",
  "research.start",
  "research.people",
  "sequence.prepare",
  "sequence.publish",
  "sequence.enrol",
  ...AGENT_EDITABLE_MESSAGE_OPERATION_NAMES,
] as const);

const legacyEmail = new Set<string>(AGENT_LEGACY_EMAIL_OPERATION_NAMES);
const nativeDispatch = new Set<string>(AGENT_NATIVE_DISPATCH_OPERATION_NAMES);
const editableMessages = new Set<string>(
  AGENT_EDITABLE_MESSAGE_OPERATION_NAMES,
);
const reviewable = new Set<string>(AGENT_REVIEWABLE_OPERATION_NAMES);

export const isAgentLegacyEmailOperation = (name: string) =>
  legacyEmail.has(name);
export const isAgentNativeDispatchOperation = (name: string) =>
  nativeDispatch.has(name);
export const isAgentEditableMessageOperation = (name: string) =>
  editableMessages.has(name);
export const isAgentReviewableOperation = (name: string) =>
  reviewable.has(name);

/** Preserve the existing presentation classifier, including social manual_link
 * names. Server review/edit admission and demo auto-approval are narrower. */
export const isAgentMessageReviewOperation = (name: string) =>
  name === "linkedin.invitation" ||
  /^(email|whatsapp|linkedin)\.(initial|reply|follow_up|manual_link)$/.test(
    name,
  );
