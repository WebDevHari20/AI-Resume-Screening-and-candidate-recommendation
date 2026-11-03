create or replace function public.get_confirmation(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  reserved jsonb := '[]'::jsonb;
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

  if exists (select 1 from interview_confirmations where id = (
    select id from interview_confirmations where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  ) and campaign_id is not null) then
    select coalesce(jsonb_agg(slot_id), '[]'::jsonb) into reserved
    from interview_campaign_slots
    where campaign_id = (select campaign_id from interview_confirmations
      where token_hash = encode(digest(p_token, 'sha256'), 'hex'))
      and status = 'booked';
  end if;

  return jsonb_build_object(
    'candidate_name', r.candidate_name,
    'job_title', r.title,
    'job_description', r.description,
    'required_skills', r.required_skills,
    'min_experience', r.min_experience,
    'education_level', r.education_level,
    'available_slots', r.available_slots,
    'reserved_slot_ids', reserved,
    'selected_slot_id', r.selected_slot_id,
    'status', case when r.status = 'link_generated' and r.expires_at < now()
                   then 'expired' else r.status end,
    'expires_at', r.expires_at,
    'responded_at', r.responded_at);
end $$;
