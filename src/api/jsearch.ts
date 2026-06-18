import { request } from "undici";
import {
  AuthFailedError,
  QuotaExhaustedError,
  UpstreamError,
  UpstreamTimeoutError,
} from "../errors.js";
import { jobSearchCache, stableKey } from "../cache.js";

const JSEARCH_BASE = "https://jsearch.p.rapidapi.com/search";
const JSEARCH_HOST = "jsearch.p.rapidapi.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

export type JSearchDatePosted = "all" | "today" | "3days" | "week" | "month";

export interface JSearchSearchParams {
  query: string;
  location?: string;
  date_posted?: JSearchDatePosted;
  remote_only?: boolean;
  employment_types?: Array<"FULLTIME" | "CONTRACTOR" | "PARTTIME" | "INTERN">;
  page?: number;
  num_pages?: number;
  employer?: string;
}

export interface JSearchJobRaw {
  job_id?: string;
  employer_name?: string;
  employer_logo?: string;
  employer_website?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_title?: string;
  job_apply_link?: string;
  job_apply_is_direct?: boolean;
  job_description?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_salary_period?: string;
  job_highlights?: {
    Qualifications?: string[];
    Responsibilities?: string[];
    Benefits?: string[];
  };
  job_required_skills?: string[] | null;
}

interface JSearchResponse {
  status?: string;
  request_id?: string;
  error?: { message?: string } | string;
  message?: string;
  data?: JSearchJobRaw[];
}

function getApiKey(): string {
  const key = process.env.JSEARCH_RAPIDAPI_KEY;
  if (!key || key.trim().length === 0) {
    throw new AuthFailedError();
  }
  return key.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJSearch(
  url: string,
  apiKey: string,
  timeoutMs: number
): Promise<{ statusCode: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": JSEARCH_HOST,
        "user-agent": "hiresignal-mcp/0.1",
      },
    });
    const body = await res.body.text();
    return { statusCode: res.statusCode, body };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamTimeoutError("jsearch", timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function jsearchSearch(
  params: JSearchSearchParams,
  opts: { timeoutMs?: number; bypassCache?: boolean } = {}
): Promise<JSearchJobRaw[]> {
  const apiKey = getApiKey();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const queryParts = [params.query.trim()];
  if (params.employer) queryParts.push(`at ${params.employer}`);
  if (params.location) queryParts.push(`in ${params.location}`);
  const fullQuery = queryParts.filter(Boolean).join(" ");

  const qs = new URLSearchParams({
    query: fullQuery,
    page: String(params.page ?? 1),
    num_pages: String(params.num_pages ?? 1),
  });
  if (params.date_posted) qs.set("date_posted", params.date_posted);
  if (params.remote_only) qs.set("remote_jobs_only", "true");
  if (params.employment_types && params.employment_types.length > 0) {
    qs.set("employment_types", params.employment_types.join(","));
  }

  const cacheKey = stableKey({
    provider: "jsearch",
    query: fullQuery,
    date_posted: params.date_posted ?? "",
    remote_only: params.remote_only ?? false,
    employment_types: params.employment_types ?? [],
    page: params.page ?? 1,
    num_pages: params.num_pages ?? 1,
  });

  if (!opts.bypassCache) {
    const cached = jobSearchCache.get(cacheKey);
    if (cached) return cached as JSearchJobRaw[];
  }

  const url = `${JSEARCH_BASE}?${qs.toString()}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { statusCode, body } = await fetchJSearch(url, apiKey, timeoutMs);

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
          throw new UpstreamError("jsearch", statusCode, body);
        }
        await sleep(backoffMs);
        continue;
      }
      if (statusCode !== 200) {
        throw new UpstreamError("jsearch", statusCode, body);
      }

      let parsed: JSearchResponse;
      try {
        parsed = JSON.parse(body) as JSearchResponse;
      } catch {
        throw new UpstreamError("jsearch", statusCode, "invalid JSON body");
      }

      const errMsg =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error?.message ?? parsed.message;
      if (errMsg) {
        if (/quota|limit|plan|exceeded/i.test(errMsg)) {
          throw new QuotaExhaustedError(3600);
        }
        throw new UpstreamError("jsearch", statusCode, errMsg);
      }

      const data = parsed.data ?? [];
      jobSearchCache.set(cacheKey, data);
      return data;
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
  throw new UpstreamError("jsearch", 0, "unknown failure");
}

export function jsearchLocationString(job: JSearchJobRaw): string {
  return [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ");
}
