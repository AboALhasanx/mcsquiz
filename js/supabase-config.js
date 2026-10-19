// Supabase config for the shared weekly league board (public values only).
//
// IMPORTANT (2026-10-19): the previously configured project/key turned out to
// belong to a third party (it contains profiles / waitlist / admins tables that
// are not ours). Cloud sync is therefore DISABLED: leaving url/key empty makes
// the league fall back to "not configured" and keeps every answer on the device.
//
// To re-enable on YOUR OWN project:
//   1. Create a project at https://supabase.com/dashboard
//   2. Run 00_STUDIO_HUB/PORTAL_LEAGUE_SCHEMA.sql in its SQL Editor
//   3. Paste Project URL + the publishable (anon) key below
window.PORTAL_SUPABASE = {
  url: '',
  key: '',
};
