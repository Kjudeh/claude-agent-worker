# Claude Agent SDK worker — base pinned by tag AND digest; bumped only via
# reviewed PRs from the weekly upstream-check workflow.
# Build context is the repo root (dockerfilePath: services/worker/Dockerfile).
FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
COPY services/worker/package.json services/worker/package-lock.json ./
RUN npm ci
COPY services/worker/tsconfig.json ./
COPY services/worker/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
# curl + git + ca-certificates: used by agent Bash-tool tasks (e.g. issue triage)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/worker/tasks.yaml ./tasks.yaml
COPY services/worker/package.json ./package.json
# the Agent SDK refuses permissionMode bypassPermissions as root — run unprivileged
RUN mkdir -p /app/workspace && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
