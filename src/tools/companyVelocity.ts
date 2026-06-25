import { z } from "zod";
import { jsearchSearch, type JSearchJobRaw } from "../api/jsearch.js";
import { AuthFailedError, InvalidInputError } from "../errors.js";
import { classifyDepartment, normalizeCompanyName, topN, type Department } from "../util/textAnalysis.js";
import { findTarget } from "../targets.js";
import { getCorpus, type CorpusVelocity } from "../store/corpus.js";

export const CompanyVelocityInput = z.object({
  company_name: z
    .string()
    .min(1)
    .max(120)
    .describe("Exact or near-exact company name. Examples: 'Stripe', 'OpenAI', 'Anthropic'."),
  time_window_days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe("Time window (1-30 days) used for the recent posting count."),
});

export type CompanyVelocityArgs = z.infer<typeof CompanyVelocityInput>;

export type HiringTrend = "growing" | "stable" | "shrinking";

export type DataSource = "first_party_ats" | "aggregated_api";

export interface CompanyVelocityResult {
  company_name: string;
  total_open_roles: number;
  roles_added_last_7d: number;
  roles_added_last_30d: number;
  roles_closed_last_30d: number | null;
  top_departments_hiring: Array<{ department: Department; count: number }>;
  hiring_trend: HiringTrend;
  signal_confidence: "low" | "medium" | "high";
  /**
   * Where this signal came from. "first_party_ats" = computed from our own
   * scraped time-series (preferred, higher confidence, includes role closures);
   * "aggregated_api" = derived live from a third-party search aggregator.
   */
  data_source: DataSource;
  notes: string;
}

