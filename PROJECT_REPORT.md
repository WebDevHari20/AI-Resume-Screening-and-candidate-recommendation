# Smart Resume Screening and Candidate Recommendation

## 1. Executive summary

Smart Resume Screening is a recruiter and candidate platform for publishing job
openings, collecting resumes, ranking candidates, reviewing evidence, managing
interview invitations, and accepting public applications.

The system is designed as a **human-in-the-loop** screening workflow. It
automates document extraction, structured resume parsing, similarity matching,
proof-of-work checks, scoring, and retrieval-assisted recruiter questions, but
does not make an automatic hiring decision.

## 2. Product capabilities

### Recruiter/company experience

- Recruiter registration and password-based authentication.
- Company profile information.
- Job creation with:
  - title and description;
  - required skills;
  - minimum experience;
  - education level;
  - proof-of-work requirement;
  - configurable scoring weights;
  - public application availability.
- Resume upload for PDF, DOCX, and TXT files.
- Batch resume processing with file-size and batch-size limits.
- Candidate ranking by final score.
- Blind screening mode that hides candidate identity in the interface.
- Candidate filtering by minimum score and status.
- Explainable score breakdowns and reasons.
- Matched and missing skill lists.
- Integrity and resume-quality warnings.
- GitHub and LeetCode proof-of-work verification.
- Recruiter actions: shortlist, reject, mark for interview, and add notes.
- Signed resume access through private Supabase Storage URLs.
- CSV export of candidate rankings.
- Interview scheduling with available time slots.
- Confirmation links with expiration and candidate responses.
- Recruiter search across retrieved candidate evidence.

### Candidate experience

- Candidate magic-link authentication.
- Browse publicly available job openings.
- Search by title, company, description, or keyword.
- Filter jobs by required skill.
- View job details, requirements, and company information.
- Submit an application with a resume.
- View application status, score, and interview information.
- Select or decline an interview slot through a secure confirmation link.

## 3. High-level architecture

```text
Candidate or recruiter browser
              |
              v
React + TypeScript + Vite frontend
              |
              v
Supabase Auth, Postgres, Storage, and Edge Functions
              |
       +------+------+
       |             |
       v             v
  SBERT service   Gemini APIs
  (preferred)     (embeddings, OCR, RAG)
```

The frontend is a static React application. Supabase provides authentication,
database access, file storage, row-level security, and server-side Edge
Functions. The optional SBERT service is a separate FastAPI/Python service
because Supabase Edge Functions run on Deno and do not provide a PyTorch
runtime.

The semantic matching sequence is:

1. SBERT service, when configured and reachable.
2. Gemini embeddings.
3. Deterministic term-frequency cosine similarity.

## 4. Technology stack

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- `@supabase/supabase-js`
- CSS with responsive layouts and shared design tokens

The frontend includes recruiter and candidate views, a unified login screen,
job browsing, application forms, candidate drawers, interview workflows, and
responsive styling.

### Backend and platform services

- Supabase Auth for recruiter and candidate authentication.
- Supabase Postgres for relational application data.
- Supabase Storage for private resume files.
- Supabase Edge Functions using Deno and TypeScript.
- PostgreSQL functions and Row Level Security policies.

### AI and document processing

- Python FastAPI and Uvicorn for the SBERT service.
- `sentence-transformers/all-MiniLM-L6-v2` for semantic embeddings.
- Gemini embeddings as a hosted semantic fallback.
- Gemini OCR fallback for scanned PDFs.
- Deterministic TypeScript resume parsing and scoring.

### Optional deployment services

- Vercel for the frontend.
- Render, Hugging Face, Cloud Run, or another Python-capable host for SBERT.
- Resend integration for production interview email delivery.
- Optional standalone Express/Nodemailer email service.

## 5. Resume processing pipeline

The `process-resumes` Edge Function handles multipart resume uploads.

### Validation and deduplication

- A job ID and at least one file are required.
- Batch size is limited by `MAX_FILES_PER_REQUEST`.
- Individual file size is limited by `MAX_FILE_MB`.
- Each file is hashed with SHA-256.
- Duplicate uploads are rejected using `(job_id, content_hash)`.

### Text extraction

The extraction layer supports PDF, DOCX, and TXT content. If a PDF contains
little or no extractable text, Gemini is used as an OCR/transcription fallback.
Files without meaningful readable text are rejected.

