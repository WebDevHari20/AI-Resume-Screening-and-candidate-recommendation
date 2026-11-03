import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
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
    if (mode === "login") {
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
          <p className="eyebrow">RECRUITER WORKSPACE</p>
          <h1>Make every hiring decision clearer.</h1>
          <p>Screen resumes with transparent scoring, evidence, and human oversight.</p>
          <div className="auth-points"><span>✓ Explainable candidate rankings</span><span>✓ Evidence-based screening</span><span>✓ You make the final decision</span></div>
        </section>
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>{mode === "login" ? "Sign in to your workspace" : "Create your recruiter account"}</h2>
          <p className="muted">Manage openings, candidates, and interview workflows.</p>

          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {mode === "register" && <label>Company<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>}

          {msg && <div className={`notice ${msg.type}`}>{msg.text}</div>}

          <button className="primary auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
          <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMsg(null); }}>
            {mode === "login" ? "New recruiter? Create an account" : "Have an account? Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
