export type Department =
  | "engineering"
  | "data_ml"
  | "product"
  | "design"
  | "sales"
  | "marketing"
  | "operations"
  | "finance"
  | "people_hr"
  | "legal"
  | "support"
  | "research"
  | "other";

const DEPARTMENT_RULES: Array<{ dept: Department; patterns: RegExp[] }> = [
  {
    dept: "data_ml",
    patterns: [
      /\b(ml|machine learning|ai|artificial intelligence|data scien|data engineer|analytics engineer|nlp|llm|deep learning|mlops|research engineer)\b/i,
    ],
  },
  {
    dept: "engineering",
    patterns: [
      /\b(software|backend|back-end|frontend|front-end|fullstack|full-stack|devops|sre|platform|infrastructure|security engineer|mobile|ios|android|qa engineer|test engineer|firmware|embedded|systems engineer|cloud engineer|engineer|developer|programmer|sde|swe)\b/i,
    ],
  },
  { dept: "product", patterns: [/\b(product manager|product lead|product owner|pm,|tpm|product analyst)\b/i] },
  { dept: "design", patterns: [/\b(designer|design lead|ux|ui|user experience|user research)\b/i] },
  {
    dept: "sales",
    patterns: [
      /\b(sales|account executive|ae,|sdr|bdr|business development|account manager|customer success|cs manager|revenue|partnerships)\b/i,
    ],
  },
  {
    dept: "marketing",
    patterns: [
      /\b(marketing|growth|brand|content|seo|community manager|pr,|communications|copywriter)\b/i,
    ],
  },
  {
    dept: "operations",
    patterns: [
      /\b(operations|ops manager|program manager|project manager|chief of staff|strategy|biz ?ops|supply chain|logistics)\b/i,
    ],
  },
  { dept: "finance", patterns: [/\b(finance|accountant|controller|fp&a|treasury|auditor|tax)\b/i] },
  {
    dept: "people_hr",
    patterns: [
      /\b(recruiter|talent|people ops|people partner|hr,|hrbp|chief people|head of people)\b/i,
    ],
  },
  { dept: "legal", patterns: [/\b(legal|counsel|paralegal|compliance|privacy)\b/i] },
  { dept: "support", patterns: [/\b(support|customer service|help desk|technical support)\b/i] },
  { dept: "research", patterns: [/\b(researcher|research scientist|principal scientist)\b/i] },
];

export function classifyDepartment(title: string | undefined | null): Department {
  if (!title) return "other";
  for (const rule of DEPARTMENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(title)) return rule.dept;
    }
  }
  return "other";
}

const NUM_NC = String.raw`(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)`;
const TOKEN_NC = String.raw`(?:${NUM_NC}\s*[kK]|${NUM_NC})`;
const SALARY_REGEX = new RegExp(
  String.raw`(?:USD|US\$|\$|£|€)\s*(${TOKEN_NC})(?:\s*(?:-|–|to)\s*(?:(?:USD|US\$|\$|£|€)\s*)?(${TOKEN_NC}))?`,
  "g"
);

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const isK = /k$/i.test(trimmed);
  const cleaned = trimmed.replace(/[kK,]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return isK ? n * 1000 : n;
}

export interface ParsedSalary {
  min: number;
  max: number;
  midpoint: number;
}

export function parseSalaryRange(text: string | undefined | null): ParsedSalary | null {
  if (!text) return null;
  SALARY_REGEX.lastIndex = 0;
  const matches = [...text.matchAll(SALARY_REGEX)];
  if (matches.length === 0) return null;
  const first = matches[0];
  if (!first) return null;
  const a = parseAmount(first[1] ?? "");
  const b = first[2] ? parseAmount(first[2]) : null;
  if (a === null) return null;
  // Heuristic: if a single number under 1000 with no suffix, ignore (probably noise like "401k" — though we strip k)
  const min = b !== null ? Math.min(a, b) : a;
  const max = b !== null ? Math.max(a, b) : a;
  if (min < 1000 && max < 1000) return null;
  // Annualize: salaries listed as hourly under $500 are probably hourly. Heuristic only.
  const annualize = (n: number): number => (n < 500 ? n * 2080 : n);
  const annMin = annualize(min);
  const annMax = annualize(max);
  return { min: annMin, max: annMax, midpoint: (annMin + annMax) / 2 };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) {
    const only = sorted[0];
    return only ?? 0;
  }
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? loVal;
  if (lo === hi) return loVal;
  return loVal + (hiVal - loVal) * (idx - lo);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

export function topN<K>(counts: Map<K, number>, n: number): Array<{ key: K; count: number }> {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co\.?)\b/g, "")
    .replace(/[,.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
