import { describe, expect, it } from "vitest";

import { normalizeGreenhouse } from "../src/ats/greenhouse.js";
import { normalizeAshby } from "../src/ats/ashby.js";
import { normalizeLever } from "../src/ats/lever.js";
import { normalizeWorkday, parsePostedOn } from "../src/ats/workday.js";
import { Corpus } from "../src/store/corpus.js";
import type { AtsPosting, Target } from "../src/ats/types.js";

// ---------------------------------------------------------------------------
// Normalizers — pure, no network
// ---------------------------------------------------------------------------

describe("normalizeGreenhouse", () => {
  it("maps fields, classifies department, prefers first_published, detects remote", () => {
    const out = normalizeGreenhouse({
      jobs: [
        {
          id: 7954688,
          title: "Senior Backend Engineer",
          location: { name: "Remote, US" },
          first_published: "2026-06-02T08:58:57-04:00",
          updated_at: "2026-06-19T12:11:02-04:00",
          absolute_url: "https://stripe.com/jobs/7954688",
        },
      ],
    });
    expect(out).toHaveLength(1);
    const j = out[0]!;
    expect(j.externalId).toBe("7954688");
    expect(j.department).toBe("engineering");
    expect(j.remote).toBe(true);
    expect(j.postedAt).toBe(new Date("2026-06-02T08:58:57-04:00").toISOString());
    expect(j.url).toContain("stripe.com");
  });

  it("skips jobs without an id and tolerates missing fields", () => {
    const out = normalizeGreenhouse({ jobs: [{ title: "No ID" }, { id: 1 }] });
    expect(out).toHaveLength(1);
    expect(out[0]!.postedAt).toBeNull();
  });
});

describe("normalizeAshby", () => {
  it("uses native department, honors isRemote, drops unlisted", () => {
    const out = normalizeAshby({
      jobs: [
        {
          id: "abc",
          title: "Account Executive",
          department: "Sales",
          location: "New York, NY",
          isRemote: true,
          isListed: true,
          publishedAt: "2026-06-11T17:21:26.410+00:00",
          jobUrl: "https://jobs.ashbyhq.com/ramp/abc",
        },
        { id: "hidden", title: "Internal", isListed: false },
      ],
    });
    expect(out).toHaveLength(1);
    const j = out[0]!;
    expect(j.department).toBe("sales");
    expect(j.remote).toBe(true);
    expect(j.postedAt).toBe(new Date("2026-06-11T17:21:26.410+00:00").toISOString());
  });

  it("falls back to title classification for unknown departments", () => {
    const out = normalizeAshby({
      jobs: [{ id: "x", title: "Machine Learning Engineer", department: "Mystery Team" }],
    });
    expect(out[0]!.department).toBe("data_ml");
  });
});

describe("normalizeLever", () => {
  it("converts epoch createdAt to ISO and reads category location", () => {
    const created = Date.parse("2026-06-01T00:00:00Z");
    const out = normalizeLever([
      {
        id: "lev-1",
        text: "Product Manager",
        categories: { location: "Remote" },
        createdAt: created,
        hostedUrl: "https://jobs.lever.co/x/lev-1",
      },
    ]);
    expect(out[0]!.department).toBe("product");
    expect(out[0]!.remote).toBe(true);
    expect(out[0]!.postedAt).toBe(new Date(created).toISOString());
  });
});

