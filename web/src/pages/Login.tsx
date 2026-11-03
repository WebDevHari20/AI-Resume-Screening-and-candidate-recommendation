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
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <h1>Smart Resume Screening</h1>
        <p className="muted">Explainable, evidence-based screening. You make the final decision.</p>

        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === "register" && (
          <label>Company
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
        )}

        {msg && <div className={`notice ${msg.type}`}>{msg.text}</div>}

        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
        <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setMsg(null); }}>
          {mode === "login" ? "New recruiter? Create an account" : "Have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
