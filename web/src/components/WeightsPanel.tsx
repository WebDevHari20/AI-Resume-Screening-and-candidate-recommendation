import { useState } from "react";
import { supabase } from "../lib/supabase";
import { COMPONENT_LABEL, fnError } from "../lib/helpers";
import type { Job } from "../types";

const KEYS = ["skills", "experience", "education", "semantic", "proof_of_work"];

export default function WeightsPanel({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [w, setW] = useState<Record<string, number>>(
    Object.fromEntries(KEYS.map((k) => [k, Math.round((job.weights?.[k] ?? 0) * 100)])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const [suggestion, setSuggestion] = useState<Record<string, number> | null>(null);
  const total = KEYS.reduce((n, k) => n + w[k], 0) || 1;

  async function call(body: object, okText: (d: any) => string) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.functions.invoke("update-weights", { body: { job_id: job.id, ...body } });
    if (error) setMsg({ type: "error", text: await fnError(error) });
    else {
      setMsg({ type: "info", text: okText(data) });
      onChanged();
    }
    setBusy(false);
    return { data, error };
  }

  async function suggest() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.functions.invoke("update-weights", { body: { job_id: job.id, learn: true } });
    if (error) setMsg({ type: "error", text: await fnError(error) });
    else setSuggestion(data.suggested_weights);
    setBusy(false);
  }

  return (
    <div className="card">
      <h3>Scoring weights</h3>
      <p className="muted small">Weights are normalized to 100%. Changing them rescores every candidate for this job.</p>
      {KEYS.map((k) => (
        <div key={k} className="slider">
          <span>{COMPONENT_LABEL[k]}</span>
          <input type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />
          <b>{Math.round((w[k] / total) * 100)}%</b>
        </div>
      ))}
      <div className="row">
        <button className="primary" disabled={busy}
          onClick={() => call({ weights: Object.fromEntries(KEYS.map((k) => [k, w[k] / total])) }, (d) => `Saved. Rescored ${d.rescored} candidate(s).`)}>
          Save & rescore
        </button>
        <button disabled={busy} onClick={suggest}>Suggest from my decisions</button>
      </div>
      {suggestion && (
        <div className="notice info">
          <b>Suggested weights</b> (learned from your shortlist/reject decisions):
          <div>{KEYS.map((k) => `${COMPONENT_LABEL[k]} ${Math.round(suggestion[k] * 100)}%`).join(" · ")}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy}
              onClick={async () => { const r = await call({ learn: true, apply: true }, (d) => `Applied. Rescored ${d.rescored} candidate(s).`); if (!r.error) { setW(Object.fromEntries(KEYS.map((k) => [k, Math.round(suggestion[k] * 100)]))); setSuggestion(null); } }}>
              Apply suggestion
            </button>
            <button onClick={() => setSuggestion(null)}>Dismiss</button>
          </div>
        </div>
      )}
      {msg && <div className={`notice ${msg.type}`}>{msg.text}</div>}
    </div>
  );
}
