# Direct Gmail adapter boundary

`createGmailAdapter` wraps an injected Gmail mailbox and optional draft port. The adapter has no Acquire, Next.js, database, environment, credential or HTTP dependency. Existing OAuth/token refresh and Gmail MIME/history implementations remain in their existing runtime during this transition.

The factory returns the shared `MessagingAdapter` operations plus `binding`, truthful `capabilities` and optional `drafts`. It accepts only a direct Gmail email connection. Send readiness is checked independently of reply-history coverage; this adapter advertises no event/history capability because it does not yet implement normalized reads.

Inject the core's `messageDigest` and, when drafts are enabled, `draftDigest`. The adapter verifies the recorded binding, operation, payload digest and thread/draft/message references before calling a port. Update/delete digests include the target draft. Inputs are copied before awaiting readiness so external changes cannot alter a validated submission.

This adapter has `durableIdempotency: false`; it creates no journal. Acquire/service admission and unresolved-operation policy must retain their authoritative journal. Repeatedly calling `submit` itself can send repeatedly. Definite Gmail rejection classification can be injected at the application boundary. Unclassified send failures and invalid post-send receipts remain unknown and never trigger retry, lookup or backend fallback inside the adapter. A requested conversation whose returned thread differs remains unknown after submission.

Receipt lookup uses the original recorded binding and read-only RFC/message-ID correlation metadata. The expected recipient comes from recorded operation metadata, and must be supplied to construct a scoped receipt. It is not an independently verified provider-recipient claim when the legacy port returns only IDs. The adapter preserves supplied provider timestamps and leaves unavailable timestamps absent. Lookup never calls send or account readiness. Missing or insufficient lookup data returns `null`; the caller must retain its unresolved operation.

Draft create/update/delete never invoke messaging submission. Readiness failures surface as `GmailReadinessError`, carrying the shared waiting/review result. Provider errors propagate for draft operations; the enclosing service must apply draft journaling/reconciliation policy rather than assuming an error means no change was made.

Example composition:

```ts
const gmail = createGmailAdapter({
  binding,
  mailbox: existingMailbox,
  drafts: existingMailbox,
  readiness: checkExistingConnection,
  messageDigest,
  draftDigest,
  classifyFailure: classifyDefiniteGmailRejection,
});
```

This boundary has fixture/local verification. It is not wired into Acquire dispatch yet, and does not certify OAuth, provider compatibility, complete reply history, journal persistence or production rollout.