describe("normalizeWorkday + parsePostedOn", () => {
  const now = new Date("2026-06-24T00:00:00Z");

  it("parses relative posted dates, treating 30+ as unknown", () => {
    expect(parsePostedOn("Posted Today", now)).toBe(now.toISOString());
    expect(parsePostedOn("Posted Yesterday", now)).toBe(
      new Date(now.getTime() - 86_400_000).toISOString()
    );
    expect(parsePostedOn("Posted 5 Days Ago", now)).toBe(
      new Date(now.getTime() - 5 * 86_400_000).toISOString()
    );
    expect(parsePostedOn("Posted 30+ Days Ago", now)).toBeNull();
    expect(parsePostedOn(undefined, now)).toBeNull();
  });

  it("normalizes job postings and builds absolute urls", () => {
    const out = normalizeWorkday(
      {
        total: 1,
        jobPostings: [
          {
            title: "Machine Learning Engineer",
            externalPath: "/job/Santa-Clara/Machine-Learning-Engineer_R1",
            locationsText: "Remote, US",
            postedOn: "Posted Today",
            bulletFields: ["R1"],
          },
        ],
      },
      "nvidia.wd5.myworkdayjobs.com",
      now
    );
    expect(out).toHaveLength(1);
    const j = out[0]!;
    expect(j.externalId).toBe("/job/Santa-Clara/Machine-Learning-Engineer_R1");
    expect(j.department).toBe("data_ml");
    expect(j.remote).toBe(true);
    expect(j.url).toBe("https://nvidia.wd5.myworkdayjobs.com/job/Santa-Clara/Machine-Learning-Engineer_R1");
    expect(j.postedAt).toBe(now.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Corpus — ingest diffing + velocity time-series (in-memory SQLite)
// ---------------------------------------------------------------------------

const TARGET: Target = { company: "Acme", provider: "greenhouse", boardId: "acme", industry: "saas" };

function posting(id: string, opts: Partial<AtsPosting> = {}): AtsPosting {
  return {
    externalId: id,
    title: opts.title ?? "Software Engineer",
    department: opts.department ?? "engineering",
    location: opts.location ?? "Remote",
    remote: opts.remote ?? true,
    postedAt: opts.postedAt ?? null,
    url: opts.url ?? `https://acme.example/${id}`,
  };
}

function daysAgo(now: Date, n: number): string {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe("Corpus ingest + velocity", () => {
  it("counts open roles, recent additions, and departments from real posted dates", () => {
    const corpus = new Corpus(":memory:");
    const now = new Date("2026-06-24T00:00:00Z");

    const result = corpus.ingestCompany(
      TARGET,
      [
        posting("1", { postedAt: daysAgo(now, 2), department: "engineering" }),
        posting("2", { postedAt: daysAgo(now, 5), department: "sales", title: "AE" }),
        posting("3", { postedAt: daysAgo(now, 20), department: "engineering" }),
        posting("4", { postedAt: daysAgo(now, 90), department: "marketing", title: "Growth" }),
      ],
      now
    );
    expect(result).toEqual({ company: "Acme", open: 4, added: 4, closed: 0 });

    const v = corpus.velocity("Acme", 7, now);
    expect(v.found).toBe(true);
    expect(v.total_open_roles).toBe(4);
    expect(v.roles_added_last_7d).toBe(2); // ids 1 & 2
    expect(v.roles_added_last_30d).toBe(3); // ids 1,2,3 (not the 90d-old one)
    expect(v.posted_date_coverage).toBe(1);
    expect(v.top_departments[0]).toEqual({ department: "engineering", count: 2 });
    corpus.close();
  });

  it("detects closures across ingests and builds a trend from snapshots", () => {
    const corpus = new Corpus(":memory:");
    const day0 = new Date("2026-06-01T00:00:00Z");
    const day10 = new Date("2026-06-11T00:00:00Z");

    // Day 0: 2 roles.
    corpus.ingestCompany(TARGET, [posting("1"), posting("2")], day0);

    // Day 10: role 2 closed, roles 3 & 4 added → net growth.
    const r2 = corpus.ingestCompany(
      TARGET,
      [posting("1"), posting("3"), posting("4")],
      day10
    );
    expect(r2.added).toBe(2); // 3 & 4
    expect(r2.closed).toBe(1); // 2

    const v = corpus.velocity("Acme", 7, day10);
    expect(v.total_open_roles).toBe(3);
    expect(v.roles_closed_last_30d).toBe(1);
    expect(v.snapshots).toBe(2);
    expect(v.observed_days).toBe(10);
    expect(v.trend).toBe("growing"); // 2 → 3 open roles
    corpus.close();
  });

  it("returns found=false for an untracked company", () => {
    const corpus = new Corpus(":memory:");
    const v = corpus.velocity("Nonexistent", 7);
    expect(v.found).toBe(false);
    expect(v.total_open_roles).toBe(0);
    corpus.close();
  });

  it("reports corpus-wide stats", () => {
    const corpus = new Corpus(":memory:");
    const now = new Date("2026-06-24T00:00:00Z");
    corpus.ingestCompany(TARGET, [posting("1"), posting("2")], now);
    const stats = corpus.stats();
    expect(stats.companies_tracked).toBe(1);
    expect(stats.open_roles).toBe(2);
    expect(stats.snapshots).toBe(1);
    expect(stats.last_ingest_at).toBe(now.toISOString());
    corpus.close();
  });
});
