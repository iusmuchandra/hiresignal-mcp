# The first-party corpus — HireSignal's data moat

HireSignal's signals used to be derived live from third-party aggregators (SerpApi /
JSearch). That works, but it has no moat: the data is resold Google Jobs that anyone can
buy, every call costs money, and "hiring velocity" is a point-in-time guess.

The corpus replaces that for the companies we care about. We scrape each tracked company's
**own applicant-tracking system** (Greenhouse, Ashby, Lever) directly, on a schedule, and
store a **time-series** of every posting. That gives us three things the aggregator can't:

1. **First-party data** — pulled from the source of record, company-resolved by construction.
2. **Zero marginal cost** — public ATS JSON endpoints, no per-query API bill.
3. **An accumulating history** — and *this is the actual moat*. "Roles added in the last 7
   days", "started hiring for X", "scaling vs. freezing" can only be computed from a series
   of dated snapshots. A competitor who starts today cannot backfill last month. Every
   ingest makes the asset more valuable and harder to replicate.

> The corpus is a single SQLite file (`data/corpus.db` by default). That file *is* the
> proprietary asset. Built on Node's built-in `node:sqlite` — **zero added npm dependencies.**

## How it works

```
TARGETS (src/targets.ts)         ── curated, verified list of companies → ATS board ids
   │
   ▼
fetchCompanyPostings (src/ats)   ── direct Greenhouse / Ashby / Lever JSON, normalized
   │
   ▼
Corpus.ingestCompany (src/store) ── diff vs. last seen, write postings + a dated snapshot
   │
   ▼
company_hiring_velocity tool     ── reads the time-series, returns data_source:"first_party_ats"
```

### The diff (what makes it a time-series, not a scrape)

On each ingest, per company, `ingestCompany`:

- marks every stored posting closed, then re-opens the ones still live (so disappearances
  become **closures** — a real churn signal);
- stamps `first_seen` on genuinely new postings (so "added in last Nd" is exact);
- keeps the ATS's real posted date (`first_published` / `publishedAt` / `createdAt`) when
  present — so velocity is accurate *even on the very first ingest*;
- writes a `snapshots` row: `(company, captured_at, open_roles, by_department)`.

### Schema

```sql
postings(company, provider, external_id, title, department, location, remote,
         posted_at, url, first_seen, last_seen, is_open)   -- PK (company, external_id)
snapshots(company, captured_at, open_roles, by_department) -- PK (company, captured_at)
```

## Running it

```bash
npm run build
npm run ingest          # ingest all targets once (≈3s for ~30 companies)
npm run ingest:dev      # same, via tsx, no build step
npm run ingest -- 10    # cap concurrency at 10
```

A full run over the current roster ingests ~6,000 open roles in a few seconds, at no cost.
`get_server_status` reports corpus health (`companies_tracked`, `open_roles`, `snapshots`,
`last_ingest_at`).

## Keeping it fresh (pick one)

**A. Self-sustaining server (recommended).** Set `INGEST_INTERVAL_HOURS` and point the
corpus at a persistent volume. One instance ingests on boot + on the interval and serves
from the same file — no external cron, no cross-host sync.

```bash
HIRESIGNAL_CORPUS_PATH=/data/corpus.db   # Railway/Fly persistent volume
INGEST_INTERVAL_HOURS=6
```

**B. External cron.** Run `npm run ingest` from a GitHub Actions / Railway scheduled job
that writes to the same persistent corpus path the server reads.

The corpus only earns its moat if it runs continuously — **start the schedule now**, even
pre-launch, so history is already deep when the first customer connects.

## Adding a company

Append a row to `TARGETS` in [`src/targets.ts`](src/targets.ts) with a **verified** board id,
then re-run ingest. Verify an id before adding:

```bash
# Greenhouse — expect {"jobs":[...]}
curl -s "https://boards-api.greenhouse.io/v1/boards/<id>/jobs" | head -c 200
# Ashby — expect {"jobs":[...]}
curl -s "https://api.ashbyhq.com/posting-api/job-board/<id>" | head -c 200
```

Dead or wrong ids are skipped at ingest time (one bad board never aborts the run), so the
roster degrades gracefully if a company changes ATS.

## Fallback

Companies *not* in the corpus still work: `company_hiring_velocity` falls back to the
aggregator when `JSEARCH_RAPIDAPI_KEY` is set, tagged `data_source:"aggregated_api"`. With no
key and no corpus entry it returns a clear, non-fatal note rather than erroring. The corpus is
strictly additive — it never makes an uncovered company worse.