### Structured parsing

The parser extracts:

- candidate name;
- email and phone;
- normalized skills;
- estimated years of experience;
- education level;
- GitHub and LeetCode handles;
- external links;
- detected resume sections.

Experience is estimated from explicit phrases such as “3 years of experience”
and from date ranges. Overlapping employment periods are merged to avoid
double-counting.

### Identity redaction

Semantic comparison uses identity-redacted resume text. This supports blind
screening and prevents names, emails, and contact details from influencing
semantic matching.

### Integrity and quality checks

The pipeline records safety flags for suspicious or low-quality content. An
invalid resume receives a zero score and is marked for manual review. Other
integrity flags reduce the score through a multiplier while preserving the
candidate for human review.

## 6. Scoring algorithms

The scoring engine uses normalized components in the range 0 to 1.

### Skill matching

Required skills are canonicalized through a taxonomy containing aliases such as
`react`, `react.js`, and `reactjs`. A skill is matched when it appears in the
parsed skill list or in the resume text.

```text
skill score = matched required skills / total required skills
```

### Experience matching

When a minimum is specified:

```text
experience score =
  min(parsed years / required years, 1)
```

If no minimum is configured, the component is excluded and the remaining
weights are renormalized.

### Education matching

Education levels are ordered as:

```text
any < high_school < diploma < bachelor < master < phd
```

The detected education rank is divided by the required education rank and
clamped to the range 0 to 1.

### Semantic similarity

The preferred SBERT service embeds the job description and one or more resume
texts with normalized embeddings. The service returns a cosine similarity
score.

The score is rescaled from the cosine range to the application’s 0–1 score
range. If SBERT is unavailable, Gemini embeddings are compared using cosine
similarity. If both services are unavailable, deterministic term-frequency
cosine similarity is used.

### Proof of work

GitHub and LeetCode links are treated as supporting evidence. The verification
layer checks public-profile signals and records verified and unverified claims.
If proof of work is required but unavailable, the component can be excluded
and other weights are renormalized.

### Weighted final score

Default weights are:

```text
skills:         0.30
experience:     0.15
education:      0.10
semantic:       0.25
proof_of_work:  0.20
```

Only active components participate in the weighted average. Their weights are
renormalized so missing criteria do not unfairly reduce the score.

```text
weighted score =
  sum(normalized component × effective weight) × 100
final score =
  weighted score × integrity multiplier
```

The minimum integrity multiplier is `0.30`. Fit tiers are:

- `strong_fit`: final score at least 75 with structured job criteria;
- `moderate_fit`: final score at least 50;
- `low_fit`: all other valid results.

Invalid resumes are scored as zero. Integrity flags trigger manual review.

### Weight learning

The scoring module contains an optional recruiter-feedback learning mechanism.
When at least ten labeled examples exist and both positive and negative labels
are present, a regularized logistic regression is trained with gradient descent.
The learned non-negative weights are normalized before use. This keeps scoring
configurable while requiring recruiter-confirmed feedback.

## 7. Recruiter search and retrieval

The recruiter search function implements a lightweight retrieval-augmented
generation workflow:

1. Retrieve candidate records visible to the authenticated recruiter.
2. Combine resume text, proof-of-work data, score details, status, and fit tier.
3. Tokenize the recruiter question.
4. Remove common stop words.
5. Rank candidates by query-term overlap.
6. Select up to eight candidates with positive overlap, or five fallback
   candidates when there is no overlap.
7. Send bounded candidate context to Gemini.
8. Instruct Gemini to answer only from the supplied context and identify
   candidates by name and score when relevant.

The search function limits question length, context sizes, and generated output.
Resume content is treated as untrusted data rather than instructions.

## 8. Supabase data model

### Main tables

- `profiles`: recruiter company information linked to `auth.users`.
- `jobs`: openings, requirements, scoring weights, ownership, and publication
  state.
- `candidates`: parsed resumes, scores, evidence, flags, status, and storage
  paths.
- `feedback`: recruiter decisions and notes.
- `interview_confirmations`: hashed confirmation tokens, expiration, response
  state, and interview slots.

### Relationships

```text
auth.users 1──1 profiles
auth.users 1──N jobs
jobs       1──N candidates
candidates 1──N feedback
candidates 1──N interview_confirmations
```

