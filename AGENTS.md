# AGENTS.md — MCSQuiz (mcq-portal)

Rules for any agent working in this repository. Short on purpose: the long form is in
`README.md` (how it runs), `SECURITY.md` (threat model), `QUALITY.md` (the gates),
`ROADMAP.md` (what is next) and `CHANGELOG.md` (what shipped).

## 1. What this repo is

The PWA that students actually open. **It is not the master of the content**: the
question banks live in the vault (`01_Semester_1/<Subject>/07_Quizzes_&_Anki/`), are
published to Supabase by `portal_content.py`, and only the pulled bundle
(`data/index.json` + `data/banks/*`) lands here. Editing a bank in `data/` is always
wrong — fix it in the vault and re-pull.

## 2. Before touching anything

```bash
git status                     # expect clean; this repo is public
python tools/ci.py --fast      # audit, ~2 s
```

Read the files you are about to change. This is a small vanilla-JS app with no build
step: `index.html` + `js/*.js` + `css/*.css` are shipped as-is.

## 3. The gate (no exceptions)

```bash
python -m http.server 8081 &                     # the suite drives a real browser
PORTAL_BASE_URL=http://127.0.0.1:8081 python tools/ci.py
```

- Green means **audit + the whole behaviour suite** (currently 220 checks).
- Never report "done" on a red or unrun gate. If a spec fails for an environmental
  reason (rate limit, flaky device), say so explicitly instead of calling it a flake.
- The specs create real accounts on the live Supabase project; `tools/ci.py` sweeps
  them afterwards. Do not point the suite at production and leave rows behind.
- `tools/audit.py` fails only on **new** findings against `.audit-baseline.json`;
  a deliberate exception is marked inline `// audit-ignore: reason`.

## 4. Release and deploy

```bash
python tools/release.py patch|minor|major --note "one line for the changelog"
PORTAL_BASE_URL=http://127.0.0.1:8081 python tools/ci.py
git add -A && git commit && git push origin master
npx -y vercel@latest --prod --yes
```

- `VERSION` is SemVer and drives the manifest, `SHELL_VERSION` and the SW cache name
  (`mcq-portal-<version>`). A new shell only reaches a device after a reload — verify
  on the device **after** reloading, never on the already-open page.
- Content needs no deploy: `portal_content.py sync` + `pull` is enough. Deploy the
  shell only when the bundle/precache changed.
- Deploys are explicit: ask before shipping a release the student did not ask for.

## 5. Non-negotiables for the UI

- **Arabic first, RTL.** Every new string is Arabic (MSA, no dialect); technical terms
  stay in clean English with no parenthetical echo. `←` inside Arabic lines, `→` in
  English ones.
- **No AI-slop copy.** No filler, no "مرحباً بك في تجربتك التعليمية", no emoji in UI
  text. Short, literal, useful.
- **Mobile first.** Tap targets ≥ 40 px, one hand, dark theme by default, light theme
  must not break. Test at 402–533 px wide.
- **Accessibility is part of the gate**: every icon-only control has `aria-label`,
  focus is visible, sheets close with ✕ / Esc / swipe-down.
- The logo is never redrawn — the favicon points at `assets/brand-image-light.png`.

## 6. Data and accounts — handle with care

- Accounts are **username + 4-digit PIN**. The PIN is the only credential: never log
  it, never send it anywhere but the RPC, never leave it in storage after sign-out.
- Personal data (history, bookmarks, best scores) is **encrypted on the device** with a
  key derived from the PIN. The server cannot read it; a device without the PIN must
  never overwrite the account's copy (`needs-pin`, not "push empty").
- The **service_role key never enters this repo** (or any file under it). Writes go
  through the RPCs in `db/*.sql`, applied with `tools/db_apply.py`.
- Any destructive database action (delete rows, reset a table, re-publish content)
  needs the student's explicit approval first.

## 7. Devices

- Local suite: `python -m http.server 8081` + `PORTAL_BASE_URL`.
- Tablet/phone: `adb forward tcp:9333 localabstract:chrome_devtools_remote`, then
  Playwright `connectOverCDP('http://127.0.0.1:9333')`. Re-add the forward after every
  device reconnect; a stale port refuses the websocket.
- Cache busting in a browser: `?t=<timestamp>` (bypasses the worker). `?debug=1` exposes
  `window.__portal` — never leave the debug panel visible on the student's device.

## 8. Definition of done

1. The gate is green (paste the summary line).
2. The behaviour is verified on the deployed build at phone/tablet width, not just
   locally — and on the device itself when the change is device-specific.
3. `CHANGELOG.md` has the entry (via `release.py`), `ROADMAP.md` moves the item if it
   was listed there, and the version was bumped when the shell changed.
4. Committed and pushed. No secrets, no `node_modules`, no local artefacts.
