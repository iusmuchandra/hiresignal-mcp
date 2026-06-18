# HireSignal MCP

Real-time job market intelligence as an MCP server. Plug HireSignal into Claude, Cursor, Cline, or Windsurf and ask questions like:

- "Which companies in fintech are hiring ML engineers right now?"
- "What skills are most in-demand in NYC this week?"
- "Is Stripe growing its data team or shrinking it?"
- "Show me Staff Engineer roles in London posted in the last 24 hours."

The server speaks the **Model Context Protocol** over **SSE** so it can be hosted remotely (Railway, Fly, anywhere with HTTPS).

## Try it instantly (hosted demo)

A live instance is running with a shared, rate-limited demo key. Point any MCP client at:

```
URL:    https://hiresignal-mcp-production-d4d9.up.railway.app/sse
Header: Authorization: Bearer hs_demo_0b25932234553fd38b571f12c1439bfd
```

> The demo key is heavily rate-limited and shares a small monthly data quota — expect `QUOTA_EXHAUSTED` during busy periods. For a dedicated key with higher limits, get in touch.

## Tools

| Tool | What it does |
| --- | --- |
| `search_jobs` | Find live postings matching a role/skill in a location and recency window. |
| `company_hiring_velocity` | Total roles + 7d / 30d adds + department mix + growing/stable/shrinking signal for one company. |
| `skill_demand_pulse` | Week-over-week demand trend for a skill, with avg disclosed salary and top hiring companies. |
| `market_salary_estimate` | p25 / median / p75 for a job title + location + seniority, plus remote premium. |
| `industry_hiring_heatmap` | Per-department open-role counts and % change for an industry vertical. |
| `competitor_talent_intel` | Compare up to 5 companies side by side on open roles, top titles, and growth signal. |
| `job_alert_check` | Poll for new postings since N hours ago. Designed for cron / agent loops. |
| `get_server_status` | Health snapshot: version, uptime, configured providers, cache size. |

## Configuration

Set these environment variables on the server (Railway → Variables, or `.env` locally):

```bash
SERPAPI_KEY=...               # https://serpapi.com — used by search_jobs, job_alert_check
JSEARCH_RAPIDAPI_KEY=...      # https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
HIRESIGNAL_API_KEYS=k1,k2     # comma-separated allowlist of client keys
PORT=3000                     # default
```

At least one provider key must be set. `get_server_status` will report `"degraded"` if neither is configured.

`HIRESIGNAL_API_KEYS` accepts one or more comma-separated keys (or use `HIRESIGNAL_API_KEY` for a single key). If neither is set the server runs in **open mode** — it logs a startup warning and accepts unauthenticated calls, which is convenient for local dev but **must not** be used in any deployment exposed to the network.

## Run locally

```bash
npm install
cp .env.example .env   # fill in keys
npm run dev            # tsx watch
# → http://localhost:3000/sse
# → http://localhost:3000/health
```

Production build:

```bash
npm run build
npm start
```

## Deploy to Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
# then set SERPAPI_KEY and JSEARCH_RAPIDAPI_KEY in the Railway dashboard
```

`railway.json` wires up Nixpacks, the `npm ci && npm run build` step, and `/health` for health checks.

## Connecting from MCP clients

### Claude Desktop

Claude Desktop's stable config supports stdio MCP servers natively and remote (SSE) servers via the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```jsonc
{
  "mcpServers": {
    "hiresignal": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-hiresignal.up.railway.app/sse",
        "--header",
        "Authorization: Bearer YOUR_HIRESIGNAL_API_KEY"
      ]
    }
  }
}
```

Restart Claude Desktop. The 8 HireSignal tools will appear in the tools menu.

### Cursor

Open Cursor → Settings → MCP → "Add new MCP server":

```jsonc
{
  "mcpServers": {
    "hiresignal": {
      "url": "https://your-hiresignal.up.railway.app/sse",
      "headers": {
        "Authorization": "Bearer YOUR_HIRESIGNAL_API_KEY"
      }
    }
  }
}
```

### Cline / Windsurf

Both support remote SSE MCP servers. Point them at `https://your-hiresignal.up.railway.app/sse` with the same `Authorization: Bearer …` header.

### Local stdio fallback

Most clients only need the SSE URL above. If a client requires stdio, point it at the `mcp-remote` bridge as in the Claude Desktop example.

## How auth and limits work

- **API key**: the server reads it from `Authorization: Bearer …`, `x-api-key`, or `?api_key=…` (prefer the header — query params end up in proxy/access logs). The presented key is SHA-256 digested and compared in constant time against the digests of every key in `HIRESIGNAL_API_KEYS`. Unknown or missing keys get a `401` with `{"code": "AUTH_FAILED"}`. Only the first 16 hex chars of the digest are logged, never the key itself. The `/messages` POST endpoint re-checks the key on every call and rejects it if the session was opened under a different key, so a leaked `sessionId` is not enough to take over a session.
- **Rate limit**: 30 tool calls per API key per minute (token bucket, in-memory). On overflow, tools return `{ "code": "RATE_LIMITED", "retry_after_seconds": N }`.
- **Cache**: job search results are cached for 15 minutes per `(query, location, date_posted)` tuple to protect upstream quota. `job_alert_check` always bypasses the cache.
- **Quota errors**: when an upstream returns 429 or signals quota exhaustion, the tool returns `{ "code": "QUOTA_EXHAUSTED", "retry_after_seconds": N, "hint": "hiresignal.io/pricing" }`.

## Testing

```bash
npm test         # vitest run with mocked upstream APIs
npm run typecheck
```

## License

MIT.
