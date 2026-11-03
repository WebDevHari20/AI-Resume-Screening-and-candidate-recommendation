import { authenticate, handler, HttpError, json, serviceClient } from "../_shared/http.ts";
import { analyzeResume, type JobRow } from "../_shared/pipeline.ts";
import { extractSkills } from "../_shared/nlp.ts";

const MAX_FILES = Number(Deno.env.get("MAX_FILES_PER_REQUEST") ?? 20);
const MAX_BYTES = Number(Deno.env.get("MAX_FILE_MB") ?? 5) * 1024 * 1024;
const CONCURRENCY = 3;

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);

/** POST multipart/form-data: job_id + files (repeat the "files" field). */
Deno.serve(handler(async (req) => {
  const { user, userClient } = await authenticate(req);

  const form = await req.formData();
  const jobId = String(form.get("job_id") ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!jobId) throw new HttpError(400, "job_id is required");
  if (!files.length) throw new HttpError(400, "Attach at least one resume in the 'files' field");
  if (files.length > MAX_FILES) throw new HttpError(413, `Max ${MAX_FILES} resumes per request`);

  // RLS guarantees the recruiter owns this job.
  const { data: job } = await userClient.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) throw new HttpError(404, "Job not found");

  const sb = serviceClient();

  // README: if required_skills is omitted, extract them from the description.
  if (!job.required_skills?.length) {
    job.required_skills = extractSkills(`${job.title}\n${job.description}`);
    await sb.from("jobs").update({ required_skills: job.required_skills }).eq("id", jobId);
  }

  const demoPhone = Deno.env.get("DEMO_WHATSAPP_NUMBER") ?? null;
  const processed: unknown[] = [];
  const errors: { filename: string; code: string; error: string }[] = [];

  async function processOne(file: File) {
    try {
      if (file.size > MAX_BYTES) {
        return errors.push({ filename: file.name, code: "too_large", error: `Larger than ${MAX_BYTES / 1024 / 1024} MB` });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = toHex(await crypto.subtle.digest("SHA-256", bytes));

      const { data: dup } = await sb.from("candidates").select("id")
        .eq("job_id", jobId).eq("content_hash", hash).maybeSingle();
      if (dup) return errors.push({ filename: file.name, code: "duplicate", error: "This resume was already uploaded for this job" });

      const analysis = await analyzeResume(bytes, file.name, job as JobRow);

      const path = `${user.id}/${jobId}/${hash.slice(0, 16)}-${safeName(file.name)}`;
      const up = await sb.storage.from("resumes").upload(path, bytes, {
        contentType: file.type || "application/octet-stream", upsert: false,
      });
      if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);

      const { data: row, error } = await sb.from("candidates").insert({
        job_id: jobId,
        filename: file.name,
        content_hash: hash,
        allocated_phone: demoPhone, // demo number, never the number parsed from the resume
        resume_path: path,
        status: "new",
        ...analysis,
      }).select("id, name, final_score, fit_tier").single();

      if (error) {
        await sb.storage.from("resumes").remove([path]);
        if (error.code === "23505") return errors.push({ filename: file.name, code: "duplicate", error: "Duplicate resume" });
        throw new Error(error.message);
      }
      processed.push({ ...row, filename: file.name });
    } catch (e) {
      console.error(file.name, e);
      errors.push({ filename: file.name, code: "processing_failed", error: (e as Error).message });
    }
  }

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(files.slice(i, i + CONCURRENCY).map(processOne));
  }

  return json({ processed, errors });
}));
