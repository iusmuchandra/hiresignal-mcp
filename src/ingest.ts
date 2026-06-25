import { fetchCompanyPostings } from "./ats/index.js";
import { TARGETS } from "./targets.js";
import { Corpus, DEFAULT_CORPUS_PATH } from "./store/corpus.js";

/**
 * Ingest entrypoint — the cron that grows the corpus.
 *
 *   npm run ingest            # all targets
 *   npm run ingest -- 6       # cap concurrency at 6
 *
 * Run it on a schedule (GitHub Actions / Railway cron, every 6h). Every run
 * appends a dated snapshot per company, so the hiring-velocity signal sharpens
 * over time — the part a competitor can't backfill.
 */

interface RunSummary {
  companies: number;
  ok: number;
  failed: number;
  totalOpen: number;
  totalAdded: number;
  totalClosed: number;
  durationMs: number;
}

function log(event: string, data: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n");
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runIngest(opts: { concurrency?: number; corpusPath?: string } = {}): Promise<RunSummary> {
  const started = Date.now();
  const concurrency = opts.concurrency ?? 6;
  const corpus = new Corpus(opts.corpusPath ?? DEFAULT_CORPUS_PATH);
  log("ingest_start", { targets: TARGETS.length, concurrency, corpus: opts.corpusPath ?? DEFAULT_CORPUS_PATH });

  let ok = 0;
  let failed = 0;
  let totalOpen = 0;
  let totalAdded = 0;
  let totalClosed = 0;

  await mapWithConcurrency(TARGETS, concurrency, async (target) => {
    try {
      const postings = await fetchCompanyPostings(target);
      const result = corpus.ingestCompany(target, postings);
      ok++;
      totalOpen += result.open;
      totalAdded += result.added;
      totalClosed += result.closed;
      log("ingest_company", {
        company: target.company,
        provider: target.provider,
        open: result.open,
        added: result.added,
        closed: result.closed,
      });
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log("ingest_company_failed", { company: target.company, provider: target.provider, error: message });
    }
  });

  const stats = corpus.stats();
  corpus.close();

  const summary: RunSummary = {
    companies: TARGETS.length,
    ok,
    failed,
    totalOpen,
    totalAdded,
    totalClosed,
    durationMs: Date.now() - started,
  };
  log("ingest_done", { ...summary, corpus_stats: stats });
  return summary;
}

// Run when invoked directly (node dist/ingest.js [concurrency]).
const invokedDirectly = process.argv[1]?.endsWith("ingest.js") || process.argv[1]?.endsWith("ingest.ts");
if (invokedDirectly) {
  const arg = process.argv[2];
  const concurrency = arg ? Number(arg) : undefined;
  runIngest(concurrency && Number.isFinite(concurrency) ? { concurrency } : {})
    .then((s) => process.exit(s.failed > 0 && s.ok === 0 ? 1 : 0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ingest fatal: ${message}\n`);
      process.exit(1);
    });
}
