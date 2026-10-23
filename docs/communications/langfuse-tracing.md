# Langfuse tracing

Acquire exports explicit server-side spans through Langfuse JS SDK6.0.2. Next.js registers the exporter from `src/instrumentation.ts`. No schema change is required.

Set these private runtime variables:

```dotenv
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=<project public key>
LANGFUSE_SECRET_KEY=<project secret key>
LANGFUSE_TRACING_ENVIRONMENT=production
LANGFUSE_RELEASE=<released source revision>
```

Credentials automatically enable tracing unless `LANGFUSE_ENABLED=false`. Missing credentials disable tracing. Builds do not initialize it. The keys are server-only; never use `NEXT_PUBLIC_` names. Restart the persistent app after changing runtime configuration. The user's supplied keys are saved in ignored mode0600 `.env.local` files in the main and tracing worktrees; they are not committed or installed on the production Droplet by this change.

The dependency lock uses the latest Langfuse6.0.2 and compatible OpenTelemetry2.12.0 / Node SDK0.223.0 / API1.9.1. OpenTelemetry Node0.300.0 uses a different major and conflicts with Langfuse's current core peer contract. Explicit peer dependencies prevent the package manager from choosing that incompatible combination. The new protobuf dependency's install script is disabled; no new dependency build script was approved or executed.

## What is recorded

- Native worker scope/handler, history reads, coverage revalidation, decisions, prepare/submit, original receipt lookup and capture.
- Hosted callback kind, generated request ID, HTTP status and fixed outcome.
- Hosted RPC path names, HTTP status and failure stage.
- Access pool acquisition, membership/run/registration checks and transaction stages.
- One generation per actual OpenAI structured completion: model name, input/output/cache token usage and request-size counts. Cached tokens are separated from uncached input rather than counted twice. Research fallbacks remain separate actual generations.
- Opaque existing mandate/conversation/event/operation IDs, event kind and channel. Conversation UUID is the Langfuse session ID; no personal user identity is exported.

The OpenAI adapter uses raw HTTP, not an OpenAI/Vercel AI SDK client, so explicit generation instrumentation covers its real call boundary. No framework-specific wrapper is added that could duplicate calls or automatically capture prompts.

## Data and lifecycle boundaries

Only bounded, allowlisted metadata is recorded. Inputs/outputs intentionally contain structural counts, IDs and outcomes instead of prospect/buyer data. Prompts, source text, real/reserved addresses, phone numbers, names, message bodies, cookies, authorization headers, credentials, SQL parameters and raw exception messages/stacks are excluded. Exceptions are caught inside the SDK observation and rethrown afterward unchanged; this avoids SDK automatic error-content capture. The exporter also applies masking and accepts only explicit `acquire.*` Langfuse spans. Automatic resource detection and general HTTP/database instrumentation are disabled.

Tracing is non-authoritative. It cannot approve a message, renew authority, bypass history, resubmit an unknown effect, replace an exception or turn a failed operation into a success. The shared communications package exposes only an optional process-local port; it has no Langfuse credential/framework/exporter dependency. Work executes once even if tracing fails before or after entering it.

The persistent Next process batches exports asynchronously every second with a five-second exporter request timeout. Short-lived diagnostic scripts explicitly call `flushAcquireTelemetry()` and `shutdownAcquireTelemetry()`. Ordinary admission/callback paths never await a network flush. Abrupt termination may lose an unexported batch; traces are diagnostics, while original application/service journals remain authoritative.

This change instruments Acquire. The independent hosted simulator must adopt the shared optional port or its own compatible exporter to expose its internal SQL/worker spans. An Acquire HTTP error span alone cannot identify every simulator-side SQL failure, and this change does not claim cross-process trace propagation through an uninstrumented service.

## Verification

Executed tests cover exactly-once effects despite tracing failure, unchanged original exceptions, no automatic retry, metadata/getter/PII exclusion, optional initialization, generation typing/usage, correct agent typing, retained unknown outcomes and HTTP error classification. The two dispatch classification cases executed RED before their fixes, then GREEN. The first new port suite initially failed at its missing entrypoint; that was a missing-module failure, not an executed behavioral assertion.

Actual Langfuse project authentication passed. A private integration script exercised the normal hosted history RPC and one tiny synthetic OpenAI request, with no outreach or database migration. The final standalone trace has four nested observations in environment `integration-test`, session tied to the original diagnostic conversation, service name `acquire`, and genuine model usage44input/11output tokens. The first trace captured hosted history401; the next history read passed. Neither is a send/reply acceptance test. Returned observation payloads were inspected via the current v2 observations CLI for hierarchy, model, usage, session/environment, service name and exclusion of credentials/content. Private evidence is `.local-data/langfuse/`.

Follow [the RCA](hosted-retry-rca-2026-10-23.md) for the separate hosted authorization/locking defects. Instrumentation does not repair or bypass them. Production activation and any simulator instrumentation remain distinct release tasks.
