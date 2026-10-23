# Shared AI and direct Anthropic release

Reviewed 2026-10-24. Scope P7.3/P7.4 and DBR-5/6. New worktree `project-acquire-anthropic`, branch `codex/anthropic-shared-ai`, starts at remote main c2de288 and merges reliability PR #20 through adc6b79. No migration is needed or applied.

The existing `src/adapters/ai/provider.ts` now exposes a single-attempt completion foundation for both native agent chat and outreach. HTTP payloads, error translation and provider token formats stay inside adapters. Agent calls reserve before inference, validate original schemas and model/accounting identity, then settle the original operation. Unknown outcomes remain uncertain, without retry or fallback. Completed cached operations can replay across a provider change only with identical semantic request/context/prompt; running or uncertain operations remain blocked. Approval, recipient, ownership and dispatch gates are unchanged.

Production configuration is intended to set `AGENT_AI_PROVIDER=anthropic` and `AGENT_DECISION_MODEL=claude-haiku-5-5`, with `ANTHROPIC_API_KEY` in restricted runtime configuration. No proxy/intermediary is used. Generic `AI_PROVIDER=anthropic` is supported independently. Research settings are deliberately unchanged.

## Reviewed contract and pricing

Official sources reviewed 2026-10-24:

- https://platform.claude.com/docs/en/models/haiku-5-5/overview
- https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://platform.claude.com/docs/en/api/service-tiers
- https://platform.claude.com/docs/en/about-claude/pricing

Haiku uses the fixed model ID `claude-haiku-5-5`. Requests use Messages with `output_config.format`, low effort, standard-only global inference, and no tools or explicit prompt caching. Unsupported grammar constraints move to descriptions; original schema validation still enforces lengths, exact route IDs, subjects and all application constraints. Invalid output is never repaired into an executable action.

Rates in USD per million tokens: uncached input 0.10; output 0.50; cache reads 0.01; five-minute writes 0.125; one-hour writes 0.20. Above 100,000 total input tokens, all rates are multiplied by five. The 64,000-input/2,000-output admission ceiling uses the most expensive short-context cache-write rate. Receipts retain total input including cache categories, output including thinking, and each reported cache duration. Anthropic does not report a separate reasoning count; none is fabricated. Integer micro-USD settlement rounds up once after summing categories. Each new operation records its pricing version and rates; historical OpenAI operations retain their original conservative accounting.

A missing/inconsistent receipt or mismatched model cannot authorize a model decision. Authentication, credits, rate limits, unsupported requests, transport, timeout, cancellation and invalid responses have fixed safe categories. Definite supported HTTP rejections settle zero money and one attempted call. Locally rejected requests without a positive provider receipt conservatively retain their reservation for reconciliation. No raw prompts, prospect messages, arbitrary provider bodies or credentials are logged.

## Other consumers and retained exceptions

`createAiProvider` continues serving existing generic drafting consumers and now supports Anthropic through the same completion foundation. Native chat/outreach no longer import OpenAI adapters or error types. `createResearchAi`, `OpenAiResearch`, OpenRouter/free-provider research and Cloudflare research retain their existing routing and bounded fallback behavior. Mandate generation and brief-scope extraction retain their existing research selection and explicit OpenAI fallback branches. Those historical flows have different budgets and paid-fallback semantics; changing them in this release would alter research behavior. They still share the existing low-level OpenAI adapter and are not silently switched to Anthropic by agent configuration. Research/OpenAI quota availability remains a separate limitation.

## Evidence and rollout

Before extraction, 28 existing OpenAI/chat/outreach characterization tests passed. Shared completion tests failed 5/5 before the entry point existed; Anthropic selection failed 1/4 before integration; tracing metadata failed 1/5 before allowlist support. Pricing/store tests first passed legacy characterization, then demonstrated new capability failures. Unpriceable-response tests failed before callers rejected these decisions. Adapter request fields, null usage and cancellation had additional observed red/green cycles.

A real direct Haiku synthetic compatibility test passed for both full native chat and outreach schemas in about 10 seconds. This used mock budget stores and synthetic content only; it is not production integration or delivery evidence. The opt-in test is `RUN_ANTHROPIC_SYNTHETIC=true ...vitest run src/adapters/ai/anthropic-live.integration.test.ts`; the ignored private credential file is never loaded by ordinary test runs.

Final full-suite, deployment and normal demo acceptance results are recorded in communications/progress.md. A healthy endpoint or model response does not establish simulator message/reply acceptance.

## Rollback

Direct deployment retains the previous image, runtime and compose files under `/opt/acquire-app/ops/app/releases/`. Restore those three files and run `docker compose -f compose.hosted.yml up -d --wait --wait-timeout 120`, then authenticated readiness and campaign readiness checks. Do not alter data or reconcile uncertain operations by retrying them. The pre-release image is `acquire-app:dispatch-checkpoints-20261024`; its OpenAI credits were exhausted, so rollback restores that functional limitation too. Never prune either release image during acceptance. Restore only this release's temporary operator-IP SSH rule afterward.
