import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface JobDetails {
  id: string;
  title: string;
  description: string;
  required_skills: string[];
  min_experience: number;
  education_level: string;
  company: string | null;
}

export default function Apply() {
  const MAX_RESUME_BYTES = 5 * 1024 * 1024;
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetails | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);
  const [name, setName] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoadingJob(true);
    supabase.functions.invoke("job-details", { body: { job_id: jobId } })
      .then(({ data, error }) => setJob(error ? null : data as JobDetails))
      .finally(() => setLoadingJob(false));
  }, [jobId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!resume) return setMessage("Please attach a PDF, DOCX, or TXT resume.");
    if (resume.size > MAX_RESUME_BYTES) {
      setMessage("Resume must be 5 MB or smaller. Please upload a smaller file.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      window.location.href = `/candidate-login?returnTo=/apply/${jobId}`;
      return;
    }
    const form = new FormData();
    form.append("job_id", jobId);
    form.append("name", name);
    form.append("resume", resume);
    const { data, error } = await supabase.functions.invoke("submit-application", { body: form });
    setMessage(error ? error.message : data?.message);
    if (!error) { setName(""); setResume(null); }
    setBusy(false);
  }

  if (loadingJob) return <div className="center"><div className="card"><p className="muted">Loading job details…</p></div></div>;
  if (!job) return <div className="center muted">This job is unavailable or closed.</div>;
  return <div className="center"><form className="card form" onSubmit={submit}>
    <button type="button" onClick={() => navigate("/candidate")}>← Back to candidate portal</button>
    <h2>Apply for {job.title}</h2>
    <p className="muted">{job.company || "Hiring company"}</p>
    <p className="pre">{job.description}</p>
    <p className="muted small">Required skills: {job.required_skills.join(", ") || "Not specified"}</p>
    <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
    <p className="muted small">Your signed-in candidate email will be attached to this application.</p>
    <label>Resume
      <input required type="file" accept=".pdf,.docx,.txt" onChange={(e) => {
        const file = e.target.files?.[0] ?? null;
        if (file && file.size > MAX_RESUME_BYTES) {
          setResume(null);
          setMessage("Resume must be 5 MB or smaller. Please upload a smaller file.");
        } else {
          setResume(file);
          setMessage(null);
        }
      }} />
      <span className="muted small">PDF, DOCX, or TXT · maximum 5 MB</span>
    </label>
    {message && <div className={`notice ${message.includes("success") ? "info" : "error"}`}>{message}</div>}
    <button className="primary" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
  </form></div>;
}
