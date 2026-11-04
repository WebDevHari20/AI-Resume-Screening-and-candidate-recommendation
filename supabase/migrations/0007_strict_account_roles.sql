-- Strict account roles. New accounts are candidates by default.
-- Recruiter accounts must be provisioned by an administrator.

alter table public.profiles
  add column if not exists role text not null default 'candidate'
  check (role in ('candidate', 'recruiter'));

-- Preserve existing company accounts while preventing future client-side
-- metadata from granting recruiter access.
update public.profiles
set role = 'recruiter'
where nullif(btrim(company), '') is not null;

create or replace function public.current_account_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_recruiter()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_account_role() = 'recruiter';
$$;

-- A user's role must not be writable through the client.
drop policy if exists "own profile" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "own jobs" on public.jobs;
drop policy if exists "recruiters manage own jobs" on public.jobs;
create policy "recruiters manage own jobs" on public.jobs
  for all using (public.is_recruiter() and owner_id = auth.uid())
  with check (public.is_recruiter() and owner_id = auth.uid());

drop policy if exists "read own candidates" on public.candidates;
drop policy if exists "update own candidates" on public.candidates;
drop policy if exists "delete own candidates" on public.candidates;
drop policy if exists "candidate reads own applications" on public.candidates;
drop policy if exists "recruiters read own candidates" on public.candidates;
drop policy if exists "recruiters update own candidates" on public.candidates;
drop policy if exists "recruiters delete own candidates" on public.candidates;

create policy "recruiters read own candidates" on public.candidates
  for select using (public.is_recruiter() and public.owns_job(job_id));
create policy "recruiters update own candidates" on public.candidates
  for update using (public.is_recruiter() and public.owns_job(job_id))
  with check (public.is_recruiter() and public.owns_job(job_id));
create policy "recruiters delete own candidates" on public.candidates
  for delete using (public.is_recruiter() and public.owns_job(job_id));

drop policy if exists "own feedback read" on public.feedback;
drop policy if exists "own feedback insert" on public.feedback;
drop policy if exists "recruiters read own feedback" on public.feedback;
drop policy if exists "recruiters insert own feedback" on public.feedback;
create policy "recruiters read own feedback" on public.feedback
  for select using (public.is_recruiter() and public.owns_candidate(candidate_id));
create policy "recruiters insert own feedback" on public.feedback
  for insert with check (
    public.is_recruiter()
    and public.owns_candidate(candidate_id)
    and recruiter_id = auth.uid()
  );

drop policy if exists "own confirmations read" on public.interview_confirmations;
drop policy if exists "recruiters read own confirmations" on public.interview_confirmations;
create policy "recruiters read own confirmations" on public.interview_confirmations
  for select using (public.is_recruiter() and public.owns_candidate(candidate_id));

drop policy if exists "recruiter reads own resumes" on storage.objects;
drop policy if exists "recruiter deletes own resumes" on storage.objects;
drop policy if exists "recruiters read own resumes" on storage.objects;
drop policy if exists "recruiters delete own resumes" on storage.objects;
create policy "recruiters read own resumes" on storage.objects
  for select using (
    public.is_recruiter()
    and bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "recruiters delete own resumes" on storage.objects
  for delete using (
    public.is_recruiter()
    and bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Candidate application data is exposed only through candidate-portal, which
-- selects an allow-listed set of fields with the service client.
revoke all on function public.current_account_role() from public;
grant execute on function public.current_account_role() to authenticated;
revoke all on function public.is_recruiter() from public;
grant execute on function public.is_recruiter() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, company, role)
  values (new.id, new.raw_user_meta_data->>'company', 'candidate')
  on conflict (id) do nothing;
  return new;
end
$$;
