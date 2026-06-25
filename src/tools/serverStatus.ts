import { z } from "zod";
import { jobSearchCache } from "../cache.js";
import { VERSION } from "../version.js";
import { TARGETS } from "../targets.js";
import { getCorpus, type CorpusStats } from "../store/corpus.js";

export const ServerStatusInput = z.object({}).describe("No arguments.");

export type ServerStatusArgs = z.infer<typeof ServerStatusInput>;

export interface ServerStatusResult {
  status: "ok" | "degraded";
  version: string;
  uptime_seconds: number;
  last_updated: string;
  providers: {
    serpapi_configured: boolean;
    jsearch_configured: boolean;
    first_party_corpus: boolean;
  };
  corpus: {
    targets_configured: number;
    companies_tracked: number;
    open_roles: number;
    snapshots: number;
    last_ingest_at: string | null;
    oldest_snapshot_at: string | null;
  };
  cache: {
    entries: number;
    default_ttl_minutes: number;
  };
  api_quota_remaining: string;
  notes: string;
}

const STARTED_AT_MS = Date.now();

function readCorpusStats(): CorpusStats | null {
  try {
    return getCorpus().stats();
  } catch {
    return null;
  }
}

export async function getServerStatus(_rawInput: unknown): Promise<ServerStatusResult> {
  const serpapiConfigured = !!(process.env.SERPAPI_KEY && process.env.SERPAPI_KEY.trim());
  const jsearchConfigured = !!(process.env.JSEARCH_RAPIDAPI_KEY && process.env.JSEARCH_RAPIDAPI_KEY.trim());

  const corpusStats = readCorpusStats();
  const corpusActive = !!corpusStats && corpusStats.companies_tracked > 0;

  // The corpus is a self-contained data source — the server is healthy if it has
  // an ingested corpus OR a configured aggregator key.
  const status: ServerStatusResult["status"] =
    corpusActive || serpapiConfigured || jsearchConfigured ? "ok" : "degraded";

  const notes =
    status === "degraded"
      ? "No data source available. Run `npm run ingest` to build the first-party corpus, and/or set SERPAPI_KEY / JSEARCH_RAPIDAPI_KEY."
      : corpusActive
        ? `First-party corpus active: ${corpusStats.companies_tracked} companies, ${corpusStats.open_roles} open roles across ${corpusStats.snapshots} snapshots.`
        : "Server is healthy via a third-party aggregator. Run `npm run ingest` to activate the first-party corpus.";

  return {
    status,
    version: VERSION,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT_MS) / 1000),
    last_updated: new Date().toISOString(),
    providers: {
      serpapi_configured: serpapiConfigured,
      jsearch_configured: jsearchConfigured,
      first_party_corpus: corpusActive,
    },
    corpus: {
      targets_configured: TARGETS.length,
      companies_tracked: corpusStats?.companies_tracked ?? 0,
      open_roles: corpusStats?.open_roles ?? 0,
      snapshots: corpusStats?.snapshots ?? 0,
      last_ingest_at: corpusStats?.last_ingest_at ?? null,
      oldest_snapshot_at: corpusStats?.oldest_snapshot_at ?? null,
    },
    cache: {
      entries: jobSearchCache.size(),
      default_ttl_minutes: 15,
    },
    api_quota_remaining: "tracked-upstream",
    notes,
  };
}

export const serverStatusToolDefinition = {
  name: "get_server_status",
  description:
    "Return a health snapshot of the HireSignal MCP server: version, uptime, which upstream providers are configured, cache size, and a short status note. Use this to verify the server is reachable, the API keys are wired up, and to surface quota/health context to a paying user.",
  inputSchema: ServerStatusInput,
} as const;
