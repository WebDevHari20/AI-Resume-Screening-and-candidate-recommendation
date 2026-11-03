import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { confirmationState, csvEscape, removeResumeFiles, TIER_LABEL } from "../lib/helpers";
import type { Candidate, Job } from "../types";
import JobForm from "../components/JobForm";
import UploadPanel from "../components/UploadPanel";
import WeightsPanel from "../components/WeightsPanel";
import CandidateDrawer from "../components/CandidateDrawer";
import RecruiterSearch from "../components/RecruiterSearch";

const COLS =
  "id, job_id, filename, name, email, allocated_phone, resume_path, content_type, final_score, fit_tier, " +
  "needs_manual_review, status, created_at, parsed, proof_of_work, safety_flags, score_breakdown, " +
  "interview_confirmations(id, status, expires_at, sent_at, responded_at, phone_last4, available_slots, selected_slot_id)";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } },
};

export default function Dashboard({ session }: { session: Session }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string | null>(store.get("jobId"));
  const [cands, setCands] = useState<Candidate[]>([]);
  const [candId, setCandId] = useState<string | null>(store.get("candId"));
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<"none" | "newJob" | "upload" | "weights">("none");
  const [blind, setBlind] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [bulkWindow, setBulkWindow] = useState({ start: "", end: "" });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const job = jobs.find((j) => j.id === jobId) ?? null;

  const loadJobs = useCallback(async () => {
    const { data } = await supabase.from("jobs").select("*").order("created_at", { ascending: false });
    setJobs((data ?? []) as Job[]);
  }, []);

  const loadCands = useCallback(async (silent = false) => {
    if (!jobId) { setCands([]); return; }
    if (!silent) setLoading(true);
    const { data } = await supabase.from("candidates").select(COLS)
      .eq("job_id", jobId).order("final_score", { ascending: false, nullsFirst: false });
    setCands((data ?? []) as unknown as Candidate[]);
    setLoading(false);
  }, [jobId]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { store.set("jobId", jobId); setCandId(null); loadCands(); }, [jobId, loadCands]);
  useEffect(() => { store.set("candId", candId); }, [candId]);
  // Pick up candidate confirmations without a manual refresh.
  useEffect(() => { const t = setInterval(() => loadCands(true), 20000); return () => clearInterval(t); }, [loadCands]);
  // If the saved job no longer exists, fall back to the newest one.
  useEffect(() => {
    if (jobs.length && !jobs.some((j) => j.id === jobId)) setJobId(jobs[0].id);
  }, [jobs, jobId]);

  const shown = useMemo(
    () => cands.filter((c) => (c.final_score ?? 0) >= minScore && (statusFilter === "all" || c.status === statusFilter)),
    [cands, minScore, statusFilter],
  );
  const labelOf = (c: Candidate) => blind
    ? `Candidate #${cands.findIndex((x) => x.id === c.id) + 1}`
    : c.name ?? c.filename;
  const selected = cands.find((c) => c.id === candId) ?? null;
  const acceptedCandidates = cands.filter((c) => confirmationState(c).latest?.status === "accepted");
  const shortlistedCandidates = cands.filter((c) => c.status === "shortlisted" || c.status === "interview");

  async function sendBulkInvitations() {
    if (!job) return;
    if (!bulkWindow.start || !bulkWindow.end || `${bulkWindow.end}:00+05:30` <= `${bulkWindow.start}:00+05:30`) {
      setBulkMessage("Add a valid start and end time window.");
      return;
    }
    if (!confirm(`Send these slots to ${shortlistedCandidates.length} shortlisted/interview candidate(s)?`)) return;
    setBulkBusy(true);
    setBulkMessage(null);
    const { data, error } = await supabase.functions.invoke("bulk-interview-invitations", {
      body: { job_id: job.id, window_start: bulkWindow.start, window_end: bulkWindow.end },
    });
    if (error) {
      setBulkMessage(error.message);
    } else {
      const failed = (data?.results ?? []).filter((result: { sent: boolean }) => !result.sent).length;
      setBulkMessage(`Sent ${data?.total - failed}/${data?.total} invitation(s). Each selected slot is reserved for one candidate.`);
      await loadCands(true);
    }
    setBulkBusy(false);
  }

  async function deleteAllCandidates() {
    if (!job || !confirm(`Delete ALL ${cands.length} candidates for “${job.title}”?`)) return;
    await removeResumeFiles(cands.map((c) => c.resume_path));
    await supabase.from("candidates").delete().eq("job_id", job.id);
    setCandId(null);
    loadCands();
  }

  async function deleteJob() {
    if (!job || !confirm(`Delete the job “${job.title}” and all its candidates?`)) return;
    await removeResumeFiles(cands.map((c) => c.resume_path));
    await supabase.from("jobs").delete().eq("id", job.id);
    setJobId(null);
    setPanel("none");
    loadJobs();
  }

  function exportCsv() {
    const head = ["rank", ...(blind ? [] : ["name", "email"]), "score", "fit", "status", "interview_confirmation", "matched_skills", "missing_skills", "manual_review"];
    const rows = cands.map((c, i) => [
      i + 1, ...(blind ? [] : [c.name, c.email]), c.final_score, c.fit_tier, c.status,
      confirmationState(c).label,
      (c.score_breakdown?.matched_skills ?? []).join("; "),
      (c.score_breakdown?.missing_skills ?? []).join("; "),
      c.needs_manual_review ? "yes" : "no",
    ]);
    const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${(job?.title ?? "ranking").replace(/[/\\?%*:|"<>]/g, "_")}.csv`;
    a.click();
  }

  return (
    <div className="layout">
      <nav className="sidebar">
        <h2>Openings</h2>
        <button className="primary block" onClick={() => setPanel("newJob")}>+ New job</button>
        <ul>
          {jobs.map((j) => (
            <li key={j.id} className={j.id === jobId ? "active" : ""} onClick={() => { setJobId(j.id); setPanel("none"); }}>
              {j.title}
            </li>
          ))}
          {!jobs.length && <li className="muted">No openings yet</li>}
        </ul>
        <div className="grow" />
        <div className="muted small">{session.user.email}</div>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </nav>

      <main>
        {!!acceptedCandidates.length && (
          <div className="notice info">
            <b>Interview availability confirmed</b>
            <div className="row wrap" style={{ marginTop: 6 }}>
              {acceptedCandidates.map((candidate) => {
                const confirmation = confirmationState(candidate).latest;
                return (
                  <button key={candidate.id} onClick={() => setCandId(candidate.id)}>
                    {labelOf(candidate)} accepted{confirmation?.responded_at ? ` · ${new Date(confirmation.responded_at).toLocaleString()}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <RecruiterSearch />
        {panel === "newJob" && (
          <JobForm
            onCancel={() => setPanel("none")}
            onCreated={(j) => { setJobs((p) => [j, ...p]); setJobId(j.id); setPanel("upload"); }}
          />
        )}

        {!job && panel !== "newJob" && <div className="card"><h2>Welcome</h2><p>Create a job opening to start screening resumes.</p></div>}

        {job && panel !== "newJob" && (
          <>
            <section className="card">
              <div className="between">
                <div>
                  <h3>Shortlisted candidates</h3>
                  <p className="muted small">
                    {shortlistedCandidates.length} candidate(s). The system will generate consecutive 30-minute slots
                    between the times below and email them to all shortlisted and interview candidates.
                    Once a candidate selects a slot, it is unavailable to everyone else.
                  </p>
                </div>
              </div>
              <div className="row wrap" style={{ marginBottom: 8 }}>
                <label>From (Asia/Kolkata)
                  <input type="datetime-local" value={bulkWindow.start} aria-label="Interview window start"
                    onChange={(e) => setBulkWindow((current) => ({ ...current, start: e.target.value }))} />
                </label>
                <label>To (Asia/Kolkata)
                  <input type="datetime-local" value={bulkWindow.end} aria-label="Interview window end"
                    onChange={(e) => setBulkWindow((current) => ({ ...current, end: e.target.value }))} />
                </label>
                <span className="muted small">Duration: 30 minutes per interview</span>
              </div>
              <div className="row wrap">
                {job.applications_open && <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/apply/${job.id}`)}>Copy application link</button>}
                <button className="primary" disabled={bulkBusy || !shortlistedCandidates.length} onClick={sendBulkInvitations}>
                  {bulkBusy ? "Sending invitations…" : "Email slots to shortlisted candidates"}
                </button>
              </div>
              {bulkMessage && <div className="notice info" style={{ marginTop: 8 }}>{bulkMessage}</div>}
              {!!shortlistedCandidates.length && (
                <div className="row wrap" style={{ marginTop: 10 }}>
                  {shortlistedCandidates.map((candidate) => (
                    <button key={candidate.id} onClick={() => setCandId(candidate.id)}>
                      {labelOf(candidate)} · {candidate.status}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <div className="card">
              <div className="between">
                <div>
                  <h2>{job.title}</h2>
                  <div className="muted small">
                    {cands.length} candidate(s) · {job.min_experience}+ yrs · education: {job.education_level.replace("_", " ")}
                    {job.requires_proof_of_work && " · proof of work required"}
                  </div>
                  <div>{job.required_skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
                </div>
                <div className="row wrap">
                  <button className="primary" onClick={() => setPanel(panel === "upload" ? "none" : "upload")}>Upload resumes</button>
                  <button onClick={() => setPanel(panel === "weights" ? "none" : "weights")}>Weights</button>
                  <button onClick={exportCsv} disabled={!cands.length}>Export CSV</button>
                  <button className="danger" onClick={deleteAllCandidates} disabled={!cands.length}>Delete all candidates</button>
                  <button className="danger" onClick={deleteJob}>Delete job</button>
                </div>
              </div>
            </div>

            {panel === "upload" && <UploadPanel job={job} onDone={() => loadCands()} />}
            {panel === "weights" && <WeightsPanel key={JSON.stringify(job.weights)} job={job} onChanged={() => { loadJobs(); loadCands(); }} />}

            <div className="card">
              <div className="row wrap filters">
                <label className="check"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind mode</label>
                <label>Min score <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value) || 0)} style={{ width: 70 }} /></label>
                <label>Status
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="new">New</option>
                    <option value="shortlisted">Shortlisted</option>
                    <option value="interview">Interview</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
                <button onClick={() => loadCands()}>Refresh</button>
              </div>

              {loading ? <p className="muted">Loading…</p> : (
                <table>
                  <thead>
                    <tr><th>#</th><th>Candidate</th><th>Score</th><th>Fit</th><th>Skills</th><th>Status</th><th>Interview</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((c, i) => {
                      const bd = c.score_breakdown ?? {};
                      const total = (bd.matched_skills?.length ?? 0) + (bd.missing_skills?.length ?? 0);
                      const conf = confirmationState(c);
                      return (
                        <tr key={c.id} onClick={() => setCandId(c.id)} className={c.id === candId ? "sel" : ""}>
                          <td>{i + 1}</td>
                          <td>{labelOf(c)}{c.needs_manual_review && <span title="Manual review required" className="flag"> ⚠</span>}</td>
                          <td><b>{c.final_score ?? "—"}</b></td>
                          <td><span className={`tier ${c.fit_tier}`}>{c.fit_tier ? TIER_LABEL[c.fit_tier] : "—"}</span></td>
                          <td>{total ? `${bd.matched_skills?.length ?? 0}/${total}` : "—"}</td>
                          <td>{c.status}</td>
                          <td><span className={`pill ${conf.key}`}>{conf.label}</span></td>
                        </tr>
                      );
                    })}
                    {!shown.length && <tr><td colSpan={7} className="muted">No candidates to show. Upload resumes to begin.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>

      {selected && job && (
        <CandidateDrawer
          candidate={selected} job={job} blind={blind} label={labelOf(selected)}
          onClose={() => setCandId(null)} onChanged={() => loadCands(true)}
        />
      )}
    </div>
  );
}
