import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { fnError } from "../lib/helpers";
import type { Job } from "../types";

interface Result {
  processed: { filename: string; final_score: number; fit_tier: string }[];
  errors: { filename: string; code: string; error: string }[];
}

export default function UploadPanel({ job, onDone }: { job: Job; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append("job_id", job.id);
    files.forEach((f) => form.append("files", f));
    const { data, error } = await supabase.functions.invoke("process-resumes", { body: form });
    if (error) setError(await fnError(error));
    else {
      setResult(data as Result);
      setFiles([]);
      if (input.current) input.current.value = "";
      onDone();
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <h3>Upload resumes for “{job.title}”</h3>
      <p className="muted small">PDF, DOCX or TXT. Up to 20 files per upload, 5 MB each.</p>
      <input
        ref={input} type="file" multiple accept=".pdf,.docx,.txt" disabled={busy}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={busy || !files.length} onClick={upload}>
          {busy ? "Reading, verifying and ranking…" : `Upload & rank ${files.length || ""} file(s)`}
        </button>
      </div>
      {busy && <p className="muted small">This can take a minute: each resume is parsed, matched and checked against public profiles.</p>}
      {error && <div className="notice error">{error}</div>}
      {result && (
        <div className="notice info">
          Processed {result.processed.length} resume(s).
          {result.errors.length > 0 && (
            <ul>{result.errors.map((e, i) => <li key={i}><b>{e.filename}</b>: {e.error}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}
