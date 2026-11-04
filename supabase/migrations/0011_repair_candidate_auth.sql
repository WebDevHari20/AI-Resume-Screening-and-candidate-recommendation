-- Ensure magic-link users always receive a readable candidate profile.
-- This is safe to run against projects where earlier migrations partially ran.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_company text := nullif(btrim(new.raw_user_meta_data->>'company'), '');
begin
  insert into public.profiles (id, company, role)
  values (
    new.id,
    signup_company,
    case when signup_company is null then 'candidate' else 'recruiter' end
  )
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select on public.profiles to authenticated;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
