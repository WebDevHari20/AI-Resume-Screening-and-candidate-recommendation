import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function CandidateLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (active && data.session) navigate("/candidate", { replace: true });
    };
    checkSession();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate("/candidate", { replace: true });
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/candidate` },
    });
    setMessage(error ? error.message : "Check your email for the secure sign-in link.");
    setBusy(false);
  }

  return <div className="auth-shell">
    <div className="auth-brand"><span className="brand-mark">S</span> SmartHire</div>
    <div className="auth-layout candidate-auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">CANDIDATE PORTAL</p>
        <h1>Find work that fits your future.</h1>
        <p>Discover open roles, apply securely, and keep track of every application in one place.</p>
        <div className="auth-points"><span>✓ Browse open opportunities</span><span>✓ Apply with your profile</span><span>✓ Track your application status</span></div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">SECURE SIGN IN</p>
        <h2>Welcome to your candidate portal</h2>
        <p className="muted">Enter your email and we’ll send a secure sign-in link.</p>
        <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {message && <div className={`notice ${message.startsWith("Check") ? "info" : "error"}`}>{message}</div>}
        <button className="primary auth-submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
        <a className="auth-switch" href="/login">Recruiter? Sign in here</a>
      </form>
    </div>
  </div>;
}
