import { describe, expect, it, vi } from "vitest";
import type { ConnectionBinding, DeliveryOutcome, MessageSubmission, MessagingAdapter, ReceiptLookup } from "../../contracts/src";
import { messageDigest } from "./message-digest";
import { createDispatchCoordinator, type DispatchJournalPort, type DispatchRecord } from "./dispatch";

const binding: ConnectionBinding = { applicationId: "fixture-app", tenantId: "fixture-tenant", ownerId: "fixture-owner", connectionId: "fixture-connection", accountId: "fixture-account", generation: 1, channel: "whatsapp", platform: "whatsapp", backend: "unipile" };
function submission(): MessageSubmission {
  const message = { recipient: { kind: "phone" as const, value: "+61400000000" }, text: "Synthetic dispatch" };
  return { snapshot: { binding: structuredClone(binding), key: "fixture-key", operation: "message", payloadDigest: messageDigest("message", message) }, message };
}
function submitted(input = submission()): Extract<DeliveryOutcome, { status: "submitted" }> {
  return { status: "submitted", receipt: { message: { binding: structuredClone(input.snapshot.binding), id: "fixture-message" }, recipient: structuredClone(input.message.recipient) } };
}
function lookup(input = submission()): ReceiptLookup { return { snapshot: input.snapshot, message: { binding: input.snapshot.binding, id: "fixture-message" }, expectedRecipient: input.message.recipient }; }

/** Synthetic in-memory port for coordinator ordering only. No durability/concurrency/fencing proof. */
function fixture() {
  let stored: DispatchRecord | null = null;
  const events: string[] = [];
  const journal: DispatchJournalPort = {
    claim: vi.fn<DispatchJournalPort["claim"]>(async input => {
      events.push("claim");
      if (stored) return { kind: "existing", record: structuredClone(stored) } as const;
      const record: DispatchRecord = { ...structuredClone(input), state: "claimed" };
      stored = record;
      return { kind: "claimed", token: "fixture-token", record: structuredClone(record) } as const;
    }),
    beginDispatch: vi.fn<DispatchJournalPort["beginDispatch"]>(async input => {
      events.push("beginDispatch");
      if (input.record.state !== "claimed") throw new Error("Synthetic port requires claimed state");
      const admitted: DispatchRecord = { ...structuredClone(input.record), state: "dispatching" };
      stored = admitted;
      return { kind: "admitted", record: structuredClone(admitted) } as const;
    }),
    complete: vi.fn<DispatchJournalPort["complete"]>(async input => {
      events.push("complete");
      const base = { snapshot: input.record.snapshot, recipient: input.record.recipient, ...(input.record.message ? { message: input.record.message } : {}), ...(input.record.conversation ? { conversation: input.record.conversation } : {}), ...(input.record.rfcMessageId ? { rfcMessageId: input.record.rfcMessageId } : {}) };
      stored = input.outcome.status === "unknown" ? { ...base, state: "unknown", outcome: input.outcome } : { ...base, state: "completed", outcome: input.outcome };
      return structuredClone(stored);
    }),
    get: vi.fn<DispatchJournalPort["get"]>(async () => { events.push("get"); return structuredClone(stored); }),
    reconcile: vi.fn<DispatchJournalPort["reconcile"]>(async input => {
      events.push("reconcile"); stored = { ...structuredClone(input.record), state: "completed", outcome: input.outcome as Exclude<DeliveryOutcome, { status: "unknown" }> };
      return structuredClone(stored);
    }),
  };
  const adapter: MessagingAdapter = {
    ready: vi.fn<MessagingAdapter["ready"]>(async () => { events.push("ready"); return { status: "ready" }; }),
    submit: vi.fn<MessagingAdapter["submit"]>(async () => { events.push("submit"); return submitted(); }),
    lookup: vi.fn<MessagingAdapter["lookup"]>(async () => { events.push("lookup"); return submitted(); }),
  };
  return { journal, adapter, events, get stored() { return stored; }, set stored(record: DispatchRecord | null) { stored = structuredClone(record); } };
}

