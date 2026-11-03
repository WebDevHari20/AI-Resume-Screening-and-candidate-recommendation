create table public.interview_campaigns (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  slots jsonb not null,
  created_at timestamptz not null default now()
);

create table public.interview_campaign_slots (
  campaign_id uuid not null references public.interview_campaigns(id) on delete cascade,
  slot_id text not null,
  status text not null default 'open' check (status in ('open', 'booked')),
  booked_confirmation_id uuid references public.interview_confirmations(id),
  primary key (campaign_id, slot_id),
  unique (campaign_id, booked_confirmation_id)
);

alter table public.interview_confirmations
  add column if not exists campaign_id uuid references public.interview_campaigns(id) on delete set null,
  add column if not exists slot_id text;

alter table public.interview_campaigns enable row level security;
alter table public.interview_campaign_slots enable row level security;
create policy "own interview campaigns" on public.interview_campaigns
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own interview campaign slots" on public.interview_campaign_slots
  for select using (exists (
    select 1 from public.interview_campaigns c
    where c.id = campaign_id and c.owner_id = auth.uid()
  ));

create or replace function public.respond_confirmation(
  p_token text, p_decision text, p_slot_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ic interview_confirmations;
  reserved_slot interview_campaign_slots;
begin
  if p_decision not in ('accepted','declined') then
    raise exception 'decision must be accepted or declined';
  end if;
  select * into ic from interview_confirmations
    where token_hash = encode(digest(p_token, 'sha256'), 'hex') for update;
  if not found then raise exception 'invalid link'; end if;
  if ic.expires_at < now() then raise exception 'link expired'; end if;
  if ic.status <> 'link_generated' then raise exception 'already responded'; end if;

  if p_decision = 'accepted' then
    if p_slot_id is null or not exists (
      select 1 from jsonb_array_elements(ic.available_slots) slot
      where slot->>'id' = p_slot_id
    ) then raise exception 'select an available interview slot'; end if;

    if ic.campaign_id is not null then
      update interview_campaign_slots
         set status = 'booked', booked_confirmation_id = ic.id
       where campaign_id = ic.campaign_id and slot_id = p_slot_id and status = 'open'
       returning * into reserved_slot;
      if not found then raise exception 'That interview slot was just selected by another candidate. Choose another slot.'; end if;
    end if;
  end if;

  update interview_confirmations
     set status = p_decision, selected_slot_id = case when p_decision = 'accepted' then p_slot_id else null end,
         slot_id = case when p_decision = 'accepted' then p_slot_id else null end, responded_at = now()
   where id = ic.id;
  if p_decision = 'accepted' then
    update candidates set status = 'interview' where id = ic.candidate_id;
  end if;
  return jsonb_build_object('status', p_decision, 'selected_slot_id', p_slot_id);
end $$;

grant execute on function public.respond_confirmation(text, text, text) to anon, authenticated;
