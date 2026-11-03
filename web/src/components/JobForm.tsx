import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { Job } from "../types";

export default function JobForm({ onCreated, onCancel }: { onCreated: (j: Job) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("");
  const [minExp, setMinExp] = useState("0");
  const [edu, setEdu] = useState("any");
  const [proof, setProof] = useState(false);
  const [applicationsOpen, setApplicationsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      setError("You must be logged in to create a job.");
      setBusy(false);
      return;
    }
    const { data, error } = await supabase.from("jobs").insert({
      owner_id: u.user.id,
      title: title.trim(),
      description: description.trim(),
      required_skills: skills.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      min_experience: Number(minExp) || 0,
      education_level: edu,
      requires_proof_of_work: proof,
      applications_open: applicationsOpen,
    }).select().single();
    setBusy(false);
    if (error) setError(error.message);
    else onCreated(data as Job);
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>New job opening</h2>
      <label>Job title
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>Job description
        <textarea required rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>Required skills <span className="muted">(comma separated — leave empty to extract from the description)</span>
        <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="python, sql, react" />
      </label>
      <div className="row">
        <label>Minimum experience (years)
          <input type="number" min="0" step="0.5" value={minExp} onChange={(e) => setMinExp(e.target.value)} />
        </label>
        <label>Education level
          <select value={edu} onChange={(e) => setEdu(e.target.value)}>
            <option value="any">Any</option>
            <option value="high_school">High school</option>
            <option value="diploma">Diploma</option>
            <option value="bachelor">Bachelor's</option>
            <option value="master">Master's</option>
            <option value="phd">PhD</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={proof} onChange={(e) => setProof(e.target.checked)} />
        Proof of work (GitHub / LeetCode) is required
      </label>
      <label className="check">
        <input type="checkbox" checked={applicationsOpen} onChange={(e) => setApplicationsOpen(e.target.checked)} />
        Accept public applications
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create job"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
