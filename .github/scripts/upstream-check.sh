#!/usr/bin/env bash
# Refreshes pinned versions: node base image digest + npm dependency versions.
set -euo pipefail

tag="22-slim"
digest=$(curl -fsSL "https://hub.docker.com/v2/repositories/library/node/tags/${tag}" | jq -r '.digest')
sed -i -E "s|node:${tag}@sha256:[a-f0-9]+|node:${tag}@${digest}|g" services/worker/Dockerfile

cd services/worker
for pkg in @anthropic-ai/claude-agent-sdk node-cron pg yaml; do
  latest=$(curl -fsSL "https://registry.npmjs.org/${pkg}/latest" | jq -r '.version')
  npm pkg set "dependencies.${pkg}=${latest}"
done
npm install --package-lock-only

echo "node:${tag}@${digest}"
npm pkg get dependencies
