alter table public.interview_confirmations
  add column if not exists available_slots jsonb not null default '[]'::jsonb,
  add column if not exists selected_slot_id text,
  add column if not exists recruiter_email text;

create or replace function public.get_confirmation(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  select ic.status, ic.expires_at, ic.responded_at, ic.available_slots, ic.selected_slot_id,
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
    'available_slots', r.available_slots,
    'selected_slot_id', r.selected_slot_id,
    'status', case when r.status = 'link_generated' and r.expires_at < now()
                   then 'expired' else r.status end,
    'expires_at', r.expires_at,
    'responded_at', r.responded_at);
end $$;

create or replace function public.respond_confirmation(
  p_token text, p_decision text, p_slot_id text default null)
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
  if p_decision = 'accepted' and (
    p_slot_id is null or not exists (
      select 1 from jsonb_array_elements(ic.available_slots) slot
      where slot->>'id' = p_slot_id
    )
  ) then
    raise exception 'select an available interview slot';
  end if;

  update interview_confirmations
     set status = p_decision, selected_slot_id = case when p_decision = 'accepted' then p_slot_id else null end,
         responded_at = now()
   where id = ic.id;

  if p_decision = 'accepted' then
    update candidates set status = 'interview' where id = ic.candidate_id;
  end if;

  return jsonb_build_object('status', p_decision, 'selected_slot_id', p_slot_id);
end $$;

grant execute on function public.respond_confirmation(text, text, text) to anon, authenticated;
