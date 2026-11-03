alter table public.candidates
  add column if not exists applicant_id uuid references auth.users(id) on delete set null;

create index if not exists candidates_applicant_id_idx on public.candidates(applicant_id);

create policy "candidate reads own applications" on public.candidates
  for select using (applicant_id = auth.uid());
