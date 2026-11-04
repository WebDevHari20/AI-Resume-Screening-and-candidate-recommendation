-- Recruiter signup uses the company field to provision a recruiter profile.
-- Candidate accounts use the separate candidate portal and do not submit company data.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_company text := nullif(btrim(new.raw_user_meta_data->>'company'), '');
begin
  insert into profiles (id, company, role)
  values (
    new.id,
    signup_company,
    case when signup_company is null then 'candidate' else 'recruiter' end
  )
  on conflict (id) do nothing;
  return new;
end
$$;
