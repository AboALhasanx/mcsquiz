# Security and data flows

This is an implementation note, not a penetration test or a claim that the service is
secure for high-risk data. For the threat model, user-facing limitations and incident
steps, see [`SECURITY.md`](../../SECURITY.md). This document records the behavior visible
in the checked-in client and migrations, plus one dated snapshot of the live Supabase
security advisor. Re-check the live project before acting on that snapshot.

## Data paths and trust boundaries

### Browser storage

- Quiz history, saved questions, best scores and study metadata are held as ordinary
  JSON in origin `localStorage` (for example `portal_history_v1` and
  `portal_saved_v1`). They are not encrypted at rest on the device. Other app state,
  account metadata, and—in handle/PIN accounts—the four-digit PIN
  (`portal_pin_v1`) are also stored there. Browser-profile access or same-origin script
  execution can therefore access local data. See [`js/app.js`](../../js/app.js) and
  [`js/cloud.js`](../../js/cloud.js).
- Telegram launch identity is taken from `initDataUnsafe.user` or a URL hash. The hash
  parser checks only its age and shape; it does not verify Telegram's signature. The
  raw identity is stashed in `sessionStorage` and removed from the URL hash.
- The optional diagnostic ring buffer is in `localStorage` as `portal_debug_log`.
  Error lines can be sent in small batches to `/api/log`; inspect
  [`js/debug.js`](../../js/debug.js) and [`api/log.js`](../../api/log.js) before
  changing what is reported. Do not treat the comment's privacy promise as a substitute
  for reviewing the actual messages passed to the logger.

### Sync destinations

`PortalCloud.activeStore()` chooses Telegram CloudStorage when its bridge is available;
otherwise it uses Supabase when configured. If neither is available, data stays local.

- Telegram CloudStorage receives the JSON bundle produced by `collectBundle()` split
  into chunks. This path does **not** encrypt the bundle in this client.
- Supabase `portal_data.data` receives an AES-GCM envelope when Web Crypto is available
  and the account PIN is present. `cloud.js` derives an AES-256 key with PBKDF2-SHA-256
  (210,000 rounds) from the PIN and the deterministic string `mcqquiz|<handle>`; it
  uses a random 12-byte IV per encryption. The PIN also goes to the `portal_login`,
  `portal_profile`, `portal_change_pin`, and account deletion RPCs over HTTPS so the
  server can verify/update its PIN hash. Do not describe it as never leaving the
  browser. The SQL uses a per-account random `pin_salt` for the stored hash; that is
  distinct from the client-side encryption salt.
- If a linked device lacks a usable PIN, or cannot decrypt the envelope, sync returns a
  locked/`needs-pin` state and avoids replacing the server copy. The client merges local
  and remote bundles rather than blindly replacing one with the other.

### Supabase boundary

The browser uses the configured publishable/anon key and sends `x-portal-user` as a
client-asserted identity. `db/003_rls_scope.sql` scopes `portal_data` and league writes
to that claim; the header is not proof of identity. Treat it as a row boundary, not an
authenticated session. The legacy account model and its residual risks are described
in [`SECURITY.md`](../../SECURITY.md). Public league reads expose the fields intentionally
used by the board. Anonymous RPCs marked `SECURITY DEFINER` in the live advisor are not
by themselves evidence of a vulnerability: review each function's intended public use,
authorization checks, and grants together.

The static host sends CSP and related browser headers in [`vercel.json`](../../vercel.json).
`/api/avatar` proxies only URLs matching the `https://t.me/i/userpic/` prefix; this is an
avatar convenience, not an identity check (`api/avatar.js`).

## Known limitations and verification notes

- A four-digit PIN has a small search space. The SQL migrations implement throttling,
  but throttling does not make it equivalent to a strong password. Current intended
  limits and account recovery steps are in [`SECURITY.md`](../../SECURITY.md).
- Local browser storage and Telegram CloudStorage are not encrypted by this client.
  Device/browser access and the Telegram storage account are therefore part of the
  trust boundary.
- Changing a PIN is a **potential data-continuity issue; unverified**: the client-side
  encryption key is derived from the PIN, while `changePin()` updates the remote PIN
  hash and local PIN without visibly decrypting and re-encrypting an existing remote
  envelope. This suggests a bundle encrypted under the old PIN might not decrypt after
  the change. No end-to-end PIN-change/sync test was run for this note, so this is a
  hypothesis, not a confirmed data-loss bug. Verify with a disposable local/test account
  and preserve an export before considering a fix; do not experiment on a real account.
- The live-advisor items below are snapshots of automated lints, not exploit findings.
  Their presence does not establish reachability, impact, or successful exploitation.

## Live Supabase security-advisor snapshot

**Observed 2026-11-13 16:09:55 UTC** via the Supabase security advisor. This is a dated,
unverified snapshot of that project's state; it may be stale or reflect intentional
design. No row contents, credentials, addresses, or user data are included.

| Advisor finding | Snapshot | Review note |
|---|---|---|
| RLS enabled, no policies | `content_publishes`, `login_attempts`, `login_links`, `portal_users` (4 tables; INFO) | `login_attempts` is intended to be function-only in migration 001; verify grants and current schema. Assess the others separately. |
| Mutable function `search_path` | `portal_handle_immutable`, `portal_client_ip`, `portal_claimed_user` (3; WARN) | Compare live definitions and grants to migrations; advisor does not prove exploitability. |
| `SECURITY DEFINER` executable by `anon` / `authenticated` | 14 functions in each role category, including content, link, login/profile, PIN/delete and VS RPCs (WARN) | Some RPCs may be intentionally public. Review each function's body, argument validation, grants and effect before changing access. |

Advisor remediation references: [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [mutable search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anon executable `SECURITY DEFINER`](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated executable `SECURITY DEFINER`](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

To refresh, query the Supabase project's **Security Advisor** (or `get_advisors` with
`type: "security"`) and record the observation time. Do not copy secrets or personal
data into this document. For current migration and regression-test pointers, see
[`SECURITY.md`](../../SECURITY.md) and [`QUALITY.md`](../../QUALITY.md); do not duplicate
their changing version or test counts here.
