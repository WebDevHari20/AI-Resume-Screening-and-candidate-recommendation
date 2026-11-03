import { canonicalSkill, EDU_RANK, hasTerm, type IntegrityFlag, type Parsed } from "./nlp.ts";
import type { ProofResult } from "./proof.ts";
import type { Semantic } from "./matching.ts";

export const KEYS = ["skills", "experience", "education", "semantic", "proof_of_work"] as const;
export type Key = typeof KEYS[number];
export type Weights = Record<Key, number>;
export type Components = Record<Key, number | null>;

export const DEFAULT_WEIGHTS: Weights = {
  skills: 0.30, experience: 0.15, education: 0.10, semantic: 0.25, proof_of_work: 0.20,
};

export interface JobLike {
  title: string;
  description: string;
  required_skills: string[];
  min_experience: number;
  education_level: string;
  requires_proof_of_work: boolean;
  weights: Partial<Weights> | null;
}

export function normalizeWeights(w: Partial<Weights> | null | undefined): Weights {
  const raw = KEYS.map((k) => Math.max(0, Number(w?.[k] ?? DEFAULT_WEIGHTS[k])));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(KEYS.map((k, i) => [k, raw[i] / sum])) as Weights;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function skillMatch(job: JobLike, parsed: Parsed, text: string) {
  const required = [...new Set(job.required_skills.map(canonicalSkill))];
  const have = new Set(parsed.skills);
  const matched = required.filter((s) => have.has(s) || hasTerm(text, s));
  return { required, matched, missing: required.filter((s) => !matched.includes(s)) };
}

export function computeComponents(
  job: JobLike, parsed: Parsed, text: string, semantic: Semantic, proof: ProofResult,
) {
  const sk = skillMatch(job, parsed, text);
  const components: Components = {
    skills: sk.required.length ? sk.matched.length / sk.required.length : null,
    experience: job.min_experience > 0 ? clamp01(parsed.years_experience / job.min_experience) : null,
    education: (EDU_RANK[job.education_level] ?? 0) > 0
      ? clamp01((EDU_RANK[parsed.education_level] ?? 0) / EDU_RANK[job.education_level])
      : null,
    semantic: semantic.score,
    proof_of_work: proof.score,
  };
  return { components, matched_skills: sk.matched, missing_skills: sk.missing };
}

const MIN_MULTIPLIER = 0.3;

export function scoreFromComponents(
  components: Components,
  weightsIn: Partial<Weights> | null,
  flags: IntegrityFlag[],
) {
  const weights = normalizeWeights(weightsIn);
  const qualityFailed = flags.some((flag) => flag.code === "invalid_resume");
  const comp = components || ({} as Components);
  const active = KEYS.filter((k) => comp[k] !== null && comp[k] !== undefined);
  const wsum = active.reduce((n, k) => n + weights[k], 0) || 1;

  const contributions: Partial<Record<Key, number>> = {};
  let weighted = 0;
  if (!qualityFailed) {
    for (const k of active) {
      const c = (weights[k] / wsum) * (comp[k] as number) * 100;
      contributions[k] = Math.round(c * 100) / 100;
      weighted += c;
    }
  }
  const integrityMultiplier = flags
    .filter((f) => f.code !== "invalid_resume")
    .reduce((m, f) => m * f.severity, 1);
  const multiplier = qualityFailed ? 0 : Math.max(MIN_MULTIPLIER, integrityMultiplier);
  const final = qualityFailed ? 0 : Math.round(weighted * multiplier * 100) / 100;
  const structured = active.some((k) => k !== "semantic");
  const tier = !qualityFailed && final >= 75 && structured ? "strong_fit" : !qualityFailed && final >= 50 ? "moderate_fit" : "low_fit";
  const effectiveWeights = qualityFailed ? {} : Object.fromEntries(active.map((k) => [k, weights[k] / wsum]));
  return {
    final, tier, weighted: Math.round(weighted * 100) / 100, multiplier,
    contributions, effective_weights: effectiveWeights,
    excluded: qualityFailed ? [...KEYS] : KEYS.filter((k) => !active.includes(k)),
    needs_manual_review: flags.some((flag) => flag.code !== "invalid_resume"),
  };
}

export function buildReasons(
  job: JobLike, parsed: Parsed, c: ReturnType<typeof computeComponents>,
  semantic: Semantic, proof: ProofResult, flags: IntegrityFlag[],
  result: ReturnType<typeof scoreFromComponents>,
): string[] {
  const r: string[] = [];
  const total = c.matched_skills.length + c.missing_skills.length;
  if (total) {
    r.push(`Matches ${c.matched_skills.length} of ${total} required skills` +
      (c.missing_skills.length ? `; missing: ${c.missing_skills.join(", ")}.` : "."));
  }
  if (job.min_experience > 0) {
    r.push(`${parsed.years_experience} years of experience found vs ${job.min_experience} required.`);
  }
  if ((EDU_RANK[job.education_level] ?? 0) > 0) {
    const ok = (EDU_RANK[parsed.education_level] ?? 0) >= EDU_RANK[job.education_level];
    r.push(`Education detected: ${parsed.education_level}; ${ok ? "meets" : "below"} the ${job.education_level} requirement.`);
  }
  const backendLabel = semantic.backend === "sbert"
    ? "local SBERT embeddings"
    : semantic.backend === "gemini"
      ? "Gemini embeddings"
      : "keyword fallback, embedding services unavailable";
  r.push(`Job-description similarity ${Math.round(semantic.score * 100)}% (${backendLabel}).`);
  if (result.tier !== "strong_fit" && c.components.semantic !== null &&
      !Object.keys(c.components).some((k) => k !== "semantic" && c.components[k as Key] !== null)) {
    r.push("Strong fit is withheld because the job has no configured skills, experience, education, or proof-of-work criteria.");
  }
  if (flags.some((flag) => flag.code === "invalid_resume")) {
    r.push("Candidate marked non-fit because the resume appears incomplete, templated, or lacks meaningful candidate-specific information.");
  }
  if (proof.score === null) r.push(`Proof of work was excluded from the score (${proof.status.replace(/_/g, " ")}); other weights were rescaled.`);
  else r.push(`Proof of work scored ${Math.round(proof.score * 100)}% (${proof.claims.verified.length} claim(s) verified, ${proof.claims.unverified.length} unverified).`);
  const integrityFlags = flags.filter((f) => f.code !== "invalid_resume");
  if (integrityFlags.length) {
    r.push(`Score multiplied by ${result.multiplier.toFixed(2)} because of integrity flag(s): ${integrityFlags.map((f) => f.code).join(", ")}. Manual review required.`);
  }
  return r;
}

// ---------- Weight learning (logistic regression, recruiter-confirmed only) ----------
export function learnWeights(rows: { components: Components; positive: boolean }[]): Weights | null {
  const pos = rows.filter((r) => r.positive).length;
  if (rows.length < 10 || pos === 0 || pos === rows.length) return null;

  const X = rows.map((r) => KEYS.map((k) => r.components[k] ?? 0));
  const y = rows.map((r) => (r.positive ? 1 : 0));
  const w = KEYS.map(() => 0);
  let b = 0;
  const lr = 0.5, l2 = 0.01;
  for (let it = 0; it < 2000; it++) {
    const gw = KEYS.map(() => 0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const z = b + X[i].reduce((s, x, j) => s + x * w[j], 0);
      const err = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < w.length; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < w.length; j++) w[j] -= lr * (gw[j] / X.length + l2 * w[j]);
    b -= lr * (gb / X.length);
  }
  return normalizeWeights(Object.fromEntries(KEYS.map((k, j) => [k, Math.max(w[j], 0.02)])) as Weights);
}
