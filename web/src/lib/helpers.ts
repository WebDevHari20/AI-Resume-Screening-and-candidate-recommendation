import { supabase } from "./supabase";
import type { Candidate } from "../types";

export const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");

export function confirmationState(c: Candidate) {
  const latest = [...(c.interview_confirmations ?? [])]
    .sort((a, b) => +new Date(b.sent_at) - +new Date(a.sent_at))[0];
  if (!latest) return { key: "none", label: "Not contacted", latest: null };
  if (latest.status === "accepted") return { key: "accepted", label: "Interview accepted", latest };
  if (latest.status === "declined") return { key: "declined", label: "Interview declined", latest };
  if (new Date(latest.expires_at) < new Date()) return { key: "expired", label: "Link expired", latest };
  return { key: "waiting", label: "Awaiting response", latest };
}

export const csvEscape = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function removeResumeFiles(paths: (string | null | undefined)[]) {
  const p = paths.filter(Boolean) as string[];
  if (p.length) await supabase.storage.from("resumes").remove(p);
}

/** Pull the real message out of a failed Edge Function call. */
export async function fnError(error: any): Promise<string> {
  try {
    const body = await error.context.json();
    if (body?.error) return body.error;
  } catch { /* ignore */ }
  return error?.message ?? "Something went wrong";
}

export const TIER_LABEL: Record<string, string> = {
  strong_fit: "Strong fit",
  moderate_fit: "Moderate fit",
  low_fit: "Low fit",
};

export const COMPONENT_LABEL: Record<string, string> = {
  skills: "Skills match",
  experience: "Experience",
  education: "Education",
  semantic: "Job-description match",
  proof_of_work: "Proof of work",
};