function uniqueByJobId(jobs: JSearchJobRaw[]): JSearchJobRaw[] {
  const seen = new Set<string>();
  const out: JSearchJobRaw[] = [];
  for (const j of jobs) {
    const key = j.job_id ?? `${j.employer_name ?? ""}::${j.job_title ?? ""}::${j.job_city ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

function filterToCompany(jobs: JSearchJobRaw[], company: string): JSearchJobRaw[] {
  const target = normalizeCompanyName(company);
  return jobs.filter((j) => {
    if (!j.employer_name) return false;
    const candidate = normalizeCompanyName(j.employer_name);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
}

export async function companyHiringVelocity(rawInput: unknown): Promise<CompanyVelocityResult> {
  const parsed = CompanyVelocityInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new InvalidInputError(`company_hiring_velocity: ${msg}`);
  }
  const args = parsed.data;

  // Prefer the first-party corpus: if we track this company and have ingested
  // it, the signal comes from our own scraped time-series — more accurate, and
  // it knows about role closures and real posted dates the aggregator can't see.
  const target = findTarget(args.company_name);
  if (target) {
    const cv = getCorpus().velocity(target.company, args.time_window_days);
    if (cv.found) {
      return fromCorpus(target.company, cv);
    }
  }

  // Fallback: company not in the curated corpus (or never ingested). Derive a
  // live estimate from the aggregator if a key is configured.
  return velocityFromAggregator(args);
}

function fromCorpus(company: string, cv: CorpusVelocity): CompanyVelocityResult {
  const historyNote =
    cv.observed_days >= 1
      ? `${cv.observed_days}d of history across ${cv.snapshots} snapshots`
      : `first snapshot (trend inferred from ATS posted dates; sharpens as history accrues)`;
  const notes =
    cv.total_open_roles === 0
      ? "Company is tracked but currently shows no open roles."
      : `First-party signal from the company's own ATS. ${cv.total_open_roles} open roles, ` +
        `${cv.roles_added_last_30d} added / ${cv.roles_closed_last_30d} closed in 30d; ${historyNote}. ` +
        `${Math.round(cv.posted_date_coverage * 100)}% of roles carry a real posted date.`;

  return {
    company_name: company,
    total_open_roles: cv.total_open_roles,
    roles_added_last_7d: cv.roles_added_last_7d,
    roles_added_last_30d: cv.roles_added_last_30d,
    roles_closed_last_30d: cv.roles_closed_last_30d,
    top_departments_hiring: cv.top_departments.map((d) => ({ department: d.department, count: d.count })),
    hiring_trend: cv.trend,
    signal_confidence: cv.confidence,
    data_source: "first_party_ats",
    notes,
  };
}

async function velocityFromAggregator(args: CompanyVelocityArgs): Promise<CompanyVelocityResult> {
  let recent: JSearchJobRaw[];
  let monthly: JSearchJobRaw[];
  try {
    [recent, monthly] = await Promise.all([
      jsearchSearch({
        query: args.company_name,
        employer: args.company_name,
        date_posted: args.time_window_days <= 3 ? "3days" : "week",
        num_pages: 2,
      }),
      jsearchSearch({
        query: args.company_name,
        employer: args.company_name,
        date_posted: "month",
        num_pages: 2,
      }),
    ]);
  } catch (err: unknown) {
    // No aggregator key and not in the corpus: return a clear, non-fatal answer
    // pointing at the fix, rather than surfacing an auth error for a data gap.
    if (err instanceof AuthFailedError) {
      return {
        company_name: args.company_name,
        total_open_roles: 0,
        roles_added_last_7d: 0,
        roles_added_last_30d: 0,
        roles_closed_last_30d: null,
        top_departments_hiring: [],
        hiring_trend: "stable",
        signal_confidence: "low",
        data_source: "aggregated_api",
        notes:
          "Not in the first-party corpus and no aggregator key configured. " +
          "Add this company to src/targets.ts and run `npm run ingest`, or set JSEARCH_RAPIDAPI_KEY.",
      };
    }
    throw err;
  }

  const recentMatched = uniqueByJobId(filterToCompany(recent, args.company_name));
  const monthlyMatched = uniqueByJobId(filterToCompany(monthly, args.company_name));

  const total = monthlyMatched.length;
  const last7d = recentMatched.length;
  const last30d = monthlyMatched.length;

  const deptCounts = new Map<Department, number>();
  for (const job of monthlyMatched) {
    const d = classifyDepartment(job.job_title);
    deptCounts.set(d, (deptCounts.get(d) ?? 0) + 1);
  }
  const topDepartments = topN(deptCounts, 5).map(({ key, count }) => ({ department: key, count }));

  const projected30FromRecent = last7d * (30 / Math.max(1, args.time_window_days));
  let trend: HiringTrend = "stable";
  if (projected30FromRecent > last30d * 1.2 && last7d >= 2) trend = "growing";
  else if (projected30FromRecent < last30d * 0.6 && last30d >= 5) trend = "shrinking";

  const confidence: CompanyVelocityResult["signal_confidence"] =
    last30d >= 25 ? "high" : last30d >= 8 ? "medium" : "low";

  const notes =
    last30d === 0
      ? "No matching postings found in the last 30 days. Company name may need to be more specific (try the legal entity), or add it to the first-party corpus for a stronger signal."
      : `Live estimate from a third-party aggregator: ${last30d} normalized postings in the last 30d; ${last7d} in the last ${args.time_window_days}d window. Add this company to the corpus for a higher-confidence, closure-aware signal.`;

  return {
    company_name: args.company_name,
    total_open_roles: total,
    roles_added_last_7d: last7d,
    roles_added_last_30d: last30d,
    roles_closed_last_30d: null,
    top_departments_hiring: topDepartments,
    hiring_trend: trend,
    signal_confidence: confidence,
    data_source: "aggregated_api",
    notes,
  };
}

export const companyVelocityToolDefinition = {
  name: "company_hiring_velocity",
  description:
    "Measure how fast a specific company is hiring right now — a proxy for budget unlocking and account expansion. For companies in our first-party corpus (scraped directly from their ATS), returns a time-series signal: total open roles, roles added/closed in the last 7d/30d, top departments hiring, and a 'growing/stable/shrinking' trend with confidence — plus a `data_source` of 'first_party_ats'. For others, falls back to a live aggregator estimate. Use for account scoring and prospecting ('is this account expanding = worth pursuing?'), competitive intel, or due diligence. Pass the company name plainly (e.g., 'Stripe', not 'stripe.com').",
  inputSchema: CompanyVelocityInput,
} as const;
