# Normal Acquire demo canary

`scripts/acquisition-demo-canary.mjs` exports `runAcquisitionDemoCanary` for injected HTTP/persistence tests and provides an opt-in CLI. It uses normal authenticated Acquire workflow, execution, demo preparation, review, and operation-display routes. It does not call the simulator directly, use database credentials, alter freshness limits, or force channel timing.

```sh
node scripts/acquisition-demo-canary.mjs --execute \
  --origin https://acquire.mlai.au \
  --request-id YOUR-STABLE-UUID \
  --cookie-file /absolute/path/.local-data/canary/acquire-cookie.txt \
  --evidence-dir /absolute/path/.local-data/canary/run
```

The cookie file must contain only the Acquire session cookie header, without a newline inside the value. Never commit it. Use a fresh evidence directory for a genuinely new request; preserve the directory and request UUID when resuming. The script creates a demo only if that exact request has no saved workflow, and refuses to generate replacement phase keys for an existing responsibility.

The default acceptance channel is email. `--require-channels email,whatsapp,linkedin` is only appropriate when the normal configured workflow actually produces messages on all three channels; a reply may correctly stop later channels. The canary does not bypass that behavior. Output distinguishes `verifiedChannels` from `allThreeChannelsVerified`.

It can approve one contact selection and at most five initial-message operations. It does not approve replies, follow-ups, booking links, or connection requests. Only exact owned pending manifests are approved. Each accepted result requires a submitted provider-message receipt and saved inbound text on that channel dated at or after submission; old history alone does not pass.

Before every mutation, immutable request data is saved in `state.json`. Transport failure, invalid JSON, invalid success receipt, or server error leaves an unresolved marker and stops. A subsequent invocation refuses further mutations until that receipt has been inspected and reconciled separately. It never automatically retries an ambiguous send or approval. Explicit HTTP errors stop immediately. Stage evidence is append-only and contains paths/statuses, not cookie values or message bodies. Treat the entire evidence directory as private.

An exclusive `run.lock` prevents concurrent CLI observers sharing one evidence directory. An interrupted process may leave that lock; inspect saved mutation state before removing it manually.

The run is bounded to ten minutes by default (the exported runner permits a maximum of fifteen), with 45-second individual request deadlines and 30-second polling. Stopping the observer does not cancel already-approved background work.

Local verification: `node --test scripts/acquisition-demo-canary.test.mjs` passes ten mock-HTTP scenarios, including new admission, resume, three-channel receipts, email-only default, ownership rejection, approval cap, authentication/malformed responses, ambiguous mutation recovery, and old inbound rejection. These tests make no live API, database, or local simulator requests. Hosted end-to-end acceptance must be recorded separately.
