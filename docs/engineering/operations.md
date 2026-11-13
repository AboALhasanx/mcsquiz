# Operations runbook

This is an operator map, not a replacement for the canonical procedures. See
[README.md](../../README.md), [QUALITY.md](../../QUALITY.md),
[SECURITY.md](../../SECURITY.md), and the vault's
`00_STUDIO_HUB/guides/PORTAL_PUBLISH.md` for full content-authoring details.

## Content ownership and publication

- **The vault owns question content.** Edit and validate source banks under
  `01_Semester_1/<Subject>/07_Quizzes_&_Anki/`; never hand-edit generated
  `data/index.json` or `data/banks/*` in this repository. The bundle is a fallback,
  not the canonical source ([AGENTS.md](../../AGENTS.md), [README.md](../../README.md)).
- From the vault/toolbox context documented in `PORTAL_PUBLISH.md`, use
  `portal_content.py status` to inspect the published state, `sync` to validate and
  publish approved vault changes to Supabase, then `pull` to refresh this repository's
  bundled fallback. The repository README shows the command forms under
  `90_Shared_Toolbox/tools/portal_content.py`.
- **Publication is a remote content write.** Confirm the intended bank set and obtain
  the content owner's approval before `sync`; inspect `status` before and after. `pull`
  writes generated repository data. Review its diff, and do not repair content by
  editing generated bundle files directly. Content changes are served dynamically and
  do not by themselves require a shell deploy ([README.md](../../README.md#content),
  [QUALITY.md](../../QUALITY.md#what-ci-does-not-do)).
- At runtime the client asks the content RPC for a manifest, downloads changed banks,
  and stores manifest/banks locally. When unavailable it tries the last-seen local
  manifest, then the static bundled `data/` copy. A first-ever offline visit therefore
  needs the shell's precached bundle ([js/app.js](../../js/app.js),
  [js/content.js](../../js/content.js)).

## PWA shell updates and cache

- The service worker precaches its `CORE` list, including the bundled index and banks;
  `VERSION` names the shell cache. Activation removes older caches and claims open
  clients. Normal GETs are cache-first with network fallback/update; `?v=` and `?t=`
  requests try network first ([sw.js](../../sw.js)).
- The client registers with `updateViaCache: 'none'` and checks for updates on
  foreground/focus and periodically ([js/pwa.js](../../js/pwa.js)). A release must
  keep `VERSION`, `manifest.json`, `js/app.js`'s `SHELL_VERSION`, and the worker cache
  version aligned; `python tools/release.py <patch|minor|major> --note "..."` updates
  these and the changelog, but does **not** deploy ([tools/release.py](../../tools/release.py),
  [QUALITY.md](../../QUALITY.md)).
- After an authorized deployment, verify on the target device **after reloading** so
  the new worker controls the page. For diagnosis, `?t=<timestamp>` makes the worker
  try the network first, but it can still fall back to cache; `?debug=1` exposes diagnostics and must not be left open
  on a student's device ([AGENTS.md](../../AGENTS.md#7-devices)).

## Safe checks and QA cleanup

Run local, non-publishing checks from the repository root:

```bash
git status --short
python tools/ci.py --fast
```

`--fast` runs the static audit only. The full gate is `python tools/ci.py`; it serves a
local copy and runs the browser suite, but the specs exercise the configured Supabase
RPCs and create throwaway accounts there. A local app URL does not isolate the remote
backend. The gate then invokes cleanup. **Do not run it if that would create unapproved
production data or leave rows behind.** Verify the backend configuration and obtain
authorization to create and clean up test accounts before running the full gate.

The standalone cleanup is destructive against Supabase: inspect its selection first
with `python tools/clean_qa_users.py --dry-run`. Only run
`python tools/clean_qa_users.py` when cleanup of exactly those synthetic records is
approved. Its implementation also deletes associated rows and matching test login
attempts; dry-run lists matching accounts but does not preview every associated-row
delete ([tools/clean_qa_users.py](../../tools/clean_qa_users.py)). Never use it as a
general database cleanup tool.

The suite runner removes and rewrites `tests/report.txt` before reporting results
([tests/run_all.py](../../tests/run_all.py)). Preserve any existing report or user
changes before running it; choose a separate checkout or save/restore the report with
the owner's approval. Device runtime/offline sweeps are separate and require a device
([QUALITY.md](../../QUALITY.md#the-runtime-audit-a-real-device)).

## Release and deployment authorization

1. Review the diff and run the authorized gate; update the changelog/version through
   `tools/release.py` for shell releases. Check the resulting version and generated
   precache list when relevant.
2. Content-only publication uses the vault content workflow. Shell changes require a
   shell release; neither `release.py` nor CI deploys automatically.
3. Production deploys are explicit and require the student's authorization. Only
   after approval and a green gate, the documented command is
   `npx -y vercel@latest --prod --yes` for the intended project/account. Do not deploy
   merely because a command appears in this runbook ([AGENTS.md](../../AGENTS.md),
   [QUALITY.md](../../QUALITY.md)).
4. Verify the deployed version and behavior on a reloaded phone/tablet-width client.
   Deployment rollback is not rehearsed/documented here; if rollback is needed, stop
   and obtain the operator's direction rather than guessing at a production action
   ([ENGINEERING_REVIEW.md](../../ENGINEERING_REVIEW.md#10-cicd-and-release)).

## Destructive-action rule

Any database delete/reset, content re-publication or production deployment requires
the student's explicit approval first. Prefer status/dry-run and diff inspection;
never put a service-role key in this repository. Database migrations are applied via
`tools/db_apply.py` only as an explicitly approved operation
([AGENTS.md](../../AGENTS.md#6-data-and-accounts--handle-with-care),
[SECURITY.md](../../SECURITY.md)).
