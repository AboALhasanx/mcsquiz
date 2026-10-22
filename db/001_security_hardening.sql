-- 001_security_hardening.sql
-- Applied 2026-10-22 (portal: gywniovuupjmllbmjmai)
--
-- What it does
--   1. a small attempt ledger for the PIN login: a handle is blocked for 5
--      minutes after 5 wrong tries, an address for 15 minutes after 20
--   2. `portal_login` and `portal_profile` consult that ledger, so a 4-digit
--      PIN cannot be guessed by hammering the RPC
--   3. `portal_delete_account` lets a student erase their own account, their
--      personal rows and their league entries
--
-- The ledger has no public policy: only the SECURITY DEFINER functions below
-- touch it. Apply with the Management API:
--   python tools/db_apply.py db/001_security_hardening.sql

create table if not exists public.login_attempts (
  key           text primary key,
  count         integer not null default 0,
  first_at      timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.login_attempts enable row level security;

-- count one failure and block the key when it crosses the limit
create or replace function public.portal_bump_attempt(
  p_key text, p_max integer, p_block_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key is null or p_key = '' then return; end if;
  insert into public.login_attempts as a (key, count, first_at, updated_at)
  values (p_key, 1, now(), now())
  on conflict (key) do update
     set count = a.count + 1,
         first_at = case when a.blocked_until is not null and a.blocked_until <= now()
                          then now() else a.first_at end,
         updated_at = now()
  returning count into v_count;
  if v_count >= p_max then
    update public.login_attempts
       set blocked_until = now() + make_interval(secs => p_block_seconds),
           updated_at = now()
     where key = p_key;
  end if;
end $$;

create or replace function public.portal_block_until(p_key text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(blocked_until) from public.login_attempts where key = p_key;
$$;

-- the client address as PostgREST sees it
create or replace function public.portal_client_ip()
returns text
language sql
stable
as $$
  select coalesce(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), '');
$$;

create or replace function public.portal_login(p_handle text, p_pin text, p_name text)
returns table (id uuid, handle text, name text, avatar text, created boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_ip     text := public.portal_client_ip();
  v_until  timestamptz;
  u        public.portal_users%rowtype;
begin
  if v_handle is null or v_handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'bad_handle' using errcode = '22023';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'bad_pin_format' using errcode = '22023';
  end if;

  v_until := greatest(
    public.portal_block_until('handle:' || v_handle),
    public.portal_block_until('ip:' || v_ip)
  );
  if v_until is not null and v_until > now() then
    raise exception 'too_many_attempts' using errcode = '28000';
  end if;

  select * into u from public.portal_users pu where pu.handle = v_handle;
  if not found then
    -- a new account still counts against the limits, so handles cannot be
    -- spammed either
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 20, 900);
    insert into portal_users as pu (handle, name, pin_salt, pin_hash, avatar)
      values (v_handle, coalesce(nullif(trim(p_name), ''), v_handle), gen_random_uuid()::text,
              null, '')
      returning * into u;
    update portal_users pu set pin_hash = public._pin_hash(p_pin, u.pin_salt) where pu.id = u.id
      returning * into u;
    return query select u.id, u.handle, u.name, u.avatar, true;
    return;
  end if;
  if u.pin_hash is null then
    update portal_users pu set pin_salt = gen_random_uuid()::text where pu.id = u.id returning * into u;
    update portal_users pu set pin_hash = public._pin_hash(p_pin, u.pin_salt) where pu.id = u.id returning * into u;
  elsif u.pin_hash <> public._pin_hash(p_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 20, 900);
    raise exception 'bad_pin' using errcode = '28000';
  end if;

  delete from public.login_attempts where key = 'handle:' || v_handle;
  update portal_users pu set name = coalesce(nullif(trim(p_name), ''), pu.name), updated_at = now()
    where pu.id = u.id returning * into u;
  return query select u.id, u.handle, u.name, u.avatar, false;
end $$;

create or replace function public.portal_profile(p_handle text, p_pin text, p_name text, p_avatar text)
returns table (id uuid, handle text, name text, avatar text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_ip     text := public.portal_client_ip();
  v_until  timestamptz;
  u        public.portal_users%rowtype;
begin
  select * into u from public.portal_users pu where pu.handle = v_handle;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;

  v_until := greatest(
    public.portal_block_until('handle:' || v_handle),
    public.portal_block_until('ip:' || v_ip)
  );
  if v_until is not null and v_until > now() then
    raise exception 'too_many_attempts' using errcode = '28000';
  end if;

  if u.pin_hash is null or u.pin_hash <> public._pin_hash(p_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 20, 900);
    raise exception 'bad_pin' using errcode = '28000';
  end if;
  delete from public.login_attempts where key = 'handle:' || v_handle;

  update portal_users pu
     set name = coalesce(nullif(trim(p_name), ''), pu.name),
         avatar = coalesce(p_avatar, pu.avatar),
         updated_at = now()
   where pu.id = u.id
   returning * into u;
  return query select u.id, u.handle, u.name, u.avatar;
end $$;

-- erase my account (and everything attached to it)
create or replace function public.portal_delete_account(p_handle text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_ip     text := public.portal_client_ip();
  v_until  timestamptz;
  u        public.portal_users%rowtype;
begin
  select * into u from public.portal_users pu where pu.handle = v_handle;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;

  v_until := greatest(
    public.portal_block_until('handle:' || v_handle),
    public.portal_block_until('ip:' || v_ip)
  );
  if v_until is not null and v_until > now() then
    raise exception 'too_many_attempts' using errcode = '28000';
  end if;
  if u.pin_hash is null or u.pin_hash <> public._pin_hash(p_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 20, 900);
    raise exception 'bad_pin' using errcode = '28000';
  end if;

  delete from public.league_xp where user_id in (u.id::text, 'u:' || u.id::text, v_handle);
  delete from public.portal_data where user_id in (u.id::text, 'u:' || u.id::text, v_handle);
  delete from public.login_links where user_id = u.id::text;
  delete from public.login_attempts where key = 'handle:' || v_handle;
  delete from public.portal_users where id = u.id;
  return true;
end $$;
