import { extractResume } from "./extract.ts";
import { detectIntegrityFlags, detectResumeQualityFlags, extractSkills, parseResume, redact } from "./nlp.ts";
import { semanticMatch, transcribePdf } from "./matching.ts";
import { verifyProof } from "./proof.ts";
import {
  buildReasons, computeComponents, type Components, type JobLike, scoreFromComponents,
} from "./scoring.ts";

export interface JobRow extends JobLike { id: string }

/** Full analysis of one resume. Returns columns ready to insert into `candidates`. */
export async function analyzeResume(bytes: Uint8Array, filename: string, job: JobRow) {
  let ex = await extractResume(bytes, filename);
  const notes: string[] = [];

  // Scanned PDF? Fall back to Gemini transcription.
  if (ex.kind === "pdf" && ex.text.trim().length < 80) {
    const ocr = await transcribePdf(bytes);
    if (ocr) { ex = { ...ex, text: ocr }; notes.push("text_from_gemini_ocr"); }
  }
  if (ex.text.trim().length < 50) throw new Error("No readable text could be extracted from this file.");

  const parsed = parseResume(ex.text, ex.links);
  const flags = [
    ...detectIntegrityFlags(ex.text, ex.hiddenSignals),
    ...detectResumeQualityFlags(ex.text, parsed),
  ];

  // Semantic matching always uses identity-redacted text (supports blind screening).
  const jobText = `${job.title}\n${job.description}\nRequired skills: ${job.required_skills.join(", ")}`;
  const [semantic, proof] = await Promise.all([
    semanticMatch(redact(ex.text, parsed), jobText),
    verifyProof(parsed, job),
  ]);

  const c = computeComponents(job, parsed, ex.text, semantic, proof);
  const result = scoreFromComponents(c.components, job.weights, flags);
  const reasons = buildReasons(job, parsed, c, semantic, proof, flags, result);

  return {
    name: parsed.name,
    email: parsed.email,
    raw_text: ex.text,
    content_type: ex.kind,
    parsed: { ...parsed, notes },
    proof_of_work: proof,
    safety_flags: flags,
    final_score: result.final,
    fit_tier: result.tier,
    needs_manual_review: result.needs_manual_review,
    score_breakdown: {
      components: c.components,
      contributions: result.contributions,
      effective_weights: result.effective_weights,
      excluded_components: result.excluded,
      multiplier: result.multiplier,
      weighted_score: result.weighted,
      matched_skills: c.matched_skills,
      missing_skills: c.missing_skills,
      semantic: { backend: semantic.backend, raw_similarity: semantic.raw },
      reasons,
    },
  };
}

/** Re-score a stored candidate from its saved components (no re-parsing, no network). */
export function rescore(
  job: Pick<JobLike, "weights">,
  candidate: { score_breakdown: any; safety_flags: any },
) {
  const prev = candidate.score_breakdown ?? {};
  const components = prev.components as Components;
  const result = scoreFromComponents(components, job.weights, candidate.safety_flags ?? []);
  return {
    final_score: result.final,
    fit_tier: result.tier,
    needs_manual_review: result.needs_manual_review,
    score_breakdown: {
      ...prev,
      contributions: result.contributions,
      effective_weights: result.effective_weights,
      excluded_components: result.excluded,
      multiplier: result.multiplier,
      weighted_score: result.weighted,
    },
  };
}

export { extractSkills };
