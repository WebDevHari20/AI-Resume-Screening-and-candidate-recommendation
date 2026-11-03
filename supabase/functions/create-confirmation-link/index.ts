import { authenticate, handler, HttpError, json, serviceClient } from "../_shared/http.ts";

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.serve(handler(async (req) => {
  const { userClient } = await authenticate(req);
  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body.candidate_id === "string" ? body.candidate_id : "";
  const phone = typeof body.phone === "string" ? body.phone : "";
  const slots = Array.isArray(body.slots) ? body.slots : [];
  if (!candidateId) throw new HttpError(400, "candidate_id is required");

  const { data: candidate, error: candidateError } = await userClient
    .from("candidates")
    .select("id, status, email, name, jobs(title)")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) throw new HttpError(500, candidateError.message);
  if (!candidate) throw new HttpError(404, "Candidate not found");
  if (candidate.status !== "shortlisted" && candidate.status !== "interview") {
    throw new HttpError(422, "Candidate must be shortlisted or marked for interview first");
  }
  if (slots.length < 1 || slots.length > 10 || slots.some((slot) =>
    !slot || typeof slot.id !== "string" || typeof slot.start_at !== "string" ||
    typeof slot.end_at !== "string" || slot.timezone !== "Asia/Kolkata" ||
    !Number.isFinite(Date.parse(slot.start_at)) || !Number.isFinite(Date.parse(slot.end_at)) ||
    Date.parse(slot.end_at) <= Date.parse(slot.start_at)
  )) {
    throw new HttpError(400, "Provide 1 to 10 valid Asia/Kolkata interview slots");
  }

  const appUrl = Deno.env.get("APP_URL") || req.headers.get("origin") || "http://localhost:5173";
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");

  const raw = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const tokenHash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const { error: insertError } = await serviceClient().from("interview_confirmations").insert({
    candidate_id: candidateId,
    token_hash: tokenHash,
    phone_last4: phone.replace(/\D/g, "").slice(-4),
    expires_at: expiresAt,
    available_slots: slots,
    recruiter_email: user.email ?? null,
  });
  if (insertError) throw new HttpError(500, insertError.message);

  let emailSent = false;
  let emailWarning: string | undefined;

  if (resendApiKey && emailFrom) {
    if (!candidate.email) {
      emailWarning = "Candidate has no email address on file. Please share the confirmation link manually.";
    } else {
      const job = Array.isArray(candidate.jobs) ? candidate.jobs[0] : candidate.jobs;
      const confirmationUrl = `${appUrl.replace(/\/$/, "")}/confirm/${raw}`;
      const candidateName = candidate.name || "there";
      const jobTitle = job?.title || "your interview";
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: emailFrom,
            to: candidate.email,
            subject: `Interview confirmation for ${jobTitle}`,
            text: [
              `Hello ${candidateName},`,
              "",
              `You have been shortlisted for ${jobTitle}.`,
              `Confirm your interview availability here: ${confirmationUrl}`,
              "",
              "This link expires in 72 hours.",
            ].join("\n"),
            html: `
              <p>Hello ${candidateName},</p>
              <p>You have been shortlisted for <strong>${jobTitle}</strong>.</p>
              <p><a href="${confirmationUrl}">Confirm your interview availability</a></p>
              <p>This link expires in 72 hours.</p>
            `,
          }),
        });
        if (emailResponse.ok) {
          emailSent = true;
        } else {
          const details = await emailResponse.text();
          console.error("Confirmation email failed:", details);
          emailWarning = "Confirmation email could not be sent. Please share the link manually.";
        }
      } catch (err) {
        console.error("Confirmation email request failed:", err);
        emailWarning = "Could not reach email provider. Please share the link manually.";
      }
    }
  } else {
    emailWarning = "Email provider not configured. Please share the link manually or via WhatsApp.";
  }

  return json({
    link_token: raw,
    link_expires_at: expiresAt,
    email_sent: emailSent,
    warning: emailWarning,
  });
}));
