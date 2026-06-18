import { z } from "zod";
import { jsearchSearch, type JSearchJobRaw } from "../api/jsearch.js";
import { InvalidInputError } from "../errors.js";
import { classifyDepartment, normalizeCompanyName, topN, type Department } from "../util/textAnalysis.js";

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

export interface CompanyVelocityResult {
  company_name: string;
  total_open_roles: number;
  roles_added_last_7d: number;
  roles_added_last_30d: number;
  top_departments_hiring: Array<{ department: Department; count: number }>;
  hiring_trend: HiringTrend;
  signal_confidence: "low" | "medium" | "high";
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

  const [recent, monthly] = await Promise.all([
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
      ? "No matching postings found in the last 30 days. Company name may need to be more specific (try the legal entity)."
      : `Based on ${last30d} normalized postings in the last 30d; ${last7d} in the last ${args.time_window_days}d window.`;

  return {
    company_name: args.company_name,
    total_open_roles: total,
    roles_added_last_7d: last7d,
    roles_added_last_30d: last30d,
    top_departments_hiring: topDepartments,
    hiring_trend: trend,
    signal_confidence: confidence,
    notes,
  };
}

export const companyVelocityToolDefinition = {
  name: "company_hiring_velocity",
  description:
    "Estimate how fast a specific company is hiring right now. Returns total open roles, postings added in the last 7d and 30d, the top departments they are hiring into, and a directional 'growing/stable/shrinking' trend with confidence. Use this when the user asks whether a company is scaling, freezing, or contracting. Pass the company name as plainly as possible (e.g., 'Stripe', not 'stripe.com').",
  inputSchema: CompanyVelocityInput,
} as const;
