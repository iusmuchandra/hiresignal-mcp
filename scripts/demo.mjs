#!/usr/bin/env node
// Live demo against the hosted HireSignal instance. Run: node scripts/demo.mjs
// Uses the shared demo key unless HIRESIGNAL_API_KEY is set.
import { EventSource } from "undici";
globalThis.EventSource = EventSource;
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const KEY = process.env.HIRESIGNAL_API_KEY ?? "hs_demo_0b25932234553fd38b571f12c1439bfd";
const BASE = process.env.HIRESIGNAL_URL ?? "https://hiresignal-mcp-production-d4d9.up.railway.app/sse";

const url = new URL(BASE);
url.searchParams.set("api_key", KEY);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  init.headers = { ...(init.headers || {}), "x-api-key": KEY };
  return realFetch(input, init);
};

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: "hiresignal-demo", version: "1.0.0" }, { capabilities: {} });
await client.connect(new SSEClientTransport(url));

async function call(name, args) {
  console.log(`\n${dim("▶ tool:")} ${cyan(name)} ${dim(JSON.stringify(args))}`);
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const ms = Math.round(performance.now() - t0);
  const data = JSON.parse(r.content[0].text);
  console.log(dim(`  ✓ ${ms}ms`));
  return data;
}

console.log(bold("\nHireSignal — hiring-intent signals over MCP (live server, real data)\n"));

const status = await call("get_server_status", {});
console.log(`  first-party corpus: ${green(status.corpus.companies_tracked + " companies")}, ${green(status.corpus.open_roles.toLocaleString() + " open roles")}, tracked as a time-series`);
await sleep(600);

const jobs = await call("search_jobs", { query: "revenue operations", date_posted: "7d", limit: 4 });
console.log(`  ${bold("New RevOps reqs this week")} ${dim("(= sales-tooling budget approved, 60–90d before vendor search)")}:`);
for (const j of (jobs.jobs ?? []).slice(0, 4)) {
  console.log(`    ${dim("·")} ${bold(j.company)} — ${j.title} ${dim(`(${j.posted_at})`)}`);
}
await sleep(600);

const velocity = await call("company_hiring_velocity", { company_name: "Notion" });
console.log(`  ${bold("Notion")} — ${green(velocity.total_open_roles + " open roles")}, ${yellow("+" + velocity.roles_added_last_30d)} added last 30d ${dim(`(source: ${velocity.data_source ?? "first_party_ats"})`)}`);
for (const d of (velocity.top_departments_hiring ?? []).slice(0, 3)) {
  console.log(`    ${dim("·")} ${d.department}: ${d.count} open`);
}
console.log(`  ${dim("→ sales-led hiring spike = budget moving. This account is in-market.")}`);
await sleep(600);

console.log(`\n${bold("Connect your agent in one line:")}`);
console.log(cyan(`  claude mcp add --transport sse hiresignal ${BASE} \\`));
console.log(cyan(`    --header "Authorization: Bearer ${KEY}"`) + "\n");

await client.close();
process.exit(0);
