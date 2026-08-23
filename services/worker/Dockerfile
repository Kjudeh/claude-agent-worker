# Claude Agent SDK worker — base pinned by tag AND digest; bumped only via
# reviewed PRs from the weekly upstream-check workflow.
# Build context is the repo root (dockerfilePath: services/worker/Dockerfile).
FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /app
COPY services/worker/package.json services/worker/package-lock.json ./
RUN npm ci
COPY services/worker/tsconfig.json ./
COPY services/worker/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
# curl + git + ca-certificates: used by agent Bash-tool tasks (e.g. issue triage)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/worker/tasks.yaml ./tasks.yaml
COPY services/worker/package.json ./package.json
EXPOSE 8080
CMD ["node", "dist/index.js"]
