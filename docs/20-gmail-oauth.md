# Gmail via Google OAuth — draft and send from the user's own mailbox

Written 26 Aug 2026, against the brief in `01-understanding.md` and the Gmail question left open
at C4/D7 in `02-questions-for-mark.md`. No application code exists in this repo yet, so this is
the integration design and the decision it forces, not an implementation note.

## What this changes about the brief

The brief has Gmail as *"inbound reply capture. Deferred, adapter only"*, and M0 criterion 6 is
*"Outreach drafting works; nothing sends"*. Connecting a user's Gmail so we can draft and send on
their behalf moves Gmail from a deferred adapter to a live connector with a Google verification
dependency on it.

It does **not** break the human-gate constraint. "The system drafts, a person releases" survives
intact — the release action now results in an actual `messages.send` call against the user's
mailbox instead of a state change in our database. What it does break is the assumption that
Gmail can be scheduled late: verification is a calendar dependency measured in weeks, not a
sprint task, and the security assessment variant is measured in months and thousands of dollars.
That is the reason this document exists.

## The finding that drives everything

Google splits OAuth scopes into non-sensitive, **sensitive**, and **restricted**. The Gmail scopes
do not split the way most people assume:

| Scope | Grants | Tier |
|---|---|---|
| `gmail.send` | Send messages. No read access of any kind. | **Sensitive** |
| `gmail.compose` | Create, read, update, delete drafts **and** send | **Restricted** |
| `gmail.readonly` | Read messages and settings | **Restricted** |
| `gmail.modify` | Read, compose, send, label | **Restricted** |
| `gmail.metadata` | Headers and labels, no bodies | Sensitive |
| `https://mail.google.com/` | Everything, including permanent delete | **Restricted** |

Both tiers require app verification — brand review, a published privacy policy on a verified
domain, a demo video, narrowest-scope justification. Restricted adds one more thing:

> "Apps requesting access to restricted scopes must meet the additional requirement of secure
> data handling by submitting to an **annual security assessment**."

That is CASA, performed by a Google-authorised third-party assessor, repeated every year, priced
in the low-to-mid thousands of dollars at Tier 2 and rising with scope. For a build whose first
milestone is a Friday deadline with two accounts on it, that is not a line item — it is a
different project.

So the fork is sharp, and it is not where you would guess. **Writing a draft into the user's
Gmail drafts folder costs more than sending the email outright.** `gmail.compose` is restricted;
`gmail.send` is not.

## Recommendation

Ship `https://www.googleapis.com/auth/gmail.send` and nothing else, plus the two identity scopes
(`openid`, `email` — `userinfo.profile` only if we display a name and avatar).

Consequences, stated plainly:

- Drafts live in our database, reviewed in our UI, exactly as the prototype's outreach stage
  already models them. They never appear in the user's Gmail Drafts folder. This is a real
  product loss — some users will want to hand-edit in Gmail — and it is worth roughly the cost of
  an annual CASA assessment to avoid, so we take the loss.
- Sent messages **do** appear in the user's Sent folder and thread correctly, because Gmail files
  anything sent through the API into the account normally. Replies land in the user's inbox where
  they expect them.
- We get zero read access. We cannot see the reply. That is the next section.
- `gmail.send` alone is a genuinely narrow ask, which is also the thing Google's verification
  reviewers grade hardest on. A single-scope submission with a clean demo video is the fastest
  path through the queue.

## Reply capture without restricted scopes

Reply capture is the actual reason the brief listed Gmail in the first place, and every Gmail API
route to it — `readonly`, `modify`, `users.watch` with Pub/Sub push — is restricted. Two ways
around it:

