# Security

This app holds a small amount of personal data (a handle, a display name, an avatar,
the quiz history and the saved questions) for the student and their classmates. There is
no email, no phone number, no location and no third-party analytics. The notes below say
what is protected, what is **not**, and what to do when something goes wrong.

## What protects what

| Asset | How it is protected |
|---|---|
| The PIN | never stored in the clear: a per-account salt plus SHA-256 (`_pin_hash`), and the PIN itself only lives in the device's local storage |
| Changing the PIN | `portal_change_pin` (`db/005_change_pin.sql`) requires the current PIN, rotates the salt, and counts a wrong try exactly like a failed login (5 per account, 100 per address) — a change attempt can never guess faster than the login form |
| Brute force | `portal_login` counts failures: 5 wrong tries lock one account for 5 minutes, 100 wrong tries lock one address for 10 minutes (`db/004_rate_limit_tuning.sql`) |
| The history and the saved questions | encrypted **on the device** with AES-GCM; the key is derived from the PIN (PBKDF2, 210k rounds) and a per-account salt. The server stores bytes it cannot read |
| The personal rows | `portal_data` and the league writes are scoped by row: a request only reaches the row the client claims (`db/003_rls_scope.sql`) |
| The profile table | `portal_users` has no public policy at all; the app only reaches it through `SECURITY DEFINER` functions |
| The account creation | handled by `portal_login`, which hashes before it returns |
| The transport | HTTPS only; the service worker refuses to cache anything but its own origin |
| The runtime | the Supabase client is vendored into `js/vendor/npm/` — no CDN, no third-party code at runtime, and a strict `Content-Security-Policy` (`vercel.json`) |
| The crash reports | `/api/log` receives a short line (message, file, version). Never a handle, a question or a token |

## What is **not** protected — read this before trusting it

- **The PIN is four digits.** The rate limit makes guessing slow, not impossible, and
  the PIN is the only secret behind the encryption key. Treat the history and the saved
  questions as private to the class, not as a vault.
- **The `x-portal-user` header is client-asserted.** RLS scoping stops the "read every
  row" access, but a caller that claims someone else's id can still reach *their* row.
  The payload is encrypted, so the bytes are useless without the PIN — that is the real
  protection. A signed per-device token would be the stronger design.
- **The league board is public to read.** It shows a name, an avatar, a score and a
  subject breakdown. That is the point of a league, but it means the class can see each
  other's names.
- **There is no recovery.** If the PIN is forgotten, the data cannot be decrypted: the
  key is derived from it. A lost PIN means a new account and a fresh start.

## How the pieces are implemented

| Concern | Where |
|---|---|
| hashed PIN, rate limit, account deletion | `db/001_security_hardening.sql`, `db/002_login_rate_limit.sql`, `db/004_rate_limit_tuning.sql` |
| changing the PIN | `db/005_change_pin.sql` (`portal_change_pin`) |
| row scoping | `db/003_rls_scope.sql` |
| encryption + merge | `js/cloud.js` (`personalKey`, `encryptBundle`, `decryptBundle`, `mergeBundles`) |
| the client identity header | `js/cloud.js` (`sbClient`), `js/league.js` (`client`) |
| headers and cache policy | `vercel.json` |
| the checks | `tests/test_security.py`, `tests/test_pin_change.py`, `tools/audit.py` |

Apply a migration with:

```bash
python tools/db_apply.py db/003_rls_scope.sql
```

Every migration is a file in `db/`, applied through the Management API, and it either
runs completely or not at all.

## If something goes wrong

**An account may be compromised** (someone else signed in with a handle and PIN):

1. The owner signs in on a trusted device and opens **حسابي ← حذف حسابي**, entering the
   PIN. That removes the account row, the personal row and the league entries.
2. They sign in again — the handle is free and a fresh account is created.
3. Change the PIN: the salt is regenerated, so the old key can no longer decrypt the old
   payload.

**A device was lost**: sign in on the other device, then delete the account and sign in
again from the lost device's perspective. The old device keeps its local copy until the
next sync, which will be rejected once the account is gone.

**The site looks broken**: the app is a static shell; a broken build is one redeploy
away. `npx -y vercel@latest --prod --yes` publishes the current commit.

## Reporting a problem

This is a private project, so there is no public issue tracker. Tell the person who
runs it (the student) with: what you did, what you expected, and the app version
(**القائمة ← سجل التشخيص** shows the build and the last errors). The diagnostic log stays
on the device and is never sent unless a crash is reported.

## Before you trust it with something you care about

Read `00_STUDIO_HUB/guides/QUIZ_BANK_PROTOCOL.md` for the content side, and the
engineering review in `ENGINEERING_REVIEW.md` for the honest state of the project: what
is finished, what is missing, and what would be needed before this could be called
production grade.
