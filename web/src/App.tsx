import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Confirm from "./pages/Confirm";
import Apply from "./pages/Apply";
import CandidateLogin from "./pages/CandidateLogin";
import CandidatePortal from "./pages/CandidatePortal";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<"candidate" | "recruiter" | null>(null);
  const [ready, setReady] = useState(false);

  async function loadSessionRole(nextSession: Session | null) {
    setSession(nextSession);
    if (!nextSession) {
      setRole(null);
      setReady(true);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", nextSession.user.id)
      .maybeSingle();
    if (error || !data || (data.role !== "candidate" && data.role !== "recruiter")) {
      await supabase.auth.signOut();
      setSession(null);
      setRole(null);
      setReady(true);
      return;
    }
    setRole(data.role);
    setReady(true);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => loadSessionRole(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { void loadSessionRole(s); });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Routes>
      {/* Public candidate page: no login needed, protected by the secret token */}
      <Route path="/confirm/:token" element={<Confirm />} />
      <Route path="/apply/:jobId" element={<Apply />} />
      <Route path="/candidate-login" element={<CandidateLogin />} />
      <Route
        path="/candidate"
        element={!ready ? <div className="center muted">Signing you in…</div> : session && role === "candidate" ? <CandidatePortal /> : session && role === "recruiter" ? <Navigate to="/" replace /> : <Navigate to="/candidate-login" replace />}
      />
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/*"
        element={
          !ready ? <div className="center muted">Loading…</div>
          : session && role === "recruiter" ? <Dashboard session={session} />
          : session && role === "candidate" ? <Navigate to="/candidate" replace />
          : <Navigate to="/login" replace />
        }
      />
    </Routes>
  );
}
