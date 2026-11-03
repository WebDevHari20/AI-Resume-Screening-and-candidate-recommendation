alter table public.jobs
  add column if not exists applications_open boolean not null default false;
