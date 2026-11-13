# Competition baseline and change record

## Phase 0 — 2026-11-13 (in progress)

The goal is to improve competition and adaptive virtual opponents without deploying
to Vercel. Production content, accounts and scores are not test fixtures. Do not
change production data to validate this work.

### Before changes

- `python tools/ci.py --fast`: audit clean; zero new errors and warnings.
- Physical Android tablet connected via USB (`adb devices -l`). Opening the installed
  MCSQuiz PWA showed the Arabic catalogue in the accessibility hierarchy. A read-only
  Chrome DevTools connection confirmed the page title `MCSQuiz`, the deployed URL,
  the menu's Arabic accessible label, the presence of the VS menu entry, and an active
  service-worker controller. No competition match was played on the student's profile.
- Port 8081 was occupied by an existing Python server and returned
  `net::ERR_EMPTY_RESPONSE`. A separate server bound to 127.0.0.1:18081 returned HTTP
  200. With the repository's configured Chromium executable and Supabase requests
  blocked, a 402px local guest browser opened the menu and exposed both `التحدي المباشر`
  and `الدوري الأسبوعي`. It navigated to `#/vs` and the lobby became visible; this
  did not start a match. The first bare Playwright launch failed because its default
  headless executable was missing; use the executable configured in `tests/common.py`.
- On the connected tablet, after opening the side drawer, the live PWA accessibility
  hierarchy exposed the same competition menu entries and reported the app installed.
  A subsequent read-only DOM check confirmed the VS menu entry was visible. The tablet
  has an existing account, so no match, league write, sign-out or data reset was used
  as a test.
- Navigating from that existing PWA menu to `#/vs` opened the live VS lobby. The USB
  accessibility tree exposed `التحدي المباشر`, subject/chapter pickers, create-room
  and join-room controls. No room was created and no match was played. This verifies
  the baseline deployed lobby only, not the pending local changes or offline VS.

This is an incomplete baseline, not evidence that scoring, competition flows or
offline play passed. Record the website and local guest flows, exact runtime test
results and all implementation changes below as work proceeds.

## Phase 1 — in progress

- League privacy: a failed visibility lookup previously defaulted to `hidden: false`
  before an upsert. `syncWeek` now aborts on a failed lookup rather than overwriting
  a potentially hidden player. `node tests/test_league_privacy.js` verifies five
  isolated cases, including API errors and rejected network promises. This does not
  change scoring or historical rows, and has not been deployed.
- League disclosure: virtual opponents are labelled in the leaderboard, podium,
  player card, winner banner and share canvas. `tests/test_league_bot_disclosure.py`
  passed 28 isolated checks against local port 18081. The podium itself remains
  aria-hidden; table rows and player cards carry the accessible disclosure.
- Account switching: a local mock reproduced a stale cached league user ID after an
  account change. `invalidateClient()` now clears that ID along with the client; the
  isolated regression asserts the next sync targets the new account and preserves its
  visibility. No real account or production write was used for this verification.
- Offline legend lobby: local code now keeps legend access available offline and
  disables online room actions. An isolated browser observed the lobby, five legend
  controls and disabled room buttons while offline. After correcting test setup for
  Playwright and the first-visit tour, `python tests/test_vs_offline_competition.py`
  passed a full five-round duel using a disposable warmed browser page with service
  workers blocked. A cold start through the installed PWA has not been tested.
- Tablet local build: USB reverse forwarded port 18081; a separate tab on the tablet
  opened the local origin without changing the installed production PWA. With the
  tab's `navigator.onLine` overridden to false and Supabase requests blocked, the
  offline lobby showed five legends, disabled live-room creation, and completed five
  rounds with the result visible. This simulates the offline state; it is not an
  airplane-mode test or a cold-start installed-PWA test.

## Phase 2 — bot engine (local)

- Score-gap rubber-banding replaced the 250/350-point step rules with a continuous
  curve (`0.085 * tanh(gap / 900)`), so one answer no longer produces an 8–9 point
  accuracy cliff.
- Late-round clutch now has diminishing returns instead of adding its full bonus, so
  accurate legends no longer collapse onto the same 96% wall. `node
  tests/test_bot_competition.js` checks continuity (max 300-point step 0.0322),
  archetype separation in the deciding round (0.870 vs 0.853) and timing/accuracy
  bounds for every legend. These are tuned heuristics, not a trained model.

## Phase 3 — adaptive opponent (wired locally, session-only)

- `js/vs_adaptive.js` is now wired into `js/vs_ui.js`: a profile per subject is created
  at duel start, the bounded offset is applied to that legend's accuracy for the
  match, and the outcome is recorded after the result screen. No storage, cookie or
  network write; the profile is dropped on reload or when the local owner changes.
  The module was added to the service-worker precache (343 entries).
- Evidence: `node tests/test_vs_adaptive.js` (200 checks) and
  `python tests/test_vs_adaptive_integration.py`, which proves the offset reaches
  `PortalVSBot.decide` and exactly one outcome is recorded per completed duel.
- Limit: small between-match adjustment only; no claim of predicting ability or
  guaranteeing a win rate.

## Integrated local verification

- `python tests/test_bot_competition.py` → 4 checks, 0 failed.
- `python tests/test_vs_offline_competition.py` → five-round duel passed.
- `python tests/test_vs_adaptive_integration.py` → offset applied, one outcome recorded.
- `python tests/test_league_bot_disclosure.py` → 28 checks, 0 failed.
- `node tests/test_league_privacy.js` → 5 visibility cases + account-switch isolation.
- Safe local suite on port 18081 (18 specs; remote-touching specs excluded):
  **597 checks, 0 failed**. `tests/report.txt` was backed up and restored byte for
  byte (SHA-256 `8AA81E88…BD9535`).
- Tablet, integrated build: after cache-busting with `?t=`, the local page loaded
  `PortalVSAdaptive`, reported offset 0 on a cold session, completed five rounds
  offline-simulated and showed the result with no page errors. The first attempt
  loaded the tablet's cached older shell (`PortalVSAdaptive` absent); `?t=` fixed it.
- Shell bumped to **1.13.0** via `tools/release.py minor` (VERSION, manifest,
  service-worker cache name, `SHELL_VERSION`); precache check reports 343 entries and
  the audit is clean. Nothing was deployed.
- Not verified: cold-start installed-PWA update, airplane mode, or the deployed build.
