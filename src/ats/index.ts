import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import type { AtsPosting, Target } from "./types.js";

export type { AtsPosting, AtsProvider, Industry, Target } from "./types.js";
export { normalizeGreenhouse } from "./greenhouse.js";
export { normalizeAshby } from "./ashby.js";
export { normalizeLever } from "./lever.js";

/** Fetch and normalize all live postings for one tracked company. */
export async function fetchCompanyPostings(target: Target): Promise<AtsPosting[]> {
  switch (target.provider) {
    case "greenhouse":
      return fetchGreenhouse(target.boardId);
    case "ashby":
      return fetchAshby(target.boardId);
    case "lever":
      return fetchLever(target.boardId);
  }
}
