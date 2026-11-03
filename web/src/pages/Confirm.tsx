import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface Details {
  candidate_name: string | null;
  job_title: string;
  job_description: string;
  required_skills: string[];
  min_experience: number;
  education_level: string;
  status: "link_generated" | "accepted" | "declined" | "expired";
  available_slots: { id: string; start_at: string; end_at: string; timezone: string }[];
  selected_slot_id: string | null;
  reserved_slot_ids: string[];
  expires_at: string;
}

export default function Confirm() {
  const { token = "" } = useParams();
  const [d, setD] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string>("");

  useEffect(() => {
    supabase.rpc("get_confirmation", { p_token: token }).then(({ data, error }) => {
      if (error) setError("This link is invalid or no longer available.");
      else setD(data as Details);
    });
  }, [token]);

  async function decide(decision: "accepted" | "declined") {
    setBusy(true);
    setError(null);
    const { error } = await supabase.functions.invoke("respond-confirmation", {
      body: { token, decision, slot_id: decision === "accepted" ? selectedSlot : null },
    });
    if (error) {
      let details = "";
      try {
        const body = await error.context?.json();
        details = body?.error ?? "";
      } catch { /* use the SDK message */ }
      if (/slot was just selected|already booked|not available/i.test(details)) {
        setSelectedSlot("");
        const refreshed = await supabase.rpc("get_confirmation", { p_token: token });
        if (!refreshed.error) setD(refreshed.data as Details);
        setError("That slot was already reserved. Please choose another available slot.");
      } else {
        setError(
          /expired/.test(details) ? "This link has expired."
          : /already/.test(details) ? "A response has already been recorded."
          : details || error.message || "Could not record your response. Please try again.",
        );
      }
    } else {
      setD((prev) => (prev ? { ...prev, status: decision } : prev));
    }
    setBusy(false);
  }

  if (error && !d) return <div className="center"><div className="card auth"><h2>Interview confirmation</h2><div className="notice error">{error}</div></div></div>;
  if (!d) return <div className="center muted">Loading…</div>;

  return (
    <div className="center">
      <div className="card confirm">
        <h2>Interview availability</h2>
        <p>Hello{d.candidate_name ? ` ${d.candidate_name}` : ""}, you have been shortlisted for:</p>
        <h3>{d.job_title}</h3>
        <p className="pre">{d.job_description}</p>
        <dl>
          <dt>Required skills</dt>
          <dd>{d.required_skills?.length ? d.required_skills.map((s) => <span key={s} className="chip">{s}</span>) : "—"}</dd>
          <dt>Experience</dt>
          <dd>{d.min_experience > 0 ? `${d.min_experience}+ years` : "Not specified"}</dd>
          <dt>Education</dt>
          <dd>{d.education_level === "any" ? "Not specified" : d.education_level.replace("_", " ")}</dd>
        </dl>

        {d.status === "link_generated" && (
          <>
            <p>Select an interview slot:</p>
            <div>
              {(d.available_slots ?? []).map((slot) => (
                <label key={slot.id} className="row" style={{ marginBottom: 8 }}>
                  <input type="radio" name="interview-slot" value={slot.id} disabled={(d.reserved_slot_ids ?? []).includes(slot.id)}
                    checked={selectedSlot === slot.id} 
                    onChange={() => setSelectedSlot(slot.id)} />
                  <span>{new Date(slot.start_at).toLocaleString("en-IN", { timeZone: slot.timezone })} - {new Date(slot.end_at).toLocaleTimeString("en-IN", { timeZone: slot.timezone })} ({slot.timezone})
                    {(d.reserved_slot_ids ?? []).includes(slot.id) && <b className="muted"> · Already reserved</b>}
                  </span>
                </label>
              ))}
            </div>
            {error && <div className="notice error">{error}</div>}
            <div className="row">
              <button className="primary" disabled={busy || !selectedSlot} onClick={() => decide("accepted")}>Select slot</button>
              <button className="danger" disabled={busy} onClick={() => decide("declined")}>Decline</button>
            </div>
            <p className="muted small">Times are shown in Asia/Kolkata. This link expires on {new Date(d.expires_at).toLocaleString()}.</p>
          </>
        )}
        {d.status === "accepted" && <div className="notice info">Thank you! Your interview slot is confirmed. The recruiter has been notified.</div>}
        {d.status === "declined" && <div className="notice info">You have declined. Thank you for letting us know.</div>}
        {d.status === "expired" && <div className="notice error">This link has expired. Please contact the recruiter.</div>}
      </div>
    </div>
  );
}
