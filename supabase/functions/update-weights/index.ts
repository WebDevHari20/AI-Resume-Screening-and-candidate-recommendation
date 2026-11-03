import { authenticate, handler, HttpError, json, serviceClient } from "../_shared/http.ts";
import { rescore } from "../_shared/pipeline.ts";
import { learnWeights, normalizeWeights } from "../_shared/scoring.ts";

/**
 * POST { job_id, weights }                 -> save normalized weights + rescore all candidates
 * POST { job_id, learn: true }             -> suggest weights from shortlist/reject decisions
 * POST { job_id, learn: true, apply: true }-> save the suggestion + rescore (explicit opt-in)
 */
Deno.serve(handler(async (req) => {
  const { userClient } = await authenticate(req);
  const body = await req.json().catch(() => ({}));
  if (!body.job_id) throw new HttpError(400, "job_id is required");

  const { data: job } = await userClient.from("jobs").select("*").eq("id", body.job_id).maybeSingle();
  if (!job) throw new HttpError(404, "Job not found");
  const sb = serviceClient();

  async function saveAndRescore(weights: Record<string, number>) {
    await sb.from("jobs").update({ weights }).eq("id", job.id);
    const { data: cands } = await sb.from("candidates")
      .select("id, score_breakdown, safety_flags").eq("job_id", job.id);
    const list = cands ?? [];
    for (let i = 0; i < list.length; i += 20) {
      await Promise.all(list.slice(i, i + 20).map((c) =>
        sb.from("candidates").update(rescore({ weights }, c)).eq("id", c.id)
      ));
    }
    return list.length;
  }

  if (body.learn) {
    const { data: cands } = await sb.from("candidates")
      .select("status, score_breakdown").eq("job_id", job.id)
      .in("status", ["shortlisted", "interview", "rejected"]);
    const rows = (cands ?? []).map((c) => ({
      components: c.score_breakdown?.components,
      positive: c.status !== "rejected",
    })).filter((r) => r.components);

    const suggestion = learnWeights(rows);
    if (!suggestion) {
      throw new HttpError(422, "Need at least 10 decided candidates, including both shortlisted and rejected.");
    }
    if (body.apply === true) {
      const n = await saveAndRescore(suggestion);
      return json({ applied: true, weights: suggestion, rescored: n });
    }
    return json({ applied: false, suggested_weights: suggestion, decided_candidates: rows.length });
  }

  if (!body.weights) throw new HttpError(400, "Provide weights, or set learn: true");
  const weights = normalizeWeights(body.weights);
  const n = await saveAndRescore(weights);
  return json({ weights, rescored: n });
}));
