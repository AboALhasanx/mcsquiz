-- 005_change_pin.sql
-- Applied 2026-10-23 (portal: gywniovuupjmllbmjmai)
--
-- The 4-digit PIN is the only credential an account has. Until now it could be
-- verified (`portal_profile`) but never changed — the profile field was
-- confirm-only, so a student who thought their PIN leaked had no way out.
--
-- This is the one place the PIN is ever rewritten. It keeps the same guard as
-- login: a wrong old PIN counts toward the same per-account (5 / 5 min) and
-- per-address (100 / 10 min) limits, so it cannot be used to brute-force a PIN
-- any faster than the login form can.
--
-- Rotating the salt means the previous hash cannot be matched even if the row
-- was read before the change. Other devices keep their old PIN and will be
-- asked for the new one the next time they need it (that is the point).

create or replace function public.portal_change_pin(
  p_handle text, p_old_pin text, p_new_pin text)
returns table (status text, retry_after integer)
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
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'bad_pin_format' using errcode = '22023';
  end if;

  select * into u from public.portal_users pu where pu.handle = v_handle;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;

  v_until := greatest(
    public.portal_block_until('handle:' || v_handle),
    public.portal_block_until('ip:' || v_ip)
  );
  if v_until is not null and v_until > now() then
    return query select 'too_many_attempts'::text,
      greatest(1, ceil(extract(epoch from (v_until - now()))))::integer;
    return;
  end if;

  if u.pin_hash is null or u.pin_hash <> public._pin_hash(p_old_pin, u.pin_salt) then
    perform public.portal_bump_attempt('handle:' || v_handle, 5, 300);
    perform public.portal_bump_attempt('ip:' || v_ip, 100, 600);
    return query select 'bad_pin'::text, 0;
    return;
  end if;

  if p_old_pin = p_new_pin then
    return query select 'same_pin'::text, 0;
    return;
  end if;

  -- a verified owner starts with a clean slate
  delete from public.login_attempts where key = 'handle:' || v_handle;

  -- new salt, then the hash of the new PIN against it
  update public.portal_users pu
     set pin_salt = gen_random_uuid()::text,
         updated_at = now()
   where pu.id = u.id
   returning * into u;
  update public.portal_users pu
     set pin_hash = public._pin_hash(p_new_pin, u.pin_salt)
   where pu.id = u.id;

  return query select 'ok'::text, 0;
end $$;
