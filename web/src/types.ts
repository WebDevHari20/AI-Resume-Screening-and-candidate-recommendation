export interface Job {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  required_skills: string[];
  min_experience: number;
  education_level: string;
  requires_proof_of_work: boolean;
  weights: Record<string, number>;
  created_at: string;
  applications_open: boolean;
}

export interface Confirmation {
  id: string;
  status: "link_generated" | "accepted" | "declined";
  expires_at: string;
  sent_at: string;
  responded_at: string | null;
  phone_last4: string | null;
  available_slots: InterviewSlot[];
  selected_slot_id: string | null;
}

export interface InterviewSlot {
  id: string;
  start_at: string;
  end_at: string;
  timezone: "Asia/Kolkata";
}

export interface Feedback {
  id: string;
  action: "shortlist" | "reject" | "interview" | "note";
  note: string | null;
  created_at: string;
}

export interface Candidate {
  id: string;
  job_id: string;
  filename: string;
  name: string | null;
  email: string | null;
  allocated_phone: string | null;
  resume_path: string | null;
  content_type: string | null;
  final_score: number | null;
  fit_tier: "strong_fit" | "moderate_fit" | "low_fit" | null;
  needs_manual_review: boolean;
  status: "new" | "shortlisted" | "rejected" | "interview";
  created_at: string;
  parsed: any;
  proof_of_work: any;
  safety_flags: { code: string; severity: number; detail: string }[];
  score_breakdown: any;
  interview_confirmations?: Confirmation[];
}
