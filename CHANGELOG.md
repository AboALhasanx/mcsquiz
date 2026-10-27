# Changelog

All notable changes to the MCSQuiz portal. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.18] — 2026-10-28

### Changed
- content: add Data Mining Chapters 6–7 quiz banks


## [1.7.17] — 2026-10-28

### Changed
- إلغاء شارة الإشعار عن أيقونة المحفوظات في الشريط العلوي نهائياً


## [1.7.16] — 2026-10-28

### Changed
- توحيد لون وموقع شارات الإشعارات والمحفوظات في الشريط العلوي


## [1.7.15] — 2026-10-28

### Changed
- توحيد الهوية البصرية ونظام الألوان وإلغاء التنافر اللوني


## [1.7.14] — 2026-10-28

### Changed
- chore: cache Data Mining chapters 4 and 5


## [1.7.13] — 2026-10-27

### Changed
- زيادة المسافات بين أزرار الخيارات والشرائح وتأكيد تسجيل الحساب


## [1.7.12] — 2026-10-27

### Changed
- content: Data Mining Chapters 2–3 topic banks


## [1.7.11] — 2026-10-27

### Changed
- content: Data Mining Chapter 1 topic-bank replacement


## [1.7.10] — 2026-10-27

### Changed
- content: retire superseded Cyber Security Chapter 6 banks


## [1.7.9] — 2026-10-27

### Changed
- content: publish cleaned Cyber Security Chapters 4 and 5


## [1.7.8] — 2026-10-26

### Changed
- content: Cyber chapter 3 rebuilt (103 questions, 9 banks) — crossed-out material removed, no handout references, no length tell


## [1.7.7] — 2026-10-26

### Changed
- content: chapters 1 and 2 no longer refer to the handout — 163 questions reworded to stand on their own


## [1.7.6] — 2026-10-26

### Changed
- content: Cyber chapter 2 rewritten (92 questions, 8 banks) — aligned to the doctor's focus, one fact per question, no length tell


## [1.7.5] — 2026-10-26

### Changed
- content: Cyber chapter 1 rewritten (71 questions, 6 banks) — plainer wording, no repeated concepts, no length or formula tell


## [1.7.4] — 2026-10-24

### Changed
- إصلاح عمل الـ PWA أوفلاين بالكامل وإزالة استعلامات النسخ المانعة لتحميل الـ CSS بدون إنترنت وتضمين ملفات KaTeX في التخزين المسبق


## [1.7.3] — 2026-10-24

### Changed
- اعتماد أفاتار قياسي نظيف وحل تداخل لون الخلفية الصفراء لصور المستخدمين بدون صورة شخصية


## [1.7.2] — 2026-10-24

### Changed
- مزامنة تلقائية في الخلفية بين الأوفلاين والأونلاين مع دعم إعادة المحاولة ودمج السجل والنتائج


## [1.7.1] — 2026-10-24

### Changed
- ui: 3d tactile option push and Duolingo pop/shake feedback, in-app offline banner, and calm review card styling


## [1.7.0] — 2026-10-23

### Changed
- feat: tap a league row to see that classmate's public card (avatar, rank, answers, accuracy, top subjects - this week only, never the handle)


## [1.6.3] — 2026-10-23

### Changed
- league: the join card says sign up (the Telegram bot is gone) and opens the sign-up sheet; ROADMAP records the public player card


## [1.6.2] — 2026-10-23

### Changed
- sign-out now wipes this device's records (history, bookmarks, best scores) after syncing them up; the account keeps them


## [1.6.1] — 2026-10-23

### Changed
- fix: after a link or a manual sync the stats/bookmarks re-read the merged copy instead of waiting for a reload


## [1.6.0] — 2026-10-23

### Changed
- feat: resume a quiz after an accidental refresh, sign-out warning, saved-account login with handle+PIN, swipe-down sheets, linked devices are told to enter the PIN


## [1.5.2] — 2026-10-23

### Changed
- fix: a link request clears the signed-out guard, and a stall on the QR now explains itself (missing account row, expired code) instead of spinning


## [1.5.1] — 2026-10-23

### Changed
- fix: the QR link hands the approving device all six digits; the login link is a real button with a QR icon; the avatar picker opens one row with إظهار المزيد and a «بدون» tile


## [1.5.0] — 2026-10-23

### Changed
- feat: change the 4-digit PIN from the account page (portal_change_pin, same rate limits as login)


## [1.4.5] — 2026-10-23

### Changed
- account: deleting the account or signing out also wipes the stored PIN; a wrong PIN now says so


## [1.4.4] — 2026-10-23

### Changed
- sound: the mute choice is remembered across reloads (it now lives in the burger menu)


## [1.4.3] — 2026-10-23

### Changed
- top bar: the saved shortcut is always visible; the sound toggle now lives in the burger menu only


## [1.4.2] — 2026-10-23

### Changed
- content: Cyber chapter 6 published (13 banks / 258 questions); precache refreshed for offline installs


## [1.4.1] — 2026-10-23

### Changed
- content: Cyber chapter 5 published (17 banks / 346 questions); precache list refreshed so offline installs pick up the new banks


## [1.4.0] — 2026-10-22

### Changed
- notifications name the new topic, chapter and subject; the topic badge sits with the card chips; the tab icon is the transparent white-Q logo


## [1.3.1] — 2026-10-22

### Changed
- the translation icon stays fixed in every app bar


## [1.3.0] — 2026-10-22

### Changed
- the language switch is now one translation icon (yellow for Arabic) before the bell, and a refresh no longer flashes the old header or language state


## [1.2.3] — 2026-10-22

### Changed
- the browser tab and app name are just MCSQuiz; fix the chapter word


## [1.2.2] — 2026-10-22

### Changed
- chapters stay plain numbers, topics are numbered inside the card (1.1, 1.2)


## [1.2.1] — 2026-10-22

### Changed
- the chapter chips show the numbered chapter (1.1, 1.2 …)


## [1.2.0] — 2026-10-22

### Changed
- the card title no longer repeats the subject, chapters are numbered 1.1/1.2, the login card has a close button, and the modals follow the light theme


## [1.1.1] — 2026-10-22

### Changed
- fix: a tour step whose target is not on screen yet keeps its text visible instead of leaving a blank overlay


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
