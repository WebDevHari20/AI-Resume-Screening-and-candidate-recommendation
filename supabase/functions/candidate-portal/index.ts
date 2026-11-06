import { authenticate, handler, HttpError, json, serviceClient } from "../_shared/http.ts";

Deno.serve(handler(async (req) => {
  const { user } = await authenticate(req);
  const sb = serviceClient();
  const [{ data: jobs, error: jobsError }, { data: applications, error: applicationsError }] = await Promise.all([
    sb.from("jobs").select("id, owner_id, title, description, required_skills, min_experience, education_level")
      .eq("applications_open", true).order("created_at", { ascending: false }),
    sb.from("candidates").select("id, job_id, created_at, interview_confirmations(status, expires_at, available_slots, selected_slot_id)")
      .eq("applicant_id", user.id).order("created_at", { ascending: false }),
  ]);
  if (jobsError || applicationsError) throw new HttpError(500, (jobsError ?? applicationsError)!.message);
  const ownerIds = [...new Set((jobs ?? []).map((job) => job.owner_id))];
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await sb.from("profiles").select("id, company").in("id", ownerIds)
    : { data: [], error: null };
  if (profilesError) throw new HttpError(500, profilesError.message);
  const companies = new Map((profiles ?? []).map((profile) => [profile.id, profile.company]));
  return json({
    jobs: (jobs ?? []).map(({ owner_id, ...job }) => ({ ...job, company: companies.get(owner_id) ?? null })),
    applications: applications ?? [],
  });
}));
