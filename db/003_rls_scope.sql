-- 003_rls_scope.sql
-- Applied 2026-10-22 (portal: gywniovuupjmllbmjmai)
--
-- Scope the personal tables to the account the client is acting as.
--
-- The client sends `x-portal-user: u:<uuid>` on every request; the policy
-- only lets that one row through. It is not a proof of identity (the header
-- is client-asserted — the honest version needs a signed token), but it stops
-- the open "read every row / write any row" access the anon key had, and
-- the payload itself is encrypted, so even a forged header only reaches
-- unreadable bytes.

create or replace function public.portal_claimed_user()
returns text
language sql
stable
as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-portal-user', '');
$$;

drop policy if exists "portal open insert" on public.portal_data;
drop policy if exists "portal open update" on public.portal_data;
drop policy if exists "portal public read" on public.portal_data;

create policy "portal own row read" on public.portal_data
  for select using (user_id = public.portal_claimed_user());
create policy "portal own row insert" on public.portal_data
  for insert with check (user_id = public.portal_claimed_user());
create policy "portal own row update" on public.portal_data
  for update using (user_id = public.portal_claimed_user())
  with check (user_id = public.portal_claimed_user());

-- the league board stays public to read (it is a shared board), but a write
-- may only touch the row the client claims
drop policy if exists "league community update" on public.league_xp;
create policy "league community update" on public.league_xp
  for update using (user_id = public.portal_claimed_user())
  with check (user_id = public.portal_claimed_user());
drop policy if exists "league community insert" on public.league_xp;
create policy "league community insert" on public.league_xp
  for insert with check (user_id = public.portal_claimed_user());
