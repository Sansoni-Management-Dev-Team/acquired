import { isDeepStrictEqual, types } from "node:util";
import { assertOperationMatches, assertSameBinding, assertSubmissionReceiptMatches, ContractError } from "../../contracts/src";
import type { CanonicalIdentity, ConnectionBinding, DeliveryOutcome, MessageSubmission, MessagingAdapter, OperationSnapshot, ProviderReference, Readiness } from "../../contracts/src";
import { messageDigest } from "./message-digest";

export type DispatchBlock = Extract<DeliveryOutcome, { status: "waiting" | "review" | "rejected" }>;
export interface DispatchMetadata { conversation?: ProviderReference; rfcMessageId?: string }
export type DispatchRecord = { snapshot: OperationSnapshot; recipient: CanonicalIdentity; message?: ProviderReference } & DispatchMetadata & (
  | { state: "claimed" | "dispatching"; outcome?: never }
  | { state: "unknown"; outcome: Extract<DeliveryOutcome, { status: "unknown" }> }
  | { state: "completed"; outcome: Exclude<DeliveryOutcome, { status: "unknown" }> }
);
export type UncertainDispatchRecord = DispatchRecord & {state: 'unknown' | 'dispatching'};
export type ClaimDecision = { kind: "claimed"; token: string; record: DispatchRecord } | { kind: "existing"; record: DispatchRecord } | { kind: "blocked"; outcome: DispatchBlock };
export type BeginDispatchDecision = { kind: "admitted"; record: DispatchRecord } | { kind: "blocked"; outcome: DispatchBlock } | { kind: "uncertain" };

/** Required authoritative storage boundary. All operations must enforce current authorization.
 * claim is scope/key atomic without quotas; beginDispatch commits a fenced dispatching CAS and
 * both account/application quota charges atomically. complete/reconcile preserve original facts.
 * These port types alone provide no database durability, concurrency, lease, quota or grant proof. */
export interface DispatchJournalPort {
  claim(input: { snapshot: OperationSnapshot; recipient: CanonicalIdentity } & DispatchMetadata): Promise<ClaimDecision>;
  beginDispatch(input: { token: string; record: DispatchRecord }): Promise<BeginDispatchDecision>;
  complete(input: { token: string; record: DispatchRecord; outcome: DeliveryOutcome }): Promise<DispatchRecord>;
  get(snapshot: OperationSnapshot): Promise<DispatchRecord | null>;
  reconcile(input: { record: DispatchRecord; outcome: DeliveryOutcome }): Promise<DispatchRecord>;
}
export interface DispatchCoordinatorOptions {
  /** Trusted server composition only: a committed tracking ACK and authenticated,
   * read-verified association must identify the original email. No caller ID/search.
   * The journal independently verifies this proposal before durable reconciliation. */
  recoverUnknownEmail?(record: UncertainDispatchRecord, signal: AbortSignal): Promise<DeliveryOutcome | null>;
  /** Whole recovery/read + reconciliation response budget, never renewed per phase. */
  recoveryTimeoutMs?: number;
}

const unknown = (): DeliveryOutcome => ({ status: "unknown" });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fields = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max = 2048): value is string => typeof value === "string" && !!value.trim() && value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function date(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    hour <= 23 && minute <= 59 && second <= 59 && (zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59)) && Number.isFinite(Date.parse(value));
}
const retryCodes = new Set(["incomplete", "stale", "busy", "timeout", "rate_limited", "unavailable", "identity_pending"]);
const reviewCodes = new Set(["reconnect", "account_changed", "protocol", "unexpected", "delivery_disabled", "unresolved_send", "unsupported", "forbidden", "operation_conflict"]);

