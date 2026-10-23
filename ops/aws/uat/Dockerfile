# syntax=docker/dockerfile:1
# Extend the existing standalone image without changing DigitalOcean startup.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=node:node ops/aws/uat/start.mjs ./uat-start.mjs
CMD ["node", "uat-start.mjs"]
