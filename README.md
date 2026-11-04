# Smart Resume Screening

Smart Resume Screening is a recruiter dashboard and candidate portal for uploading
resumes, scoring candidates, collecting proof-of-work evidence, and scheduling
interviews.

The project uses a hybrid screening architecture:

1. A local or hosted SBERT service performs fast, low-cost semantic similarity
   screening.
2. Gemini provides embedding and OCR fallbacks and can answer recruiter search
   questions using retrieved candidate context.
3. Deterministic application code scores skills, experience, education, proof of
   work, integrity flags, and semantic similarity.

## Technology stack

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- Supabase JavaScript client
- CSS in `web/src/styles.css`

### Backend and data

- Supabase Auth for recruiter and candidate authentication
- Supabase Postgres for jobs, candidates, applications, interviews, and scoring data
- Supabase Row Level Security for ownership and access control
- Database-enforced recruiter and candidate account roles
- Supabase Storage for uploaded resumes
- Supabase Edge Functions running on Deno
- SQL migrations in `supabase/migrations/`

### AI and screening

- SBERT (`sentence-transformers/all-MiniLM-L6-v2`) in `local-screener/`
- FastAPI and Uvicorn for the SBERT HTTP service
- Gemini API for embeddings, scanned-PDF OCR, and recruiter RAG search
- Deterministic TypeScript NLP and scoring logic
- GitHub and LeetCode public-profile checks for optional proof of work
- Automatic shortlisting and candidate notification for scores of 80 or higher

### Optional services

- `email-service/` is a standalone Express/Nodemailer Gmail service.
- The main Supabase Edge Functions use Resend for shortlist and interview email delivery.
- The standalone email service is not required for the main application flow.

Recruiters create an account with email, password, and company name, then sign
in with email and password. Candidates use the candidate portal, which sends a
secure email sign-in link. Apply `0007_strict_account_roles.sql` and
`0010_recruiter_signup.sql` before using this separation in production. If
magic-link users remain stuck during sign-in, apply
`0011_repair_candidate_auth.sql` to restore the auth trigger and profile policy.

## Repository structure

```text
web/                         React/Vite frontend
supabase/migrations/         Database schema migrations
supabase/functions/          Supabase Edge Functions
supabase/functions/_shared/  Resume extraction, NLP, matching, scoring, and HTTP helpers
local-screener/              Python SBERT service
email-service/               Optional standalone Gmail email service
```

## How screening works

When a recruiter uploads a resume:

1. `process-resumes` authenticates the recruiter and checks job ownership.
2. The resume is extracted from PDF, DOCX, or TXT.
3. Scanned PDFs can be transcribed by Gemini OCR.
4. Candidate identity is redacted before semantic matching.
5. The configured SBERT service is called first.
6. If SBERT is unavailable, Gemini embeddings are attempted.
7. If both embedding services are unavailable, keyword cosine similarity is used.
8. Skills, experience, education, proof of work, integrity flags, and semantic
   similarity are combined into a transparent score.
9. Candidates scoring 80 or higher are automatically marked as shortlisted and
    receive a shortlist notification email through Resend.
10. The original resume, parsed data, score breakdown, and explanations are saved
    in Supabase.
11. Gemini is used only for deeper contextual tasks such as OCR and recruiter
    search; it is not the sole scoring authority.

## Prerequisites

- Node.js 18 or newer
- npm
- A Supabase project
- Supabase CLI (`npx supabase` can run it without a global install)
- A Gemini API key for embeddings/OCR/search
- Python 3.12 for the local SBERT service
- Optional: GitHub token, Resend API key, and verified email sender

## Configuration

### Frontend environment

Create or update `web/.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLIC_KEY
```

Do not leave the anon key as `******`. The frontend cannot connect to Supabase
until a real project URL and anon/public key are configured.

### Supabase secrets

Copy the example values into `supabase/secrets.env` and replace them with real
values. Never commit this file:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
GITHUB_TOKEN=...
RESEND_API_KEY=...
EMAIL_FROM=verified-sender@example.com
DEMO_WHATSAPP_NUMBER=+911234567890
ALLOWED_ORIGIN=https://your-frontend.example.com

# Only needed when using a hosted SBERT service:
SBERT_SERVICE_URL=https://your-sbert-service.example.com
SBERT_SERVICE_TOKEN=...
```

`GITHUB_TOKEN` is optional. `RESEND_API_KEY` and `EMAIL_FROM` are required for
production shortlist and interview email delivery. Use a demo WhatsApp number
only for testing.

## Database setup

In the Supabase Dashboard:

1. Open **SQL Editor**.
2. Run every migration in numeric order:
   `0001_init.sql` through `0006_candidate_accounts.sql`.
3. Confirm that the `resumes` Storage bucket exists.
4. Configure Authentication providers.
5. For local testing only, email confirmation can be disabled.

The migrations create the application schema, interview scheduling, public job
applications, candidate accounts, policies, and supporting database functions.

## Run the frontend locally

From the repository root:

```powershell
cd web
npm install
npm run dev
```

Open <http://localhost:5173>.

To verify a production build:

```powershell
cd web
npm run build
```

## Run SBERT locally

Python 3.12 is recommended because some SBERT dependencies may not yet provide
binary wheels for Python 3.14.

```powershell
cd local-screener
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt

