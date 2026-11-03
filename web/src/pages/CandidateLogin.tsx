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

  return <div className="center"><form className="card auth" onSubmit={submit}>
    <h1>Candidate portal</h1>
    <p className="muted">Enter your email and we will send a secure sign-in link.</p>
    <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    {message && <div className={`notice ${message.startsWith("Check") ? "info" : "error"}`}>{message}</div>}
    <button className="primary" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
  </form></div>;
}
