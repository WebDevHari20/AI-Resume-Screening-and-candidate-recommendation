import { authenticate, handler, HttpError, json, serviceClient } from "../_shared/http.ts";

const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(handler(async (req) => {
  const { user, userClient } = await authenticate(req);
  const body = await req.json().catch(() => ({}));
  const jobId = typeof body.job_id === "string" ? body.job_id : "";
  const windowStart = typeof body.window_start === "string" ? body.window_start : "";
  const windowEnd = typeof body.window_end === "string" ? body.window_end : "";
  const start = Date.parse(`${windowStart}:00+05:30`);
  const end = Date.parse(`${windowEnd}:00+05:30`);
  const durationMinutes = 30;
  if (!jobId || !windowStart || !windowEnd || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpError(400, "job_id and a valid scheduling window are required");
  }
  const slots = [];
  for (let cursor = start; cursor + durationMinutes * 60_000 <= end; cursor += durationMinutes * 60_000) {
    slots.push({
      id: `slot-${slots.length + 1}`,
      start_at: new Date(cursor).toISOString(),
      end_at: new Date(cursor + durationMinutes * 60_000).toISOString(),
      timezone: "Asia/Kolkata",
    });
  }
  if (!slots.length || slots.length > 100) {
    throw new HttpError(400, "The scheduling window must contain at least one and at most 100 half-hour slots");
  }
  const { data: job } = await userClient.from("jobs").select("id, title").eq("id", jobId).maybeSingle();
  if (!job) throw new HttpError(404, "Job not found");
  const { data: candidates, error: candidateError } = await userClient
    .from("candidates").select("id, name, email").eq("job_id", jobId).in("status", ["shortlisted", "interview"]);
  if (candidateError) throw new HttpError(500, candidateError.message);
  if (!candidates?.length) throw new HttpError(422, "No shortlisted candidates need an invitation");
  if (slots.length < candidates.length) {
    throw new HttpError(422, `The scheduling window creates ${slots.length} slot(s), but ${candidates.length} candidates need interviews. Extend the window.`);
  }

  const sb = serviceClient();
  const { data: campaign, error: campaignError } = await sb.from("interview_campaigns")
    .insert({ job_id: jobId, owner_id: user.id, slots }).select("id").single();
  if (campaignError) throw new HttpError(500, campaignError.message);
  const { error: slotError } = await sb.from("interview_campaign_slots")
    .insert(slots.map((slot: { id: string }) => ({ campaign_id: campaign.id, slot_id: slot.id })));
  if (slotError) throw new HttpError(500, slotError.message);

  const appUrl = Deno.env.get("APP_URL") || req.headers.get("origin") || "http://localhost:5173";
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  const results = await Promise.all(candidates.map(async (candidate) => {
    const raw = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await sb.from("interview_confirmations").insert({
      candidate_id: candidate.id, token_hash: await hash(raw), expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      available_slots: slots, campaign_id: campaign.id, recruiter_email: user.email ?? null,
    });
    if (error) return { candidate: candidate.name || candidate.email, sent: false, error: error.message };
    if (!candidate.email || !apiKey || !emailFrom) return { candidate: candidate.name || candidate.email, sent: false, error: "Email or Resend configuration missing" };
    const confirmationUrl = `${appUrl.replace(/\/$/, "")}/confirm/${raw}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom, to: candidate.email, subject: `Choose an interview time for ${job.title}`,
        text: `Hello ${candidate.name || "there"},\n\nPlease choose an available interview time here:\n${confirmationUrl}\n\nThis link expires in 72 hours.`,
      }),
    });
    return { candidate: candidate.name || candidate.email, sent: response.ok, error: response.ok ? undefined : await response.text() };
  }));
  return json({ campaign_id: campaign.id, total: candidates.length, results });
}));
