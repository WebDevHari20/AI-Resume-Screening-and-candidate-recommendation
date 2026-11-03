// Taxonomy-based resume parsing. Add synonyms to SKILL_TAXONOMY as needed.

export const SKILL_TAXONOMY: Record<string, string[]> = {
  python: ["python"],
  javascript: ["javascript", "js", "ecmascript"],
  typescript: ["typescript"],
  java: ["java"],
  "c++": ["c++", "cpp"],
  "c#": ["c#", "csharp"],
  go: ["golang", "go lang"],
  rust: ["rust"],
  php: ["php"],
  ruby: ["ruby"],
  kotlin: ["kotlin"],
  swift: ["swift"],
  sql: ["sql"],
  html: ["html", "html5"],
  css: ["css", "css3"],
  react: ["react", "react.js", "reactjs"],
  angular: ["angular"],
  vue: ["vue", "vue.js", "vuejs"],
  "next.js": ["next.js", "nextjs"],
  "node.js": ["node.js", "nodejs", "node"],
  express: ["express", "express.js"],
  django: ["django"],
  flask: ["flask"],
  fastapi: ["fastapi"],
  "spring boot": ["spring boot", "springboot", "spring"],
  tailwind: ["tailwind", "tailwindcss"],
  postgresql: ["postgresql", "postgres"],
  mysql: ["mysql"],
  mongodb: ["mongodb", "mongo"],
  redis: ["redis"],
  supabase: ["supabase"],
  firebase: ["firebase"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  aws: ["aws", "amazon web services"],
  azure: ["azure"],
  gcp: ["gcp", "google cloud"],
  git: ["git"],
  linux: ["linux"],
  "rest api": ["rest api", "restful", "rest apis"],
  graphql: ["graphql"],
  "machine learning": ["machine learning", "ml"],
  "deep learning": ["deep learning"],
  nlp: ["nlp", "natural language processing"],
  pytorch: ["pytorch"],
  tensorflow: ["tensorflow"],
  pandas: ["pandas"],
  numpy: ["numpy"],
  "data structures": ["data structures", "dsa"],
  algorithms: ["algorithms"],
  "ci/cd": ["ci/cd", "cicd"],
  jest: ["jest"],
  pytest: ["pytest"],
  figma: ["figma"],
};

const SYNONYM_TO_CANON = new Map<string, string>();
for (const [canon, syns] of Object.entries(SKILL_TAXONOMY)) {
  SYNONYM_TO_CANON.set(canon, canon);
  for (const s of syns) SYNONYM_TO_CANON.set(s, canon);
}
export const canonicalSkill = (s: string) => {
  const k = s.trim().toLowerCase();
  return SYNONYM_TO_CANON.get(k) ?? k;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
const termRe = (term: string, flags = "i") => {
  if (term.toLowerCase() === "go") {
    // Avoid false positives on common English word "go". Require Golang or case-sensitive "Go".
    return flags.includes("i")
      ? /\b(golang|go\s*lang)\b|(?<![a-zA-Z0-9+#])Go(?![a-zA-Z0-9+#])/
      : /(?<![a-zA-Z0-9+#])Go(?![a-zA-Z0-9+#])/;
  }
  return new RegExp(`(?<![a-z0-9+#])${esc(term.toLowerCase())}(?![a-z0-9+#])`, flags);
};

export const hasTerm = (text: string, term: string) => termRe(term).test(text);
export const countTerm = (text: string, term: string) => {
  if (term.toLowerCase() === "go") {
    return [...text.matchAll(/\b(golang|go\s*lang)\b|(?<![a-zA-Z0-9+#])Go(?![a-zA-Z0-9+#])/g)].length;
  }
  return [...text.matchAll(termRe(term, "gi"))].length;
};

export function extractSkills(text: string): string[] {
  return Object.entries(SKILL_TAXONOMY)
    .filter(([canon, syns]) => [canon, ...syns].some((s) => hasTerm(text, s)))
    .map(([canon]) => canon);
}

// ---------- Education ----------
export const EDU_RANK: Record<string, number> = {
  any: 0, high_school: 1, diploma: 2, bachelor: 3, master: 4, phd: 5,
};
const EDU_PATTERNS: [string, RegExp][] = [
  ["phd", /\b(ph\.?d|doctorate|doctor of philosophy)\b/i],
  ["master", /\b(master'?s?|m\.tech|mtech|m\.sc|msc|mba|mca|m\.e)\b/i],
  ["bachelor", /\b(bachelor'?s?|b\.tech|btech|b\.sc|bsc|b\.c\.a|bca|b\.com|bcom|b\.e|undergraduate)\b/i],
  ["diploma", /\bdiploma\b/i],
  ["high_school", /\b(high school|hsc|ssc|12th|intermediate)\b/i],
];
function detectEducation(text: string): string {
  for (const [level, re] of EDU_PATTERNS) if (re.test(text)) return level;
  return "any";
}

// ---------- Sections ----------
const SECTION_RE =
  /^(?:#+\s*)?(summary|profile|objective|professional summary|work experience|professional experience|experience|employment|work history|education|academic|technical skills|skills|core competencies|key skills|projects|certifications|achievements)\s*:?$/i;

export function splitSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = "header";
  for (const line of text.split("\n")) {
    const t = line.trim().replace(/^#+\s*/, "");
    if (SECTION_RE.test(t)) {
      current = t.toLowerCase().replace(/[:\s]+$/, "");
      continue;
    }
    out[current] = (out[current] ?? "") + line + "\n";
  }
  return out;
}

// ---------- Experience ----------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const M = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
const RANGE = new RegExp(
  `(?:(?:${M}[a-z]*|\\d{1,2})[\\/.,]?\\s+)?((?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*(?:(?:(?:${M}[a-z]*|\\d{1,2})[\\/.,]?\\s+)?((?:19|20)\\d{2})|(present|current|now|ongoing))`,
  "gi",
);
const yr = (m: string | undefined, y: string) => {
  const numY = Number(y);
  if (!m) return numY;
  const cleaned = m.trim().toLowerCase();
  const mIdx = MONTHS.indexOf(cleaned.slice(0, 3));
  if (mIdx >= 0) return numY + mIdx / 12;
  const numM = Number(cleaned);
  if (numM >= 1 && numM <= 12) return numY + (numM - 1) / 12;
  return numY;
};

function yearsFromRanges(text: string): number {
  const now = new Date();
  const nowY = now.getFullYear() + now.getMonth() / 12;
  const iv: [number, number][] = [];
  for (const m of text.matchAll(RANGE)) {
    const s = yr(m[1], m[2]);
    const e = m[5] ? nowY : yr(m[3], m[4]);
    if (e >= s && e - s <= 40) iv.push([s, e]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  let total = 0, cur: [number, number] | null = null;
  for (const i of iv) {
    if (!cur) cur = [...i];
    else if (i[0] <= cur[1]) cur[1] = Math.max(cur[1], i[1]);
    else { total += cur[1] - cur[0]; cur = [...i]; }
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

function explicitYears(text: string): number {
  let best = 0;
  const re = /(\d{1,2}(?:\.\d)?)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:professional\s+|relevant\s+|work\s+)?experience/gi;
  for (const m of text.matchAll(re)) best = Math.max(best, Number(m[1]));
  return best;
}

// ---------- Contact / links ----------
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?<!\d)(\+?\d[\d\s().-]{8,}\d)(?!\d)/;
const URL_RE = /https?:\/\/[^\s)>\]]+|(?:www\.|github\.com\/|linkedin\.com\/|leetcode\.com\/)[^\s)>\]]+/gi;
const GH_RESERVED = new Set(["orgs", "sponsors", "features", "topics", "about", "pricing", "marketplace", "settings"]);
const LC_RESERVED = new Set(["problems", "contest", "explore", "discuss", "problemset", "studyplan", "u"]);

function findHandle(haystack: string, re: RegExp, reserved: Set<string>): string | null {
  for (const m of haystack.matchAll(re)) {
    const h = m[1];
    if (h && !reserved.has(h.toLowerCase())) return h;
  }
  return null;
}

export interface Parsed {
  name: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  years_experience: number;
  education_level: string;
  github: string | null;
  leetcode: string | null;
  links: string[];
}

export function parseResume(text: string, links: string[]): Parsed {
  const sections = splitSections(text);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const name = lines.slice(0, 6).find((l) => {
    const clean = l.replace(/^#+\s*/, "").trim();
    return /^[\p{L}][\p{L}.'\- ]{2,40}$/u.test(clean) &&
      clean.split(/\s+/).length >= 2 && clean.split(/\s+/).length <= 4 &&
      !SECTION_RE.test(clean) && !/resume|curriculum|vitae/i.test(clean);
  }) ?? null;

  const hay = [text, ...links].join("\n");
  const expText = sections["work experience"] ?? sections["professional experience"] ??
    sections["experience"] ?? sections["employment"] ?? sections["work history"] ?? "";
  const eduText = sections["education"] ?? sections["academic"] ?? text;

  return {
    name,
    email: text.match(EMAIL_RE)?.[0] ?? null,
    phone: text.match(PHONE_RE)?.[0]?.trim() ?? null,
    skills: extractSkills(text),
    years_experience: Math.round(Math.max(explicitYears(text), yearsFromRanges(expText)) * 10) / 10,
    education_level: detectEducation(eduText),
    github: findHandle(hay, /github\.com\/([A-Za-z0-9-]{1,39})/gi, GH_RESERVED),
    leetcode: findHandle(hay, /leetcode\.com\/(?:u\/)?([A-Za-z0-9_-]{2,40})/gi, LC_RESERVED),
    links: [...new Set(links)],
  };
}

export function detectResumeQualityFlags(text: string, parsed: Parsed): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  const placeholderPatterns = [
    /\[[^\]]+\]/g,
    /\b(sample|example)@/gi,
    /\b(mr\.?\s+student\s+name|student\s+name|your\s+name)\b/gi,
    /\b(school|college|university|company|platform|event|topic|location)\s+name\b/gi,
    /\b(certification|intern|project)\s+name\b/gi,
    /\b(yyyy|mm\/yyyy|dd\/mm\/yyyy)\b/gi,
  ];
  const placeholders = placeholderPatterns.reduce((count, pattern) => count + (text.match(pattern) ?? []).length, 0);
  const genericLinks = (parsed.links ?? []).filter((link) =>
    /linkedin\.com\/in\/?$|github\.com\/?$|leetcode\.com\/?$|hackerrank\.com\/?$|stopstalk\.com\/?$/i.test(link),
  ).length;
  const invalidName = !parsed.name ||
    /student\s+name|your\s+name|candidate\s+name|sample\s+name/i.test(parsed.name);
  const meaningfulSections = [
    /\b(education|academic)\b[\s\S]{20,}/i,
    /\b(experience|employment|work\s+history|internships?|training)\b[\s\S]{30,}/i,
    /\b(projects?|achievements?|certifications?)\b[\s\S]{30,}/i,
    /\b(technical\s+skills|skills|core\s+competencies|key\s+skills)\b[\s\S]{20,}/i,
  ].filter((pattern) => pattern.test(text.replace(/\[[^\]]+\]/g, ""))).length;

  if (placeholders >= 2 || genericLinks >= 2 || invalidName ||
      (!parsed.skills.length && meaningfulSections < 2) ||
      (meaningfulSections === 0)) {
    const reasons = [
      placeholders >= 2 ? "placeholder/template fields detected" : "",
      genericLinks >= 2 ? "generic profile links detected" : "",
      invalidName ? "missing or placeholder candidate name" : "",
      meaningfulSections === 0 ? "no meaningful resume sections found" : "",
    ].filter(Boolean);
    flags.push({
      code: "invalid_resume",
      severity: 0,
      detail: `Resume quality gate failed: ${reasons.join("; ")}.`,
    });
  }
  return flags;
}

// ---------- Integrity ----------
export interface IntegrityFlag { code: string; severity: number; detail: string }

export function detectIntegrityFlags(text: string, hiddenSignals: number): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  if (hiddenSignals > 0) {
    flags.push({ code: "hidden_text", severity: 0.6, detail: `${hiddenSignals} tiny, white or hidden text run(s) detected` });
  }
  const zw = (text.match(/[\u200B-\u200D\u2060\uFEFF]/g) ?? []).length;
  if (zw > 0) flags.push({ code: "zero_width_chars", severity: 0.9, detail: `${zw} zero-width character(s)` });

  if (/(ignore (all|any|the|previous)[^.\n]{0,40}instructions|disregard[^.\n]{0,40}instructions|you are (an?|the) (ai|assistant|recruiter|screener)|system prompt|(rank|score|rate) (this|me|my)[^.\n]{0,30}(highest|top|first|perfect)|give (this|me)[^.\n]{0,20}(high|top|perfect) score)/i.test(text)) {
    flags.push({ code: "instruction_injection", severity: 0.5, detail: "Instruction-like text aimed at the screening process" });
  }
  const stuffed = Object.entries(SKILL_TAXONOMY)
    .map(([canon, syns]) => [canon, [canon, ...syns].reduce((n, s) => n + countTerm(text, s), 0)] as const)
    .filter(([, n]) => n >= 15);
  if (stuffed.length) {
    flags.push({ code: "keyword_stuffing", severity: 0.8, detail: `Repeated excessively: ${stuffed.map(([c, n]) => `${c} (${n}x)`).join(", ")}` });
  }
  return flags;
}

// ---------- Blind screening ----------
export function redact(text: string, p: Parsed): string {
  let t = text
    .replace(new RegExp(EMAIL_RE.source, "gi"), "[email]")
    .replace(URL_RE, "[link]")
    .replace(new RegExp(PHONE_RE.source, "g"), "[phone]");
  for (const part of (p.name ?? "").split(/\s+/).filter((x) => x.length >= 2)) {
    t = t.replace(new RegExp(`\\b${esc(part)}\\b`, "gi"), "[name]");
  }
  return t;
}
