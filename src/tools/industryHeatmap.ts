import { z } from "zod";
import { jsearchSearch, type JSearchJobRaw } from "../api/jsearch.js";
import { InvalidInputError } from "../errors.js";
import { classifyDepartment, type Department } from "../util/textAnalysis.js";

export const IndustryHeatmapInput = z.object({
  industry: z
    .string()
    .min(2)
    .max(80)
    .describe(
      "Industry vertical. Examples: 'fintech', 'biotech', 'climate tech', 'enterprise SaaS'."
    ),
  date_range_days: z
    .number()
    .int()
    .min(7)
    .max(30)
    .default(14)
    .describe("Length of the current period used in the heatmap (7-30 days)."),
});

export type IndustryHeatmapArgs = z.infer<typeof IndustryHeatmapInput>;

export interface IndustryHeatmapRow {
  department: Department;
  open_roles_count: number;
  change_from_prior_period_pct: number;
}

export interface IndustryHeatmapResult {
  industry: string;
  date_range_days: number;
  total_postings_sampled: number;
  prior_period_sampled: number;
  heatmap: IndustryHeatmapRow[];
  notes: string;
}

function uniqueJobs(jobs: JSearchJobRaw[]): JSearchJobRaw[] {
  const seen = new Set<string>();
  const out: JSearchJobRaw[] = [];
  for (const j of jobs) {
    const key = j.job_id ?? `${j.employer_name ?? ""}::${j.job_title ?? ""}::${j.job_posted_at_timestamp ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

function countByDepartment(jobs: JSearchJobRaw[]): Map<Department, number> {
  const counts = new Map<Department, number>();
  for (const j of jobs) {
    const d = classifyDepartment(j.job_title);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

export async function industryHiringHeatmap(rawInput: unknown): Promise<IndustryHeatmapResult> {
  const parsed = IndustryHeatmapInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new InvalidInputError(`industry_hiring_heatmap: ${msg}`);
  }
  const args = parsed.data;

  const recentWindow = args.date_range_days <= 7 ? "week" : "month";
  const [recent, monthly] = await Promise.all([
    jsearchSearch({
      query: args.industry,
      date_posted: recentWindow,
      num_pages: 3,
    }),
    jsearchSearch({
      query: args.industry,
      date_posted: "month",
      num_pages: 3,
    }),
  ]);

  const recentUnique = uniqueJobs(recent);
  const monthlyUnique = uniqueJobs(monthly);

  // Prior period = monthly minus recent
  const recentIds = new Set(recentUnique.map((j) => j.job_id ?? ""));
  const priorJobs = monthlyUnique.filter((j) => !recentIds.has(j.job_id ?? ""));

  const recentCounts = countByDepartment(recentUnique);
  const priorCounts = countByDepartment(priorJobs);

  const recentDays = recentWindow === "week" ? 7 : 30;
  const priorDays = Math.max(1, 30 - recentDays);

  const allDepts = new Set<Department>([...recentCounts.keys(), ...priorCounts.keys()]);
  const heatmap: IndustryHeatmapRow[] = [];

  for (const dept of allDepts) {
    const recentCount = recentCounts.get(dept) ?? 0;
    const priorCount = priorCounts.get(dept) ?? 0;
    const recentPerDay = recentCount / recentDays;
    const priorPerDay = priorCount / priorDays;
    let changePct = 0;
    if (priorPerDay > 0) {
      changePct = Math.round(((recentPerDay - priorPerDay) / priorPerDay) * 1000) / 10;
    } else if (recentCount > 0) {
      changePct = 100;
    }
    heatmap.push({
      department: dept,
      open_roles_count: recentCount,
      change_from_prior_period_pct: changePct,
    });
  }

  heatmap.sort((a, b) => b.open_roles_count - a.open_roles_count);

  const notes =
    recentUnique.length === 0
      ? "No recent postings found for that industry. Try a broader term (e.g., 'fintech' instead of a niche sub-vertical)."
      : `Sampled ${recentUnique.length} postings in the recent window vs ${priorJobs.length} in the prior window.`;

  return {
    industry: args.industry,
    date_range_days: args.date_range_days,
    total_postings_sampled: recentUnique.length,
    prior_period_sampled: priorJobs.length,
    heatmap,
    notes,
  };
}

export const industryHeatmapToolDefinition = {
  name: "industry_hiring_heatmap",
  description:
    "Show where an industry vertical is adding headcount right now, by department (engineering, data/ml, sales, product, etc.) with % change vs the prior period. Use for territory and market planning — find where the buying is happening this quarter ('which functions in fintech are expanding?') before you allocate reps or spend. Rows sorted by current open-roles count.",
  inputSchema: IndustryHeatmapInput,
} as const;
