import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { AtsPosting, Target } from "../ats/types.js";
import type { Department } from "../util/textAnalysis.js";

// node:sqlite is a Node 22+ builtin. Load its runtime value via createRequire so
// the test bundler (Vite) never tries to pre-bundle the `node:sqlite` specifier;
// the type-only import above is erased at compile time. Production `node` resolves
// `require("node:sqlite")` natively.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * The corpus is HireSignal's durable asset: a local, append-only history of every
 * tracked company's job postings. Each ingest diffs the company's current board
 * against what we last saw — recording when a role *first appeared* (first_seen),
 * when it *disappeared* (a close/fill), and a dated snapshot of open headcount.
 *
 * That accumulated history is the moat: hiring velocity and "started hiring for X"
 * can only be computed from a time-series, and a competitor starting today cannot
 * backfill it. The SQLite file literally IS the proprietary data.
 *
 * Built on node:sqlite (Node 22+ built-in) so it adds ZERO npm dependencies.
 */

export const DEFAULT_CORPUS_PATH =
  process.env.HIRESIGNAL_CORPUS_PATH ?? "./data/corpus.db";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IngestResult {
  company: string;
  open: number;
  added: number;
  closed: number;
}

export interface DeptCount {
  department: Department;
  count: number;
}

export type Trend = "growing" | "stable" | "shrinking";
export type Confidence = "low" | "medium" | "high";

export interface CorpusVelocity {
  found: boolean;
  total_open_roles: number;
  roles_added_last_7d: number;
  roles_added_last_30d: number;
  roles_closed_last_30d: number;
  top_departments: DeptCount[];
  trend: Trend;
  confidence: Confidence;
  /** Days between the first and most recent snapshot we hold for this company. */
  observed_days: number;
  snapshots: number;
  /** Share of open roles that carry a real ATS posted date (vs. inferred from first_seen). */
  posted_date_coverage: number;
}

export interface CorpusStats {
  companies_tracked: number;
  open_roles: number;
  total_postings_seen: number;
  snapshots: number;
  last_ingest_at: string | null;
  oldest_snapshot_at: string | null;
}

interface PostingRow {
  posted_at: string | null;
  first_seen: string;
  department: string;
}

interface SnapshotRow {
  captured_at: string;
  open_roles: number;
}

export class Corpus {
  private readonly db: DatabaseSyncType;

