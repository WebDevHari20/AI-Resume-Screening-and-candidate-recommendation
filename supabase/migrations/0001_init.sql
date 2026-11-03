-- Smart Resume Screening: initial schema, RLS, storage and confirmation RPCs
create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company text,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  required_skills text[] not null default '{}',
  min_experience numeric not null default 0,
  education_level text not null default 'any',
  requires_proof_of_work boolean not null default false,
  weights jsonb not null default
    '{"skills":0.30,"experience":0.15,"education":0.10,"semantic":0.25,"proof_of_work":0.20}',
  created_at timestamptz not null default now()
);
create index on public.jobs(owner_id);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  filename text not null,
  content_hash text not null,
  name text,
  email text,
  allocated_phone text,            -- demo number, NOT the resume phone
  raw_text text,
  resume_path text,                -- path in 'resumes' storage bucket
  content_type text,
  parsed jsonb not null default '{}',
  proof_of_work jsonb not null default '{}',
  safety_flags jsonb not null default '[]',
  score_breakdown jsonb not null default '{}',
  final_score numeric,
  fit_tier text check (fit_tier in ('strong_fit','moderate_fit','low_fit')),
  needs_manual_review boolean not null default false,
  status text not null default 'new'
    check (status in ('new','shortlisted','rejected','interview')),
  created_at timestamptz not null default now(),
  unique (job_id, content_hash)    -- blocks duplicate uploads per job
);
create index on public.candidates(job_id, final_score desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  recruiter_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  action text not null check (action in ('shortlist','reject','interview','note')),
  note text,
  created_at timestamptz not null default now()
);
create index on public.feedback(candidate_id);

create table public.interview_confirmations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  token_hash text not null unique,   -- SHA-256 only; raw token never stored
  phone_last4 text,
  status text not null default 'link_generated'
    check (status in ('link_generated','accepted','declined')),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  responded_at timestamptz
);
create index on public.interview_confirmations(candidate_id);

-- ---------- Ownership helpers ----------
create or replace function public.owns_job(j uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from jobs where id = j and owner_id = auth.uid());
$$;

create or replace function public.owns_candidate(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from candidates ca join jobs j on j.id = ca.job_id
    where ca.id = c and j.owner_id = auth.uid());
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.candidates enable row level security;
alter table public.feedback enable row level security;
alter table public.interview_confirmations enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own jobs" on public.jobs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Candidates are inserted by Edge Functions (service role bypasses RLS).
create policy "read own candidates" on public.candidates
  for select using (public.owns_job(job_id));
create policy "update own candidates" on public.candidates
  for update using (public.owns_job(job_id)) with check (public.owns_job(job_id));
create policy "delete own candidates" on public.candidates
  for delete using (public.owns_job(job_id));

create policy "own feedback read" on public.feedback
  for select using (public.owns_candidate(candidate_id));
create policy "own feedback insert" on public.feedback
  for insert with check (public.owns_candidate(candidate_id) and recruiter_id = auth.uid());

create policy "own confirmations read" on public.interview_confirmations
  for select using (public.owns_candidate(candidate_id));
-- No direct insert/update: only the RPCs below touch this table.

-- New-user profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, company)
  values (new.id, new.raw_user_meta_data->>'company')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Storage: private resume bucket, path = <owner_id>/<job_id>/<file> ----------
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create policy "recruiter reads own resumes" on storage.objects
  for select using (
    bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recruiter deletes own resumes" on storage.objects
  for delete using (
    bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
-- Uploads are written by the Edge Function (service role).

-- ---------- Confirmation workflow RPCs ----------
-- Recruiter: create link (must own candidate, candidate must be shortlisted or marked for interview)
create or replace function public.create_confirmation_link(
  p_candidate uuid, p_phone text default null, p_ttl_hours int default 72)
returns table (link_token text, link_expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  raw text;
  exp timestamptz := now() + make_interval(hours => p_ttl_hours);
begin
  if not public.owns_candidate(p_candidate) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if not exists (select 1 from candidates where id = p_candidate and status in ('shortlisted', 'interview')) then
    raise exception 'candidate must be shortlisted or marked for interview first';
  end if;

  raw := encode(gen_random_bytes(32), 'hex');
  insert into interview_confirmations (candidate_id, token_hash, phone_last4, expires_at)
  values (p_candidate, encode(digest(raw, 'sha256'), 'hex'),
          right(coalesce(p_phone, ''), 4), exp);

  return query select raw, exp;
end $$;

-- Public: fetch candidate-facing details by token
create or replace function public.get_confirmation(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  select ic.status, ic.expires_at, ic.responded_at,
         c.name as candidate_name,
         j.title, j.description, j.required_skills, j.min_experience, j.education_level
    into r
  from interview_confirmations ic
  join candidates c on c.id = ic.candidate_id
  join jobs j on j.id = c.job_id
  where ic.token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if not found then raise exception 'invalid link'; end if;

  return jsonb_build_object(
    'candidate_name', r.candidate_name,
    'job_title', r.title,
    'job_description', r.description,
    'required_skills', r.required_skills,
    'min_experience', r.min_experience,
    'education_level', r.education_level,
    'status', case when r.status = 'link_generated' and r.expires_at < now()
                   then 'expired' else r.status end,
    'expires_at', r.expires_at,
    'responded_at', r.responded_at);
end $$;

-- Public: record decision once
create or replace function public.respond_confirmation(p_token text, p_decision text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ic interview_confirmations;
begin
  if p_decision not in ('accepted','declined') then
    raise exception 'decision must be accepted or declined';
  end if;

  select * into ic from interview_confirmations
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then raise exception 'invalid link'; end if;
  if ic.expires_at < now() then raise exception 'link expired'; end if;
  if ic.status <> 'link_generated' then raise exception 'already responded'; end if;

  update interview_confirmations
     set status = p_decision, responded_at = now()
   where id = ic.id;

  if p_decision = 'accepted' then
    update candidates
       set status = 'interview'
     where id = ic.candidate_id;
  end if;

  return jsonb_build_object('status', p_decision);
end $$;

revoke all on function public.create_confirmation_link(uuid, text, int) from public, anon;
grant execute on function public.create_confirmation_link(uuid, text, int) to authenticated;
grant execute on function public.get_confirmation(text) to anon, authenticated;
grant execute on function public.respond_confirmation(text, text) to anon, authenticated;
