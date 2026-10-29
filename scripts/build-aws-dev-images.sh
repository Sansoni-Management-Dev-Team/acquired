#!/usr/bin/env bash
set -euo pipefail
repository=${1:?Provide a local image name or the existing ECR repository URI}
revision=${GITHUB_SHA:?Provide the source commit}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
docker build --platform linux/amd64 --label "org.opencontainers.image.revision=$revision" \
  --build-arg NEXT_PUBLIC_APP_URL=https://app.acquire.pajamaprofits.net \
  -t "$repository:app-$revision" .
docker build --platform linux/amd64 -f services/research/Dockerfile \
  --label "org.opencontainers.image.revision=$revision" -t "acquire-research-base:$revision" .
docker build --platform linux/amd64 -f services/research/aws/Dockerfile \
  --build-arg "BASE_IMAGE=acquire-research-base:$revision" -t "$repository:research-$revision" .
docker build --platform linux/amd64 -f cloudflare/crawl4ai/Dockerfile \
  --label "org.opencontainers.image.revision=$revision" -t "$repository:reader-$revision" cloudflare/crawl4ai
