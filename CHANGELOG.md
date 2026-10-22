# Changelog

All notable changes to the MCSQuiz portal. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-10-22

### Changed
- feat: rate-limited PIN, encrypted personal payload, row-scoped tables, account deletion, vendored Supabase client, strict CSP, crash reporting


## [1.0.3] — 2026-10-22

### Changed
- chore: vendor the Supabase client locally and add strict CSP/security headers


## [1.0.2] — 2026-10-22

### Changed
- fix: a league request timeout no longer stays armed after the request settles


## [1.0.1] — 2026-10-22

### Changed
- chore: dedupe the service-worker precache list


### Added
- Deep audits: `tools/audit.py` (silent failures, dead code, orphan ids, unclosed timers) and
  `tools/audit_runtime.js` (live timers, unhandled rejections, storage keys after a session).

## [1.0.0] — 2026-10-22

### Added
- Accounts with a permanent handle and a 4-digit PIN; device linking by code/QR; profile name and avatar.
- Weekly league with subject filters, a share card, and per-device checks.
- Content portal (Supabase): the agent publishes banks, the app pulls a tiny manifest and caches it.
- Offline-first shell: the service worker caches the app, the manifest and every bank.
- Notifications: a bell with an unread count, a sheet, mark-as-read, and a one-time toast.
- Two question models per chapter (النموذج أ / النموذج ب), 38 banks across six subjects.
- Question language switch (ع / EN) in the quiz, the results and the saved view.
- Statistics screen with a period filter, a trend chart with the 60% pass mark, and per-subject facts.
- Cross-device sync that **merges** both copies: bookmarks are a union, the best score keeps the
  higher value, history is a union, and removals/clears travel as timestamps.

### Changed
- Versioning moved from build counters (`v100`) to SemVer; the service-worker cache follows it.
- The leave guard warns whenever a **started** quiz is abandoned, not only after the first answer.

### Fixed
- The pause overlay no longer survives leaving a quiz (it blocked the next attempt).
- A different account on the same device no longer inherits the previous account's data.
- A stale device can no longer overwrite newer data from another device.
- The quiz clock is stopped on every exit path (it used to tick after leaving).
- Silent network failures in the league sync and the background upload are now logged.
