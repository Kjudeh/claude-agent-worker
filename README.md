# Deploy and Host Claude Agent SDK Worker on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/claude-agent-sdk-worker)

Run **scheduled autonomous Claude agents** on your own infrastructure — the official-SDK alternative to OpenClaw and Hermes for recurring jobs. Define tasks in YAML (a cron schedule plus a plain-English prompt), and a worker built on Anthropic's official [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) runs each one with real tools — web search, web fetch, bash, file access — records every run in Postgres, and shows results on a password-protected status page.

Three example tasks ship enabled-or-ready out of the box: a **daily web-research digest** on any topic you set, a **weekly RSS briefing**, and a **GitHub repo issue triage** report. Each run's full output, cost in dollars, and turn count is stored — you always know what your agents did and what it cost.

**Who it's for:** builders and teams who want recurring AI work (research, monitoring, triage, reporting) running unattended — without gluing together a chat assistant that was never designed for cron jobs.

## About Hosting Claude Agent SDK Worker

Two services, wired over Railway's private network:

| Service | Version | Role |
|---|---|---|
| **worker** | Node 22 (image pinned by digest), `@anthropic-ai/claude-agent-sdk` `0.3.241` (exact-pinned) | Schedules tasks with node-cron, runs the agent loop, serves the status page |
| **PostgreSQL** | Railway managed | Run history: status, full output, cost (USD), turn count per run |

The status page (on the worker's public URL, HTTP Basic auth: user `admin`, password from `ADMIN_PASSWORD`) lists every task with its schedule, the last 50 runs with outputs and per-run cost, and a **Run now** button per task. `/runs.json` returns history as JSON; `/healthz` is the unauthenticated healthcheck.

**Setup (~3 minutes):**

1. Click **Deploy Now** and paste your **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com)). The admin password is auto-generated.
2. When the worker goes green, open its URL and log in (`admin` / the `ADMIN_PASSWORD` value from the service's Variables).
3. Set `RESEARCH_TOPIC` (e.g. "my industry + competitors") and `RSS_FEEDS` in Variables — the two starter tasks use them. Press **Run now** to test immediately.
4. Edit tasks any time by setting the `TASKS_YAML` variable (paste a full YAML document — same format as [the default](https://github.com/Kjudeh/claude-agent-worker/blob/main/services/worker/tasks.yaml)). No fork or rebuild of your own needed; the service restarts with the new schedule.

**Task options:** cron `schedule` (in your `TZ`), `prompt` (supports `${VAR}` placeholders resolved from Variables), `model`, `maxTurns`, `allowedTools` (restrict tools per task), `enabled`. Optional `WEBHOOK_URL` posts every successful result as JSON — point it at Slack, Discord, n8n, Zapier, or Make to deliver digests anywhere (including email).

## Common Use Cases

- **Daily research digest** — monitor your market, competitors, or any topic; wake up to a sourced briefing
- **RSS / news summarization** — turn noisy feeds into one weekly themed briefing (deliver via webhook → email/Slack)
- **Repo issue triage** — nightly categorization and urgency-flagging of new GitHub issues with drafted first responses
- **Site & data monitoring** — "fetch this page/API, compare to expectations, report anomalies" on any schedule
- **Recurring reports** — weekly metrics writeups, changelog summaries, content drafts — anything you can describe in a prompt

## Dependencies for Claude Agent SDK Worker Hosting

- An **Anthropic API key** — pay-as-you-go, from [console.anthropic.com](https://console.anthropic.com). **Use an API key, not subscription-based auth**: programmatic use of consumer subscriptions has changed repeatedly in 2026 and is not a stable foundation for unattended workloads. Every run's actual API cost is recorded in the run history, so spend is always visible.

### Deployment Dependencies

- [Template source + default tasks.yaml (GitHub)](https://github.com/Kjudeh/claude-agent-worker)
- [Claude Agent SDK documentation](https://platform.claude.com/docs)
- [Anthropic Console — API keys](https://console.anthropic.com)
- [node-cron expression reference](https://github.com/node-cron/node-cron)

### Implementation Details — FAQ & Security

**What does it cost to run?** Railway compute for the always-on worker + Postgres is typically **$5–10/mo**. Agent runs bill to your Anthropic key at API rates — the default model is Claude Opus (`claude-opus-4-8`); set `CLAUDE_MODEL=claude-haiku-4-5` for lightweight tasks at a fraction of the cost. Per-run cost appears in the history, so there are no surprises.

**How is this different from OpenClaw / Hermes?** Those are self-hosted personal chat assistants built on community stacks. This is a *job runner* on Anthropic's **official SDK** — versions exact-pinned, no community fork risk, designed for scheduled autonomous work with an auditable run history rather than conversations.

**Can the agent access my systems?** Only what you allow: `allowedTools` restricts each task (e.g. the RSS task can only fetch URLs). Bash runs inside the container. Give tasks API access by adding tokens as Variables and referencing them in prompts via `${VAR}`.

**What happens if a run fails or overruns?** Failures are recorded with the error in run history; a `maxTurns` cap bounds every run. Overlapping executions of the same task are skipped, not stacked.

**How do upgrades work?** The base image is pinned by sha256 digest and the SDK by exact version; a weekly automated PR proposes bumps, which are reviewed and test-deployed before release. Redeploy to pick them up — run history lives in Postgres and survives.

**Security notes:** all credentials live in Railway Variables (never in the repo or image) · `ADMIN_PASSWORD` is auto-generated per deploy — the status page and manual-trigger endpoints require it (timing-safe check) · Postgres is only reachable on the private network · scope any GitHub/API tokens you add to read-only where possible.

## Why Deploy Claude Agent SDK Worker on Railway?

Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Claude Agent SDK Worker on Railway, you are one step closer to supporting a complete full-stack application with minimal burden. Host your servers, databases, AI agents, and more on Railway.

An always-on scheduler with persistent history needs a home; ~$5–10/mo on Railway gets you a private, auditable agent-jobs platform — compared with per-seat automation SaaS ($29–99/mo) that can't run open-ended agent tasks at all, you keep full control of prompts, tools, models, and data.

---

*Built by [Bubbles Studio](https://bubbles.studio) — we build AI automation systems for businesses. Need custom agents wired into your CRM, docs, or data? [Get in touch](https://bubbles.studio).*

*More Bubbles templates: [n8n Production Stack](https://railway.com/deploy/n8n-production-stack-queue-mode) · [WhatsApp AI Receptionist](https://railway.com/deploy/whatsapp-ai-receptionist) · [Postgres S3 Backup](https://railway.com/deploy/sparkling-creation) · [Webhook Inspector](https://railway.com/deploy/webhook-inspector)*
