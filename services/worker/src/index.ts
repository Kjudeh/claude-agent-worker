import { query } from "@anthropic-ai/claude-agent-sdk";
import * as cron from "node-cron";
import pg from "pg";
import { parse } from "yaml";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

interface Task {
  name: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
}

const PORT = Number(process.env.PORT || 8080);
const TZ = process.env.TZ || "UTC";
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
const WORKSPACE = "/app/workspace";
const startedAt = new Date();

mkdirSync(WORKSPACE, { recursive: true });

// ---------- tasks ----------

function loadTasks(): Task[] {
  // TASKS_YAML env var (set in Railway Variables) overrides the baked-in file,
  // so deployers can change jobs without forking the repo
  const raw = process.env.TASKS_YAML?.trim()
    ? process.env.TASKS_YAML
    : readFileSync(new URL("../tasks.yaml", import.meta.url), "utf8");
  const doc = parse(raw) as { tasks?: Task[] };
  const tasks = (doc?.tasks ?? []).filter((t) => t?.name && t?.schedule && t?.prompt);
  for (const t of tasks) {
    if (!cron.validate(t.schedule)) {
      console.error(`[tasks] invalid cron expression for "${t.name}": ${t.schedule} — task disabled`);
      t.enabled = false;
    }
  }
  return tasks;
}

// ${VAR} placeholders in prompts resolve from service Variables at run time
function interpolate(prompt: string): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = prompt.replace(/\$\{([A-Z0-9_]+)\}/g, (m, name) => {
    const v = process.env[name];
    if (v === undefined) {
      missing.push(name);
      return m;
    }
    return v;
  });
  return { text, missing };
}

// ---------- db ----------

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function initDb(retries = 20): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS runs (
        id BIGSERIAL PRIMARY KEY,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        result TEXT,
        error TEXT,
        cost_usd NUMERIC,
        num_turns INTEGER
      )`);
      return;
    } catch (err) {
      if (i >= retries) throw err;
      console.log(`[db] not ready (attempt ${i}), retrying in 5s...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ---------- agent runner ----------

const running = new Set<string>();

async function runTask(task: Task, trigger: string): Promise<number | null> {
  if (running.has(task.name)) {
    console.log(`[run] ${task.name} already running — skipping ${trigger} trigger`);
    return null;
  }
  running.add(task.name);
  const { rows } = await pool.query(
    "INSERT INTO runs (task, status) VALUES ($1, 'running') RETURNING id",
    [task.name],
  );
  const runId: number = rows[0].id;
  console.log(`[run] #${runId} ${task.name} started (${trigger})`);
  try {
    const { text: prompt, missing } = interpolate(task.prompt);
    if (missing.length) {
      console.warn(`[run] #${runId} unresolved variables: ${missing.join(", ")} — set them in Railway Variables`);
    }
    let resultText = "";
    let costUsd: number | null = null;
    let numTurns: number | null = null;
    let subtype = "unknown";

    for await (const message of query({
      prompt,
      options: {
        model: task.model || DEFAULT_MODEL,
        maxTurns: task.maxTurns ?? 30,
        allowedTools: task.allowedTools ?? ["WebSearch", "WebFetch", "Read", "Write", "Glob", "Grep", "Bash"],
        permissionMode: "bypassPermissions",
        cwd: WORKSPACE,
      },
    })) {
      const m = message as any;
      if (m.type === "result") {
        subtype = m.subtype ?? "unknown";
        resultText = m.result ?? "";
        costUsd = m.total_cost_usd ?? null;
        numTurns = m.num_turns ?? null;
      }
    }

    if (subtype !== "success") {
      throw new Error(`agent finished with subtype "${subtype}"${resultText ? `: ${resultText.slice(0, 500)}` : ""}`);
    }

    await pool.query(
      "UPDATE runs SET status='success', finished_at=now(), result=$2, cost_usd=$3, num_turns=$4 WHERE id=$1",
      [runId, resultText, costUsd, numTurns],
    );
    console.log(`[run] #${runId} ${task.name} succeeded (${numTurns} turns, $${costUsd ?? "?"})`);

    if (process.env.WEBHOOK_URL) {
      try {
        await fetch(process.env.WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: task.name, run_id: runId, status: "success", result: resultText }),
        });
      } catch (err) {
        console.warn(`[run] #${runId} webhook delivery failed: ${err}`);
      }
    }
    return runId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      "UPDATE runs SET status='error', finished_at=now(), error=$2 WHERE id=$1",
      [runId, msg.slice(0, 4000)],
    );
    console.error(`[run] #${runId} ${task.name} failed: ${msg}`);
    return runId;
  } finally {
    running.delete(task.name);
  }
}