  constructor(path: string = DEFAULT_CORPUS_PATH) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS postings (
        company       TEXT NOT NULL,
        provider      TEXT NOT NULL,
        external_id   TEXT NOT NULL,
        title         TEXT NOT NULL,
        department    TEXT NOT NULL,
        location      TEXT NOT NULL,
        remote        INTEGER NOT NULL,
        posted_at     TEXT,
        url           TEXT NOT NULL,
        first_seen    TEXT NOT NULL,
        last_seen     TEXT NOT NULL,
        is_open       INTEGER NOT NULL,
        PRIMARY KEY (company, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_postings_company_open
        ON postings (company, is_open);

      CREATE TABLE IF NOT EXISTS snapshots (
        company       TEXT NOT NULL,
        captured_at   TEXT NOT NULL,
        open_roles    INTEGER NOT NULL,
        by_department TEXT NOT NULL,
        PRIMARY KEY (company, captured_at)
      );
    `);
  }

  /**
   * Record one company's current postings, diffing against prior state.
   * Idempotent within a snapshot timestamp.
   */
  ingestCompany(target: Target, postings: AtsPosting[], now: Date = new Date()): IngestResult {
    const nowIso = now.toISOString();
    const company = target.company;

    const knownIds = new Set(
      (
        this.db
          .prepare("SELECT external_id FROM postings WHERE company = ?")
          .all(company) as Array<{ external_id: string }>
      ).map((r) => r.external_id)
    );
    const openBeforeIds = new Set(
      (
        this.db
          .prepare("SELECT external_id FROM postings WHERE company = ? AND is_open = 1")
          .all(company) as Array<{ external_id: string }>
      ).map((r) => r.external_id)
    );
    const currentIds = new Set(postings.map((p) => p.externalId));

    const upsert = this.db.prepare(`
      INSERT INTO postings
        (company, provider, external_id, title, department, location, remote, posted_at, url, first_seen, last_seen, is_open)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(company, external_id) DO UPDATE SET
        title      = excluded.title,
        department = excluded.department,
        location   = excluded.location,
        remote     = excluded.remote,
        posted_at  = COALESCE(postings.posted_at, excluded.posted_at),
        url        = excluded.url,
        last_seen  = excluded.last_seen,
        is_open    = 1
    `);

    this.db.exec("BEGIN");
    try {
      // Tentatively close everything for this company; re-opened below by upsert.
      this.db.prepare("UPDATE postings SET is_open = 0 WHERE company = ?").run(company);

      for (const p of postings) {
        upsert.run(
          company,
          target.provider,
          p.externalId,
          p.title,
          p.department,
          p.location,
          p.remote ? 1 : 0,
          p.postedAt,
          p.url,
          nowIso,
          nowIso
        );
      }

      const byDept = new Map<Department, number>();
      for (const p of postings) byDept.set(p.department, (byDept.get(p.department) ?? 0) + 1);

      this.db
        .prepare(
          "INSERT OR REPLACE INTO snapshots (company, captured_at, open_roles, by_department) VALUES (?, ?, ?, ?)"
        )
        .run(company, nowIso, postings.length, JSON.stringify(Object.fromEntries(byDept)));

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    let added = 0;
    for (const id of currentIds) if (!knownIds.has(id)) added++;
    let closed = 0;
    for (const id of openBeforeIds) if (!currentIds.has(id)) closed++;

    return { company, open: postings.length, added, closed };
  }

  hasCompany(company: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM postings WHERE company = ? LIMIT 1")
      .get(company) as { 1: number } | undefined;
    return row !== undefined;
  }

  /** Compute a hiring-velocity signal for a company from stored history. */
  velocity(company: string, windowDays: number, now: Date = new Date()): CorpusVelocity {
    const openRows = this.db
      .prepare(
        "SELECT posted_at, first_seen, department FROM postings WHERE company = ? AND is_open = 1"
      )
      .all(company) as PostingRow[];

    const snapRows = this.db
      .prepare(
        "SELECT captured_at, open_roles FROM snapshots WHERE company = ? ORDER BY captured_at ASC"
      )
      .all(company) as SnapshotRow[];

    if (openRows.length === 0 && snapRows.length === 0 && !this.hasCompany(company)) {
      return emptyVelocity();
    }

    const nowMs = now.getTime();
    const within = (iso: string | null, days: number): boolean => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return !Number.isNaN(t) && nowMs - t <= days * DAY_MS;
    };
    // Effective "appeared" date: the ATS posted date if present, else when we first saw it.
    const effective = (r: PostingRow): string => r.posted_at ?? r.first_seen;

    const windowClamped = Math.max(1, Math.min(windowDays, 30));
    const total = openRows.length;
    const added7 = openRows.filter((r) => within(effective(r), Math.min(7, windowClamped))).length;
    const added30 = openRows.filter((r) => within(effective(r), 30)).length;
    const withPostedDate = openRows.filter((r) => r.posted_at).length;

    const closed30 = (
      this.db
        .prepare(
          "SELECT last_seen FROM postings WHERE company = ? AND is_open = 0"
        )
        .all(company) as Array<{ last_seen: string }>
    ).filter((r) => within(r.last_seen, 30)).length;

    const deptCounts = new Map<Department, number>();
    for (const r of openRows) {
      const d = r.department as Department;
      deptCounts.set(d, (deptCounts.get(d) ?? 0) + 1);
    }
    const topDepartments: DeptCount[] = [...deptCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([department, count]) => ({ department, count }));

    // Observed span + trend.
    const first = snapRows[0];
    const last = snapRows[snapRows.length - 1];
    const observedDays =
      first && last
        ? Math.max(0, Math.round((Date.parse(last.captured_at) - Date.parse(first.captured_at)) / DAY_MS))
        : 0;

    const trend = this.computeTrend(snapRows, { total, added7, added30, nowMs });

    // Confidence rises with both history depth and sample size. A multi-week
    // time-series is inherently more trustworthy than a single-shot estimate.
    let confidence: Confidence = "low";
    if (observedDays >= 14 && total >= 10) confidence = "high";
    else if (observedDays >= 3 || total >= 8) confidence = "medium";

    return {
      found: true,
      total_open_roles: total,
      roles_added_last_7d: added7,
      roles_added_last_30d: added30,
      roles_closed_last_30d: closed30,
      top_departments: topDepartments,
      trend,
      confidence,
      observed_days: observedDays,
      snapshots: snapRows.length,
      posted_date_coverage: total > 0 ? Math.round((withPostedDate / total) * 100) / 100 : 0,
    };
  }

  private computeTrend(
    snapRows: SnapshotRow[],
    fallback: { total: number; added7: number; added30: number; nowMs: number }
  ): Trend {
    // Preferred: compare current open headcount against a baseline snapshot from
    // the last 30 days. This is the genuine time-series signal.
    if (snapRows.length >= 2) {
      const last = snapRows[snapRows.length - 1];
      const baseline =
        snapRows.find((s) => fallback.nowMs - Date.parse(s.captured_at) <= 30 * DAY_MS) ?? snapRows[0];
      if (last && baseline && baseline !== last && baseline.open_roles > 0) {
        const pct = (last.open_roles - baseline.open_roles) / baseline.open_roles;
        if (pct > 0.1) return "growing";
        if (pct < -0.1) return "shrinking";
        return "stable";
      }
    }
    // Cold-start fallback (first ingest): infer from real ATS posted dates.
    const projected30 = fallback.added7 * (30 / 7);
    if (projected30 > fallback.added30 * 1.2 && fallback.added7 >= 2) return "growing";
    if (fallback.added7 === 0 && fallback.added30 >= 5) return "shrinking";
    return "stable";
  }

  stats(): CorpusStats {
    const companies = (
      this.db.prepare("SELECT COUNT(DISTINCT company) AS n FROM postings").get() as { n: number }
    ).n;
    const open = (
      this.db.prepare("SELECT COUNT(*) AS n FROM postings WHERE is_open = 1").get() as { n: number }
    ).n;
    const totalSeen = (
      this.db.prepare("SELECT COUNT(*) AS n FROM postings").get() as { n: number }
    ).n;
    const snaps = (
      this.db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number }
    ).n;
    const last = this.db
      .prepare("SELECT MAX(captured_at) AS t FROM snapshots")
      .get() as { t: string | null };
    const oldest = this.db
      .prepare("SELECT MIN(captured_at) AS t FROM snapshots")
      .get() as { t: string | null };

    return {
      companies_tracked: companies,
      open_roles: open,
      total_postings_seen: totalSeen,
      snapshots: snaps,
      last_ingest_at: last.t,
      oldest_snapshot_at: oldest.t,
    };
  }

  close(): void {
    this.db.close();
  }
}

function emptyVelocity(): CorpusVelocity {
  return {
    found: false,
    total_open_roles: 0,
    roles_added_last_7d: 0,
    roles_added_last_30d: 0,
    roles_closed_last_30d: 0,
    top_departments: [],
    trend: "stable",
    confidence: "low",
    observed_days: 0,
    snapshots: 0,
    posted_date_coverage: 0,
  };
}

let singleton: Corpus | null = null;

/** Process-wide read/query handle to the corpus (opened lazily). */
export function getCorpus(): Corpus {
  singleton ??= new Corpus();
  return singleton;
}

/**
 * Reset the process-wide corpus handle. Pass a path (e.g. ":memory:") to point
 * it at a fresh, isolated store, or nothing to drop it. Intended for tests.
 */
export function resetCorpus(path?: string): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      /* already closed */
    }
  }
  singleton = path === undefined ? null : new Corpus(path);
}
