-- 006_vs_mode.sql
-- 1v1 Real-Time VS Mode: rooms, matchmaking, and match records.

create table if not exists public.vs_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  subject_id text not null,
  chapter_id text not null,
  seed int not null,
  host_id text not null,
  host_name text not null,
  host_avatar text default '',
  guest_id text,
  guest_name text,
  guest_avatar text default '',
  status text not null default 'waiting', -- waiting | active | completed | abandoned
  host_score int default 0,
  guest_score int default 0,
  winner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_vs_rooms_code on public.vs_rooms(code);
create index if not exists idx_vs_rooms_status on public.vs_rooms(status);
create index if not exists idx_vs_rooms_created on public.vs_rooms(created_at);

alter table public.vs_rooms enable row level security;

-- Everyone can read rooms by code/id
drop policy if exists "vs_rooms public read" on public.vs_rooms;
create policy "vs_rooms public read" on public.vs_rooms for select using (true);

-- Room creation RPC: generates random 4-digit code (1000..9999) without collision among recent active/waiting rooms
create or replace function public.portal_create_vs_room(
  p_subject text,
  p_chapter text,
  p_host_id text,
  p_host_name text,
  p_host_avatar text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_seed int;
  v_id uuid;
  v_tries int := 0;
begin
  -- Delete old rooms older than 4 hours to keep room codes recyclable
  delete from public.vs_rooms where created_at < now() - interval '4 hours';

  loop
    v_tries := v_tries + 1;
    v_code := lpad(floor(1000 + random() * 9000)::text, 4, '0');
    exit when not exists (
      select 1 from public.vs_rooms
      where code = v_code and status in ('waiting', 'active')
    ) or v_tries > 50;
  end loop;

  v_seed := floor(100000 + random() * 900000)::int;

  insert into public.vs_rooms (
    code, subject_id, chapter_id, seed, host_id, host_name, host_avatar, status
  ) values (
    v_code, p_subject, p_chapter, v_seed, p_host_id, coalesce(nullif(trim(p_host_name), ''), 'مضيف'), coalesce(p_host_avatar, ''), 'waiting'
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'room_id', v_id,
    'code', v_code,
    'seed', v_seed,
    'subject_id', p_subject,
    'chapter_id', p_chapter
  );
end;
$$;

-- Join room RPC
create or replace function public.portal_join_vs_room(
  p_code text,
  p_guest_id text,
  p_guest_name text,
  p_guest_avatar text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.vs_rooms%rowtype;
begin
  select * into r from public.vs_rooms
  where code = trim(p_code) and status = 'waiting' and created_at > now() - interval '1 hour'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  if r.host_id = p_guest_id then
    -- Host re-entering their own waiting room
    return jsonb_build_object(
      'ok', true,
      'room_id', r.id,
      'code', r.code,
      'seed', r.seed,
      'subject_id', r.subject_id,
      'chapter_id', r.chapter_id,
      'host_id', r.host_id,
      'host_name', r.host_name,
      'host_avatar', r.host_avatar,
      'role', 'host'
    );
  end if;

  update public.vs_rooms
  set guest_id = p_guest_id,
      guest_name = coalesce(nullif(trim(p_guest_name), ''), 'ضيف'),
      guest_avatar = coalesce(p_guest_avatar, ''),
      status = 'active',
      updated_at = now()
  where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'room_id', r.id,
    'code', r.code,
    'seed', r.seed,
    'subject_id', r.subject_id,
    'chapter_id', r.chapter_id,
    'host_id', r.host_id,
    'host_name', r.host_name,
    'host_avatar', r.host_avatar,
    'guest_id', p_guest_id,
    'guest_name', coalesce(nullif(trim(p_guest_name), ''), 'ضيف'),
    'guest_avatar', coalesce(p_guest_avatar, ''),
    'role', 'guest'
  );
end;
$$;

-- Finish match RPC
create or replace function public.portal_finish_vs_match(
  p_room_id uuid,
  p_host_score int,
  p_guest_score int,
  p_winner_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.vs_rooms
  set host_score = p_host_score,
      guest_score = p_guest_score,
      winner_id = p_winner_id,
      status = 'completed',
      updated_at = now()
  where id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;
