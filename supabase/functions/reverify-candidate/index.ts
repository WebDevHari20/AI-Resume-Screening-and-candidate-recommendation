import { authenticate, handler, HttpError, json, serviceClient } from "../_shared/http.ts";
import { verifyProof } from "../_shared/proof.ts";
import { rescore } from "../_shared/pipeline.ts";
import { buildReasons, type Components } from "../_shared/scoring.ts";
import type { Parsed } from "../_shared/nlp.ts";

/** POST { candidate_id } */
Deno.serve(handler(async (req) => {
  const { userClient } = await authenticate(req);
  const { candidate_id } = await req.json().catch(() => ({}));
  if (!candidate_id) throw new HttpError(400, "candidate_id is required");

  // RLS: returns nothing unless the recruiter owns the job behind this candidate.
  const { data: cand } = await userClient
    .from("candidates").select("*, jobs(*)").eq("id", candidate_id).maybeSingle();
  if (!cand || !cand.jobs) throw new HttpError(404, "Candidate not found");

  const proof = await verifyProof(cand.parsed as Parsed, cand.jobs);

  const prev = cand.score_breakdown ?? {};
  const components: Components = {
    ...(prev.components ?? {}),
    proof_of_work: proof.score,
  };
  const breakdown = {
    ...prev,
    components,
  };
  const scored = rescore(cand.jobs, { score_breakdown: breakdown, safety_flags: cand.safety_flags });

  const c = {
    components,
    matched_skills: prev.matched_skills ?? [],
    missing_skills: prev.missing_skills ?? [],
  };
  const semantic = {
    score: components.semantic ?? 0,
    backend: (prev.semantic?.backend ?? "tfidf") as "sbert" | "gemini" | "tfidf",
    raw: prev.semantic?.raw_similarity ?? (components.semantic ?? 0),
  };
  const reasons = buildReasons(
    cand.jobs,
    cand.parsed as Parsed,
    c,
    semantic,
    proof,
    cand.safety_flags ?? [],
    {
      final: scored.final_score,
      tier: scored.fit_tier,
      weighted: scored.score_breakdown.weighted_score,
      multiplier: scored.score_breakdown.multiplier,
      contributions: scored.score_breakdown.contributions,
      effective_weights: scored.score_breakdown.effective_weights,
      excluded: scored.score_breakdown.excluded_components,
      needs_manual_review: scored.needs_manual_review,
    },
  );

  const updatedBreakdown = {
    ...scored.score_breakdown,
    reasons,
  };

  const { error } = await serviceClient().from("candidates")
    .update({ proof_of_work: proof, ...scored, score_breakdown: updatedBreakdown }).eq("id", candidate_id);
  if (error) throw new HttpError(500, error.message);

  return json({ candidate_id, proof_of_work: proof, final_score: scored.final_score, fit_tier: scored.fit_tier });
}));