**Reply-To routing (recommended).** Send with `Reply-To: deal-<threadId>@reply.<ourdomain>` and
receive at an inbound-parse endpoint on our own MX (Postmark inbound, SES + SNS, Cloudflare Email
Workers — all AU-routable or AU-hostable). The seller replies; the reply reaches the buyer's
inbox never, or reaches ours and is forwarded on. We parse it, thread it, and the deal status
ladder advances on real evidence. No Gmail read scope, no CASA. Cost: the `Reply-To` header is
visible, and a header that does not match the From address is a mild deliverability and
credibility signal on cold outreach. Mitigate by using a subdomain of the sending domain where
the user has one, and by keeping the display name identical to the From.

**BCC capture.** BCC every outbound to an ingest address, which gives us the outbound record but
not the reply. Useful as a belt-and-braces audit trail for the evidence panel; not a substitute.

If a design partner insists on true inbox sync later, that is the moment to price CASA — and by
then there is a bank security review in flight anyway, so the two assessments should be scoped
together rather than sequentially.

## Architecture

Same adapter discipline as everywhere else in this build. One interface, two implementations,
interchangeable:

```
MailboxAdapter
  connect(userId) -> authUrl
  status(userId)  -> { connected, address, scopes, expiresAt }
  send(userId, { to, subject, html, text, replyTo, inReplyTo, references })
      -> { providerMessageId, providerThreadId, sentAt }
  disconnect(userId)
```

`MockMailbox` writes to a table and returns a fake id — this is what M0 runs on and what every
test runs on, per "no real personal data in dev/test". `GmailMailbox` calls
`users.messages.send` with a base64url RFC 2822 payload. A future `OutlookMailbox` implements the
same three methods against Microsoft Graph `Mail.Send`, which is worth knowing now because a
meaningful share of Australian SME buyers are on Microsoft 365 and the interface should not have
Gmail's shape baked into it.

**Flow.** Authorisation code with PKCE, `access_type=offline`, `prompt=consent` on first connect
so a refresh token is actually issued, `state` carrying a signed, short-lived nonce bound to the
session, `login_hint` set to the user's known address so they land on the right account. The
callback exchanges the code server-side; the client never touches a token.

**Token storage.** Refresh tokens are long-lived credentials to a person's mailbox and should be
treated as the most sensitive rows in the database. Envelope-encrypt with a KMS-held key, store
ciphertext plus key version, never log them, never return them over the API, and give the record
its own table with column-level access separate from the user row. Access tokens are cached in
memory or a short-TTL store, not persisted. Handle `invalid_grant` as a first-class product state
— the user revoked access, changed password, or the token aged out — and surface "reconnect
Gmail" in the UI rather than failing a send silently.

Note that while the app is in Testing (pre-verification) refresh tokens expire after **seven
days** and the app is capped at 100 test users. That is fine for two accounts and a design
partner, and it is a trap if nobody knows about it, because it looks exactly like a bug.

**Provenance.** Per the "evidence or nothing" rule, a send writes `providerMessageId`,
`providerThreadId`, the authenticated sending address, the exact rendered body, and the approving
user's id to the audit trail. The outreach stage should be reconstructable from the record alone.

## Compliance, in three parts

**Google Limited Use.** The policy prohibits *"transferring, selling, or using user data to
create, train, or improve a machine learning or artificial intelligence model beyond that specific
user's personalized model"*, and restricts human reading of user data without documented explicit
consent. This build sends every draft through Claude, so the Anthropic side needs to be on
no-training terms and that needs to be stateable in the verification submission. Note that with
`gmail.send` only, the content we send Claude is content we composed, not content read out of the
user's mailbox — which is another quiet argument for the narrow scope. The moment reply bodies
enter a prompt, this clause is live.

