import { useState } from "react";
import { supabase } from "../lib/supabase";
import { fnError } from "../lib/helpers";

interface Source {
  id: string;
  name: string;
  score: number | null;
  retrieval_score: number;
}

export default function RecruiterSearch() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);
    const { data, error: invokeError } = await supabase.functions.invoke("recruiter-search", {
      body: { question: trimmed },
    });
    setBusy(false);
    if (invokeError) {
      setError(await fnError(invokeError));
      return;
    }
    setAnswer(data.answer);
    setSources(data.sources ?? []);
  }

  return (
    <div className="card">
      <h3>Ask across candidates</h3>
      <p className="muted small">Retrieves matching resume evidence, proof-of-work, and scores, then generates a grounded answer.</p>
      <div className="row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) search(); }}
          placeholder="Who has the strongest React and GitHub experience?"
          maxLength={500}
        />
        <button className="primary" onClick={search} disabled={busy || !question.trim()}>
          {busy ? "Searching…" : "Ask"}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {answer && <div className="notice info pre">{answer}</div>}
      {!!sources.length && (
        <div className="small">
          <b>Retrieved candidates:</b>{" "}
          {sources.map((source) => (
            <span className="chip" key={source.id}>{source.name} ({source.score ?? "—"})</span>
          ))}
        </div>
      )}
    </div>
  );
}
