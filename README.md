# MCSQuiz

A personal study app: six subjects, question banks written from the lecture notes, an
offline-first PWA, a weekly league, and a content portal so a new bank reaches every
device without a redeploy.

```
vault (01_Semester_1/*/07_Quizzes_&_Anki/Quiz_*.json)   <- the master copy
        |  portal_content.py sync        (validate -> merge -> publish)
        v
Supabase: content_banks + content_meta                   <- the content portal
        |  content_manifest() / content_bank()
        v
the PWA: service worker + cached manifest + cached banks  <- offline first
```

## Run it locally

```bash
cd mcq-portal
python -m http.server 8081        # the app is a static site
PORTAL_BASE_URL=http://127.0.0.1:8081 python tests/run_all.py
```

The suite needs Playwright with Chromium (or set `PORTAL_CHROMIUM` to a local browser).

## The gates

```bash
python tools/ci.py            # static audit + the behaviour suite (one command)
python tools/ci.py --fast     # the audit only
python tools/audit.py         # silent failures, dead code, orphan ids, unclosed timers
python tools/audit.py --json  # machine readable
python tools/clean_qa_users.py --dry-run   # throwaway accounts the specs left behind
```

`tools/ci.py` runs the sweep after the suite (a missing management token never fails the gate):
the browser specs create real accounts, and their own cleanup is best-effort.

`tools/audit.py` compares against `.audit-baseline.json`: only **new** findings fail.
Mark a deliberate exception inline with `// audit-ignore: reason`.

## The runtime audit (a real device)

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
node tools/audit_runtime.js
```

It instruments `setInterval` / `setTimeout`, drives every screen, and reports what is
still alive (zombie timers with their source line), unhandled rejections, storage keys
left behind, and a session that survived leaving a quiz.

## Release

The version lives in `VERSION` and follows [SemVer](https://semver.org/); the manifest,
the service worker cache name (`mcq-portal-<version>`) and the app's `SHELL_VERSION`
follow it.

```bash
python tools/release.py patch --note "fix: the quiz clock stops on leave"
python tools/ci.py && npx -y vercel@latest --prod --yes
```

`CHANGELOG.md` is kept in the Keep a Changelog format. Deploys are explicit; the
committed GitHub Actions workflow runs the same gate on every push.

## Content

The vault is the master. A bank is one JSON file per chapter model:

```
01_Semester_1/<Subject>/07_Quizzes_&_Anki/Quiz_Ch<NN>_Model<A|B>_<Slug>.json
```

Two models per chapter (النموذج أ / النموذج ب). The authoring rules, the schema and the
publishing steps live in the vault: `00_STUDIO_HUB/guides/QUIZ_BANK_PROTOCOL.md` and
`00_STUDIO_HUB/guides/PORTAL_PUBLISH.md`.

```bash
python 90_Shared_Toolbox/tools/portal_content.py sync     # publish what changed
python 90_Shared_Toolbox/tools/portal_content.py status   # what is live
python 90_Shared_Toolbox/tools/portal_content.py pull     # refresh the bundled fallback
```

## The app in one file

| file | what it owns |
|---|---|
| `js/app.js` | the shell: catalogue, quiz, results, stats, league view, account, tour |
| `js/cloud.js` | identity (handle + PIN), the personal-data store, the merge, the encryption |
| `js/league.js` | the weekly board and the share card |
| `js/content.js` | the content-portal client (manifest + banks) |
| `js/pwa.js` | the service-worker registration and the install prompt |
| `js/debug.js` | the local log and the crash reports |
| `js/vendor/npm/` | the Supabase client, vendored (no CDN at runtime) |

## Endpoints

| path | what |
|---|---|
| `/api/avatar.js` | proxies `t.me` avatars so the share-card canvas stays clean |
| `/api/health.js` | liveness + the running version |
| `/api/log.js` | where the app reports a crash (function log; no personal data) |

## Security

Read [SECURITY.md](SECURITY.md). In one line: the PIN is salted and hashed, the personal
payload is encrypted on the device with a key derived from that PIN, the personal tables
are scoped by row, and no third party sees anything at runtime.

## License

MIT — see [LICENSE](LICENSE).
