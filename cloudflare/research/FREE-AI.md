# Free-first research AI with Mercury fallback

Business extraction, people extraction, headcount extraction and follow-up planning
use `src/adapters/ai/free-openrouter.ts` in both Node and the research Worker.
No Workers AI binding is present in the research Worker.

The ordered research candidates are NEX N2.5 Pro, NEX N2.5 Mini, then Nemotron 3 Super.
OpenRouter's `models` routing tries the next candidate when a provider is unavailable
or overloaded. The free stage has a zero-price ceiling. After that stage fails
with a quota/capacity/transport or invalid-output error, one request to
`inception/mercury-2.5` is allowed. No other paid model, web-search plugin or
arbitrary model override is permitted. Mercury has a separate price ceiling of
$0.04/M input and $0.15/M output tokens, matching its current promotional rate;
it fails closed if that rate increases. Provider data collection is denied. An account's privacy settings can
exclude a candidate; this does not change those settings.

Set `OPENROUTER_API_KEY` as a secret on `acquire-research`. This is independent of
the existing outreach drafting provider and its model configuration.

## Local verification

The local Next.js application can use this same provider for draft generation:

```dotenv
AI_PROVIDER=openrouter-free
OUTREACH_DRAFTING_PROVIDER=ai
OPENROUTER_API_KEY=your-key
```

Keep the key in `.env.local` and restart the development server after changing it.
This mode ignores `OUTREACH_AI_MODELS`, including any paid fallback in that list.
Selecting `AI_PROVIDER=openrouter` explicitly restores the separate configurable
outreach provider. This switch does not start a local research workflow worker;
research dispatch is configured separately through `RESEARCH_WORKER_URL`.

`pnpm dev` now configures and starts both local services automatically; see
[local development](../../docs/27-local-research-and-ai.md). Free drafting uses
NEX Mini then NEX Pro with reasoning disabled and an additional 2,048 output tokens
for the seven-message sequence. Nemotron is excluded from drafting because its
advertised effort levels do not include `none`. Business/people extraction,
headcount and follow-up planning also disable reasoning and use NEX Pro then NEX
Mini. This keeps reasoning from consuming the bounded extraction output budget;
Nemotron is excluded from these requests because it does not support `none`.
Model usage logs include truncated completions and contain no draft or page text.
Safe AI error reasons are retained in research page history, including token-limit,
timeout, schema and HTTP failures; raw provider error bodies are never exposed.

Put the key in `.env.local` or export it, then run:

```sh
node scripts/test-free-research.mjs
```

This opt-in test uses the production prompts and source validators on fictional
business text. It checks named roles, unpublished email, customer exclusion,
explicit and unknown headcount, and bounded follow-up selection. It reports the
actual answering model, token usage, elapsed time and reported cost. It does not
write to the database or call Cloudflare. Ordinary `pnpm test` skips live calls.

For local Crawl4AI research harnesses, inject `FreeOpenRouter.complete` wherever
the runner expects model extraction/planning; it accepts the same messages and
JSON schemas as the Worker. The `{response}` result keeps the existing evidence
validators in place. A structurally valid response still must pass those validators.

## Limits and failure behaviour

Each logical model call makes at most two external requests: one to the free pool,
then (only on eligible failure) one to Mercury. Each attempt increments the Worker
request budget. Both attempts share a 45-second deadline; the free attempt gets
at most 25 seconds when fallback is enabled. Output has a 2,048-token minimum.

Authentication, policy, bad-request and insufficient-credit failures do not
trigger paid inference. There are no further retries after Mercury. All responses
still undergo JSON-schema and source-evidence validation. Unit tests can explicitly
set `paidFallback: false` to exercise free-only behavior. The existing
`AI_PROVIDER=openrouter-free` configuration name is retained for compatibility;
its preset now includes the single named paid fallback.

`node scripts/test-free-research.mjs --mercury` simulates free quota exhaustion and
runs real Mercury calls against the same fictional business, people, size,
planning and draft checks. These tests incur the logged Mercury token charges.

Worker `research-ai` log events contain only job ID, model, usage, cost and elapsed
time. Prompts, source text and credentials are not logged. The shared local outreach adapter uses the same fallback policy.

References: [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[rate limits](https://openrouter.ai/docs/api/reference/limits).
