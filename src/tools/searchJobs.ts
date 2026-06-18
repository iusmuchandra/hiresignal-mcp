import { z } from "zod";
import { normalizeApplyUrl, searchJobsRaw, type SerpApiJobRaw } from "../api/serpapi.js";
import { InvalidInputError } from "../errors.js";

export const SearchJobsInput = z.object({
  query: z
    .string()
    .min(2, "query must be at least 2 characters")
    .max(200, "query must be 200 characters or fewer")
    .describe(
      "Job role, skill, or keyword to search for. Examples: 'ML engineer', 'senior product manager fintech', 'rust backend'."
    ),
  location: z
    .string()
    .min(1)
    .max(100)
    .default("Remote")
    .describe(
      "City, region, country, or 'Remote'. Examples: 'Austin, TX', 'London, UK', 'Remote'."
    ),
  date_posted: z
    .enum(["24h", "3d", "7d", "30d"])
    .default("7d")
    .describe("Filter for how recently the job was posted."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Maximum number of jobs to return (1-20)."),
});

export type SearchJobsArgs = z.infer<typeof SearchJobsInput>;

export interface SearchJobsResultItem {
  title: string;
  company: string;
  location: string;
  posted_at: string;
  apply_url: string;
  salary_range: string | null;
  remote: boolean;
  source: string;
  job_id: string | null;
}

export interface SearchJobsResult {
  query: string;
  location: string;
  date_posted: SearchJobsArgs["date_posted"];
  count: number;
  jobs: SearchJobsResultItem[];
}

const DATE_POSTED_MAP: Record<SearchJobsArgs["date_posted"], "today" | "3days" | "week" | "month"> = {
  "24h": "today",
  "3d": "3days",
  "7d": "week",
  "30d": "month",
};

function normalizeJob(raw: SerpApiJobRaw): SearchJobsResultItem {
  const ext = raw.detected_extensions ?? {};
  return {
    title: raw.title || "",
    company: raw.company_name ?? "",
    location: raw.location ?? "",
    posted_at: ext.posted_at ?? "",
    apply_url: normalizeApplyUrl(raw),
    salary_range: ext.salary ?? null,
    remote: ext.work_from_home === true,
    source: raw.via ?? "",
    job_id: raw.job_id ?? null,
  };
}

export async function searchJobs(rawInput: unknown): Promise<SearchJobsResult> {
  const parsed = SearchJobsInput.safeParse(rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new InvalidInputError(`search_jobs: ${msg}`);
  }
  const args = parsed.data;

  const jobs = await searchJobsRaw({
    query: args.query,
    location: args.location,
    date_posted: DATE_POSTED_MAP[args.date_posted],
    limit: args.limit,
  });

  return {
    query: args.query,
    location: args.location,
    date_posted: args.date_posted,
    count: jobs.length,
    jobs: jobs.map(normalizeJob),
  };
}

export const searchJobsToolDefinition = {
  name: "search_jobs",
  description:
    "Find live job postings matching a role/skill query in a specific location, filtered by how recently they were posted. Use this when the user wants concrete current openings (with apply links). Returns up to 20 jobs with title, company, location, posted date, salary (when published), and apply URL. Cache TTL is 15 minutes. Best for: 'find roles', 'who is hiring for X', 'recent postings'.",
  inputSchema: SearchJobsInput,
} as const;
