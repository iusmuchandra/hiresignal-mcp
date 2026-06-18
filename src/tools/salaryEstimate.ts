import { z } from "zod";
import { jsearchSearch, type JSearchJobRaw } from "../api/jsearch.js";
import { InvalidInputError } from "../errors.js";
import { parseSalaryRange, percentile } from "../util/textAnalysis.js";

export const SalaryEstimateInput = z.object({
  job_title: z
    .string()
    .min(2)
    .max(120)
    .describe("Job title. Examples: 'Senior Product Manager', 'Staff Software Engineer'."),
  location: z
    .string()
    .min(1)
    .max(100)
    .describe("Target market. Examples: 'San Francisco, CA', 'London, UK', 'United States'."),
  experience_level: z
    .enum(["entry", "mid", "senior", "staff"])
    .default("senior")
    .describe("Seniority bucket used to refine the search."),
});

export type SalaryEstimateArgs = z.infer<typeof SalaryEstimateInput>;

export interface SalaryEstimateResult {
  job_title: string;
  location: string;
  experience_level: SalaryEstimateArgs["experience_level"];
  median_salary: number;
  p25_salary: number;
  p75_salary: number;
  remote_premium_pct: number;
  sample_size: number;
  currency_hint: string;
  notes: string;
}

const LEVEL_KEYWORDS: Record<SalaryEstimateArgs["experience_level"], string> = {
  entry: "junior",
  mid: "mid level",
  senior: "senior",
  staff: "staff principal",
};

interface Sample {
  midpoint: number;
  remote: boolean;
  currency: string;
}

function extractSalary(job: JSearchJobRaw): Sample | null {
  let midpoint: number | null = null;
  let currency = job.job_salary_currency ?? "USD";
  if (typeof job.job_min_salary === "number" && typeof job.job_max_salary === "number") {
    const mid = (job.job_min_salary + job.job_max_salary) / 2;
    midpoint = mid < 500 ? mid * 2080 : mid;
  } else {
    const parsed = parseSalaryRange(job.job_description);
    if (parsed) midpoint = parsed.midpoint;
  }
  if (midpoint === null || !Number.isFinite(midpoint) || midpoint <= 0) return null;
  if (midpoint < 15000) return null; // implausible annual
  if (midpoint > 1_500_000) return null; // implausible outlier
  return { midpoint, remote: job.job_is_remote === true, currency };
}

export async function marketSalaryEstimate(rawInput: unknown): Promise<SalaryEstimateResult> {
  const parsed = SalaryEstimateInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new InvalidInputError(`market_salary_estimate: ${msg}`);
  }
  const args = parsed.data;

  const query = `${LEVEL_KEYWORDS[args.experience_level]} ${args.job_title}`;
  const results = await jsearchSearch({
    query,
    location: args.location,
    date_posted: "month",
    num_pages: 3,
  });

  const samples: Sample[] = [];
  const currencies = new Map<string, number>();
  for (const job of results) {
    const s = extractSalary(job);
    if (!s) continue;
    samples.push(s);
    currencies.set(s.currency, (currencies.get(s.currency) ?? 0) + 1);
  }

  const sorted = samples.map((s) => s.midpoint).sort((a, b) => a - b);
  const median = sorted.length > 0 ? Math.round(percentile(sorted, 0.5)) : 0;
  const p25 = sorted.length > 0 ? Math.round(percentile(sorted, 0.25)) : 0;
  const p75 = sorted.length > 0 ? Math.round(percentile(sorted, 0.75)) : 0;

  const remote = samples.filter((s) => s.remote).map((s) => s.midpoint);
  const onsite = samples.filter((s) => !s.remote).map((s) => s.midpoint);
  let remotePremiumPct = 0;
  if (remote.length >= 3 && onsite.length >= 3) {
    const remoteMedian = percentile([...remote].sort((a, b) => a - b), 0.5);
    const onsiteMedian = percentile([...onsite].sort((a, b) => a - b), 0.5);
    if (onsiteMedian > 0) {
      remotePremiumPct = Math.round(((remoteMedian - onsiteMedian) / onsiteMedian) * 1000) / 10;
    }
  }

  let topCurrency = "USD";
  let topCount = 0;
  for (const [cur, count] of currencies) {
    if (count > topCount) {
      topCurrency = cur;
      topCount = count;
    }
  }

  const notes =
    samples.length < 5
      ? `Low sample size (${samples.length}). Treat result as directional; widen the location or remove seniority to improve confidence.`
      : `Estimated from ${samples.length} postings with disclosed salary in the last 30 days.`;

  return {
    job_title: args.job_title,
    location: args.location,
    experience_level: args.experience_level,
    median_salary: median,
    p25_salary: p25,
    p75_salary: p75,
    remote_premium_pct: remotePremiumPct,
    sample_size: samples.length,
    currency_hint: topCurrency,
    notes,
  };
}

export const salaryEstimateToolDefinition = {
  name: "market_salary_estimate",
  description:
    "Estimate the current salary band (p25/median/p75) for a job title + location + seniority from postings that disclosed pay in the last 30 days, plus a remote vs onsite premium where data permits. Use for comp benchmarking, offer calibration, or enriching account/role records. Check the returned sample_size and notes — samples can be small in markets without pay-transparency laws.",
  inputSchema: SalaryEstimateInput,
} as const;
