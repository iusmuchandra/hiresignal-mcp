import { z } from "zod";
import { jsearchSearch, type JSearchJobRaw } from "../api/jsearch.js";
import { InvalidInputError } from "../errors.js";
import { classifyDepartment, normalizeCompanyName, topN, type Department } from "../util/textAnalysis.js";

export const CompetitorIntelInput = z.object({
  company_names: z
    .array(z.string().min(1).max(120))
    .min(1, "at least one company is required")
    .max(5, "compare at most 5 companies at a time")
    .describe("List of 1-5 company names to compare side by side."),
});

export type CompetitorIntelArgs = z.infer<typeof CompetitorIntelInput>;

export type GrowthSignal = "growing" | "stable" | "shrinking" | "insufficient_data";

export interface CompetitorEntry {
  company: string;
  open_roles: number;
  open_roles_last_7d: number;
  top_roles_by_count: Array<{ title: string; count: number }>;
  top_departments: Array<{ department: Department; count: number }>;
  estimated_team_growth_signal: GrowthSignal;
}

export interface CompetitorIntelResult {
  companies: CompetitorEntry[];
  notes: string;
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

function matchesCompany(job: JSearchJobRaw, company: string): boolean {
  if (!job.employer_name) return false;
  const target = normalizeCompanyName(company);
  const candidate = normalizeCompanyName(job.employer_name);
  return candidate === target || candidate.includes(target) || target.includes(candidate);
}

function titleSignature(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b(senior|sr|junior|jr|staff|principal|lead|head of|associate|intern)\b/g, "")
    .replace(/[,/()\-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function gatherCompany(company: string): Promise<CompetitorEntry> {
  const [recent, monthly] = await Promise.all([
    jsearchSearch({ query: company, employer: company, date_posted: "week", num_pages: 2 }),
    jsearchSearch({ query: company, employer: company, date_posted: "month", num_pages: 2 }),
  ]);

  const recentMatched = uniqueJobs(recent).filter((j) => matchesCompany(j, company));
  const monthlyMatched = uniqueJobs(monthly).filter((j) => matchesCompany(j, company));

  const titleCounts = new Map<string, number>();
  const deptCounts = new Map<Department, number>();
  for (const job of monthlyMatched) {
    const sig = titleSignature(job.job_title ?? "");
    if (sig.length > 0) titleCounts.set(sig, (titleCounts.get(sig) ?? 0) + 1);
    deptCounts.set(classifyDepartment(job.job_title), (deptCounts.get(classifyDepartment(job.job_title)) ?? 0) + 1);
  }

  let signal: GrowthSignal = "insufficient_data";
  if (monthlyMatched.length >= 8) {
    const projected = recentMatched.length * (30 / 7);
    if (projected > monthlyMatched.length * 1.2) signal = "growing";
    else if (projected < monthlyMatched.length * 0.6) signal = "shrinking";
    else signal = "stable";
  }

  return {
    company,
    open_roles: monthlyMatched.length,
    open_roles_last_7d: recentMatched.length,
    top_roles_by_count: topN(titleCounts, 5).map(({ key, count }) => ({ title: key, count })),
    top_departments: topN(deptCounts, 5).map(({ key, count }) => ({ department: key, count })),
    estimated_team_growth_signal: signal,
  };
}

export async function competitorTalentIntel(rawInput: unknown): Promise<CompetitorIntelResult> {
  const parsed = CompetitorIntelInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new InvalidInputError(`competitor_talent_intel: ${msg}`);
  }
  const args = parsed.data;

  const entries = await Promise.all(args.company_names.map(gatherCompany));

  const noisy = entries.filter((e) => e.open_roles < 5).map((e) => e.company);
  const notes =
    noisy.length > 0
      ? `Low signal for: ${noisy.join(", ")}. Try the legal entity name (e.g., 'OpenAI, Inc.') or a more common spelling.`
      : "All companies returned a workable sample size.";

  return { companies: entries, notes };
}

export const competitorIntelToolDefinition = {
  name: "competitor_talent_intel",
  description:
    "Compare up to 5 companies side by side on current hiring: total open roles, postings in the last 7 days, the top recurring job titles, the top departments hiring, and a directional growth signal. Use this for competitive-intel questions like 'OpenAI vs Anthropic vs Mistral hiring activity' or 'Compare growth across our top 3 competitors'.",
  inputSchema: CompetitorIntelInput,
} as const;
