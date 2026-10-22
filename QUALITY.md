# Quality gates, versioning and CI

The portal is a static app with a service worker and a remote content portal. It is small
enough that a heavy toolchain would cost more than it saves, so the gate is three scripts and
one workflow — but each one is real and fails the build.

## Versioning (SemVer + Keep a Changelog)

| file | holds |
|---|---|
| `VERSION` | the single source of truth, e.g. `1.0.2` |
| `manifest.json` → `version` | the PWA metadata |
| `sw.js` → `VERSION` / `CACHE` | the worker cache name is `mcq-portal-<version>`, so a release invalidates the old shell |
| `js/app.js` → `SHELL_VERSION` | what the app reports and compares |
| `CHANGELOG.md` | added / changed / fixed, newest first |

```bash
python tools/release.py patch --note "fix: the quiz clock stops on leave"
python tools/release.py minor --note "feat: export the account"
python tools/release.py major
```

`release.py` bumps all four places and opens a dated `CHANGELOG` entry; it never deploys.
A deploy is one command after the gate is green:

```bash
python tools/ci.py && npx -y vercel@latest --prod --yes
```

## The gates

### 1. `tools/audit.py` — static deep audit

Adapted from the **`lsp-inspect`** skill (blackwell-systems/agent-lsp: `dead_symbol`,
`silent_failure`, `error_wrapping`, `coverage_gap`, `unrecovered_concurrent_entry`,
`channel_never_closed`) and the **silent-failure-hunter** practice, without the LSP server the
original needs. It reads `js/`, `css/`, `index.html` and the Python tools.

| check | what it catches |
|---|---|
| `silent_failure` | `catch {}` around a network/`await` call — the failure disappears |
| `error_swallow` | `.catch(() => {})` on a request |
| `dead_symbol` | a top-level function that nothing calls, references or binds |
| `timer_never_cleared` | `setInterval` with no `clearInterval`, a stored `setTimeout` never cleared |
| `listener_leak` | many `addEventListener` and no `removeEventListener` (informational) |
| `orphan_id` / `dangling_id` | markup ids nothing uses / JS looking up an id that does not exist |
| `storage_orphan` | a `localStorage` key written but never read, read but never written, never removable |
| `debug_leftover` | `window.__*` hooks and `console.log` in shipped code |
| `todo` | unfinished markers |

Severity: `error` fails the build, `warning` fails it too, `info` is reported. A deliberate
no-op (a storage probe, a page-lifetime interval, a debug hook) is marked inline:

```js
} catch (e) { /* audit-ignore: probe only */ }
setInterval(check, 20 * 60 * 1000); // audit-ignore: page lifetime
```

Findings that are **accepted today** live in `.audit-baseline.json`; the gate fails only on
**new** findings. Accept more only on purpose:

```bash
python tools/audit.py --write-baseline
```

### 2. `tools/audit_runtime.js` — the live app on a real device

Drives every screen on the tablet over CDP while it instruments `setInterval` / `setTimeout`,
then reports what is still alive: zombie intervals with their source line, timeouts that never
cleared, unhandled rejections, storage keys the session left behind, and a session object that
survived leaving the quiz. It found two real leaks:

- the 500 ms quiz clock kept ticking after leaving a quiz (cleared on every exit path now),
- `withTimeout` left an 8 s timer armed after the request settled (cleared on settle now).

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
node tools/audit_runtime.js
```

### 3. `tests/run_all.py` — the behaviour suite (139 checks)

Ten specs: banks, accounts, catalogue, quiz, league, share, tour, offline, a11y, **security**. They run
against a locally served copy (their own server on `:8081`) or against production with
`PORTAL_BASE_URL`. The tablet sweeps (`sync_cross_device.py`, `tablet_sweep.js`,
`tablet_offline_sweep.js`) live in the vault under `90_Shared_Toolbox/tools/qa/`.

`tests/test_security.py` (18 checks) covers what the app promises about the data:
the PIN is rate limited, the stored payload is an encrypted envelope, the personal rows are
scoped to the claimed account, and deleting an account removes everything it owned.

### 4. `db/*.sql` — the database as code

The schema, the policies and the functions are migrations, not manual clicks:

| file | what |
|---|---|
| `db/001_security_hardening.sql` | the attempt ledger, the rate-limited login, account deletion |
| `db/002_login_rate_limit.sql` | the functions return a status instead of raising, so the counter commits |
| `db/003_rls_scope.sql` | the personal tables are scoped to the claimed account |
| `db/004_rate_limit_tuning.sql` | the address limit raised for shared networks, the delete fixed for a uuid column |

```bash
python tools/db_apply.py db/003_rls_scope.sql
```

Each file runs as one transaction: it either applies completely or changes nothing.

### 5. `tools/ci.py` — the one command

```bash
python tools/ci.py          # audit + suite on its own port
python tools/ci.py --fast   # audit only
```

Exit 1 on any failure. `.github/workflows/ci.yml` runs the same thing on push and pull request
(Python 3.12 + Playwright's Chromium; `tests/common.py` falls back to it when Thorium is absent).

## What CI does not do

- It does not deploy. Deploys are explicit (`vercel --prod`) after a green gate.
- It does not touch the content portal. Banks ship with `portal_content.py sync` (see
  `00_STUDIO_HUB/guides/QUIZ_BANK_PROTOCOL.md` in the vault).
- It does not run the tablet harnesses (they need the device).

## Known accepted findings

`.audit-baseline.json` currently accepts the optional-storage guards (`try { localStorage… }
catch {}`), the page-lifetime worker update check, the debug-only `window.__portal` hook and the
async test-wait helpers. Anything else fails.