Candidate resumes are stored in the private `resumes` bucket using a path
structured as:

```text
<owner_id>/<job_id>/<content-hash-prefix>-<safe-filename>
```

## 9. Supabase queries and access patterns

The application uses the Supabase JavaScript client for normal frontend
queries and Edge Functions for privileged processing.

### Recruiter queries

- Load owned jobs ordered by newest creation date.
- Load candidates for the selected job ordered by descending final score.
- Filter candidates by job ID, score, and status.
- Insert recruiter feedback.
- Update candidate status.
- Delete candidates and jobs owned by the recruiter.
- Create short-lived signed URLs for private resume access.

### Candidate queries

The candidate portal calls the `candidate-portal` Edge Function. The function
uses the service client to:

```text
select jobs
where applications_open = true
order by created_at desc
```

It also loads applications for the authenticated candidate and looks up
company names from `profiles`.

Job details are retrieved by job ID and require `applications_open = true`.
This prevents closed roles from being viewed or applied to through a direct
URL.

### Processing queries

The resume pipeline:

- selects the job after authenticated ownership validation;
- checks for an existing candidate with the same job ID and content hash;
- updates missing job skills extracted from the description;
- uploads the resume to private Storage;
- inserts parsed and scored candidate data;
- removes the uploaded file if the database insert fails.

### Confirmation queries and RPCs

Interview links use PostgreSQL functions:

- `create_confirmation_link`: validates recruiter ownership and candidate
  status, creates a random token, stores only its SHA-256 hash, and returns the
  raw token once.
- `get_confirmation`: hashes the supplied token and returns candidate-facing
  job and slot information.
- `respond_confirmation`: locks the confirmation row, validates expiration and
  slot selection, records the decision, and updates the candidate status.

This design prevents raw confirmation tokens from being stored in the database
and protects the response workflow against concurrent slot updates.

## 10. Security and privacy controls

- Supabase Auth protects recruiter and candidate sessions.
- Row Level Security limits recruiters to their own profiles, jobs, candidates,
  feedback, confirmations, and resume files.
- Edge Functions use the service role only for trusted server-side processing.
- Resume files are stored in a private bucket.
- Signed resume URLs expire after a short period.
- Confirmation links store SHA-256 token hashes, not raw tokens.
- Candidate identity is redacted before semantic matching.
- Upload limits and duplicate detection reduce abuse and repeated processing.
- Recruiter search limits context and treats resume text as untrusted.
- Service tokens are kept in deployment secrets and are not exposed to the
  frontend.

Candidate resumes contain personal data. Retention, access policies, logging,
and production credential rotation should be reviewed before handling
real-world hiring data.

## 11. Deployment model

The intended hosted architecture is:

```text
Vercel
  hosts the React/Vite frontend

Supabase
  hosts authentication, Postgres, Storage, and Deno Edge Functions

Separate Python host
  hosts the SBERT FastAPI service when SBERT is enabled
```

SBERT cannot be reached by hosted Supabase Functions when it runs only on a
developer’s `localhost`. A hosted SBERT URL is required for production SBERT
matching. If no SBERT URL is configured or the service is unavailable, the
application is designed to continue with Gemini embeddings and then keyword
cosine similarity.

The repository includes CI/CD configuration for frontend validation and
provider-based deployment. Secrets are expected to remain in the hosting
provider or GitHub Actions secret store rather than in source control.

## 12. Design principles

- Explainability over opaque ranking.
- Human review over automatic rejection.
- Multiple semantic backends with deterministic fallback.
- Identity redaction for fairer semantic comparison.
- Evidence and score breakdowns alongside every recommendation.
- Database-enforced ownership and private document storage.
- Configurable job-specific scoring weights.
- Bounded external AI context and explicit error reporting.

## 13. Current limitations

- Free hosting plans may sleep, have limited memory, or impose request limits.
- SBERT requires a separate Python runtime and may need more memory than a free
  instance provides.
- Gemini and external profile verification depend on provider availability and
  configured credentials.
- Resume parsing is deterministic and text-based; unusual formatting can reduce
  extraction quality.
- AI-generated recruiter answers are constrained to retrieved context but still
  require human verification.
- Production readiness requires monitoring, rate limits, backups, audit logging,
  retention policies, and automated end-to-end testing.

