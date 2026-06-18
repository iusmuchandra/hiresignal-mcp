import { z } from "zod";
import { jobSearchCache } from "../cache.js";

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
  };
  cache: {
    entries: number;
    default_ttl_minutes: number;
  };
  api_quota_remaining: string;
  notes: string;
}

const STARTED_AT_MS = Date.now();
const VERSION = "0.1.0";

export async function getServerStatus(_rawInput: unknown): Promise<ServerStatusResult> {
  const serpapiConfigured = !!(process.env.SERPAPI_KEY && process.env.SERPAPI_KEY.trim());
  const jsearchConfigured = !!(process.env.JSEARCH_RAPIDAPI_KEY && process.env.JSEARCH_RAPIDAPI_KEY.trim());

  const status: ServerStatusResult["status"] =
    serpapiConfigured || jsearchConfigured ? "ok" : "degraded";

  const notes =
    status === "degraded"
      ? "No upstream provider API key is configured. Set SERPAPI_KEY and/or JSEARCH_RAPIDAPI_KEY."
      : "Server is healthy and at least one upstream provider is configured.";

  return {
    status,
    version: VERSION,
    uptime_seconds: Math.floor((Date.now() - STARTED_AT_MS) / 1000),
    last_updated: new Date().toISOString(),
    providers: {
      serpapi_configured: serpapiConfigured,
      jsearch_configured: jsearchConfigured,
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
