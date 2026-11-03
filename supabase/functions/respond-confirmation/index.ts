import { handler, HttpError, json, serviceClient } from "../_shared/http.ts";

const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(handler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const decision = body.decision === "accepted" || body.decision === "declined" ? body.decision : "";
  const slotId = typeof body.slot_id === "string" ? body.slot_id : null;
  if (!token || !decision) throw new HttpError(400, "token and decision are required");

  const sb = serviceClient();
  const tokenHash = await hashToken(token);
  const { data: confirmation, error: lookupError } = await sb
    .from("interview_confirmations")
    .select("id, recruiter_email, available_slots, selected_slot_id, candidates(name, jobs(title))")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (lookupError) throw new HttpError(500, lookupError.message);
  if (!confirmation) throw new HttpError(404, "Invalid link");

  const { data, error } = await sb.rpc("respond_confirmation", {
    p_token: token,
    p_decision: decision,
    p_slot_id: slotId,
  });
  if (error) throw new HttpError(422, error.message);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  if (apiKey && emailFrom && confirmation.recruiter_email) {
    const candidate = Array.isArray(confirmation.candidates) ? confirmation.candidates[0] : confirmation.candidates;
    const job = candidate && (Array.isArray(candidate.jobs) ? candidate.jobs[0] : candidate.jobs);
    const selected = Array.isArray(confirmation.available_slots)
      ? confirmation.available_slots.find((slot: { id: string }) => slot.id === slotId)
      : null;
    const subject = decision === "accepted"
      ? `Interview slot selected for ${job?.title || "your job"}`
      : `Candidate declined interview for ${job?.title || "your job"}`;
    const details = decision === "accepted" && selected
      ? `Selected slot: ${new Date(selected.start_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} - ${new Date(selected.end_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} (Asia/Kolkata)`
      : "The candidate declined all proposed interview slots.";
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom,
        to: confirmation.recruiter_email,
        subject,
        text: `Candidate ${candidate?.name || "unknown"} responded.\n\n${details}`,
      }),
    });
    if (!emailResponse.ok) console.error("Recruiter notification failed:", await emailResponse.text());
  }

  return json(data);
}));
