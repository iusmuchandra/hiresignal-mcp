import { classifyDepartment, type Department } from "../util/textAnalysis.js";
import { getJson, isoOrNull } from "./fetch.js";
import type { AtsPosting } from "./types.js";

interface AshbyJob {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  location?: string;
  isRemote?: boolean;
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

/**
 * Ashby reports a company-defined `department` string. Map the common ones onto
 * our canonical Department enum; fall back to title classification otherwise so
 * we never lose a posting to an unrecognized label.
 */
function mapAshbyDepartment(department: string | undefined, title: string): Department {
  const d = (department ?? "").toLowerCase();
  if (/data|machine learning|\bml\b|\bai\b|analytics|research scien/.test(d)) return "data_ml";
  if (/research/.test(d)) return "research";
  if (/engineer|technolog|infrastructure|platform/.test(d)) return "engineering";
  if (/product/.test(d)) return "product";
  if (/design/.test(d)) return "design";
  if (/sales|revenue|account|partnership|go.to.market|gtm/.test(d)) return "sales";
  if (/marketing|growth|brand|content/.test(d)) return "marketing";
  if (/people|talent|recruit|\bhr\b|human resources/.test(d)) return "people_hr";
  if (/finance|account|fp&a/.test(d)) return "finance";
  if (/legal|counsel|compliance/.test(d)) return "legal";
  if (/support|customer|success/.test(d)) return "support";
  if (/operation|\bops\b|g&a|general|strategy|program/.test(d)) return "operations";
  return classifyDepartment(title);
}

/** Pure normalizer — exported for unit testing. */
export function normalizeAshby(raw: AshbyResponse): AtsPosting[] {
  const jobs = raw.jobs ?? [];
  const out: AtsPosting[] = [];
  for (const j of jobs) {
    if (!j.id) continue;
    if (j.isListed === false) continue;
    const title = j.title ?? "";
    const location = j.location ?? "";
    out.push({
      externalId: String(j.id),
      title,
      department: mapAshbyDepartment(j.department, title),
      location,
      remote: j.isRemote === true || /\bremote\b/i.test(location),
      postedAt: isoOrNull(j.publishedAt),
      url: j.jobUrl ?? "",
    });
  }
  return out;
}

export async function fetchAshby(boardId: string): Promise<AtsPosting[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardId)}`;
  const data = await getJson(url, "ashby");
  return normalizeAshby(data as AshbyResponse);
}
