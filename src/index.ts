import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z, type ZodTypeAny } from "zod";

import { searchJobs, searchJobsToolDefinition } from "./tools/searchJobs.js";
import { companyHiringVelocity, companyVelocityToolDefinition } from "./tools/companyVelocity.js";
import { skillDemandPulse, skillPulseToolDefinition } from "./tools/skillPulse.js";
import { marketSalaryEstimate, salaryEstimateToolDefinition } from "./tools/salaryEstimate.js";
import { industryHiringHeatmap, industryHeatmapToolDefinition } from "./tools/industryHeatmap.js";
import { competitorTalentIntel, competitorIntelToolDefinition } from "./tools/competitorIntel.js";
import { jobAlertCheck, jobAlertCheckToolDefinition } from "./tools/jobAlertCheck.js";
import { getServerStatus, serverStatusToolDefinition } from "./tools/serverStatus.js";
import { AuthFailedError, HireSignalError } from "./errors.js";
import { toolRateLimiter } from "./rateLimit.js";
import {
  authenticate,
  extractApiKey,
  hashApiKeyForLog,
  loadAuthConfigFromEnv,
  type AuthConfig,
} from "./auth.js";

import { runIngest } from "./ingest.js";
import { VERSION, SERVER_NAME } from "./version.js";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
}

interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: unknown) => Promise<unknown>;
}

const TOOLS: RegisteredTool[] = [
  { definition: searchJobsToolDefinition, handler: searchJobs },
  { definition: companyVelocityToolDefinition, handler: companyHiringVelocity },
  { definition: skillPulseToolDefinition, handler: skillDemandPulse },
  { definition: salaryEstimateToolDefinition, handler: marketSalaryEstimate },
  { definition: industryHeatmapToolDefinition, handler: industryHiringHeatmap },
  { definition: competitorIntelToolDefinition, handler: competitorTalentIntel },
  { definition: jobAlertCheckToolDefinition, handler: jobAlertCheck },
  { definition: serverStatusToolDefinition, handler: getServerStatus },
];

function logUsage(params: { apiKeyHash: string; tool: string; ok: boolean; ms: number }): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    api_key_hash: params.apiKeyHash,
    tool: params.tool,
    ok: params.ok,
    duration_ms: params.ms,
  });
  process.stdout.write(line + "\n");
}

function buildMcpServer(apiKeyHash: string): Server {
  const server = new Server(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS.map((t) => ({
        name: t.definition.name,
        description: t.definition.description,
        inputSchema: zodToJsonSchema(t.definition.inputSchema, {
          $refStrategy: "none",
          target: "openApi3",
        }),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const tool = TOOLS.find((t) => t.definition.name === toolName);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Unknown tool: ${toolName}`, code: "NOT_FOUND" }),
          },
        ],
      };
    }

    const started = Date.now();
    try {
      toolRateLimiter.consume(apiKeyHash, 1);
      const result = await tool.handler(req.params.arguments ?? {});
      logUsage({ apiKeyHash, tool: toolName, ok: true, ms: Date.now() - started });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      logUsage({ apiKeyHash, tool: toolName, ok: false, ms: Date.now() - started });
      if (err instanceof HireSignalError) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(err.toSerialized()) }],
        };
      }
      const message = err instanceof Error ? err.message : "unknown error";
      return {
        isError: true,
        content: [
          { type: "text", text: JSON.stringify({ error: message, code: "INTERNAL" }) },
        ],
      };
    }
  });

  return server;
}

interface ActiveSession {
  transport: SSEServerTransport;
  server: Server;
  apiKeyHash: string;
}

const sessions = new Map<string, ActiveSession>();

function sendAuthError(res: Response): void {
  const err = new AuthFailedError();
  res.status(401).json(err.toSerialized());
}

function tryAuthenticate(req: Request, res: Response, authConfig: AuthConfig): string | null {
  const apiKey = extractApiKey(req);
  try {
    authenticate(apiKey, authConfig);
  } catch {
    sendAuthError(res);
    return null;
  }
  return hashApiKeyForLog(apiKey);
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const authConfig = loadAuthConfigFromEnv();
  const app = express();

  if (authConfig.openMode) {
    process.stderr.write(
      "WARNING: no HIRESIGNAL_API_KEY(S) configured — server is running in OPEN MODE. " +
        "Anyone with network access can call your tools and burn your upstream quota. " +
        "Set HIRESIGNAL_API_KEYS=key1,key2 in the environment before exposing this server.\n"
    );
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", name: SERVER_NAME, version: VERSION });
  });

  app.get("/sse", async (req: Request, res: Response) => {
    const apiKeyHash = tryAuthenticate(req, res, authConfig);
    if (apiKeyHash === null) return;

    const transport = new SSEServerTransport("/messages", res);
    const server = buildMcpServer(apiKeyHash);
    const sessionId = transport.sessionId ?? randomUUID();

    sessions.set(sessionId, { transport, server, apiKeyHash });

    res.on("close", () => {
      sessions.delete(sessionId);
      void server.close().catch(() => undefined);
    });

    await server.connect(transport);
  });

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = (req.query.sessionId as string | undefined) ?? "";
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Unknown sessionId", code: "NOT_FOUND" });
      return;
    }
    // Defense in depth: revalidate the key on every message and require it to
    // match the key that opened this session. Stops a leaked sessionId from
    // being used by a different caller.
    const apiKeyHash = tryAuthenticate(req, res, authConfig);
    if (apiKeyHash === null) return;
    if (!authConfig.openMode && apiKeyHash !== session.apiKeyHash) {
      sendAuthError(res);
      return;
    }
    await session.transport.handlePostMessage(req, res);
  });

  app.listen(port, () => {
    process.stdout.write(
      JSON.stringify({
        event: "server_started",
        name: SERVER_NAME,
        version: VERSION,
        port,
        transport: "sse",
        auth: authConfig.openMode ? "open" : "required",
        endpoints: { sse: "/sse", messages: "/messages", health: "/health" },
      }) + "\n"
    );
    maybeScheduleIngest();
  });
}

/**
 * Optional self-sustaining corpus: when INGEST_INTERVAL_HOURS is set, the server
 * ingests on boot and on an interval into its own corpus file. Point
 * HIRESIGNAL_CORPUS_PATH at a persistent volume (e.g. /data/corpus.db on Railway)
 * and a single instance keeps the moat growing with no external cron.
 */
function maybeScheduleIngest(): void {
  const hours = Number(process.env.INGEST_INTERVAL_HOURS ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return;

  const tick = (): void => {
    runIngest({ concurrency: 6 }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`scheduled ingest failed: ${message}\n`);
    });
  };

  tick(); // prime the corpus on boot
  setInterval(tick, hours * 60 * 60 * 1000).unref();
  process.stdout.write(
    JSON.stringify({ event: "ingest_scheduled", interval_hours: hours }) + "\n"
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
});

export { z };
