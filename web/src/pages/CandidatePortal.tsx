import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Job {
  id: string;
  title: string;
  description: string;
  required_skills: string[];
  company: string | null;
}
interface Application {
  id: string;
  job_id: string;
  created_at: string;
  interview_confirmations?: { status: string; available_slots: { id: string; start_at: string; end_at: string; timezone: string }[]; selected_slot_id: string | null }[];
}

export default function CandidatePortal() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState("");

  useEffect(() => {
    supabase.functions.invoke("candidate-portal").then(({ data, error }) => {
      if (error) setError(error.message);
      else { setJobs(data.jobs ?? []); setApplications(data.applications ?? []); }
    }).finally(() => setLoading(false));
  }, []);

  const visibleJobs = jobs.filter((job) => {
    const text = `${job.title} ${job.company ?? ""} ${job.description}`.toLowerCase();
    const queryMatch = !query.trim() || text.includes(query.trim().toLowerCase());
    const skillMatch = !skillFilter || job.required_skills.some((skill) => skill.toLowerCase() === skillFilter.toLowerCase());
    return queryMatch && skillMatch;
  });
  const skills = [...new Set(jobs.flatMap((job) => job.required_skills))].sort();

  return <div className="candidate-shell">
    <header className="candidate-nav">
      <a className="candidate-brand" href="/candidate"><span className="brand-mark">S</span> SmartHire</a>
      <nav className="candidate-nav-links">
        <a className="active" href="#jobs">Find jobs</a>
        <a href="#applications">My applications</a>
      </nav>
      <button onClick={() => supabase.auth.signOut()}>Log out</button>
    </header>
    <main className="candidate-main">
      <section className="candidate-hero">
        <div>
          <p className="eyebrow">YOUR NEXT OPPORTUNITY</p>
          <h1>Find work that fits your future.</h1>
          <p className="hero-copy">Discover open roles and apply with your profile in minutes.</p>
        </div>
        <div className="hero-stat"><b>{jobs.length}</b><span>open roles</span></div>
      </section>
    {error && <div className="notice error">{error}</div>}
    <section id="jobs" className="candidate-section">
      <div className="section-heading"><div><p className="eyebrow">OPPORTUNITIES</p><h2>Recommended jobs</h2></div><span className="muted small">{visibleJobs.length} results</span></div>
      <div className="job-search">
        <input aria-label="Search jobs" placeholder="Search by job title, company, or keyword" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter by skill" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)}>
          <option value="">All skills</option>{skills.map((skill) => <option key={skill} value={skill}>{skill}</option>)}
        </select>
      </div>
      {loading ? <div className="empty-state">Loading open jobs…</div> : visibleJobs.length ? <div className="job-grid">{visibleJobs.map((job) => (
        <article key={job.id} className="job-card">
          <div className="job-card-top"><span className="company-logo">{(job.company || "H").slice(0, 1).toUpperCase()}</span><span className="job-type">Open role</span></div>
          <button className="job-title" onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}>{job.title}</button>
          <p className="company-name">{job.company || "Hiring company"}</p>
          <div className="job-meta"><span>Full-time</span><span>·</span><span>Remote / on-site</span></div>
          <div className="skill-list">{(job.required_skills.length ? job.required_skills : ["Skills discussed in description"]).slice(0, 4).map((skill) => <span className="skill-tag" key={skill}>{skill}</span>)}</div>
          {expandedJob === job.id && <div className="job-details"><p className="pre">{job.description}</p><a className="btn primary-link" href={`/apply/${job.id}`}>View details and apply</a></div>}
          {expandedJob !== job.id && <button className="text-action" onClick={() => setExpandedJob(job.id)}>View details →</button>}
        </article>
      ))}</div> : <div className="empty-state">No matching jobs are available.</div>}
    </section>
    <section id="applications" className="candidate-section applications-section"><div className="section-heading"><div><p className="eyebrow">YOUR ACTIVITY</p><h2>My applications</h2></div></div>{loading ? <div className="empty-state">Loading applications…</div> : applications.length ? <table><thead><tr><th>Job</th><th>Status</th><th>Applied</th></tr></thead><tbody>
      {applications.map((application) => {
        const confirmation = application.interview_confirmations?.[0];
        const slot = confirmation?.available_slots?.find((item) => item.id === confirmation.selected_slot_id);
        return <tr key={application.id}>
          <td>{jobs.find((job) => job.id === application.job_id)?.title ?? "Job"}</td>
          <td>Submitted</td>
          <td>{slot ? `Interview: ${new Date(slot.start_at).toLocaleString("en-IN", { timeZone: slot.timezone })}` : confirmation?.status ?? new Date(application.created_at).toLocaleDateString()}</td>
        </tr>;
      })}
    </tbody></table> : <div className="empty-state">You have not applied to any jobs yet.</div>}</section>
    </main>
  </div>;
}
