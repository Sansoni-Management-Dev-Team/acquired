# Free research AI

Business extraction, people extraction, headcount extraction and follow-up planning
use `src/adapters/ai/free-openrouter.ts` in both Node and the research Worker.
No Workers AI binding is present in the research Worker.

The ordered research candidates are NEX N2.5 Pro, NEX N2.5 Mini, then Nemotron 3 Super.
OpenRouter's `models` routing tries the next candidate when a provider is unavailable
or overloaded. The list is explicit: no automatic model discovery, paid fallback,
web-search plugin or arbitrary model override. Zero input/output price ceilings
also apply. Provider data collection is denied. An account's privacy settings can
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
advertised effort levels do not include `none`. Research uses `medium`, which all
three research candidates support. Model usage logs contain no draft or page text.

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

Each logical model call uses one HTTP request with server-side model fallback;
this counts against the Worker's external request budget. OpenRouter's internal
provider attempts are not individually exposed by this adapter. The request has
a 45-second deadline within the 60-second workflow step. Output has a 2,048-token
minimum allowance so reasoning models have room to return JSON.

Authentication errors, account-wide quota exhaustion, unavailable free endpoints,
timeouts, truncated responses or invalid schemas fail closed. There is no local
retry loop to multiply account-level rate-limit failures. The research runner
retains evidence and uses its existing predefined planner fallback when needed.
This is not an account-wide rate limiter: concurrent workflows share OpenRouter's
free request allowance and may still hit it. Changing models cannot bypass it.

Worker `research-ai` log events contain only job ID, model, usage, cost and elapsed
time. Prompts, source text and credentials are not logged. The existing outreach
adapter is unchanged and may use a separately configured paid model.

References: [model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[rate limits](https://openrouter.ai/docs/api/reference/limits).
