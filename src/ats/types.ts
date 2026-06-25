import type { Department } from "../util/textAnalysis.js";

/**
 * The applicant-tracking systems we ingest directly. These expose public,
 * unauthenticated job-board JSON endpoints — so the data is first-party (pulled
 * from the source of record) rather than resold from an aggregator.
 */
export type AtsProvider = "greenhouse" | "ashby" | "lever" | "workday";

export type Industry =
  | "ai"
  | "fintech"
  | "data_infra"
  | "devtools"
  | "security"
  | "saas"
  | "consumer"
  | "logistics";

/** A normalized job posting, identical in shape across every ATS. */
export interface AtsPosting {
  /** Stable identifier within the company's board. */
  externalId: string;
  title: string;
  department: Department;
  location: string;
  remote: boolean;
  /** ISO timestamp the ATS reports the role was first published, or null. */
  postedAt: string | null;
  url: string;
}

/** One tracked company and where to fetch its postings from. */
export interface Target {
  /** Canonical display name — also the corpus partition key. */
  company: string;
  provider: AtsProvider;
  /**
   * Board identifier used in the ATS URL (Greenhouse/Ashby/Lever). For Workday
   * this is the tenant; the host + site live in `workday` below.
   */
  boardId: string;
  industry: Industry;
  /** Required when provider === "workday". */
  workday?: WorkdayConfig;
}

export interface WorkdayConfig {
  /** e.g. "nvidia.wd5.myworkdayjobs.com" */
  host: string;
  /** e.g. "nvidia" (also Target.boardId) */
  tenant: string;
  /** career-site slug, e.g. "NVIDIAExternalCareerSite" */
  site: string;
}