$env:SBERT_SERVICE_TOKEN = "replace-with-a-long-random-token"
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Verify the service:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health
```

The first ranking request downloads the SBERT model. Keep this service running
while testing the application.

For local Supabase Functions, configure:

```powershell
$env:SBERT_SERVICE_URL = "http://127.0.0.1:8000"
$env:SBERT_SERVICE_TOKEN = "replace-with-a-long-random-token"
```

`127.0.0.1` works only when the caller and SBERT service run on the same machine.
A deployed Supabase Edge Function cannot reach your computer's localhost.

## Run Supabase Functions locally

Install and start Docker Desktop, then from the repository root:

```powershell
npx supabase start
npx supabase functions serve process-resumes --env-file supabase/local.env
```

Create `supabase/local.env` for local development. Do not commit it:

```env
GEMINI_API_KEY=...
SBERT_SERVICE_URL=http://host.docker.internal:8000
SBERT_SERVICE_TOKEN=...
```

The `host.docker.internal` address lets a containerized Supabase Function reach
the SBERT process running on Windows.

## Deploy Supabase

Authenticate and link the project:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set --env-file supabase/secrets.env
```

Deploy all functions used by the frontend:

```powershell
npx supabase functions deploy bulk-interview-invitations
npx supabase functions deploy candidate-portal
npx supabase functions deploy create-confirmation-link
npx supabase functions deploy job-details
npx supabase functions deploy process-resumes
npx supabase functions deploy recruiter-search
npx supabase functions deploy respond-confirmation
npx supabase functions deploy reverify-candidate
npx supabase functions deploy submit-application
npx supabase functions deploy update-weights
```

For a new Supabase project, apply the migrations before using the deployed
functions. Set `ALLOWED_ORIGIN` to the final frontend URL and re-run the secrets
command after changing it.

## Deploy SBERT for production

The SBERT service must be deployed separately from Supabase because Supabase Edge
Functions run on Deno and do not provide a Python/PyTorch runtime.

Recommended production options:

- Google Cloud Run
- Render
- Railway
- AWS container service
- Hugging Face Inference Endpoints

Deploy `local-screener/` as a Python web service with:

```text
Start command: python -m uvicorn main:app --host 0.0.0.0 --port $PORT
Health check:  /health
Port:          8000 or the platform-provided PORT
```

Set these variables in the hosting platform:

```text
SBERT_MODEL=sentence-transformers/all-MiniLM-L6-v2
SBERT_SERVICE_TOKEN=<long-random-secret>
```

Then set the matching `SBERT_SERVICE_URL` and `SBERT_SERVICE_TOKEN` in Supabase
Edge Function secrets. Use HTTPS, restrict inbound access where possible, and
never expose the service token in the frontend.

## Deploy the frontend

Build the frontend:

```powershell
cd web
npm run build
```

Deploy the contents of `web/dist` to Netlify, Vercel, or another static host.
Configure the frontend environment variables on that host. Add an SPA rewrite
that sends all application routes to `index.html`, especially:

```text
/confirm/*  -> /index.html
/*           -> /index.html
```

After deployment:

1. Set Supabase `ALLOWED_ORIGIN` to the frontend URL.
2. Confirm Supabase Auth redirect URLs include the frontend URL.
3. Test recruiter login, resume upload, candidate login, and confirmation links.

## Optional email service

The standalone service can be run separately:

```powershell
cd email-service
npm install
npm start
```

It requires `email-service/.env` with Gmail app-password settings. This service
is separate from the Resend-based Supabase email flow and is not necessary unless
the application is explicitly configured to call it.

## Test workflow

1. Create a recruiter account.
2. Create a job with a title, description, required skills, and scoring criteria.
3. Upload PDF, DOCX, or TXT resumes.
4. Open a candidate and inspect the score breakdown and explanation.
5. Shortlist a candidate.
6. Generate an interview confirmation link.
7. Open the link in a private browser window and accept or select an interview slot.
8. Test candidate login and candidate application tracking.
9. Test recruiter search after deploying `recruiter-search` and configuring Gemini.

## Is this a complete project?

It is a working feature-complete prototype and local development project. The
frontend build and local SBERT service have been verified, but it is not
production-ready until deployment-specific configuration is completed.

Before calling it production-ready, complete this checklist:

- Replace the masked Supabase anon key in `web/.env`.
- Run all six database migrations in the target Supabase project.
- Configure Supabase Auth redirect URLs and email settings.
- Add production Gemini, Resend, and sender configuration.
- Deploy SBERT to a reachable HTTPS service or intentionally use Gemini fallback.
- Set `SBERT_SERVICE_URL`, `SBERT_SERVICE_TOKEN`, and `ALLOWED_ORIGIN`.
- Deploy every required Edge Function.
- Deploy the frontend with SPA rewrites.
- Rotate any credentials that may have been exposed during development.
- Add monitoring, rate limits, backups, audit logging, and automated tests before
  handling real candidate data.

## Security and privacy notes

- Never commit `.env`, `secrets.env`, service tokens, API keys, or passwords.
- Rotate credentials if they were shared, logged, or committed accidentally.
- Candidate resumes contain personal data; configure retention and access policies
  before production use.
- Blind mode hides names and emails in the UI, but recruiters remain responsible
  for lawful and fair hiring decisions.
- GitHub and LeetCode data is supporting evidence only and should be disclosed to
  candidates.
- AI output must be reviewed by a human and should not be the sole hiring decision.
