import { normalizeCompanyName } from "./util/textAnalysis.js";
import type { Target } from "./ats/types.js";

/**
 * Curated set of high-value accounts a B2B seller actually targets, each mapped
 * to its live ATS board. Coverage is intentionally deep-not-wide: every board
 * here was verified to return postings. The ingest loop skips any that 404, so a
 * company changing ATS degrades gracefully rather than breaking the run.
 *
 * This list IS the product's curated coverage. Add companies by appending a row
 * with a verified board id (see scripts notes in CORPUS.md).
 */
export const TARGETS: readonly Target[] = [
  // ── AI / ML ────────────────────────────────────────────────────────────────
  { company: "OpenAI", provider: "ashby", boardId: "openai", industry: "ai" },
  { company: "Cohere", provider: "ashby", boardId: "cohere", industry: "ai" },
  { company: "Perplexity", provider: "ashby", boardId: "perplexity", industry: "ai" },
  { company: "Replit", provider: "ashby", boardId: "replit", industry: "ai" },

  // ── Fintech ─────────────────────────────────────────────────────────────────
  { company: "Stripe", provider: "greenhouse", boardId: "stripe", industry: "fintech" },
  { company: "Coinbase", provider: "greenhouse", boardId: "coinbase", industry: "fintech" },
  { company: "Robinhood", provider: "greenhouse", boardId: "robinhood", industry: "fintech" },
  { company: "Brex", provider: "greenhouse", boardId: "brex", industry: "fintech" },
  { company: "Affirm", provider: "greenhouse", boardId: "affirm", industry: "fintech" },
  { company: "SoFi", provider: "greenhouse", boardId: "sofi", industry: "fintech" },
  { company: "Ramp", provider: "ashby", boardId: "ramp", industry: "fintech" },
  { company: "Deel", provider: "ashby", boardId: "deel", industry: "fintech" },

  // ── Data infrastructure ─────────────────────────────────────────────────────
  { company: "Databricks", provider: "greenhouse", boardId: "databricks", industry: "data_infra" },
  { company: "MongoDB", provider: "greenhouse", boardId: "mongodb", industry: "data_infra" },
  { company: "Elastic", provider: "greenhouse", boardId: "elastic", industry: "data_infra" },
  { company: "Datadog", provider: "greenhouse", boardId: "datadog", industry: "data_infra" },
  { company: "Samsara", provider: "greenhouse", boardId: "samsara", industry: "data_infra" },

  // ── Dev tools / infra ───────────────────────────────────────────────────────
  { company: "GitLab", provider: "greenhouse", boardId: "gitlab", industry: "devtools" },
  { company: "Twilio", provider: "greenhouse", boardId: "twilio", industry: "devtools" },
  { company: "Supabase", provider: "ashby", boardId: "supabase", industry: "devtools" },
  { company: "Linear", provider: "ashby", boardId: "linear", industry: "devtools" },
  { company: "Vercel", provider: "ashby", boardId: "vercel", industry: "devtools" },

  // ── Security ────────────────────────────────────────────────────────────────
  { company: "Cloudflare", provider: "greenhouse", boardId: "cloudflare", industry: "security" },

  // ── SaaS / consumer ─────────────────────────────────────────────────────────
  { company: "Notion", provider: "ashby", boardId: "notion", industry: "saas" },
  { company: "Asana", provider: "greenhouse", boardId: "asana", industry: "saas" },
  { company: "Dropbox", provider: "greenhouse", boardId: "dropbox", industry: "saas" },
  { company: "Airbnb", provider: "greenhouse", boardId: "airbnb", industry: "consumer" },
  { company: "Instacart", provider: "greenhouse", boardId: "instacart", industry: "consumer" },
  { company: "Lyft", provider: "greenhouse", boardId: "lyft", industry: "consumer" },
  { company: "Discord", provider: "greenhouse", boardId: "discord", industry: "consumer" },
  { company: "Flexport", provider: "greenhouse", boardId: "flexport", industry: "logistics" },
] as const;

/** Resolve a free-text company name to a tracked target, if we cover it. */
export function findTarget(name: string): Target | undefined {
  const target = normalizeCompanyName(name);
  if (!target) return undefined;
  let prefixMatch: Target | undefined;
  for (const t of TARGETS) {
    const canonical = normalizeCompanyName(t.company);
    if (canonical === target) return t;
    if (canonical.includes(target) || target.includes(canonical)) {
      prefixMatch ??= t;
    }
  }
  return prefixMatch;
}
