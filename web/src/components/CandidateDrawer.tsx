import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { COMPONENT_LABEL, confirmationState, fmt, fnError, removeResumeFiles, TIER_LABEL } from "../lib/helpers";
import type { Candidate, Feedback, InterviewSlot, Job } from "../types";

interface Props {
  candidate: Candidate;
  job: Job;
  blind: boolean;
  label: string; // display name (anonymised in blind mode)
  onClose: () => void;
  onChanged: () => void;
}

export default function CandidateDrawer({ candidate: c, job, blind, label, onClose, onChanged }: Props) {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([{ start: "", end: "" }]);
  const [link, setLink] = useState<{
    url: string;
    expires: string;
    emailSent?: boolean;
    warning?: string;
  } | null>(null);

  const bd = c.score_breakdown ?? {};
  const proof = c.proof_of_work ?? {};
  const conf = confirmationState(c);

  async function loadFeedback() {
    const { data } = await supabase.from("feedback").select("id, action, note, created_at")
      .eq("candidate_id", c.id).order("created_at", { ascending: false });
    setFeedback((data ?? []) as Feedback[]);
  }
  useEffect(() => { setLink(null); setMsg(null); loadFeedback(); }, [c.id]);

  async function act(action: "shortlist" | "reject" | "interview") {
    setBusy(true);
    setMsg(null);
    const status = action === "shortlist" ? "shortlisted" : action === "reject" ? "rejected" : "interview";
    const fb = await supabase.from("feedback").insert({ candidate_id: c.id, action });
    const up = await supabase.from("candidates").update({ status }).eq("id", c.id);
    if (fb.error || up.error) setMsg({ type: "error", text: (fb.error ?? up.error)!.message });
    else { await loadFeedback(); onChanged(); }
    setBusy(false);
  }

  async function addNote() {
    if (!note.trim()) return;
    const { error } = await supabase.from("feedback").insert({ candidate_id: c.id, action: "note", note: note.trim() });
    if (error) setMsg({ type: "error", text: error.message });
    else { setNote(""); loadFeedback(); }
  }

  async function reverify() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.functions.invoke("reverify-candidate", { body: { candidate_id: c.id } });
    if (error) setMsg({ type: "error", text: await fnError(error) });
    else { setMsg({ type: "info", text: "Proof of work re-checked and score updated." }); onChanged(); }
    setBusy(false);
  }

  async function makeLink() {
    setBusy(true);
    setMsg(null);
    setLink(null);
    const formattedSlots: InterviewSlot[] = slots.map((slot, index) => ({
      id: `slot-${index + 1}`,
      start_at: `${slot.start}:00+05:30`,
      end_at: `${slot.end}:00+05:30`,
      timezone: "Asia/Kolkata",
    }));
    if (formattedSlots.some((slot) => !slot.start_at.startsWith("20") || !slot.end_at.startsWith("20") ||
      Date.parse(slot.end_at) <= Date.parse(slot.start_at))) {
      setMsg({ type: "error", text: "Add valid future start and end times for every slot." });
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("create-confirmation-link", {
      body: { candidate_id: c.id, phone: candidatePhone || c.allocated_phone || "", slots: formattedSlots },
    });
    if (error) setMsg({ type: "error", text: `Could not create confirmation link: ${await fnError(error)}` });
    else {
      const row = Array.isArray(data) ? data[0] : data;
      const token = row?.link_token ?? row?.linkToken;
      const expires = row?.link_expires_at ?? row?.linkExpiresAt;
      if (!token || !expires) {
        console.error("Unexpected create_confirmation_link response", data);
        setMsg({ type: "error", text: "Supabase returned no confirmation token. Check the deployed function and try again." });
      } else {
        setLink({
          url: `${window.location.origin}/confirm/${token}`,
          expires,
          emailSent: row?.email_sent,
          warning: row?.warning,
        });
        onChanged();
      }
    }
    setBusy(false);
  }

  async function openResume() {
    if (!c.resume_path) return;
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(c.resume_path, 300);
    if (error) setMsg({ type: "error", text: error.message });
    else window.open(data.signedUrl, "_blank");
  }

  async function remove() {
    if (!confirm("Delete this candidate and all related data? This cannot be undone.")) return;
    setBusy(true);
    await removeResumeFiles([c.resume_path]);
    const { error } = await supabase.from("candidates").delete().eq("id", c.id);
    setBusy(false);
    if (error) setMsg({ type: "error", text: error.message });
    else { onClose(); onChanged(); }
  }

  const candidatePhone = typeof c.parsed?.phone === "string" ? c.parsed.phone : "";
  const phoneForWa = (c.allocated_phone || candidatePhone).replace(/\D/g, "");

  const gh = proof.github, lc = proof.leetcode;

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{label}</h2>
            {!blind && <div className="muted small">{c.email ?? "no email found"} · {c.filename}</div>}
            {blind && <div className="muted small">Blind mode: identity hidden</div>}
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="score-big">
          <div className="num">{c.final_score ?? "—"}</div>
          <div>
            <span className={`tier ${c.fit_tier}`}>{c.fit_tier ? TIER_LABEL[c.fit_tier] : "Unscored"}</span>
            <div className="muted small">Status: {c.status}</div>
          </div>
        </div>

        {c.needs_manual_review && <div className="notice warn">Manual review required: integrity flag(s) detected.</div>}
        {msg && <div className={`notice ${msg.type}`}>{msg.text}</div>}

        {!blind && c.email && (
          <section>
            <h4>Contact candidate</h4>
            <p className="muted small">Confirmation emails will be sent to {c.email}.</p>
          </section>
        )}

        <section>
          <h4>Recruiter decision</h4>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => act("shortlist")}>Shortlist</button>
            <button disabled={busy} onClick={() => act("interview")}>Mark for interview</button>
            <button className="danger" disabled={busy} onClick={() => act("reject")}>Reject</button>
          </div>
          <p className="muted small">Nothing is rejected automatically. The decision is yours.</p>
        </section>

        <section>
          <h4>Why this score</h4>
          <ul>{(bd.reasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
          {Object.entries(bd.components ?? {}).map(([k, v]) => (
            <div key={k} className="bar-row">
              <span>{COMPONENT_LABEL[k] ?? k}</span>
              {v === null
                ? <span className="muted small">excluded</span>
                : <>
                    <div className="bar"><div style={{ width: `${Math.round((v as number) * 100)}%` }} /></div>
                    <span className="small">{Math.round((v as number) * 100)}% → {bd.contributions?.[k] ?? 0} pts</span>
                  </>}
            </div>
          ))}
          {bd.multiplier !== undefined && bd.multiplier < 1 && (
            <p className="small">Integrity multiplier: ×{Number(bd.multiplier).toFixed(2)}</p>
          )}
        </section>

        <section>
          <h4>Skills</h4>
          <div>{(bd.matched_skills ?? []).map((s: string) => <span key={s} className="chip ok">{s}</span>)}</div>
          <div>{(bd.missing_skills ?? []).map((s: string) => <span key={s} className="chip miss">{s}</span>)}</div>
          {!(bd.matched_skills?.length || bd.missing_skills?.length) && <span className="muted small">No required skills defined.</span>}
        </section>

        <section>
          <h4>Proof of work <span className="muted small">({(proof.status ?? "n/a").replace(/_/g, " ")})</span></h4>
          {gh && !gh.error && (
            <p className="small">
              <b>GitHub</b> {blind ? "" : `@${gh.username}`}: {gh.own_repos} own repos · {gh.commits_90d} commits in 90 days ·
              {" "}{gh.active_days_90d} active days in 90 days · {gh.stars} stars
              {gh.languages?.length ? ` · ${gh.languages.join(", ")}` : ""}
            </p>
          )}
          {gh?.error && <p className="small muted">GitHub: {gh.error}</p>}
          {lc && !lc.error && (
            <p className="small">
              <b>LeetCode</b>: {lc.total_solved} solved ({lc.easy}E / {lc.medium}M / {lc.hard}H)
              {lc.contest_rating ? ` · rating ${Math.round(lc.contest_rating)}` : ""}
            </p>
          )}
          {lc?.error && <p className="small muted">LeetCode: {lc.error}</p>}
          {proof.claims && (
            <div>
              {proof.claims.verified?.map((s: string) => <span key={s} className="chip ok">✓ {s}</span>)}
              {proof.claims.unverified?.map((s: string) => <span key={s} className="chip miss">? {s}</span>)}
            </div>
          )}
          {(proof.notes ?? []).map((n: string, i: number) => <p key={i} className="muted small">{n}</p>)}
          <button disabled={busy} onClick={reverify}>Re-verify proof of work</button>
        </section>

        {c.safety_flags?.length > 0 && (
          <section>
            <h4>Integrity flags</h4>
            <ul>{c.safety_flags.map((f) => <li key={f.code}><b>{f.code}</b>: {f.detail}</li>)}</ul>
          </section>
        )}

        <section>
          <h4>Interview confirmation</h4>
          <p className="muted small">Add available interview slots in Asia/Kolkata time. The candidate will choose one.</p>
          {slots.map((slot, index) => (
            <div className="row" key={index} style={{ marginBottom: 8 }}>
              <input type="datetime-local" value={slot.start} aria-label={`Slot ${index + 1} start`}
                onChange={(e) => setSlots((current) => current.map((item, i) => i === index ? { ...item, start: e.target.value } : item))} />
              <input type="datetime-local" value={slot.end} aria-label={`Slot ${index + 1} end`}
                onChange={(e) => setSlots((current) => current.map((item, i) => i === index ? { ...item, end: e.target.value } : item))} />
              {slots.length > 1 && <button onClick={() => setSlots((current) => current.filter((_, i) => i !== index))}>Remove</button>}
            </div>
          ))}
          {slots.length < 10 && <button onClick={() => setSlots((current) => [...current, { start: "", end: "" }])}>Add another slot</button>}
          <p><span className={`pill ${conf.key}`}>{conf.label}</span></p>
          {conf.latest && (
            <p className="small muted">
              Link created {fmt(conf.latest.sent_at)} · expires {fmt(conf.latest.expires_at)}
              {conf.latest.responded_at && ` · responded ${fmt(conf.latest.responded_at)}`}
            </p>
          )}
          {c.status === "shortlisted" || c.status === "interview" ? (
            <button className="primary" disabled={busy} onClick={makeLink}>
              {conf.latest ? "Generate a new link" : "Generate confirmation link"}
            </button>
          ) : (
            <p className="muted small">Shortlist this candidate to generate a confirmation link.</p>
          )}
          {link && (
            <div className="notice info">
              <p className="small">Copy it now: the secret link is not stored and cannot be shown again.</p>
              <input readOnly value={link.url} onFocus={(e) => e.target.select()} />
              <div className="row wrap" style={{ marginTop: 8 }}>
                <button onClick={() => navigator.clipboard.writeText(link.url)}>Copy link</button>
                <a className="btn" target="_blank" rel="noreferrer" href={link.url}>Open confirmation page</a>
                {phoneForWa && (
                  <a
                    className="btn"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://wa.me/${phoneForWa}?text=${encodeURIComponent(`Hello ${c.name || "there"}, please confirm your interview availability for ${job.title}: ${link.url}`)}`}
                  >
                    Open WhatsApp
                  </a>
                )}
              </div>
              {link.emailSent === false ? (
                <p className="notice warn small" style={{ marginTop: 8 }}>
                  {link.warning || "Confirmation email could not be sent. Please share the link manually or via WhatsApp."}
                </p>
              ) : (
                <p className="muted small">The confirmation email was sent. The candidate can accept or decline using the link.</p>
              )}
            </div>
          )}
        </section>

        <section>
          <h4>Notes & history</h4>
          <div className="row">
            <input value={note} placeholder="Add a note…" onChange={(e) => setNote(e.target.value)} />
            <button onClick={addNote}>Add</button>
          </div>
          <ul className="history">
            {feedback.map((f) => (
              <li key={f.id}><b>{f.action}</b> <span className="muted small">{fmt(f.created_at)}</span>{f.note && <div>{f.note}</div>}</li>
            ))}
          </ul>
        </section>

        <section className="row">
          {!blind && c.resume_path && <button onClick={openResume}>View original resume</button>}
          <button className="danger" disabled={busy} onClick={remove}>Delete candidate</button>
        </section>
      </aside>
    </>
  );
}
