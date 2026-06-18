import { z } from "zod";
import { normalizeApplyUrl, searchJobsRaw } from "../api/serpapi.js";
import { InvalidInputError } from "../errors.js";

export const JobAlertCheckInput = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe("Job role, skill, or keyword to poll for. Examples: 'Staff Engineer', 'GenAI PM'."),
  location: z
    .string()
    .min(1)
    .max(100)
    .default("Remote")
    .describe("City, region, country, or 'Remote'."),
  since_hours: z
    .number()
    .int()
    .min(1)
    .max(168)
    .default(24)
    .describe("How many hours back to scan for new postings (1-168, i.e. up to 7 days)."),
});

export type JobAlertCheckArgs = z.infer<typeof JobAlertCheckInput>;

export interface JobAlertItem {
  job_id: string | null;
  title: string;
  company: string;
  location: string;
  posted_at: string;
  apply_url: string;
  salary_range: string | null;
  remote: boolean;
}

export interface JobAlertCheckResult {
  query: string;
  location: string;
  since_hours: number;
  new_postings_count: number;
  jobs: JobAlertItem[];
  notes: string;
}

function pickDatePosted(sinceHours: number): "today" | "3days" | "week" {
  if (sinceHours <= 24) return "today";
  if (sinceHours <= 72) return "3days";
  return "week";
}

function matchesWindow(postedAtText: string | undefined, sinceHours: number): boolean {
  if (!postedAtText) return true; // be permissive when unknown
  const lower = postedAtText.toLowerCase();
  const m = lower.match(/(\d+)\s*(minute|hour|day)/);
  if (!m) return true;
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n)) return true;
  const hours = unit === "minute" ? n / 60 : unit === "hour" ? n : n * 24;
  return hours <= sinceHours;
}

export async function jobAlertCheck(rawInput: unknown): Promise<JobAlertCheckResult> {
  const parsed = JobAlertCheckInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new InvalidInputError(`job_alert_check: ${msg}`);
  }
  const args = parsed.data;

  const jobs = await searchJobsRaw(
    {
      query: args.query,
      location: args.location,
      date_posted: pickDatePosted(args.since_hours),
      limit: 20,
    },
    { bypassCache: true }
  );

  const filtered = jobs.filter((j) => matchesWindow(j.detected_extensions?.posted_at, args.since_hours));

  const items: JobAlertItem[] = filtered.map((j) => ({
    job_id: j.job_id ?? null,
    title: j.title || "",
    company: j.company_name ?? "",
    location: j.location ?? "",
    posted_at: j.detected_extensions?.posted_at ?? "",
    apply_url: normalizeApplyUrl(j),
    salary_range: j.detected_extensions?.salary ?? null,
    remote: j.detected_extensions?.work_from_home === true,
  }));

  const notes =
    items.length === 0
      ? `No new postings detected in the last ${args.since_hours}h. Safe to poll again later.`
      : `Found ${items.length} postings within the last ${args.since_hours}h. Deduplicate against your prior poll using job_id when possible.`;

  return {
    query: args.query,
    location: args.location,
    since_hours: args.since_hours,
    new_postings_count: items.length,
    jobs: items,
    notes,
  };
}

export const jobAlertCheckToolDefinition = {
  name: "job_alert_check",
  description:
    "Poll for NEW job postings matching a role/location since N hours ago — built for sales/prospecting agents and cron loops that want fresh buying signals the moment they appear (a new 'VP Sales' or 'RevOps' req = an account going in-market). Cache is bypassed on every call. Returns posting IDs to deduplicate against prior runs.",
  inputSchema: JobAlertCheckInput,
} as const;
