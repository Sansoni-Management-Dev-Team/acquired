<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project safety rule

- Never run or apply a database migration without explicit user approval for that specific migration.

# Firmable credential renewal

- Obtain Firmable browser credentials from Chrome DevTools → Application → Storage → Cookies, not Local Storage.
- The `__client` cookie is under `https://clerk.firmable.com`; session cookies and `clerk_active_context` are under `https://app.firmable.com`.
- Validate renewal before updating local/benchmark credentials or reconnecting production. Keep raw credentials in ignored private files; never put them in these instructions or source control.

# Communications service and Unipile work

- When working on email, WhatsApp, LinkedIn, Unipile, or communications extraction, first read `docs/39-communications-service-execution-plan.md` and `docs/communications/progress.md`.
- Use the plan's task IDs and acceptance scenarios. Update progress, decisions, evidence, and the next action when stopping or handing off work; distinguish implemented, locally verified, live verified, and released work.
- Follow the plan's TDD workflow: demonstrate a relevant failing test before implementing new behavior or fixing a defect; protect behavior-preserving extraction with passing characterization tests before and after. Record the red/green evidence and handoff state.
- Keep existing connection methods available, preserve recorded connection ownership and unresolved-send handling, and never silently switch a campaign or send attempt to another backend.
- Planning is not authorization to execute the implementation, apply migrations, enable live sends, or deploy. Follow the user's current authorization and the specific migration approval rule above.
- Keep Unipile credentials in ignored private files. Never copy credential values into plans, logs, fixtures, or source control.
