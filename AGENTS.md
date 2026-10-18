<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project safety rule

- Never run or apply a database migration without explicit user approval for that specific migration, except for the scoped standing permission below.

## Standing permission for the isolated agent build

The user explicitly granted this exception on 17 October 2026, overriding the per-migration approval rule only for this target:

- Create and apply migrations needed for the agent build in `/Users/callum/Documents/Development/project-acquire-agent-mode` only on database `acquire_agent_mode` at `127.0.0.1:5437`, with database marker `acquire-agent-mode-local-only`.
- Verify the exact database identity/marker before application, keep applied migration files immutable, and record reviewed hashes and application/test evidence.
- This is standing approval for that isolated database: do not ask for per-migration approval again within this scope.
- Other databases, production deployment and live sending still require separate approval. This exception does not authorize changing the main/shared database or another worktree.


# Firmable credential renewal

- Obtain Firmable browser credentials from Chrome DevTools → Application → Storage → Cookies, not Local Storage.
- The `__client` cookie is under `https://clerk.firmable.com`; session cookies and `clerk_active_context` are under `https://app.firmable.com`.
- Validate renewal before updating local/benchmark credentials or reconnecting production. Keep raw credentials in ignored private files; never put them in these instructions or source control.

# Communications service and Unipile work

- When working on email, WhatsApp, LinkedIn, Unipile, or communications extraction, first read `docs/39-communications-service-execution-plan.md` and `docs/communications/progress.md`.
- Use the plan's task IDs and acceptance scenarios. Update progress, decisions, evidence, and the next action when stopping or handing off work; distinguish implemented, locally verified, live verified, and released work.
- Follow the plan's TDD workflow: demonstrate a relevant failing test before implementing new behavior or fixing a defect; protect behavior-preserving extraction with passing characterization tests before and after. Record the red/green evidence and handoff state.
- The user's 2026-10-13 scope change moves direct Gmail, Baileys WhatsApp and browser LinkedIn into the independent `../legacy-channel-services` repository and removes those executable connection methods from Acquire. Preserve their logic/tests before removal, recorded historical connection ownership and unresolved-send handling; never silently switch a campaign or send attempt to another backend. Historical schema/data cleanup is not authorized by code extraction.
- Planning is not authorization to execute the implementation, apply migrations, enable live sends, or deploy. Follow the user's current authorization and the specific migration approval rule above.
- Keep Unipile credentials in ignored private files. Never copy credential values into plans, logs, fixtures, or source control.


## Audit fix fork ownership — 2026-10-18

Read [BRANCHES.md](BRANCHES.md) before working here. This is an isolated source-only audit fork. The original worktrees and their current runtime/tests remain owned by the other thread. Do not run copied Compose/OrbStack launchers or apply migrations against their databases from this fork. No fork runtime identity, database or ports have been allocated. Keep changes on this lane's fix branch and leave integration until the original tests finish and the source snapshots are reconciled.
