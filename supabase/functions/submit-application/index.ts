import { authenticate, corsHeaders, HttpError, json, serviceClient } from "../_shared/http.ts";
import { analyzeResume, type JobRow } from "../_shared/pipeline.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
const hash = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { user } = await authenticate(req);
    const form = await req.formData();
    const jobId = String(form.get("job_id") ?? "");
    const applicantName = String(form.get("name") ?? "").trim();
    const applicantEmail = user.email?.trim() ?? "";
    const file = form.get("resume");
    if (!jobId || !applicantName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail) || !(file instanceof File)) {
      throw new HttpError(400, "Name, signed-in email, job_id, and resume are required");
    }
    if (file.size > MAX_BYTES) throw new HttpError(413, "Resume must be 5 MB or smaller");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentHash = await hash(bytes);
    const sb = serviceClient();
    const { data: job, error: jobError } = await sb.from("jobs").select("*")
      .eq("id", jobId).eq("applications_open", true).maybeSingle();
    if (jobError) throw new HttpError(500, jobError.message);
    if (!job) throw new HttpError(404, "This job is not accepting applications");
    const { data: duplicate } = await sb.from("candidates").select("id")
      .eq("job_id", jobId).eq("content_hash", contentHash).maybeSingle();
    if (duplicate) throw new HttpError(409, "This resume has already been submitted for this job");
    const analysis = await analyzeResume(bytes, file.name, job as JobRow);
    const path = `${job.owner_id}/${jobId}/${contentHash.slice(0, 16)}-${safeName(file.name)}`;
    const upload = await sb.storage.from("resumes").upload(path, bytes, {
      contentType: file.type || "application/octet-stream", upsert: false,
    });
    if (upload.error) throw new HttpError(500, upload.error.message);
    const { error: insertError } = await sb.from("candidates").insert({
      job_id: jobId, applicant_id: user.id, filename: file.name, content_hash: contentHash,
      name: applicantName, email: applicantEmail, resume_path: path, status: "new", ...analysis,
    });
    if (insertError) {
      await sb.storage.from("resumes").remove([path]);
      throw new HttpError(500, insertError.message);
    }
    return json({ submitted: true, message: "Application submitted successfully." });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: "Could not submit application" }, 500);
  }
});
