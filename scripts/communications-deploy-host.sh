#!/usr/bin/env bash
# Dedicated host rollout only. Never initializes a database or changes runtime keys.
set -Eeuo pipefail
umask 077
release=${1:?Release directory required}
revision=${2:?Commit required}
mode=${3:-deploy}
[[ $# -le 3 && ( "$mode" == deploy || "$mode" == --rollback ) ]] || { echo 'Invalid communications rollout mode'; exit 1; }
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid communications revision'; exit 1; }
# Reset this invocation's receipt before artifact, configuration or storage preflight.
if [[ "$mode" == deploy ]]; then
 rm -f "$release/service-deployment-changed"
 printf 'false\n' > "$release/service-deployment-changed"
fi
[[ "$(cat "$release/commit")" == "$revision" ]] || { echo 'Communications release revision mismatch'; exit 1; }
image="acquire-communications:github-$revision"
expected=$(cat "$release/service-archive-sha256")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid communications archive checksum'; exit 1; }
actual=$(sha256sum "$release/image-communications.tar.gz" | cut -d' ' -f1)
[[ "$actual" == "$expected" ]] || { echo 'Communications archive checksum mismatch'; exit 1; }
test -s "$release/service-compose.production.yml"
test -s "$release/communications-deploy-schema-preflight.mjs"
cd /opt/acquire-app/ops/communications/service
export COMPOSE_FILE=compose.production.yml
# Same lock as app rollout; this process releases it before app rollout starts.
exec 9>/opt/acquire-app/deploy.lock
flock -w 120 9
test -s .env.production
test ! -L .env.production
[[ "$(find .env.production -prune -type f -perm 0600)" == '.env.production' ]] || { echo 'Communications runtime file must be private'; exit 1; }
if [[ "$mode" == --rollback ]]; then
 backup=$(cat releases/current-backup)
 [[ "$backup" =~ ^releases/$revision-[0-9]+-[0-9]+$ ]] || { echo 'Invalid communications rollback snapshot'; exit 1; }
else
 backup="releases/$revision-$(date +%s)-$$"
fi
restore_service() {
 local had_image had_compose
 had_image=$(cat "$backup/image-present")
 had_compose=$(cat "$backup/compose-present")
 if [[ "$had_image" == true ]]; then
  cp "$backup/previous-image.env" .env
  cp "$backup/previous-compose.yml" compose.production.yml
  docker compose up -d --wait --wait-timeout 120 || return 1
  docker compose exec -T communications node healthcheck.mjs || return 1
 else
  docker compose rm --stop --force communications || return 1
  rm -f .env
  if [[ "$had_compose" == true ]]; then cp "$backup/previous-compose.yml" compose.production.yml; else rm -f compose.production.yml; fi
 fi
 if [[ -f "$backup/previous-commit" ]]; then cp "$backup/previous-commit" releases/current-commit; else rm -f releases/current-commit; fi
 if [[ -f "$backup/previous-backup" ]]; then cp "$backup/previous-backup" releases/current-backup; else rm -f releases/current-backup; fi
}
if [[ "$mode" == --rollback ]]; then
 [[ "$(cat releases/current-commit)" == "$revision" ]] || { echo 'Communications rollback revision no longer current'; exit 1; }
 restore_service
 echo "Restored communications release preceding $revision"
 exit 0
fi
mkdir -p releases
chmod 700 releases
gzip -dc "$release/image-communications.tar.gz" | docker load
[[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$revision" ]] || { echo 'Communications image revision mismatch'; exit 1; }
# Validates actual constructors without a database connection, listener or provider action.
docker run --rm --network acquire-app_default --env-file .env.production --entrypoint node "$image" runtime.mjs --check-config
# Reads named tables, RLS, roles and repaired trigger metadata; never runs SQL artifacts.
docker run --rm --network acquire-app_default --env-file .env.production --mount "type=bind,source=$release/communications-deploy-schema-preflight.mjs,target=/app/schema-preflight.mjs,readonly" --entrypoint node "$image" /app/schema-preflight.mjs
# Re-running the current immutable release is harmless and must not overwrite its rollback snapshot.
if [[ -f releases/current-commit && "$(cat releases/current-commit)" == "$revision" ]]; then
 docker compose exec -T communications node healthcheck.mjs
 echo "Communications $revision already current"
 exit 0
fi
mkdir "$backup"
chmod 700 "$backup"
had_image=false
had_compose=false
if [[ -f .env ]]; then cp .env "$backup/previous-image.env"; had_image=true; fi
if [[ -f compose.production.yml ]]; then cp compose.production.yml "$backup/previous-compose.yml"; had_compose=true; fi
[[ "$had_image" != true || "$had_compose" == true ]] || { echo 'Incomplete existing communications release'; exit 1; }
printf '%s\n' "$had_image" > "$backup/image-present"
printf '%s\n' "$had_compose" > "$backup/compose-present"
if [[ -f releases/current-commit ]]; then cp releases/current-commit "$backup/previous-commit"; fi
if [[ -f releases/current-backup ]]; then cp releases/current-backup "$backup/previous-backup"; fi
rollback() {
 result=$?
 trap - EXIT INT TERM
 if [[ "$result" != 0 ]]; then
  echo 'Communications rollout failed; restoring prior service release'
  restore_service || echo 'Communications rollback needs operator attention'
 fi
 exit "$result"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$release/service-compose.production.yml" compose.production.yml
printf 'COMMUNICATIONS_IMAGE=%s\n' "$image" > .env
# Actual startup preflights existing approved schema before opening its listener.
docker compose up -d --wait --wait-timeout 120
docker compose exec -T communications node healthcheck.mjs
printf '%s\n' "$backup" > releases/current-backup
printf '%s\n' "$revision" > releases/current-commit
printf 'true\n' > "$release/service-deployment-changed"
trap - EXIT INT TERM
echo "Deployed communications $revision"
