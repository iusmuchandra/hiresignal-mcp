import { z } from "zod";
import { jsearchSearch, type JSearchJobRaw } from "../api/jsearch.js";
import { InvalidInputError } from "../errors.js";
import { parseSalaryRange, topN } from "../util/textAnalysis.js";

export const SkillPulseInput = z.object({
  skill: z
    .string()
    .min(1)
    .max(60)
    .describe(
      "Skill, technology, or named tool. Examples: 'Rust', 'Kubernetes', 'LangChain', 'Snowflake'."
    ),
  location: z
    .string()
    .max(100)
    .optional()
    .describe("Optional location filter. Examples: 'United States', 'London', 'Remote'."),
  industry: z
    .string()
    .max(80)
    .optional()
    .describe("Optional industry context to narrow the search. Examples: 'fintech', 'healthcare'."),
});

export type SkillPulseArgs = z.infer<typeof SkillPulseInput>;

export interface SkillPulseResult {
  skill: string;
  location: string | null;
  industry: string | null;
  job_count: number;
  prior_period_job_count: number;
  week_over_week_change_pct: number;
  avg_salary_mention: number | null;
  salary_sample_size: number;
  top_companies_hiring_this_skill: Array<{ company: string; count: number }>;
  notes: string;
}

function buildQuery(args: SkillPulseArgs): string {
  const parts = [args.skill];
  if (args.industry) parts.push(args.industry);
  return parts.join(" ");
}

function uniqueJobs(jobs: JSearchJobRaw[]): JSearchJobRaw[] {
  const seen = new Set<string>();
  const out: JSearchJobRaw[] = [];
  for (const j of jobs) {
    const key = j.job_id ?? `${j.employer_name ?? ""}::${j.job_title ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

function isSkillInJob(job: JSearchJobRaw, skill: string): boolean {
  const needle = skill.toLowerCase();
  const haystack = [
    job.job_title ?? "",
    job.job_description ?? "",
    ...(job.job_required_skills ?? []),
    ...(job.job_highlights?.Qualifications ?? []),
  ]
    .join(" \n ")
    .toLowerCase();
  return haystack.includes(needle);
}

export async function skillDemandPulse(rawInput: unknown): Promise<SkillPulseResult> {
  const parsed = SkillPulseInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new InvalidInputError(`skill_demand_pulse: ${msg}`);
  }
  const args = parsed.data;

  const baseQuery = buildQuery(args);

  const [weekResults, monthResults] = await Promise.all([
    jsearchSearch({
      query: baseQuery,
      location: args.location,
      date_posted: "week",
      num_pages: 2,
    }),
    jsearchSearch({
      query: baseQuery,
      location: args.location,
      date_posted: "month",
      num_pages: 2,
    }),
  ]);

  const weekJobs = uniqueJobs(weekResults).filter((j) => isSkillInJob(j, args.skill));
  const monthJobs = uniqueJobs(monthResults).filter((j) => isSkillInJob(j, args.skill));

  // Prior period = month minus week (rough)
  const weekIds = new Set(weekJobs.map((j) => j.job_id ?? ""));
  const priorJobs = monthJobs.filter((j) => !weekIds.has(j.job_id ?? ""));
  const priorWeeklyEstimate = priorJobs.length / 3; // weeks 2-4

  const jobCount = weekJobs.length;
  const wow =
    priorWeeklyEstimate > 0
      ? ((jobCount - priorWeeklyEstimate) / priorWeeklyEstimate) * 100
      : jobCount > 0
      ? 100
      : 0;

  const salaries: number[] = [];
  for (const job of weekJobs) {
    if (typeof job.job_min_salary === "number" && typeof job.job_max_salary === "number") {
      const mid = (job.job_min_salary + job.job_max_salary) / 2;
      // Annualize obvious hourly entries
      salaries.push(mid < 500 ? mid * 2080 : mid);
    } else {
      const parsed = parseSalaryRange(job.job_description);
      if (parsed) salaries.push(parsed.midpoint);
    }
  }

  const avgSalary = salaries.length > 0 ? Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length) : null;

  const companyCounts = new Map<string, number>();
  for (const j of weekJobs) {
    if (!j.employer_name) continue;
    companyCounts.set(j.employer_name, (companyCounts.get(j.employer_name) ?? 0) + 1);
  }
  const topCompanies = topN(companyCounts, 10).map(({ key, count }) => ({ company: key, count }));

  const notes =
    jobCount === 0
      ? "No postings mentioning this skill were found in the last 7 days. Skill name may need broader spelling."
      : `Sampled ${jobCount} postings this week and ~${Math.round(priorWeeklyEstimate)} per week prior.`;

  return {
    skill: args.skill,
    location: args.location ?? null,
    industry: args.industry ?? null,
    job_count: jobCount,
    prior_period_job_count: Math.round(priorWeeklyEstimate),
    week_over_week_change_pct: Math.round(wow * 10) / 10,
    avg_salary_mention: avgSalary,
    salary_sample_size: salaries.length,
    top_companies_hiring_this_skill: topCompanies,
    notes,
  };
}

export const skillPulseToolDefinition = {
  name: "skill_demand_pulse",
  description:
    "Measure how in-demand a specific skill (language, framework, tool) is right now, with a week-over-week trend, sample-based average salary mention, and the top companies posting roles requiring that skill. Use this for questions like 'Is Rust hot right now?' or 'Who is hiring for LangChain?'. Returns directional signal — sample sizes can be small for niche skills.",
  inputSchema: SkillPulseInput,
} as const;
