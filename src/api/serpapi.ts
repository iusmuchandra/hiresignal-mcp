import { request } from "undici";
import {
  AuthFailedError,
  QuotaExhaustedError,
  UpstreamError,
  UpstreamTimeoutError,
} from "../errors.js";
import { jobSearchCache, stableKey } from "../cache.js";

const SERPAPI_BASE = "https://serpapi.com/search.json";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

export interface SerpApiJobsParams {
  query: string;
  location?: string;
  // SerpApi accepts strings like "today", "3days", "week", "month"
  date_posted?: "today" | "3days" | "week" | "month";
  limit?: number;
}

export interface SerpApiJobRaw {
  title: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
    salary?: string;
    work_from_home?: boolean;
  };
  related_links?: { link?: string; text?: string }[];
  apply_options?: { link?: string; title?: string }[];
  share_link?: string;
  job_id?: string;
}

export interface SerpApiJobsResponse {
  jobs_results?: SerpApiJobRaw[];
  search_metadata?: { status?: string };
  error?: string;
}

function getApiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key || key.trim().length === 0) {
    throw new AuthFailedError();
  }
  return key.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{
  statusCode: number;
  body: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "user-agent": "hiresignal-mcp/0.1" },
    });
    const body = await res.body.text();
    return { statusCode: res.statusCode, body };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamTimeoutError("serpapi", timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchJobsRaw(
  params: SerpApiJobsParams,
  opts: { timeoutMs?: number; bypassCache?: boolean } = {}
): Promise<SerpApiJobRaw[]> {
  const apiKey = getApiKey();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Google Jobs (SerpApi) returns 400 if "Remote"/"Anywhere" is sent as a
  // `location` value — it only accepts real geographies. Treat those as a
  // remote-work intent instead: drop the location param and fold the keyword
  // into the query so the engine surfaces work-from-home roles. rerankByLocation
  // (below) still floats genuinely-remote postings to the top.
  const isRemoteIntent = /^(remote|anywhere|work from home|wfh)$/i.test(
    (params.location ?? "").trim()
  );
  const effectiveLocation = isRemoteIntent ? undefined : params.location;
  const effectiveQuery =
    isRemoteIntent && !/\bremote\b/i.test(params.query)
      ? `${params.query} remote`
      : params.query;

  const qs = new URLSearchParams({
    engine: "google_jobs",
    q: effectiveQuery,
    api_key: apiKey,
  });
  if (effectiveLocation) qs.set("location", effectiveLocation);
  if (params.date_posted) qs.set("chips", `date_posted:${params.date_posted}`);

  const cacheKey = stableKey({
    provider: "serpapi",
    query: effectiveQuery,
    location: effectiveLocation ?? "",
    date_posted: params.date_posted ?? "",
  });

  if (!opts.bypassCache) {
    const cached = jobSearchCache.get(cacheKey);
    if (cached) return cached as SerpApiJobRaw[];
  }

  const url = `${SERPAPI_BASE}?${qs.toString()}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { statusCode, body } = await fetchWithTimeout(url, timeoutMs);

      if (statusCode === 401 || statusCode === 403) {
        throw new AuthFailedError();
      }
      if (statusCode === 429) {
        const backoffMs = Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
        if (attempt === MAX_RETRIES - 1) {
          throw new QuotaExhaustedError(Math.ceil(backoffMs / 1000));
        }
        await sleep(backoffMs);
        continue;
      }
      if (statusCode >= 500) {
        const backoffMs = Math.min(4000, 300 * 2 ** attempt);
        if (attempt === MAX_RETRIES - 1) {
          throw new UpstreamError("serpapi", statusCode, body);
        }
        await sleep(backoffMs);
        continue;
      }
      if (statusCode !== 200) {
        throw new UpstreamError("serpapi", statusCode, body);
      }

      let parsed: SerpApiJobsResponse;
      try {
        parsed = JSON.parse(body) as SerpApiJobsResponse;
      } catch {
        throw new UpstreamError("serpapi", statusCode, "invalid JSON body");
      }

      if (parsed.error) {
        if (/quota|limit|plan/i.test(parsed.error)) {
          throw new QuotaExhaustedError(3600);
        }
        throw new UpstreamError("serpapi", statusCode, parsed.error);
      }

      const allJobs = parsed.jobs_results ?? [];
      const reranked = rerankByLocation(allJobs, params.location);
      const results = reranked.slice(
        0,
        Math.max(1, Math.min(params.limit ?? 20, 20))
      );
      jobSearchCache.set(cacheKey, results);
      return results;
    } catch (err: unknown) {
      lastErr = err;
      if (
        err instanceof AuthFailedError ||
        err instanceof QuotaExhaustedError ||
        err instanceof UpstreamError
      ) {
        throw err;
      }
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(Math.min(2000, 200 * 2 ** attempt));
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new UpstreamError("serpapi", 0, "unknown failure");
}

export function scoreLocationMatch(job: SerpApiJobRaw, requested: string | undefined): number {
  if (!requested) return 0;
  const req = requested.toLowerCase().trim();
  if (req.length === 0) return 0;

  const jobLocation = (job.location ?? "").toLowerCase();
  const isRemote = job.detected_extensions?.work_from_home === true;

  if (req === "remote" || req === "anywhere") {
    if (isRemote) return 5;
    if (/\b(remote|anywhere|work from home)\b/.test(jobLocation)) return 3;
    return 0;
  }

  if (jobLocation.length === 0) return 0;

  let score = 0;
  if (jobLocation === req) score += 5;
  else if (jobLocation.includes(req)) score += 3;

  const tokens = req
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  for (const t of tokens) {
    if (jobLocation.includes(t)) score += 1;
  }
  return score;
}

export function rerankByLocation(
  jobs: SerpApiJobRaw[],
  requestedLocation: string | undefined
): SerpApiJobRaw[] {
  if (!requestedLocation || requestedLocation.trim().length === 0 || jobs.length === 0) {
    return jobs;
  }
  // Preserve original order for ties using index in the comparator.
  const scored = jobs.map((job, index) => ({
    job,
    index,
    score: scoreLocationMatch(job, requestedLocation),
  }));
  // A score of 1 typically means only a state/country token matched (e.g. "TX") —
  // require a stronger match before we trust filtering down to matches only.
  const MATCH_THRESHOLD = 2;
  const matched = scored.filter((s) => s.score >= MATCH_THRESHOLD);

  if (matched.length >= 3) {
    return matched.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.job);
  }
  // Fallback: keep all results, but float any matches to the top.
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.job);
}

export function normalizeApplyUrl(job: SerpApiJobRaw): string {
  if (job.apply_options && job.apply_options.length > 0) {
    const first = job.apply_options[0];
    if (first?.link) return first.link;
  }
  if (job.share_link) return job.share_link;
  if (job.related_links && job.related_links.length > 0) {
    const first = job.related_links[0];
    if (first?.link) return first.link;
  }
  return "";
}
