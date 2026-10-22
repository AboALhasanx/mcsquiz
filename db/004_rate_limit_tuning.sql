-- 004_rate_limit_tuning.sql
-- Applied 2026-10-22 (portal: gywniovuupjmllbmjmai)
--
-- The first address limit was 20 failures in 15 minutes, which is far too
-- tight for a classroom: a university network puts every student behind one
-- public address, and a few mistyped PINs each would lock the whole room out.
-- The address limit now only stops a spray (100 wrong PINs in 10 minutes),
-- while the per-account limit stays strict (5 tries, 5 minutes).

create or replace function public.portal_login(p_handle text, p_pin text, p_name text)
returns table (id uuid, handle text, name text, avatar text, created boolean, status text, retry_after integer)
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
    return query select null::uuid, v_handle, '', '', false, 'too_many_attempts',
      greatest(1, ceil(extract(epoch from (v_until - now()))))::integer;
    return;
  end if;

  select * into u from public.portal_users pu where pu.handle = v_handle;
  if not found then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 100, 600);
    insert into portal_users as pu (handle, name, pin_salt, pin_hash, avatar)
      values (v_handle, coalesce(nullif(trim(p_name), ''), v_handle), gen_random_uuid()::text,
              null, '')
      returning * into u;
    update portal_users pu set pin_hash = public._pin_hash(p_pin, u.pin_salt) where pu.id = u.id
      returning * into u;
    return query select u.id, u.handle, u.name, u.avatar, true, 'ok', 0;
    return;
  end if;
  if u.pin_hash is null then
    update portal_users pu set pin_salt = gen_random_uuid()::text where pu.id = u.id returning * into u;
    update portal_users pu set pin_hash = public._pin_hash(p_pin, u.pin_salt) where pu.id = u.id returning * into u;
  elsif u.pin_hash <> public._pin_hash(p_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 100, 600);
    return query select null::uuid, v_handle, '', '', false, 'bad_pin', 0;
    return;
  end if;

  delete from public.login_attempts where key = 'handle:' || v_handle;
  update portal_users pu set name = coalesce(nullif(trim(p_name), ''), pu.name), updated_at = now()
    where pu.id = u.id returning * into u;
  return query select u.id, u.handle, u.name, u.avatar, false, 'ok', 0;
end $$;

create or replace function public.portal_profile(p_handle text, p_pin text, p_name text, p_avatar text)
returns table (id uuid, handle text, name text, avatar text, status text, retry_after integer)
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
    return query select null::uuid, v_handle, '', '', 'too_many_attempts',
      greatest(1, ceil(extract(epoch from (v_until - now()))))::integer;
    return;
  end if;

  if u.pin_hash is null or u.pin_hash <> public._pin_hash(p_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 100, 600);
    return query select null::uuid, v_handle, '', '', 'bad_pin', 0;
    return;
  end if;
  delete from public.login_attempts where key = 'handle:' || v_handle;

  update portal_users pu
     set name = coalesce(nullif(trim(p_name), ''), pu.name),
         avatar = coalesce(p_avatar, pu.avatar),
         updated_at = now()
   where pu.id = u.id
   returning * into u;
  return query select u.id, u.handle, u.name, u.avatar, 'ok', 0;
end $$;

create or replace function public.portal_delete_account(p_handle text, p_pin text)
returns text
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
    return 'too_many_attempts';
  end if;
  if u.pin_hash is null or u.pin_hash <> public._pin_hash(p_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 100, 600);
    return 'bad_pin';
  end if;

  delete from public.league_xp where user_id in (u.id::text, 'u:' || u.id::text, v_handle);
  delete from public.portal_data where user_id in (u.id::text, 'u:' || u.id::text, v_handle);
  delete from public.login_links where user_id::text = u.id::text;
  delete from public.login_attempts where key = 'handle:' || v_handle;
  delete from public.portal_users where id = u.id;
  return 'ok';
end $$;
