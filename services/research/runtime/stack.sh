#!/usr/bin/env bash
# One Compose entry point for the existing local and DigitalOcean test stacks.
set -euo pipefail
service_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${RESEARCH_RUNTIME_ENV:-$service_dir/runtime.env}"
# Release pins come from the shared file, never incidental shell overrides.
unset RESEARCH_IMAGE READER_IMAGE SEARCH_IMAGE DATABASE_IMAGE READER_SOURCE_SHA256 OPENAI_RESEARCH_MODEL OPENAI_RESEARCH_FALLBACK_MODEL
compose=(docker compose --env-file "$service_dir/runtime/release.env" --env-file "$profile" -f "$service_dir/deploy/compose.yml")
if [[ -n "${RESEARCH_RUNTIME_OVERRIDE:-}" ]]; then compose+=(-f "$RESEARCH_RUNTIME_OVERRIDE"); fi
if [[ "${1:-}" == up ]]; then
  "${compose[@]}" config --quiet
  pending=$(printf '%s\n' "SELECT count(*) FROM dbos.workflow_status WHERE status IN ('PENDING','ENQUEUED','DELAYED');" | "${compose[@]}" exec -T database sh -c 'exec psql -XqAt -U "$POSTGRES_USER" -d "$POSTGRES_DB"')
  if [[ "$pending" != 0 ]]; then
    echo 'Research workflows are still active. Drain dispatch before changing the runtime.' >&2
    exit 1
  fi
  # Close the ownership connection before Compose replaces the task network.
  "${compose[@]}" stop research
fi
exec "${compose[@]}" "$@"