describe("dispatch coordinator with a required synthetic journal port", () => {
  it("claims, preflights, commits dispatch admission, sends and persists in order", async () => {
    const f = fixture(); const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    expect(await coordinator.submit(submission())).toEqual(submitted());
    expect(f.events).toEqual(["claim", "ready", "beginDispatch", "submit", "complete"]);
  });
  it("equal-key replay returns the stored receipt without readiness/admission/provider I/O", async () => {
    const f = fixture(); const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    await coordinator.submit(submission()); f.events.length = 0;
    expect(await coordinator.submit(submission())).toEqual(submitted());
    expect(f.events).toEqual(["claim"]);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });
  it.each(["claimed", "dispatching", "unknown"] as const)("does not redispatch an existing %s operation", async state => {
    const f = fixture(); const input = submission();
    f.stored = state === "unknown" ? { snapshot: input.snapshot, recipient: input.message.recipient, state, outcome: { status: "unknown" } } : { snapshot: input.snapshot, recipient: input.message.recipient, state };
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(input)).toEqual({ status: "unknown" });
    expect(f.events).toEqual(["claim"]);
  });
  it("only the atomic claim winner calls preflight/admission/provider submit", async () => {
    const f = fixture(); const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    const outcomes = await Promise.all([coordinator.submit(submission()), coordinator.submit(submission())]);
    expect(outcomes).toContainEqual(submitted());
    expect(outcomes).toContainEqual({ status: "unknown" });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1); expect(f.journal.beginDispatch).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: "waiting", code: "incomplete" }, { status: "review", code: "reconnect" }] as const)("persists predispatch %s without quota admission or send", async outcome => {
    const f = fixture(); vi.mocked(f.adapter.ready).mockResolvedValue(outcome);
    const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    expect(await coordinator.submit(submission())).toEqual(outcome);
    expect(f.events).toEqual(["claim", "complete"]);
  });
  it("preserves a known not-ready block on same-key replay even after provider becomes ready", async () => {
    const f = fixture(); const block = { status: "waiting", code: "incomplete" } as const;
    vi.mocked(f.adapter.ready).mockResolvedValue(block);
    const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal); await coordinator.submit(submission());
    vi.mocked(f.adapter.ready).mockResolvedValue({ status: "ready" });
    expect(await coordinator.submit(submission())).toEqual(block);
    expect(f.journal.beginDispatch).not.toHaveBeenCalled(); expect(f.adapter.submit).not.toHaveBeenCalled();
  });
  it("does not preflight or submit a blocked claim", async () => {
    const f = fixture(); const block = { status: "review", code: "forbidden" } as const;
    vi.mocked(f.journal.claim).mockResolvedValue({ kind: "blocked", outcome: block });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(submission())).toEqual(block);
    expect(f.adapter.ready).not.toHaveBeenCalled(); expect(f.adapter.submit).not.toHaveBeenCalled();
  });
  it("does not submit when fenced dispatch admission blocks", async () => {
    const f = fixture(); const block = { status: "waiting", code: "busy" } as const;
    vi.mocked(f.journal.beginDispatch).mockResolvedValue({ kind: "blocked", outcome: block });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(submission())).toEqual(block);
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });
  it.each(["claim", "beginDispatch"] as const)("unknown %s commit does not trigger provider I/O or retry", async method => {
    const f = fixture(); vi.mocked(f.journal[method]).mockRejectedValue(new Error("synthetic lost journal response"));
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(submission())).toEqual({ status: "unknown" });
    expect(f.adapter.submit).not.toHaveBeenCalled(); expect(f.journal[method]).toHaveBeenCalledTimes(1);
  });
  it("uncertain admission does not complete/retry/send", async () => {
    const f = fixture(); vi.mocked(f.journal.beginDispatch).mockResolvedValue({ kind: "uncertain" });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(submission())).toEqual({ status: "unknown" });
    expect(f.adapter.submit).not.toHaveBeenCalled(); expect(f.journal.complete).not.toHaveBeenCalled();
  });
  it("provider throw is persisted unknown and never redispatched", async () => {
    const f = fixture(); vi.mocked(f.adapter.submit).mockRejectedValue(new Error("synthetic accepted then lost response"));
    const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    expect(await coordinator.submit(submission())).toEqual({ status: "unknown" });
    expect(await coordinator.submit(submission())).toEqual({ status: "unknown" });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });
  it("a failed receipt commit returns unknown and retains dispatching replay", async () => {
    const f = fixture(); vi.mocked(f.journal.complete).mockRejectedValue(new Error("synthetic receipt commit loss"));
    const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    expect(await coordinator.submit(submission())).toEqual({ status: "unknown" });
    expect(await coordinator.submit(submission())).toEqual({ status: "unknown" });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1); expect(f.journal.complete).toHaveBeenCalledTimes(1);
  });
  it("rejects altered payload digest, binding or recipient kind before journal/provider I/O", async () => {
    for (const mutate of [(input: MessageSubmission) => { input.message.text += "changed"; }, (input: MessageSubmission) => { input.snapshot.binding.generation++; }, (input: MessageSubmission) => { input.message.recipient.kind = "email"; input.snapshot.payloadDigest = messageDigest("message", input.message); }]) {
      const f = fixture(); const input = submission(); mutate(input);
      await expect(createDispatchCoordinator(binding, f.adapter, f.journal).submit(input)).rejects.toThrow();
      expect(f.events).toEqual([]);
    }
  });
  it("rejects same-key changed content against recorded state before adapter I/O", async () => {
    const f = fixture(); const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal); await coordinator.submit(submission());
    const changed = submission(); changed.message.text = "different synthetic content"; changed.snapshot.payloadDigest = messageDigest("message", changed.message); f.events.length = 0;
    await expect(coordinator.submit(changed)).rejects.toThrow("operation_conflict"); expect(f.events).toEqual(["claim"]);
  });
  it("rejects wrong recorded owner or recipient before adapter I/O", async () => {
    for (const mutate of [(record: DispatchRecord) => { record.snapshot.binding.ownerId = "other"; }, (record: DispatchRecord) => { record.recipient.value = "+61400000001"; }]) {
      const f = fixture(); const input = submission(); const record: DispatchRecord = { snapshot: input.snapshot, recipient: input.message.recipient, state: "dispatching" }; mutate(record); f.stored = record;
      await expect(createDispatchCoordinator(binding, f.adapter, f.journal).submit(submission())).rejects.toThrow("operation_conflict");
      expect(f.events).toEqual(["claim"]);
    }
  });
  it("does not send after an admitted record changes original generation", async () => {
    const f = fixture(); const input = submission();
    vi.mocked(f.journal.beginDispatch).mockResolvedValue({ kind: "admitted", record: { snapshot: { ...input.snapshot, binding: { ...binding, generation: 2 } }, recipient: input.message.recipient, state: "dispatching" } });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(input)).toEqual({ status: "unknown" }); expect(f.adapter.submit).not.toHaveBeenCalled();
  });
  it("does not return a mismatched provider receipt as confirmed submitted", async () => {
    const f = fixture(); vi.mocked(f.adapter.submit).mockResolvedValue({ status: "submitted", receipt: { message: { binding: { ...binding, accountId: "other" }, id: "other" }, recipient: submission().message.recipient } });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(submission())).toEqual({ status: "unknown" });
    expect(f.stored?.state).toBe("unknown");
  });
  it("rejects a journal completion that differs from the submitted receipt", async () => {
    const f = fixture(); const input = submission(); const outcome = submitted();
    if (outcome.status === "submitted" && "message" in outcome.receipt) outcome.receipt.message.id = "different-receipt";
    vi.mocked(f.journal.complete).mockResolvedValue({ snapshot: input.snapshot, recipient: input.message.recipient, state: "completed", outcome });
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).submit(input)).toEqual({ status: "unknown" });
  });
  it("captures callbacks and clones request/port arguments before asynchronous boundaries", async () => {
    const f = fixture(); const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal); const input = submission();
    const originalClaim = f.journal.claim;
    vi.mocked(originalClaim).mockImplementationOnce(async request => {
      const recorded = structuredClone(request);
      request.snapshot.binding.ownerId = "mutated-port";
      input.message.text = "mutated caller"; input.message.recipient.value = "+61400000001";
      f.adapter.submit = vi.fn(async () => { throw new Error("replacement must not run"); });
      f.journal.beginDispatch = vi.fn(async () => { throw new Error("replacement must not run"); });
      return { kind: "claimed", token: "fixture-token", record: { ...recorded, state: "claimed" } };
    });
    expect(await coordinator.submit(input)).toEqual(submitted());
    expect(f.adapter.submit).not.toHaveBeenCalled(); expect(f.journal.beginDispatch).not.toHaveBeenCalled();
  });
  it("detaches public receipt objects from stored journal outcomes", async () => {
    const f = fixture(); const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal); const result = await coordinator.submit(submission());
    if (result.status === "submitted") result.receipt.recipient.value = "mutated public result";
    expect(await coordinator.submit(submission())).toEqual(submitted());
  });
});