function fail(): never { throw new ContractError("operation_conflict"); }
function validRecipient(binding: ConnectionBinding, recipient: CanonicalIdentity): boolean {
  if (!object(recipient) || !fields(recipient, ["kind", "value"]) || !text(recipient.value)) return false;
  if (binding.channel === "email") return recipient.kind === "email" && recipient.value === recipient.value.toLowerCase() && /^[^\s<>@]+@[^\s<>@]+$/.test(recipient.value);
  if (binding.channel === "whatsapp") return recipient.kind === "phone" && /^\+[1-9]\d{6,14}$/.test(recipient.value);
  if (binding.channel !== "linkedin" || recipient.kind !== "linkedin_profile") return false;
  try {
    const url = new URL(recipient.value);
    return url.protocol === "https:" && ["linkedin.com", "www.linkedin.com"].includes(url.hostname) && /^\/in\/[^/]+\/?$/.test(url.pathname) && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch { return false; }
}
function validReference(binding: ConnectionBinding, reference: unknown): reference is ProviderReference {
  if (!object(reference) || !fields(reference, ["binding", "id"]) || !text(reference.id)) return false;
  try { assertSameBinding(binding, reference.binding as ConnectionBinding); return true; } catch { return false; }
}
function assertSnapshot(binding: ConnectionBinding, snapshot: OperationSnapshot): void {
  if (!object(snapshot) || !fields(snapshot, ["key", "binding", "operation", "payloadDigest"]) || !text(snapshot.key, 255) ||
      typeof snapshot.payloadDigest !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.payloadDigest) ||
      !["message", "invitation"].includes(snapshot.operation) || (snapshot.operation === "invitation" && binding.channel !== "linkedin")) fail();
  assertSameBinding(binding, snapshot.binding);
}
function assertSubmission(binding: ConnectionBinding, input: MessageSubmission): void {
  if (!object(input) || !fields(input, ["snapshot", "message"])) fail();
  assertSnapshot(binding, input.snapshot);
  if (!object(input.message) || !fields(input.message, ["recipient", "text", "subject", "conversation", "rfcMessageId", "replyTo"]) ||
      !validRecipient(binding, input.message.recipient) || typeof input.message.text !== "string" || input.message.text.length > 100_000 ||
      (input.message.subject !== undefined && (typeof input.message.subject !== "string" || input.message.subject.length > 1000)) ||
      (input.message.rfcMessageId !== undefined && !text(input.message.rfcMessageId)) ||
      (input.message.replyTo !== undefined && !text(input.message.replyTo)) ||
      (input.message.conversation !== undefined && !validReference(binding, input.message.conversation)) ||
      messageDigest(input.snapshot.operation, input.message) !== input.snapshot.payloadDigest) fail();
}
function readiness(value: unknown): value is Readiness {
  if (!object(value)) return false;
  if (value.status === "ready") return fields(value, ["status"]);
  if (value.status === "waiting") return fields(value, ["status", "code", "retryAt"]) && typeof value.code === "string" && retryCodes.has(value.code) && date(value.retryAt);
  return value.status === "review" && fields(value, ["status", "code"]) && typeof value.code === "string" && reviewCodes.has(value.code);
}
function validOutcome(value: unknown, snapshot: OperationSnapshot, recipient: CanonicalIdentity, expectedMessage?: ProviderReference, expectedConversation?: ProviderReference): value is DeliveryOutcome {
  if (!object(value)) return false;
  if (value.status === "unknown") return fields(value, ["status"]);
  if (value.status === "waiting" || value.status === "review") return readiness(value);
  if (value.status === "rejected") return fields(value, ["status", "code"]) && typeof value.code === "string" && /^[a-zA-Z0-9_:/.-]{1,100}$/.test(value.code);
  if (value.status === "skipped") return fields(value, ["status", "operation", "reason"]) && validReference(snapshot.binding, value.operation) && text(value.reason, 512);
  if (value.status !== "submitted" || !fields(value, ["status", "receipt"]) || !object(value.receipt)) return false;
  const receipt = value.receipt;
  const message = "message" in receipt;
  if ((snapshot.operation === "invitation" && message) ||
      (snapshot.operation === "message" && !message && !(snapshot.binding.backend === "browser" && snapshot.binding.channel === "linkedin"))) return false;
  if (!fields(receipt, message ? ["message", "conversation", "recipient", "submittedAt", "deliveredAt", "readAt"] : ["operation", "recipient", "submittedAt"]) ||
      !validReference(snapshot.binding, message ? receipt.message : receipt.operation) ||
      (receipt.conversation !== undefined && !validReference(snapshot.binding, receipt.conversation)) ||
      !validRecipient(snapshot.binding, receipt.recipient as CanonicalIdentity) || ![receipt.submittedAt, receipt.deliveredAt, receipt.readAt].every(date)) return false;
  try {
    assertSubmissionReceiptMatches(snapshot, recipient, receipt as unknown as Extract<DeliveryOutcome, { status: "submitted" }>['receipt']);
    return (!expectedMessage || (message && (receipt.message as ProviderReference).id === expectedMessage.id)) &&
      (!expectedConversation || (message && validReference(snapshot.binding, receipt.conversation) && receipt.conversation.id === expectedConversation.id));
  } catch { return false; }
}
function block(value: unknown, snapshot: OperationSnapshot, recipient: CanonicalIdentity): value is DispatchBlock {
  return validOutcome(value, snapshot, recipient) && ["waiting", "review", "rejected"].includes(value.status);
}
function assertRecord(record: DispatchRecord, snapshot: OperationSnapshot, recipient?: CanonicalIdentity, original?: DispatchMetadata): void {
  if (!object(record) || !fields(record, ["snapshot", "recipient", "message", "conversation", "rfcMessageId", "state", "outcome"])) fail();
  assertOperationMatches(snapshot, record.snapshot);
  if (!validRecipient(snapshot.binding, record.recipient) || (recipient && !isDeepStrictEqual(record.recipient, recipient)) ||
      (record.message !== undefined && !validReference(snapshot.binding, record.message)) ||
      (record.conversation !== undefined && !validReference(snapshot.binding, record.conversation)) ||
      (record.rfcMessageId !== undefined && !text(record.rfcMessageId)) ||
      (original && (!isDeepStrictEqual(record.conversation, original.conversation) || record.rfcMessageId !== original.rfcMessageId))) fail();
  if (record.state === "claimed" || record.state === "dispatching") { if (record.outcome !== undefined) fail(); return; }
  const outcome: unknown = record.outcome;
  if (!validOutcome(outcome, snapshot, record.recipient, record.message, record.conversation)) fail();
  if (record.state === "unknown") { if (outcome.status !== "unknown") fail(); return; }
  if (record.state !== "completed" || outcome.status === "unknown") fail();
}
function replay(record: DispatchRecord): DeliveryOutcome {
  return structuredClone(record.state === "completed" ? record.outcome : unknown());
}

