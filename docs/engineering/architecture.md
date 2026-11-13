# MCSQuiz architecture

This page describes the repository implementation, not a live deployment. It was checked against the source tree on 2026-11-13. No deployed-site or device inspection was performed; visual notes below are derived from markup and CSS, not a comprehensive visual review. Treat the code as authoritative when it changes.

For run, release and content-authoring procedures, see [README.md](../../README.md) and the vault protocols linked there. Security boundaries and known trade-offs are in [SECURITY.md](../../SECURITY.md); gates and CI are in [QUALITY.md](../../QUALITY.md). Retrieve the current shell/content versions from `VERSION`, `sw.js`, `js/app.js` and the content manifest; retrieve current test totals from the gate output. This document intentionally duplicates neither volatile value.

## System shape

```text
Vault question banks (master)
  └─ publishing tool → Supabase content RPCs ─────┐
                                                   ├─ manifest + changed banks
Static shell + bundled data/index.json and banks ─┘
  └─ index.html + vanilla JS/CSS + service worker → browser/PWA
                                                     ├─ device-local study state
                                                     ├─ optional encrypted account sync
                                                     └─ optional league / live challenge
```

The browser app is a static site with no build step. The vault, not this repository's `data/` directory, owns authored question content. The checked-in bundle is a deployable fallback and offline copy; content can be published independently of shell deployment. `js/content.js` provides read RPCs for the content manifest and a bank. `js/app.js` caches versioned banks and the last manifest locally, downloads only changed portal banks, and falls back to the bundled `data/` files when the portal is unavailable or not configured. Bank loading is isolated per bank: a cached version can remain usable if a refresh fails.

The service worker precaches the shell, local libraries, fonts, and bundled content, and uses a versioned cache (`sw.js`). It is an offline shell/content strategy, not an API response simulator. `js/pwa.js` registers the worker, checks for updates, and exposes install prompting. During a running quiz, the app saves a resumable snapshot rather than immediately forcing a shell reload.

## Startup, routing and state

1. `index.html` sets Arabic/RTL and dark theme defaults, then applies saved theme and question-language preferences before paint. It also selects the initial catalog/session header from the hash.
2. Deferred scripts load in dependency order: core helpers and data clients, feature logic, view adapters, then `js/app.js` and `js/pwa.js`. `app.js` boots on `DOMContentLoaded`.
3. Boot restores preferences and personal state, binds handlers, loads the content index/banks, builds catalog filters, then routes the current hash. A content-load failure displays the error view.
4. `route()` in `js/app.js` handles `#/` (catalog), `#/quiz/<subject>/<quiz>`, `#/practice`, `#/saved`, `#/review`, `#/search`, `#/stats`, `#/account`, `#/league`, and `#/vs`. It clears or restores quiz session state as appropriate. `hashchange` drives subsequent navigation.

`js/app.js` owns the central in-memory state and most application flows. Preferences, filters, content cache, saved questions, history, best scores, review state, and selected account metadata use browser storage; an in-progress quiz snapshot is session-scoped. `js/cloud.js` optionally synchronizes personal data through the available account storage path and handles encryption/merge logic. Account/sign-in state does not gate local study: guest/offline usage remains available. See [SECURITY.md](../../SECURITY.md) for what the account and sync model does—and does not—protect.

## Feature map