// ---------- status page ----------

function authorized(header: string | undefined): boolean {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  if (!header?.startsWith("Basic ")) return false;
  const expected = Buffer.from(`admin:${password}`);
  const got = Buffer.from(header.slice(6), "base64");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function statusHtml(tasks: Task[]): Promise<string> {
  const { rows: runs } = await pool.query(
    "SELECT id, task, status, started_at, finished_at, cost_usd, num_turns, left(coalesce(result, error, ''), 300) AS excerpt FROM runs ORDER BY id DESC LIMIT 50",
  );
  const taskRows = tasks
    .map(
      (t) => `<tr><td><b>${esc(t.name)}</b></td><td><code>${esc(t.schedule)}</code></td>
      <td>${t.enabled === false ? "disabled" : running.has(t.name) ? "running" : "scheduled"}</td>
      <td>${esc(t.model || DEFAULT_MODEL)}</td>
      <td><form method="POST" action="/run/${encodeURIComponent(t.name)}"><button ${t.enabled === false ? "" : ""}>Run now</button></form></td></tr>`,
    )
    .join("");
  const runRows = runs
    .map(
      (r: any) => `<tr><td>${r.id}</td><td>${esc(r.task)}</td><td class="${esc(r.status)}">${esc(r.status)}</td>
      <td>${esc(r.started_at?.toISOString?.() ?? r.started_at)}</td>
      <td>${r.cost_usd ? "$" + Number(r.cost_usd).toFixed(4) : ""}</td><td>${r.num_turns ?? ""}</td>
      <td><pre>${esc(r.excerpt)}</pre></td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><title>Claude Agent Worker</title><style>
  body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px}
  table{border-collapse:collapse;width:100%;margin-bottom:2rem}
  td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}
  th{background:#f5f5f5} pre{white-space:pre-wrap;margin:0;font-size:12px;max-height:6em;overflow:auto}
  .success{color:#0a7d33}.error{color:#c0262d}.running{color:#b57400}
  </style></head><body>
  <h1>Claude Agent SDK Worker</h1>
  <p>Up since ${startedAt.toISOString()} · timezone ${esc(TZ)} · default model ${esc(DEFAULT_MODEL)}</p>
  <h2>Tasks</h2><table><tr><th>Task</th><th>Cron</th><th>State</th><th>Model</th><th></th></tr>${taskRows}</table>
  <h2>Recent runs</h2><table><tr><th>#</th><th>Task</th><th>Status</th><th>Started</th><th>Cost</th><th>Turns</th><th>Output</th></tr>${runRows}</table>
  </body></html>`;
}

// ---------- main ----------

async function main() {
  await initDb();
  const tasks = loadTasks();

  for (const task of tasks) {
    if (task.enabled === false) {
      console.log(`[tasks] ${task.name} — disabled`);
      continue;
    }
    cron.schedule(task.schedule, () => void runTask(task, "cron"), { timezone: TZ });
    console.log(`[tasks] ${task.name} — scheduled "${task.schedule}" (${TZ})`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, tasks: tasks.length }));
        return;
      }
      if (!authorized(req.headers.authorization)) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="claude-agent-worker"' });
        res.end("Authentication required (user: admin, password: ADMIN_PASSWORD variable)");
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/run/")) {
        const name = decodeURIComponent(url.pathname.slice(5));
        const task = tasks.find((t) => t.name === name);
        if (!task) {
          res.writeHead(404).end("unknown task");
          return;
        }
        void runTask(task, "manual");
        res.writeHead(303, { Location: "/" }).end();
        return;
      }
      if (url.pathname === "/runs.json") {
        const { rows } = await pool.query("SELECT * FROM runs ORDER BY id DESC LIMIT 100");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await statusHtml(tasks));
    } catch (err) {
      console.error("[http]", err);
      res.writeHead(500).end("internal error");
    }
  });

  server.listen(PORT, () => console.log(`[http] status page on :${PORT}`));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[boot] ANTHROPIC_API_KEY is not set — scheduled runs will fail until you add it in Railway Variables");
  }
}

main().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
