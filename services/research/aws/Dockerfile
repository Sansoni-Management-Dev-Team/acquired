# syntax=docker/dockerfile:1
# Extend the exact standalone image; local and DigitalOcean entrypoints stay intact.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=node:node services/research/aws/rds-ca.pem /app/rds-ca.pem
