import { beforeEach, describe, expect, it, vi } from "vitest";

import { jobSearchCache } from "../src/cache.js";
import { TokenBucketLimiter } from "../src/rateLimit.js";
import { RateLimitedError, InvalidInputError, AuthFailedError } from "../src/errors.js";
import {
  authenticate,
  extractApiKey,
  hashApiKeyForLog,
  loadAuthConfigFromEnv,
} from "../src/auth.js";
import {
  classifyDepartment,
  parseSalaryRange,
  percentile,
  normalizeCompanyName,
} from "../src/util/textAnalysis.js";

// ---- Mock undici.request for all tool tests ----
type MockResponse = { statusCode: number; body: string };
const mockResponses: MockResponse[] = [];

vi.mock("undici", () => {
  return {
    request: vi.fn(async () => {
      const next = mockResponses.shift();
      if (!next) {
        throw new Error("no mock response queued");
      }
      return {
        statusCode: next.statusCode,
        body: {
          text: async (): Promise<string> => next.body,
        },
      };
    }),
  };
});

function queueResponse(status: number, body: unknown): void {
  mockResponses.push({ statusCode: status, body: typeof body === "string" ? body : JSON.stringify(body) });
}

// Now we can import the tools (they import undici lazily through the mock)
import { searchJobs } from "../src/tools/searchJobs.js";
import { rerankByLocation, scoreLocationMatch } from "../src/api/serpapi.js";
import { companyHiringVelocity } from "../src/tools/companyVelocity.js";
import { skillDemandPulse } from "../src/tools/skillPulse.js";
import { marketSalaryEstimate } from "../src/tools/salaryEstimate.js";
import { industryHiringHeatmap } from "../src/tools/industryHeatmap.js";
import { competitorTalentIntel } from "../src/tools/competitorIntel.js";
import { jobAlertCheck } from "../src/tools/jobAlertCheck.js";
import { getServerStatus } from "../src/tools/serverStatus.js";
import { getCorpus, resetCorpus } from "../src/store/corpus.js";

beforeEach(() => {
  mockResponses.length = 0;
  jobSearchCache.clear();
  process.env.SERPAPI_KEY = "test-serpapi-key";
  process.env.JSEARCH_RAPIDAPI_KEY = "test-jsearch-key";
});

// ----- Pure helpers -----

describe("classifyDepartment", () => {
  it("classifies an ML engineer as data_ml", () => {
    expect(classifyDepartment("Senior Machine Learning Engineer")).toBe("data_ml");
  });
  it("classifies a backend engineer as engineering", () => {
    expect(classifyDepartment("Backend Software Engineer")).toBe("engineering");
  });
  it("classifies a PM as product", () => {
    expect(classifyDepartment("Senior Product Manager")).toBe("product");
  });
  it("falls back to other for unknown titles", () => {
    expect(classifyDepartment("Chief Vibes Officer")).toBe("other");
  });
});

describe("parseSalaryRange", () => {
  it("parses a $-formatted range with k suffix", () => {
    const parsed = parseSalaryRange("Comp band: $180k - $220k base");
    expect(parsed).not.toBeNull();
    expect(parsed!.min).toBe(180_000);
    expect(parsed!.max).toBe(220_000);
    expect(parsed!.midpoint).toBe(200_000);
  });
  it("parses a full-number USD range", () => {
    const parsed = parseSalaryRange("Salary $150,000 - $200,000");
    expect(parsed).not.toBeNull();
    expect(parsed!.min).toBe(150_000);
    expect(parsed!.max).toBe(200_000);
  });
  it("returns null when no salary present", () => {
    expect(parseSalaryRange("Great team, fun work, no comp mentioned")).toBeNull();
  });
});

