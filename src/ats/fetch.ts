import { request } from "undici";
import { UpstreamError, UpstreamTimeoutError } from "../errors.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * GET a public ATS endpoint and parse JSON. ATS boards are unauthenticated and
 * generally reliable, so we keep this simpler than the metered-API clients: one
 * attempt with a timeout, and typed errors that the ingest loop catches per
 * company (one dead board never aborts the run).
 */
export async function getJson(
  url: string,
  provider: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "user-agent": "hiresignal-mcp (first-party ATS ingest)" },
    });
    const body = await res.body.text();
    if (res.statusCode !== 200) {
      throw new UpstreamError(provider, res.statusCode, body.slice(0, 200));
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new UpstreamError(provider, res.statusCode, "invalid JSON body");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamTimeoutError(provider, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Coerce an arbitrary ATS date string/epoch into a canonical ISO string, or null. */
export function isoOrNull(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const t = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
