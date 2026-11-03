import { corsHeaders, HttpError, json, serviceClient } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const sb = serviceClient();
    const { data: job, error } = await sb.from("jobs").select("id, owner_id, title, description, required_skills, min_experience, education_level")
      .eq("id", body.job_id).eq("applications_open", true).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!job) throw new HttpError(404, "This job is unavailable or closed");
    const { data: profile } = await sb.from("profiles").select("company").eq("id", job.owner_id).maybeSingle();
    const { owner_id: _ownerId, ...details } = job;
    return json({ ...details, company: profile?.company ?? null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load job" }, error instanceof HttpError ? error.status : 500);
  }
});