**Spam Act 2003 (Cth).** More binding on this product than the OAuth policy is, and not addressed
anywhere in the docs so far. Commercial electronic messages to Australian addresses require
consent, accurate sender identification, and a functional unsubscribe honoured within five
working days. Cold outreach to business owners runs on *inferred* consent — Schedule 2 of the Act
allows it where a work-related address has been conspicuously published without a statement that
unsolicited commercial email is unwelcome, and the message is relevant to that person's role.
That is a real basis and a narrower one than people assume: a published address carrying "no
unsolicited email" defeats it outright, ACMA's 2024 statement of expectations pushes businesses
towards express consent, and the burden of proving consent sits with the sender. Practical requirements on the build: an
unsubscribe mechanism in every template, a suppression list checked at send time and not
bypassable by the approve gate, and the sender's real identity in the footer. Question D-open from
`02-questions-for-mark.md` — who is the sender of record, the buyer or the platform — is a
Spam Act question before it is a technical one, and sending from the user's own Gmail answers it
usefully: the buyer is the sender, the platform is the tool.

**Data sovereignty.** Flagged as important in the kickoff notes. Gmail content is Google-hosted
and not in scope for AU residency; what we control is our side. Tokens, message records and
parsed replies stay in the AU region (`australia-southeast1` / `ap-southeast-2`) with the rest of
the stack. Worth writing down before the bank's security review asks, along with the fact that
`gmail.send` means we hold no copy of the user's existing mail at all — the strongest possible
answer to that question is that the data was never ingested.

## Operational limits

Sending through a user's own mailbox inherits that mailbox's limits: roughly 500 recipients per
day on consumer Gmail, 2,000 on Workspace, with lower thresholds for newly created accounts.
Google will also rate-limit or temporarily suspend an account that suddenly starts sending
templated mail to strangers. Given the outreach volumes implied by a sourcing pipeline, the build
needs per-account daily caps configured below Google's, a send queue with jitter rather than a
burst, and hard visibility when a user is approaching their ceiling. This is a feature, not a
guardrail we can leave to the API to enforce.

## What I would build, and when

| | Work | Gate |
|---|---|---|
| Now (M0) | `MailboxAdapter` interface, `MockMailbox`, drafts and approval in-app, suppression list, unsubscribe footer | None — this is the criterion-6 behaviour already agreed |
| Now, parallel | Google Cloud project, consent screen, `gmail.send` only, privacy policy page, demo video, submit for verification | Nothing blocks it and the queue is the long pole |
| On verification | `GmailMailbox`, connect/disconnect UI, token store, reconnect flow, per-account send caps | Verification granted |
| Next | Reply-To inbound parse, thread reconstruction, status ladder advancing on real replies | Inbound domain and MX |
| Only if forced | Restricted scopes, CASA assessment, true inbox sync or Gmail-native drafts | A design partner requirement that survives being told the price |

## Open decisions

- **Sender of record.** Buyer's own mailbox (recommended, and what this design assumes) versus a
  platform-operated domain. Changes deliverability, the Spam Act analysis, and whether Gmail OAuth
  is needed at all.
- **Gmail Drafts folder.** Confirm with Mark that in-app drafts satisfy the intent of C4. If the
  answer is genuinely "it must land in their Gmail drafts", that is a restricted scope and a CASA
  budget line, and it should be priced against D6 rather than absorbed.
- **Workspace versus consumer accounts.** If the design partners are all on Workspace domains,
  Marketplace listing and admin-level install become options worth comparing against per-user
  consent.
- **Outlook.** The notes list email, WhatsApp and LinkedIn as live channels. If Microsoft mailboxes
  are in scope for V1, the adapter should be validated against Graph before the Gmail
  implementation hardens around Gmail-specific assumptions.

## Sources

- [Gmail API OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) — scope
  tiers, including `gmail.compose` as restricted and `gmail.send` as sensitive
- [OAuth app verification requirements](https://support.google.com/cloud/answer/13464321) —
  annual security assessment for restricted scopes
- [Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
  — Limited Use, human review, AI/ML training restrictions
- [Avoid sending spam — ACMA](https://www.acma.gov.au/avoid-sending-spam) and
  [Consent expectations for businesses using direct marketing — ACMA](https://www.acma.gov.au/articles/2024-06/consent-expectations-businesses-using-direct-marketing)