| Area | Main implementation | Responsibility |
|---|---|---|
| App shell, catalog, quiz, results, route/state orchestration | `index.html`, `js/app.js` | Screen markup and transitions; quiz session lifecycle, rendering, timers, results, settings, tour, and shared event wiring. This is the largest module. |
| Content and validation | `js/content.js`, `data/index.json`, `data/banks/` | Portal read client and bundled fallback; normalize and validate bank payloads in `app.js`. |
| Quiz storage / analysis | `js/quiz-vault.js`, `js/analytics.js` | The loaded vault module defines IndexedDB operations, but no active consumer was identified during this source review; analytics handles scoring/result analysis. |
| Search | `js/search.js`, `js/search_ui.js` | Offline text indexing/query logic and search view. |
| Review | `js/review.js`, `js/review_ui.js` | Leitner scheduling, weak-question tracking, study days and review/custom-practice UI. |
| Saved questions and statistics | `js/saved_ui.js`, `js/stats_ui.js` | Views/adapters for bookmarks, history, trends, and personal-data backup/restore. |
| Account and personal sync | `js/cloud.js`, `js/account_ui.js`, `js/supabase-config.js`, `db/` | Identity/account operations, encrypted sync and merge; database functions/policies are defined in SQL. |
| League / share card | `js/league.js`, `js/league_ui.js` | Optional network-backed weekly/all-time standings and share presentation. |
| Versus challenge | `js/vs.js`, `js/vs_bot.js`, `js/vs_ui.js` | Optional realtime room protocol, simulated opponents, and challenge UI. |
| Achievements / flags | `js/achievements.js`, `js/admin_flags.js` | Achievement evaluation and question-audit reporting. |
| PWA / diagnostics / guided UI | `js/pwa.js`, `sw.js`, `js/debug.js`, `js/driver.js` | Install/update, offline shell, local diagnostics/crash reporting, and guided tour. |
| Styling and local libraries | `css/`, `assets/`, `js/vendor/` | Theme/layout layers, self-hosted fonts, icons and bundled runtime libraries. |

`index.html` is the screen and dialog inventory; feature modules generally expose browser globals and are loaded as deferred classic scripts. `app.js` delegates some feature rendering to view modules but still coordinates the majority of interactions. Preserve script order when changing dependencies.

## Quiz and content invariants

- `bank_kind` is explicit: `source` and `practice` are distinct catalog tracks. The catalog filters them separately and prefers the source track when one exists for the selected subject/chapter; see `chapterBankKind()`, `renderBankKindChips()` and `visibleChapters()` in `js/app.js`.
- Source questions preserve source order and option order. `preparePool()` does not shuffle a source pool or its options because answer meaning may depend on positional choices (for example, combinations such as “A and C”). A source-only session uses English, then restores the learner's preferred language on exit.
- Source metadata (`id`, `reference`, `key_status`, optional provenance and note) travels with question snapshots. The source is shown separately in the question UI. Confirmed/derived keys may be scored; a disputed source key must have a null answer and a bilingual note. `PortalAnalytics.isScorable()` excludes that item from correct/wrong totals, and result UI treats it as ungraded. Do not turn an unresolved key into a guessed answer.
- Practice pools may shuffle questions and options, with the answer index remapped to the shuffled order. Snapshots/retries preserve the question data needed to render and grade consistently.
- Search/review/saved-question practice routes through practice sessions. The review logic states that review practice must not pollute quiz history or league XP; verify that contract in `js/review.js` and its tests when modifying session completion.
- Validate content/schema changes with the focused bank/source tests and the repository gate described in [QUALITY.md](../../QUALITY.md). Do not hand-edit bundled banks as a substitute for correcting the vault source and pulling a fresh bundle.

Relevant contracts and regression coverage include `tests/test_source_schema.py`, `tests/test_source_flow.py`, `tests/test_banks.py`, `tests/test_quiz.py`, `tests/test_review.py`, and `tests/test_offline.py`.

## Design system and observed scope

The document root is Arabic/RTL with dark theme as the default; preferences can switch question language and theme. `css/quiz.css` defines the shared dark/light tokens for surfaces, text, borders, semantic status colors, radii, shadows and motion. `css/portal.css` is the portal-specific layer: it changes the accent to warm brass/gold, supplies visible keyboard focus styling, and adds portal/catalog/source styles. `css/fonts.css` maps locally hosted IBM Plex Arabic subsets for Arabic/Latin text; Space Grotesk is used for the brand wordmark. KaTeX assets support mathematical content; Lucide supplies interface icons.

The markup and styles indicate a mobile-first interface: compact headers, horizontally scrollable subject/chapter chips, card-based catalog and quiz surfaces, drawers/sheets, single-column flows, and responsive feature grids. The source track has distinct metadata and neutral/ungraded answer styling. Dark and light token sets exist. These are implementation observations, not evidence of measured contrast, touch-target dimensions, responsiveness at every width, or a screen-reader audit; consult [QUALITY.md](../../QUALITY.md) and the tests for the current verification scope.

## Evidence boundaries

This description is verified against repository source only. It does not establish that remote Supabase functions/schema match local SQL, that a deployment has the same files/configuration, or that optional network features are currently configured or reachable. For those claims, inspect the applicable live configuration and use the approved test/deployment workflow; do not infer live behavior from a source snapshot.