describe("percentile + normalizeCompanyName", () => {
  it("computes interpolated percentiles", () => {
    expect(percentile([100, 200, 300, 400], 0.5)).toBeCloseTo(250);
    expect(percentile([100, 200, 300, 400], 0.25)).toBeCloseTo(175);
    expect(percentile([100, 200, 300, 400], 0.75)).toBeCloseTo(325);
  });
  it("normalizes company names by stripping legal suffixes", () => {
    expect(normalizeCompanyName("OpenAI, Inc.")).toBe("openai");
    expect(normalizeCompanyName("Stripe LLC")).toBe("stripe");
  });
});

// ----- Rate limiter -----

describe("TokenBucketLimiter", () => {
  it("allows up to capacity then throws RateLimitedError", () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 1 });
    limiter.consume("user-1");
    limiter.consume("user-1");
    limiter.consume("user-1");
    expect(() => limiter.consume("user-1")).toThrow(RateLimitedError);
  });
  it("isolates buckets per key", () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.1 });
    limiter.consume("a");
    expect(() => limiter.consume("a")).toThrow(RateLimitedError);
    expect(() => limiter.consume("b")).not.toThrow();
  });
});

// ----- SerpApi location rerank -----

describe("scoreLocationMatch + rerankByLocation", () => {
  it("scores exact location matches highest", () => {
    const a = scoreLocationMatch({ title: "x", location: "Austin, TX" }, "Austin, TX");
    const b = scoreLocationMatch({ title: "x", location: "Austin, TX" }, "Austin");
    const c = scoreLocationMatch({ title: "x", location: "Dallas, TX" }, "Austin, TX");
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("treats 'remote' as a match when work_from_home is true", () => {
    const remoteFlag = scoreLocationMatch(
      { title: "x", location: "United States", detected_extensions: { work_from_home: true } },
      "Remote"
    );
    const nonRemote = scoreLocationMatch({ title: "x", location: "Austin, TX" }, "Remote");
    expect(remoteFlag).toBeGreaterThan(0);
    expect(nonRemote).toBe(0);
  });

  it("filters to matches when at least 3 match", () => {
    const jobs = [
      { title: "j1", location: "Dallas, TX" },
      { title: "j2", location: "Austin, TX" },
      { title: "j3", location: "Houston, TX" },
      { title: "j4", location: "Austin, TX" },
      { title: "j5", location: "Austin, TX" },
    ];
    const reranked = rerankByLocation(jobs, "Austin, TX");
    expect(reranked).toHaveLength(3);
    for (const j of reranked) {
      expect(j.location).toContain("Austin");
    }
  });

  it("falls back to all results when fewer than 3 match, with matches first", () => {
    const jobs = [
      { title: "j1", location: "Dallas, TX" },
      { title: "j2", location: "Austin, TX" },
      { title: "j3", location: "Houston, TX" },
      { title: "j4", location: "Phoenix, AZ" },
    ];
    const reranked = rerankByLocation(jobs, "Austin, TX");
    expect(reranked).toHaveLength(4);
    expect(reranked[0]?.location).toContain("Austin");
  });

  it("returns jobs unchanged when no location is requested", () => {
    const jobs = [
      { title: "j1", location: "A" },
      { title: "j2", location: "B" },
    ];
    expect(rerankByLocation(jobs, undefined)).toEqual(jobs);
    expect(rerankByLocation(jobs, "")).toEqual(jobs);
  });
});

// ----- searchJobs (SerpApi) -----

describe("searchJobs (SerpApi)", () => {
  const serpApiPayload = {
    jobs_results: [
      {
        job_id: "1",
        title: "Senior ML Engineer",
        company_name: "Acme AI",
        location: "Austin, TX",
        via: "via LinkedIn",
        detected_extensions: {
          posted_at: "2 hours ago",
          salary: "$180k - $220k a year",
          work_from_home: true,
        },
        apply_options: [{ link: "https://acme.example/jobs/1", title: "Apply on Acme" }],
      },
      {
        job_id: "2",
        title: "Staff ML Engineer",
        company_name: "Beta Labs",
        location: "Austin, TX",
        detected_extensions: { posted_at: "1 day ago" },
      },
    ],
    search_metadata: { status: "Success" },
  };

  it("returns normalized jobs with consistent shape", async () => {
    queueResponse(200, serpApiPayload);
    const result = await searchJobs({
      query: "ML engineer",
      location: "Austin, TX",
      date_posted: "24h",
      limit: 5,
    });
    expect(result.count).toBe(2);
    expect(result.jobs[0]).toMatchObject({
      title: "Senior ML Engineer",
      company: "Acme AI",
      remote: true,
      salary_range: "$180k - $220k a year",
    });
    expect(result.jobs[1]?.salary_range).toBeNull();
  });

  it("throws InvalidInputError for missing query", async () => {
    await expect(searchJobs({ query: "", location: "Remote" })).rejects.toBeInstanceOf(
      InvalidInputError
    );
  });

  it("throws AuthFailedError when SerpApi key missing", async () => {
    delete process.env.SERPAPI_KEY;
    await expect(
      searchJobs({ query: "ML engineer", location: "Austin, TX", date_posted: "24h" })
    ).rejects.toBeInstanceOf(AuthFailedError);
  });
});

// ----- companyVelocity (JSearch) -----

describe("companyHiringVelocity", () => {
  it("falls back to the aggregator for a company outside the corpus", async () => {
    // "Globex" is not a tracked target, so this exercises the aggregator path
    // deterministically regardless of whether a local corpus has been ingested.
    const recent = {
      data: Array.from({ length: 4 }, (_, i) => ({
        job_id: `r${i}`,
        employer_name: "Globex",
        job_title: i % 2 === 0 ? "Software Engineer" : "Product Manager",
      })),
    };
    const monthly = {
      data: Array.from({ length: 12 }, (_, i) => ({
        job_id: `m${i}`,
        employer_name: "Globex",
        job_title: i % 3 === 0 ? "ML Engineer" : "Software Engineer",
      })),
    };
    queueResponse(200, recent);
    queueResponse(200, monthly);

    const result = await companyHiringVelocity({ company_name: "Globex", time_window_days: 7 });
    expect(result.company_name).toBe("Globex");
    expect(result.data_source).toBe("aggregated_api");
    expect(result.roles_added_last_7d).toBe(4);
    expect(result.roles_added_last_30d).toBe(12);
    expect(result.top_departments_hiring.length).toBeGreaterThan(0);
    expect(["growing", "stable", "shrinking"]).toContain(result.hiring_trend);
  });

  it("uses the first-party corpus for a tracked company", async () => {
    resetCorpus(":memory:");
    const corpus = getCorpus();
    corpus.ingestCompany(
      { company: "Stripe", provider: "greenhouse", boardId: "stripe", industry: "fintech" },
      [
        { externalId: "1", title: "Backend Engineer", department: "engineering", location: "Remote", remote: true, postedAt: new Date().toISOString(), url: "u" },
        { externalId: "2", title: "Account Executive", department: "sales", location: "NYC", remote: false, postedAt: new Date().toISOString(), url: "u" },
      ]
    );

    const result = await companyHiringVelocity({ company_name: "Stripe", time_window_days: 7 });
    expect(result.data_source).toBe("first_party_ats");
    expect(result.total_open_roles).toBe(2);
    expect(result.roles_added_last_7d).toBe(2);
    resetCorpus();
  });
});

// ----- skillDemandPulse -----

describe("skillDemandPulse", () => {
  it("computes WoW change and salary average from JSearch payloads", async () => {
    const weekJobs = {
      data: [
        {
          job_id: "w1",
          employer_name: "Foundry",
          job_title: "Rust Backend Engineer",
          job_description: "We use Rust extensively",
          job_min_salary: 180000,
          job_max_salary: 220000,
        },
        {
          job_id: "w2",
          employer_name: "Foundry",
          job_title: "Senior Rust Engineer",
          job_description: "Rust + tokio",
          job_min_salary: 170000,
          job_max_salary: 200000,
        },
      ],
    };
    const monthJobs = {
      data: [
        ...weekJobs.data,
        { job_id: "m1", employer_name: "Crab Co", job_title: "Rust SRE", job_description: "Rust" },
        { job_id: "m2", employer_name: "Crab Co", job_title: "Backend Engineer (Rust)", job_description: "Rust" },
        { job_id: "m3", employer_name: "Crab Co", job_title: "Rust Engineer", job_description: "Rust" },
      ],
    };
    queueResponse(200, weekJobs);
    queueResponse(200, monthJobs);

    const result = await skillDemandPulse({ skill: "Rust" });
    expect(result.job_count).toBe(2);
    expect(result.avg_salary_mention).not.toBeNull();
    expect(result.top_companies_hiring_this_skill[0]?.company).toBe("Foundry");
    expect(result.salary_sample_size).toBe(2);
  });
});

// ----- marketSalaryEstimate -----

describe("marketSalaryEstimate", () => {
  it("returns p25/median/p75 with sample size", async () => {
    const data = {
      data: [
        { job_id: "1", job_title: "Senior PM", job_min_salary: 150000, job_max_salary: 180000, job_is_remote: false },
        { job_id: "2", job_title: "Senior PM", job_min_salary: 160000, job_max_salary: 200000, job_is_remote: false },
        { job_id: "3", job_title: "Senior PM", job_min_salary: 170000, job_max_salary: 210000, job_is_remote: true },
        { job_id: "4", job_title: "Senior PM", job_min_salary: 180000, job_max_salary: 220000, job_is_remote: true },
        { job_id: "5", job_title: "Senior PM", job_min_salary: 200000, job_max_salary: 240000, job_is_remote: true },
        { job_id: "6", job_title: "Senior PM", job_min_salary: 140000, job_max_salary: 170000, job_is_remote: false },
      ],
    };
    queueResponse(200, data);

    const result = await marketSalaryEstimate({
      job_title: "Product Manager",
      location: "San Francisco, CA",
      experience_level: "senior",
    });
    expect(result.sample_size).toBe(6);
    expect(result.median_salary).toBeGreaterThan(result.p25_salary);
    expect(result.p75_salary).toBeGreaterThan(result.median_salary);
  });

  it("rejects invalid experience level", async () => {
    await expect(
      marketSalaryEstimate({ job_title: "PM", location: "SF", experience_level: "wizard" })
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

// ----- industryHiringHeatmap -----

describe("industryHiringHeatmap", () => {
  it("returns rows sorted by open_roles_count", async () => {
    const recent = {
      data: [
        { job_id: "1", job_title: "Software Engineer" },
        { job_id: "2", job_title: "Backend Engineer" },
        { job_id: "3", job_title: "Account Executive" },
        { job_id: "4", job_title: "Data Scientist" },
      ],
    };
    const monthly = {
      data: [
        ...recent.data,
        { job_id: "5", job_title: "Software Engineer" },
        { job_id: "6", job_title: "ML Engineer" },
        { job_id: "7", job_title: "Marketing Manager" },
      ],
    };
    queueResponse(200, recent);
    queueResponse(200, monthly);

    const result = await industryHiringHeatmap({ industry: "fintech", date_range_days: 7 });
    expect(result.heatmap.length).toBeGreaterThan(0);
    for (let i = 1; i < result.heatmap.length; i++) {
      const prev = result.heatmap[i - 1]!;
      const curr = result.heatmap[i]!;
      expect(prev.open_roles_count).toBeGreaterThanOrEqual(curr.open_roles_count);
    }
  });
});

// ----- competitorTalentIntel -----

describe("competitorTalentIntel", () => {
  it("aggregates per-company entries", async () => {
    // For each company: recent then monthly response (2 companies = 4 responses)
    const recentA = { data: [{ job_id: "ra1", employer_name: "OpenAI", job_title: "Research Engineer" }] };
    const monthlyA = {
      data: [
        ...recentA.data,
        { job_id: "ma1", employer_name: "OpenAI", job_title: "Software Engineer" },
        { job_id: "ma2", employer_name: "OpenAI", job_title: "Software Engineer" },
      ],
    };
    const recentB = { data: [{ job_id: "rb1", employer_name: "Anthropic", job_title: "Research Engineer" }] };
    const monthlyB = {
      data: [
        ...recentB.data,
        { job_id: "mb1", employer_name: "Anthropic", job_title: "Product Manager" },
      ],
    };
    queueResponse(200, recentA);
    queueResponse(200, monthlyA);
    queueResponse(200, recentB);
    queueResponse(200, monthlyB);

    const result = await competitorTalentIntel({ company_names: ["OpenAI", "Anthropic"] });
    expect(result.companies).toHaveLength(2);
    const openai = result.companies.find((c) => c.company === "OpenAI");
    expect(openai?.open_roles).toBe(3);
  });

  it("rejects more than 5 companies", async () => {
    await expect(
      competitorTalentIntel({ company_names: ["a", "b", "c", "d", "e", "f"] })
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

// ----- jobAlertCheck -----

describe("jobAlertCheck", () => {
  it("filters jobs to the requested window", async () => {
    queueResponse(200, {
      jobs_results: [
        {
          job_id: "j1",
          title: "Staff Engineer",
          company_name: "Acme",
          location: "London",
          detected_extensions: { posted_at: "3 hours ago" },
          apply_options: [{ link: "https://acme.example/j1" }],
        },
        {
          job_id: "j2",
          title: "Staff Engineer",
          company_name: "Beta",
          location: "London",
          detected_extensions: { posted_at: "5 days ago" },
        },
      ],
    });
    const result = await jobAlertCheck({
      query: "Staff Engineer",
      location: "London",
      since_hours: 24,
    });
    expect(result.new_postings_count).toBe(1);
    expect(result.jobs[0]?.company).toBe("Acme");
  });
});

// ----- getServerStatus -----

describe("getServerStatus", () => {
  it("reports status 'ok' when at least one provider is configured", async () => {
    const result = await getServerStatus({});
    expect(result.status).toBe("ok");
    expect(result.providers.serpapi_configured).toBe(true);
    expect(result.providers.jsearch_configured).toBe(true);
    expect(result.version).toBeTruthy();
  });

  it("reports 'degraded' when no providers and an empty corpus", async () => {
    delete process.env.SERPAPI_KEY;
    delete process.env.JSEARCH_RAPIDAPI_KEY;
    resetCorpus(":memory:"); // isolate from any locally-ingested data/corpus.db
    const result = await getServerStatus({});
    expect(result.status).toBe("degraded");
    expect(result.providers.first_party_corpus).toBe(false);
    resetCorpus();
  });

  it("reports 'ok' when the corpus is active even without provider keys", async () => {
    delete process.env.SERPAPI_KEY;
    delete process.env.JSEARCH_RAPIDAPI_KEY;
    resetCorpus(":memory:");
    getCorpus().ingestCompany(
      { company: "Stripe", provider: "greenhouse", boardId: "stripe", industry: "fintech" },
      [{ externalId: "1", title: "Engineer", department: "engineering", location: "Remote", remote: true, postedAt: null, url: "u" }]
    );
    const result = await getServerStatus({});
    expect(result.status).toBe("ok");
    expect(result.providers.first_party_corpus).toBe(true);
    expect(result.corpus.open_roles).toBe(1);
    resetCorpus();
  });
});

// ----- auth -----

describe("loadAuthConfigFromEnv", () => {
  it("treats empty env as open mode", () => {
    const cfg = loadAuthConfigFromEnv({});
    expect(cfg.openMode).toBe(true);
    expect(cfg.configuredKeyDigests).toEqual([]);
  });

  it("parses HIRESIGNAL_API_KEY as a single-key allowlist", () => {
    const cfg = loadAuthConfigFromEnv({ HIRESIGNAL_API_KEY: "only-key" });
    expect(cfg.openMode).toBe(false);
    expect(cfg.configuredKeyDigests).toHaveLength(1);
  });

  it("parses HIRESIGNAL_API_KEYS as a comma-separated allowlist and trims whitespace", () => {
    const cfg = loadAuthConfigFromEnv({ HIRESIGNAL_API_KEYS: " k1 , k2 ,, k3 " });
    expect(cfg.openMode).toBe(false);
    expect(cfg.configuredKeyDigests).toHaveLength(3);
  });

  it("prefers HIRESIGNAL_API_KEYS over HIRESIGNAL_API_KEY when both are set", () => {
    const cfg = loadAuthConfigFromEnv({
      HIRESIGNAL_API_KEYS: "a,b",
      HIRESIGNAL_API_KEY: "ignored",
    });
    expect(cfg.configuredKeyDigests).toHaveLength(2);
  });
});

describe("authenticate", () => {
  it("allows any caller in open mode, including no key at all", () => {
    const cfg = loadAuthConfigFromEnv({});
    expect(() => authenticate(undefined, cfg)).not.toThrow();
    expect(() => authenticate("whatever", cfg)).not.toThrow();
  });

  it("rejects missing keys when an allowlist is configured", () => {
    const cfg = loadAuthConfigFromEnv({ HIRESIGNAL_API_KEYS: "good" });
    expect(() => authenticate(undefined, cfg)).toThrow(AuthFailedError);
    expect(() => authenticate("", cfg)).toThrow(AuthFailedError);
  });

  it("rejects unknown keys", () => {
    const cfg = loadAuthConfigFromEnv({ HIRESIGNAL_API_KEYS: "good" });
    expect(() => authenticate("bad", cfg)).toThrow(AuthFailedError);
  });

  it("accepts any configured key", () => {
    const cfg = loadAuthConfigFromEnv({ HIRESIGNAL_API_KEYS: "alpha,beta,gamma" });
    expect(() => authenticate("alpha", cfg)).not.toThrow();
    expect(() => authenticate("beta", cfg)).not.toThrow();
    expect(() => authenticate("gamma", cfg)).not.toThrow();
  });

  it("does not leak length information via early exit on shorter input", () => {
    // Mostly a sanity check that we don't crash on length-mismatched input —
    // the SHA-256 digest comparison handles arbitrary input lengths safely.
    const cfg = loadAuthConfigFromEnv({ HIRESIGNAL_API_KEYS: "a-very-long-configured-key" });
    expect(() => authenticate("x", cfg)).toThrow(AuthFailedError);
    expect(() => authenticate("a-very-long-configured-key-extra", cfg)).toThrow(AuthFailedError);
  });
});

describe("extractApiKey", () => {
  function fakeReq(opts: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
  }): { header: (n: string) => string | undefined; query: Record<string, string> } {
    const headers = opts.headers ?? {};
    return {
      header: (name: string) => headers[name.toLowerCase()],
      query: opts.query ?? {},
    };
  }

  it("reads a bearer token from the Authorization header", () => {
    const req = fakeReq({ headers: { authorization: "Bearer my-key" } });
    expect(extractApiKey(req as never)).toBe("my-key");
  });

  it("reads from x-api-key when Authorization is absent", () => {
    const req = fakeReq({ headers: { "x-api-key": "my-key" } });
    expect(extractApiKey(req as never)).toBe("my-key");
  });

  it("falls back to the api_key query param", () => {
    const req = fakeReq({ query: { api_key: "my-key" } });
    expect(extractApiKey(req as never)).toBe("my-key");
  });

  it("returns undefined when no key is presented", () => {
    expect(extractApiKey(fakeReq({}) as never)).toBeUndefined();
  });
});

describe("hashApiKeyForLog", () => {
  it("returns 'anonymous' when no key is present", () => {
    expect(hashApiKeyForLog(undefined)).toBe("anonymous");
  });

  it("returns a deterministic 16-char prefix of the SHA-256 digest", () => {
    expect(hashApiKeyForLog("same")).toBe(hashApiKeyForLog("same"));
    expect(hashApiKeyForLog("a")).not.toBe(hashApiKeyForLog("b"));
    expect(hashApiKeyForLog("a")).toHaveLength(16);
  });
});
