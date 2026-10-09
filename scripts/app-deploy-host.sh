#!/usr/bin/env bash
# Called only on the dedicated Droplet by its production GitHub runner.
# Runtime secrets remain on-host. No migrations, provider writes or sends.
set -Eeuo pipefail
umask 077
release=${1:?Release directory required}
revision=${2:?Commit required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid revision'; exit 1; }
[[ "$(cat "$release/commit")" == "$revision" ]] || { echo 'Release revision mismatch'; exit 1; }
image="acquire-app:github-$revision"
expected=$(cat "$release/archive-sha256")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid archive checksum'; exit 1; }
actual=$(sha256sum "$release/image.tar.gz" | cut -d' ' -f1)
[[ "$actual" == "$expected" ]] || { echo 'Image archive checksum mismatch'; exit 1; }
cd /opt/acquire-app/ops/app
export COMPOSE_FILE=compose.hosted.yml
# The manual deployment helper takes this same lock.
exec 9>/opt/acquire-app/deploy.lock
flock -w 120 9
test -s .env.hosted
test -s .env
mkdir -p releases
chmod 700 releases
gzip -dc "$release/image.tar.gz" | docker load
[[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$revision" ]] || { echo 'Loaded image revision mismatch'; exit 1; }
cp .env releases/previous-image.env
cp .env.hosted releases/previous-runtime.env
cp compose.hosted.yml releases/previous-compose.yml
rollback() {
  result=$?
  trap - EXIT INT TERM
  if [[ "$result" != 0 ]]; then
    echo 'Release failed; restoring previous image and compose configuration'
    cp releases/previous-image.env .env
    cp releases/previous-compose.yml compose.hosted.yml
    docker compose up -d --wait --wait-timeout 120
    docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready',{headers:{Authorization:'Bearer '+process.env.APP_READINESS_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  fi
  exit "$result"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$release/compose.hosted.yml" compose.hosted.yml
printf 'APP_IMAGE=%s\n' "$image" > .env
docker compose up -d --wait --wait-timeout 120
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready',{headers:{Authorization:'Bearer '+process.env.APP_READINESS_SECRET}}).then(r=>{if(!r.ok)process.exit(1);console.log('Database readiness passed')}).catch(()=>process.exit(1))"
docker compose cp "$release/app-public-smoke.mjs" app:/tmp/acquire-public-smoke.mjs
docker compose exec -T app node /tmp/acquire-public-smoke.mjs
printf '%s\n' "$revision" > releases/current-commit
trap - EXIT INT TERM
echo "Deployed $revision"
# Keep current and previous releases; only remove older CI tags, without force.
previous=$(sed -n 's/^APP_IMAGE=//p' releases/previous-image.env)
while IFS= read -r old; do
  [[ "$old" == "$image" || "$old" == "$previous" ]] && continue
  docker image rm "$old" || true
done < <(docker image ls --filter 'reference=acquire-app:github-*' --format '{{.Repository}}:{{.Tag}}')