/** A single immutable adapter and a REQUIRED authoritative journal: no fallback or memory journal.
 * This coordinator orders calls, validates provenance and uncertainty, and captures immutable inputs.
 * The injected repository must provide real transactions/fences/quotas and enforce current grants. */
export function createDispatchCoordinator(expectedBinding: ConnectionBinding, adapter: MessagingAdapter, journal: DispatchJournalPort, options: DispatchCoordinatorOptions = {}): MessagingAdapter {
  assertSameBinding(expectedBinding, expectedBinding);
  const binding = structuredClone(expectedBinding);
  const adapterReady = Function.prototype.bind.call(adapter.ready,adapter) as MessagingAdapter['ready'];
  const adapterSubmit = Function.prototype.bind.call(adapter.submit,adapter) as MessagingAdapter['submit'];
  const adapterLookup = Function.prototype.bind.call(adapter.lookup,adapter) as MessagingAdapter['lookup'];
  const claim = Function.prototype.bind.call(journal.claim,journal) as DispatchJournalPort['claim'];
  const beginDispatch = Function.prototype.bind.call(journal.beginDispatch,journal) as DispatchJournalPort['beginDispatch'];
  const complete = Function.prototype.bind.call(journal.complete,journal) as DispatchJournalPort['complete'];
  const get = Function.prototype.bind.call(journal.get,journal) as DispatchJournalPort['get'];
  const reconcile = Function.prototype.bind.call(journal.reconcile,journal) as DispatchJournalPort['reconcile'];
  let recover: DispatchCoordinatorOptions['recoverUnknownEmail'], recoveryTimeout: number;
  try {
    if (!options || types.isProxy(options) || Object.getPrototypeOf(options)!==Object.prototype) fail();
    const d=Object.getOwnPropertyDescriptors(options);
    if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!['recoverUnknownEmail','recoveryTimeoutMs'].includes(k)||!('value'in d[k]))) fail();
    for(const descriptor of Object.values(d))if(types.isPromise(descriptor.value)){void Promise.prototype.then.call(descriptor.value,undefined,()=>{});fail();}
    const fn=d.recoverUnknownEmail?.value;
    recoveryTimeout=d.recoveryTimeoutMs?.value??10000;
    if(fn!==undefined&&(typeof fn!=='function'||types.isProxy(fn))||!Number.isSafeInteger(recoveryTimeout)||recoveryTimeout<1||recoveryTimeout>10000)fail();
    recover=fn===undefined?undefined:Function.prototype.bind.call(fn,options);
  } catch { throw Error('Invalid dispatch recovery configuration'); }

  async function recoverEmail(record: UncertainDispatchRecord):Promise<DeliveryOutcome>{
    const controller=new AbortController(),deadline=performance.now()+recoveryTimeout;
    let timer:ReturnType<typeof setTimeout>;
    const stopped=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Email recovery unavailable'));},recoveryTimeout);});
    void stopped.catch(()=>undefined);
    const live=()=>{if(controller.signal.aborted||performance.now()>=deadline){controller.abort();throw Error('Email recovery unavailable');}};
    const call=async<T>(work:()=>Promise<T>):Promise<T>=>{live();const pending=Promise.resolve().then(()=>{live();return work();}).then(value=>{live();return value;});void pending.catch(()=>undefined);return Promise.race([pending,stopped]);};
    function capture<T>(v:T):T{
      const pending:unknown[]=[v];let count=0;
      while(pending.length){const value=pending.pop();if(++count>10000)fail();if(types.isPromise(value)){void Promise.prototype.then.call(value,undefined,()=>{});fail();}
        if(value===null||value===undefined||['string','boolean','number'].includes(typeof value))continue;
        if(!value||typeof value!=='object'||types.isProxy(value)||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(value)))fail();
        const d=Object.getOwnPropertyDescriptors(value);for(const k of Reflect.ownKeys(d)){if(typeof k!=='string'||!('value'in d[k]))fail();pending.push(d[k].value);}
      }return structuredClone(v);
    }
    try{
      const observed=capture(await call(()=>recover!(structuredClone(record),controller.signal)));
      if(!validOutcome(observed,record.snapshot,record.recipient,undefined,record.conversation)||observed?.status!=='submitted'||!('message'in observed.receipt))return unknown();
      const result=capture(await call(()=>reconcile(structuredClone({record,outcome:observed}))));
      assertRecord(result,record.snapshot,record.recipient,record);
      if(result.state!=='completed'||!isDeepStrictEqual(result.outcome,observed)||!isDeepStrictEqual(result.message,observed.receipt.message))return unknown();
      live();return structuredClone(observed);
    }catch{return unknown();}finally{clearTimeout(timer!);controller.abort();}
  }

  async function persist(token: string, record: DispatchRecord, outcome: DeliveryOutcome): Promise<DeliveryOutcome> {
    try {
      const result = structuredClone(await complete(structuredClone({ token, record, outcome })));
      assertRecord(result, record.snapshot, record.recipient, record);
      if (record.message && !isDeepStrictEqual(result.message, record.message)) return unknown();
      if ((outcome.status === "unknown" ? result.state !== "unknown" : result.state !== "completed") || !isDeepStrictEqual(result.outcome, outcome)) return unknown();
      return structuredClone(outcome);
    } catch { return unknown(); }
  }
  return {
    async ready(requested) {
      const requestedBinding = structuredClone(requested);
      assertSameBinding(binding, requestedBinding);
      try {
        const result = structuredClone(await adapterReady(structuredClone(binding)));
        return readiness(result) ? result : { status: "review", code: "protocol" };
      } catch { return { status: "waiting", code: "unavailable" }; }
    },
    async submit(request) {
      const input = structuredClone(request);
      assertSubmission(binding, input);
      let decision: ClaimDecision;
      try { decision = structuredClone(await claim(structuredClone({ snapshot: input.snapshot, recipient: input.message.recipient,
        ...(input.message.conversation ? { conversation: input.message.conversation } : {}),
        ...(input.message.rfcMessageId ? { rfcMessageId: input.message.rfcMessageId } : {}),
      }))); }
      catch (error) { if (error instanceof ContractError) throw error; return unknown(); }
      if (decision?.kind === "blocked") return block(decision.outcome, input.snapshot, input.message.recipient) ? structuredClone(decision.outcome) : unknown();
      if (decision?.kind === "existing") { assertRecord(decision.record, input.snapshot, input.message.recipient, input.message); return replay(decision.record); }
      if (decision?.kind !== "claimed" || !text(decision.token)) return unknown();
      try { assertRecord(decision.record, input.snapshot, input.message.recipient, input.message); } catch { return unknown(); }
      if (decision.record.state !== "claimed") return unknown();
      let preflight: Readiness;
      try { preflight = structuredClone(await adapterReady(structuredClone(binding))); }
      catch { return persist(decision.token, decision.record, unknown()); }
      if (!readiness(preflight)) return persist(decision.token, decision.record, unknown());
      if (preflight.status !== "ready") return persist(decision.token, decision.record, preflight);
      let admission: BeginDispatchDecision;
      try { admission = structuredClone(await beginDispatch(structuredClone({ token: decision.token, record: decision.record }))); }
      catch { return unknown(); }
      if (admission?.kind === "blocked") return block(admission.outcome, input.snapshot, input.message.recipient) ? persist(decision.token, decision.record, admission.outcome) : unknown();
      if (admission?.kind !== "admitted") return unknown();
      try { assertRecord(admission.record, input.snapshot, input.message.recipient, input.message); } catch { return unknown(); }
      if (admission.record.state !== "dispatching") return unknown();
      let outcome: DeliveryOutcome;
      try {
        const observed = structuredClone(await adapterSubmit(structuredClone(input)));
        outcome = validOutcome(observed, input.snapshot, input.message.recipient, undefined, input.message.conversation) ? observed : unknown();
      } catch { outcome = unknown(); }
      return persist(decision.token, admission.record, outcome);
    },
    async lookup(request) {
      const input = structuredClone(request);
      if (!object(input) || !fields(input, ["snapshot", "message", "expectedRecipient", "rfcMessageId"])) fail();
      assertSnapshot(binding, input.snapshot);
      if ((input.message !== undefined && !validReference(binding, input.message)) ||
          (input.expectedRecipient !== undefined && !validRecipient(binding, input.expectedRecipient)) ||
          (input.rfcMessageId !== undefined && !text(input.rfcMessageId))) fail();
      let record: DispatchRecord | null;
      try { record = structuredClone(await get(structuredClone(input.snapshot))); }
      catch (error) { if (error instanceof ContractError) throw error; return unknown(); }
      if (record === null) return null;
      assertRecord(record, input.snapshot, input.expectedRecipient);
      if (input.rfcMessageId !== undefined && input.rfcMessageId !== record.rfcMessageId) fail();
      if (record.state === "completed") {
        if (!validOutcome(record.outcome, input.snapshot, record.recipient, input.message)) throw new ContractError("receipt_mismatch");
        return structuredClone(record.outcome);
      }
      // A claimed row never crossed durable dispatch admission, so it cannot have a send to recover.
      if (record.state === "claimed") return unknown();
      if((record.state==='unknown'||record.state==='dispatching')&&!record.message&&recover&&binding.backend==='unipile'&&binding.channel==='email'&&input.snapshot.operation==='message'){
        // Browser/client proposals never nominate the learned message ID.
        if(input.message)return unknown();
        return recoverEmail(record as UncertainDispatchRecord);
      }
      const knownMessage = !!record.message && !!input.message && input.snapshot.operation === "message";
      if (input.message && !record.message) return unknown();
      if (input.message && record.message && record.message.id !== input.message.id) throw new ContractError("receipt_mismatch");
      const gmailRfc = binding.backend === "direct" && binding.platform === "gmail" && input.snapshot.operation === "message" && !!record.rfcMessageId;
      const legacyAction = binding.backend === "browser" && binding.channel === "linkedin" && !record.message && !input.message;
      if (!knownMessage && !gmailRfc && !legacyAction) return unknown();
      try {
        const observed = structuredClone(await adapterLookup(structuredClone({ snapshot: record.snapshot,
          ...(knownMessage ? { message: record.message } : {}),
          ...(record.rfcMessageId ? { rfcMessageId: record.rfcMessageId } : {}),
          expectedRecipient: record.recipient,
        })));
        // A generic lookup rejection/skip is not evidence that an uncertain original send was
        // unaccepted. Only the exact known submitted message receipt resolves that uncertainty.
        if (!validOutcome(observed, input.snapshot, record.recipient, record.message, record.conversation) || observed.status !== "submitted") return unknown();
        const result = structuredClone(await reconcile(structuredClone({ record, outcome: observed })));
        assertRecord(result, input.snapshot, record.recipient, record);
        if (record.message && !isDeepStrictEqual(result.message, record.message)) return unknown();
        return result.state === "completed" && isDeepStrictEqual(result.outcome, observed) ? structuredClone(observed) : unknown();
      } catch { return unknown(); }
    },
  };
}
