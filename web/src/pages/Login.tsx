import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [role, setRole] = useState<"recruiter" | "candidate">("recruiter");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (role === "candidate") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/candidate` },
      });
      if (error) setMsg({ type: "error", text: error.message });
      else setMsg({ type: "info", text: "Check your email for the secure sign-in link." });
    } else if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ type: "error", text: error.message });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { company } },
      });
      if (error) setMsg({ type: "error", text: error.message });
      else if (!data.session) {
        setMsg({ type: "info", text: "Account created. Check your email to confirm, then log in." });
      }
    }
    setBusy(false);
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand"><span className="brand-mark">S</span> SmartHire</div>
      <div className="auth-layout">
        <section className="auth-intro">
          <p className="eyebrow">{role === "recruiter" ? "RECRUITER WORKSPACE" : "CANDIDATE PORTAL"}</p>
          <h1>{role === "recruiter" ? "Make every hiring decision clearer." : "Find work that fits your future."}</h1>
          <p>{role === "recruiter" ? "Screen resumes with transparent scoring, evidence, and human oversight." : "Discover open roles, apply securely, and track every application in one place."}</p>
          <div className="auth-points">{(role === "recruiter"
            ? ["Explainable candidate rankings", "Evidence-based screening", "You make the final decision"]
            : ["Browse open opportunities", "Apply with your profile", "Track your application status"]
          ).map((point) => <span key={point}>✓ {point}</span>)}</div>
        </section>
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-role-tabs">
            <button type="button" className={role === "recruiter" ? "active" : ""} onClick={() => { setRole("recruiter"); setMode("login"); setMsg(null); }}>Recruiter</button>
            <button type="button" className={role === "candidate" ? "active" : ""} onClick={() => { setRole("candidate"); setMode("login"); setMsg(null); }}>Candidate</button>
          </div>
          <p className="eyebrow">{role === "recruiter" ? "WELCOME BACK" : "SECURE SIGN IN"}</p>
          <h2>{role === "candidate" ? "Welcome to your candidate portal" : mode === "login" ? "Sign in to your workspace" : "Create your recruiter account"}</h2>
          <p className="muted">{role === "candidate" ? "Enter your email and we’ll send a secure sign-in link." : "Manage openings, candidates, and interview workflows."}</p>

          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {role === "recruiter" && <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
          {role === "recruiter" && mode === "register" && <label>Company<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>}

          {msg && <div className={`notice ${msg.type}`}>{msg.text}</div>}

          <button className="primary auth-submit" disabled={busy}>{busy ? "Please wait…" : role === "candidate" ? "Email me a sign-in link" : mode === "login" ? "Log in" : "Create account"}</button>
          {role === "recruiter" && <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMsg(null); }}>
            {mode === "login" ? "New recruiter? Create an account" : "Have an account? Log in"}
          </button>}
        </form>
      </div>
    </div>
  );
}
