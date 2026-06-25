import { request } from "undici";
import { UpstreamError, UpstreamTimeoutError } from "../errors.js";
import { classifyDepartment } from "../util/textAnalysis.js";
import type { AtsPosting, WorkdayConfig } from "./types.js";

const PAGE_SIZE = 20; // Workday rejects larger limits with HTTP 400.
const MAX_PAGES = 200; // Safety cap (200 * 20 = 4000 roles) to bound pathological boards.
const PAGE_DELAY_MS = 120; // Be polite between pages.
const TIMEOUT_MS = 15_000;

interface WorkdayJob {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayPage {
  total?: number;
  jobPostings?: WorkdayJob[];
}

/**
 * Workday reports relative posted dates ("Posted Today", "Posted 5 Days Ago",
 * "Posted 30+ Days Ago"). Convert to an approximate ISO timestamp; "30+" is
 * left null (genuinely old/unknown) so it never inflates the added-in-Nd windows.
 * Exported for unit testing.
 */
export function parsePostedOn(postedOn: string | undefined, now: Date = new Date()): string | null {
  if (!postedOn) return null;
  const text = postedOn.toLowerCase();
  if (/\b30\+/.test(text)) return null;
  if (/today/.test(text)) return now.toISOString();
  if (/yesterday/.test(text)) return new Date(now.getTime() - 86_400_000).toISOString();
  const m = text.match(/(\d+)\s*\+?\s*days?\s*ago/);
  if (m) {
    const days = Number(m[1]);
    if (Number.isFinite(days)) return new Date(now.getTime() - days * 86_400_000).toISOString();
  }
  return null;
}

/** Pure normalizer for one Workday page — exported for unit testing. */
export function normalizeWorkday(page: WorkdayPage, host: string, now: Date = new Date()): AtsPosting[] {
  const jobs = page.jobPostings ?? [];
  const out: AtsPosting[] = [];
  for (const j of jobs) {
    if (!j.externalPath) continue;
    const title = j.title ?? "";
    const location = j.locationsText ?? "";
    out.push({
      externalId: j.externalPath,
      title,
      department: classifyDepartment(title),
      location,
      remote: /\bremote\b/i.test(location),
      postedAt: parsePostedOn(j.postedOn, now),
      url: `https://${host}${j.externalPath}`,
    });
  }
  return out;
}

async function fetchPage(cfg: WorkdayConfig, offset: number): Promise<WorkdayPage> {
  const url = `https://${cfg.host}/wday/cxs/${cfg.tenant}/${cfg.site}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await request(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "user-agent": "hiresignal-mcp (first-party ATS ingest)" },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: "" }),
    });
    const body = await res.body.text();
    if (res.statusCode !== 200) throw new UpstreamError("workday", res.statusCode, body.slice(0, 200));
    try {
      return JSON.parse(body) as WorkdayPage;
    } catch {
      throw new UpstreamError("workday", res.statusCode, "invalid JSON body");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") throw new UpstreamTimeoutError("workday", TIMEOUT_MS);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch ALL postings for a Workday tenant by paginating to `total`. Full
 * pagination is required so the corpus's close-out diff doesn't mistake
 * unfetched roles for closed ones.
 */
export async function fetchWorkday(cfg: WorkdayConfig, now: Date = new Date()): Promise<AtsPosting[]> {
  const first = await fetchPage(cfg, 0);
  const total = first.total ?? (first.jobPostings?.length ?? 0);
  const all: AtsPosting[] = normalizeWorkday(first, cfg.host, now);

  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
  for (let p = 1; p < pages; p++) {
    await sleep(PAGE_DELAY_MS);
    const page = await fetchPage(cfg, p * PAGE_SIZE);
    all.push(...normalizeWorkday(page, cfg.host, now));
  }
  return all;
}
