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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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
        element={!ready ? <div className="center muted">Signing you in…</div> : session ? <CandidatePortal /> : <Navigate to="/candidate-login" replace />}
      />
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/*"
        element={
          !ready ? <div className="center muted">Loading…</div>
          : session ? <Dashboard session={session} />
          : <Navigate to="/login" replace />
        }
      />
    </Routes>
  );
}