describe("dispatch coordinator original historical lookup", () => {
  function recoveryFixture() {
    const f = fixture(); const input = submission();
    f.stored = { snapshot: input.snapshot, recipient: input.message.recipient, message: lookup().message, state: "unknown", outcome: { status: "unknown" } };
    vi.mocked(f.adapter.ready).mockResolvedValue({ status: "review", code: "reconnect" });
    return f;
  }
  it("recovers exact historical known message without readiness/claim/admission/send", async () => {
    const f = recoveryFixture();
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toEqual(submitted());
    expect(f.events).toEqual(["get", "lookup", "reconcile"]);
    expect(f.adapter.ready).not.toHaveBeenCalled(); expect(f.adapter.submit).not.toHaveBeenCalled(); expect(f.journal.claim).not.toHaveBeenCalled();
  });
  it("uses the journal recipient when public lookup omits correlation metadata", async () => {
    const f = recoveryFixture(); const request = lookup(); delete request.expectedRecipient;
    await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(request);
    expect(f.adapter.lookup).toHaveBeenCalledWith({ ...request, expectedRecipient: submission().message.recipient });
  });
  it("does not search provider without an original journal record", async () => {
    const f = fixture(); expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toBeNull(); expect(f.events).toEqual(["get"]);
  });
  it("does not search or resend unknown operations without a journal-verified message reference", async () => {
    const f = recoveryFixture(); const record = f.stored!; delete record.message; f.stored = record;
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toEqual({ status: "unknown" }); expect(f.events).toEqual(["get"]);
  });
  it("rejects a caller's changed original message/recipient before provider lookup", async () => {
    for (const mutate of [(request: ReceiptLookup) => { request.message!.id = "wrong"; }, (request: ReceiptLookup) => { request.expectedRecipient!.value = "+61400000001"; }]) {
      const f = recoveryFixture(); const request = lookup(); mutate(request);
      await expect(createDispatchCoordinator(binding, f.adapter, f.journal).lookup(request)).rejects.toThrow(); expect(f.events).toEqual(["get"]);
    }
  });
  it.each([null, { status: "unknown" }, { status: "waiting", code: "incomplete" }, { status: "review", code: "protocol" }] as const)("unconfirmed lookup does not overwrite the unknown journal (%#)", async outcome => {
    const f = recoveryFixture(); vi.mocked(f.adapter.lookup).mockResolvedValue(outcome);
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toEqual({ status: "unknown" });
    expect(f.journal.reconcile).not.toHaveBeenCalled(); expect(f.adapter.submit).not.toHaveBeenCalled();
  });
  it("a lookup response for another message remains unknown", async () => {
    const f = recoveryFixture(); const outcome = submitted(); if (outcome.status === "submitted" && "message" in outcome.receipt) outcome.receipt.message.id = "different";
    vi.mocked(f.adapter.lookup).mockResolvedValue(outcome);
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toEqual({ status: "unknown" }); expect(f.journal.reconcile).not.toHaveBeenCalled();
  });
  it.each([{ status: "rejected", code: "resource_not_found" }, { status: "skipped", operation: { binding, id: "generic-action" }, reason: "synthetic_skip" }] as const)("does not declare an uncertain send unaccepted from generic lookup outcome (%#)", async outcome => {
    const f = recoveryFixture(); vi.mocked(f.adapter.lookup).mockResolvedValue(outcome);
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toEqual({ status: "unknown" });
    expect(f.journal.reconcile).not.toHaveBeenCalled();
  });
  it("a failed reconciliation commit remains unknown", async () => {
    const f = recoveryFixture(); vi.mocked(f.journal.reconcile).mockRejectedValue(new Error("synthetic persistence loss"));
    expect(await createDispatchCoordinator(binding, f.adapter, f.journal).lookup(lookup())).toEqual({ status: "unknown" }); expect(f.journal.reconcile).toHaveBeenCalledTimes(1);
  });
});
it('reports only the failed coordinator boundary with unchanged uncertainty and no extra provider effects',async()=>{
 for(const boundary of ['claim','record','ready','preflight','begin','admitted_record','persist']as const){const f=fixture(),diagnostic=vi.fn(),error=Object.assign(Error('private body/token'),{code:'40001'});
 if(boundary==='claim')vi.mocked(f.journal.claim).mockRejectedValue(error);
 if(boundary==='record')vi.mocked(f.journal.claim).mockResolvedValue({kind:'claimed',token:'t',record:{snapshot:submission().snapshot,recipient:{kind:'phone',value:'+15559999999'},state:'claimed'}});
 if(boundary==='ready')vi.mocked(f.adapter.ready).mockRejectedValue(error);
 if(boundary==='preflight')vi.mocked(f.adapter.ready).mockResolvedValue({status:'ready',extra:'private'}as never);
 if(boundary==='begin')vi.mocked(f.journal.beginDispatch).mockRejectedValue(error);
 if(boundary==='admitted_record')vi.mocked(f.journal.beginDispatch).mockResolvedValue({kind:'admitted',record:{snapshot:submission().snapshot,recipient:{kind:'phone',value:'+15559999999'},state:'dispatching'}});
 if(boundary==='persist')vi.mocked(f.journal.complete).mockRejectedValue(error);
 expect(await createDispatchCoordinator(binding,f.adapter,f.journal,{diagnostic}as never).submit(submission())).toEqual({status:'unknown'});expect(diagnostic.mock.calls.some(([v])=>v.stage==='coordinator.'+boundary)).toBe(true);expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private');if(!['persist'].includes(boundary))expect(f.adapter.submit).not.toHaveBeenCalled();}
});
