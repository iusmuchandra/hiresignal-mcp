import { classifyDepartment } from "../util/textAnalysis.js";
import { getJson, isoOrNull } from "./fetch.js";
import type { AtsPosting } from "./types.js";

interface GreenhouseJob {
  id?: number | string;
  title?: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string } | null;
  absolute_url?: string;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

/** Pure normalizer — exported so it can be unit-tested without a network call. */
export function normalizeGreenhouse(raw: GreenhouseResponse): AtsPosting[] {
  const jobs = raw.jobs ?? [];
  const out: AtsPosting[] = [];
  for (const j of jobs) {
    if (j.id === undefined || j.id === null) continue;
    const title = j.title ?? "";
    const location = j.location?.name ?? "";
    out.push({
      externalId: String(j.id),
      title,
      department: classifyDepartment(title),
      location,
      remote: /\bremote\b/i.test(location),
      // Greenhouse reports first_published — a real posted date — falling back to updated_at.
      postedAt: isoOrNull(j.first_published ?? j.updated_at),
      url: j.absolute_url ?? "",
    });
  }
  return out;
}

export async function fetchGreenhouse(boardId: string): Promise<AtsPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId)}/jobs`;
  const data = await getJson(url, "greenhouse");
  return normalizeGreenhouse(data as GreenhouseResponse);
}
