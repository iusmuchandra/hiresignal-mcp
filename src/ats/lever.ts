import { classifyDepartment } from "../util/textAnalysis.js";
import { getJson, isoOrNull } from "./fetch.js";
import type { AtsPosting } from "./types.js";

interface LeverJob {
  id?: string;
  text?: string;
  categories?: { team?: string; location?: string; commitment?: string } | null;
  createdAt?: number;
  hostedUrl?: string;
  workplaceType?: string;
}

/** Pure normalizer — exported for unit testing. */
export function normalizeLever(raw: LeverJob[]): AtsPosting[] {
  const jobs = Array.isArray(raw) ? raw : [];
  const out: AtsPosting[] = [];
  for (const j of jobs) {
    if (!j.id) continue;
    const title = j.text ?? "";
    const location = j.categories?.location ?? "";
    out.push({
      externalId: String(j.id),
      title,
      department: classifyDepartment(title),
      location,
      remote: /\bremote\b/i.test(location) || (j.workplaceType ?? "").toLowerCase() === "remote",
      postedAt: isoOrNull(j.createdAt),
      url: j.hostedUrl ?? "",
    });
  }
  return out;
}

export async function fetchLever(boardId: string): Promise<AtsPosting[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(boardId)}?mode=json`;
  const data = await getJson(url, "lever");
  return normalizeLever(data as LeverJob[]);
}
