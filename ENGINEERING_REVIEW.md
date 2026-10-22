# Engineering review — MCSQuiz portal

> **Context:** a personal study app for the student and classmates. Six subjects, 39 question
> banks, one student account model, a content portal and an offline PWA. It is **not a commercial
> product**: no paying users, no SLA, no regulated data. The review still applies the standard
> engineering criteria — a small app can be engineered properly without enterprise weight.

**Standards used**

- **ISO/IEC 25010** product-quality model: functional suitability, performance efficiency,
  compatibility, usability, reliability, security, maintainability, portability.
- **Production-readiness checklists** (Port/Cortex/Atlassian style): failure behaviour, data and
  recovery, observability, security, performance, release and rollback.
- **OWASP ASVS** for the authentication and access-control parts.
- **SemVer + Keep a Changelog**, and a definition of done that a reviewer can check without
  redoing the work.

**Verdict:** functionally complete. Engineering-wise **76 / 100** for this class of project —
well above a hobby build, short of a production service in four places: session identity, error
reporting, CI that actually runs, and the single-file front end.

## Checklist

Legend: ✅ done · 🟡 partial / acceptable for this project · ❌ missing

### 1. Requirements and scope
| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | Written scope and rules, shared with every agent | ✅ | `00_STUDIO_HUB` protocols, `QUIZ_BANK_PROTOCOL.md`, `QUALITY.md` |
| 1.2 | One source of truth per decision | ✅ | content portal + vault notes; session journal |
| 1.3 | Explicit non-goals | 🟡 | commercial concerns openly out of scope; not written as a list |

### 2. Architecture
| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | Clear layers (shell / content / identity) | ✅ | static app, Supabase content portal, `cloud.js` identity |
| 2.2 | Offline strategy designed, not accidental | ✅ | SW shell + cached manifest + bundled fallback |
| 2.3 | Modules with single responsibilities | 🟡 | `cloud/league/content/pwa` are separate; **`app.js` is ~4.6k lines** |
| 2.4 | Data contracts versioned | ✅ | schema v2 → v3, content version, fingerprints |

### 3. Code quality and maintainability
| # | Item | Status | Evidence |
|---|---|---|---|
| 3.1 | Naming and structure consistent | ✅ | one style across `js/` |
| 3.2 | No dead code left behind | ✅ | `tools/audit.py` dead-symbol check (0 now) |
| 3.3 | No silent failures on real paths | ✅ | empty catches audited; network swallows now logged |
| 3.4 | Static analysis in the gate | ✅ | `tools/audit.py` with a baseline |
| 3.5 | File sizes manageable | ❌ | `app.js` 176 KB / 4.6k lines — split by screen |

### 4. Testing
| # | Item | Status | Evidence |
|---|---|---|---|
| 4.1 | Automated behaviour suite | ✅ | 121 checks, 9 specs (`tests/run_all.py`) |
| 4.2 | Real-device verification | ✅ | tablet sweeps, offline sweep, cross-device sync (vault `tools/qa/`) |
| 4.3 | Runtime leak/zombie audit | ✅ | `tools/audit_runtime.js` (found and fixed two leaks) |
| 4.4 | Regression tests for fixed bugs | 🟡 | leave guard and sync are covered; the two timer leaks are audit-only |
| 4.5 | Coverage measured | ❌ | no coverage number; tests are scenario-level |
| 4.6 | Performance/load tested | ❌ | no Lighthouse or load run |

### 5. Security and privacy
| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1 | PIN stored salted and hashed | ✅ | `pin_salt` + SHA-256 (`extensions.digest`) |
| 5.2 | Service key never ships to the browser | ✅ | publishable key only; agent-side writes |
| 5.3 | Content read-only for anon | ✅ | `content_banks`/`content_meta` SELECT only |
| 5.4 | Profile and link tables not publicly readable | ✅ | policies dropped in this review (pin hashes were exposed before) |
| 5.5 | Server-verified session | ❌ | writes trust the client-supplied user id |
| 5.6 | Personal data protected per user | ❌ | `portal_data` open SELECT/INSERT/UPDATE for anon |
| 5.7 | Login rate limiting / lockout | ❌ | a 4-digit PIN with unlimited attempts |
| 5.8 | Security headers (CSP, etc.) | ❌ | only cache headers in `vercel.json` |
| 5.9 | Secrets out of git | ✅ | none committed; token in the local MCP store |

### 6. Data integrity and recovery
| # | Item | Status | Evidence |
|---|---|---|---|
| 6.1 | Multi-device sync cannot lose data | ✅ | merge (union/max), tombstones, server wins ties |
| 6.2 | Local backup / restore | ✅ | export JSON, restore with a validated file |
| 6.3 | Content versioning and rollback of content | ✅ | `content_meta` version, `hide/show`, retired banks |
| 6.4 | Server backup restore exercised | ❌ | relies on the Supabase plan; never rehearsed |

### 7. Reliability and offline
| # | Item | Status | Evidence |
|---|---|---|---|
| 7.1 | Works with no network | ✅ | offline sweep 13/13 on the tablet |
| 7.2 | Honest failure messages | ✅ | "needs internet" for league/sync/share |
| 7.3 | Updates reach a stale device | ✅ | `updateViaCache: none`, foreground check, `?v=` bypass |
| 7.4 | Service-worker update path tested | ✅ | first-visit reload covered by the tour test |

### 8. Usability and accessibility
| # | Item | Status | Evidence |
|---|---|---|---|
| 8.1 | RTL Arabic, mobile first | ✅ | design and tests |
| 8.2 | Labels, skip link, focus rings | ✅ | `test_a11y.py` |
| 8.3 | Empty and error states | ✅ | catalogue, stats, league, notifications |
| 8.4 | Contrast and tap-target audit | ❌ | not measured |
| 8.5 | Screen-reader pass on a device | ❌ | not done |

### 9. Observability and operations
| # | Item | Status | Evidence |
|---|---|---|---|
| 9.1 | On-device debug log | ✅ | `js/debug.js`, drawer log |
| 9.2 | Error reporting off-device | ❌ | none (no Sentry-like sink) |
| 9.3 | Uptime / health check | ❌ | none |
| 9.4 | Usage metrics | 🟡 | local counters only; no privacy-friendly aggregate |

### 10. CI/CD and release
| # | Item | Status | Evidence |
|---|---|---|---|
| 10.1 | One command gate | ✅ | `python tools/ci.py` (audit + 121 checks) |
| 10.2 | SemVer + changelog | ✅ | `VERSION`, `CHANGELOG.md`, `tools/release.py` (1.0.0 → 1.0.2 exercised) |
| 10.3 | CI on push/PR | 🟡 | workflow committed, **no git remote → never runs** |
| 10.4 | Rollback procedure | 🟡 | Vercel keeps deployments; not documented |
| 10.5 | Deploy automated after green | ❌ | manual `vercel --prod` |

### 11. Documentation
| # | Item | Status | Evidence |
|---|---|---|---|
| 11.1 | Quality gates documented | ✅ | `QUALITY.md` |
| 11.2 | Authoring and publishing documented | ✅ | vault protocols |
| 11.3 | Changelog | ✅ | `CHANGELOG.md` |
| 11.4 | Top-level README (run, deploy, arch) | ❌ | missing |
| 11.5 | Database schema/policy doc | 🟡 | RPCs described in `PORTAL_PUBLISH.md`; policies not documented |

### 12. Team process
| # | Item | Status | Evidence |
|---|---|---|---|
| 12.1 | Shared session journal | ✅ | `00_STUDIO_HUB/sessions/` |
| 12.2 | Harness registry and sign-in | ✅ | `HARNESS_REGISTRY.md` |
| 12.3 | Review discipline | 🟡 | agent self-review + audits; no second human reviewer |

## Score

Weights are tuned for a personal app shared with classmates (security and testing weigh more
than release automation), and they sum to 100.

| Area | Weight | Points | Why |
|---|---:|---:|---|
| Requirements and scope | 7 | 6.1 | clear protocols; non-goals implicit |
| Architecture | 9 | 6.3 | good layers; one huge file |
| Code quality | 9 | 6.8 | audited and readable; monolith cost |
| Testing | 15 | 12.0 | strong scenario suite + device/audits; no coverage or perf |
| Security and privacy | 13 | 7.6 | hashing and server-side keys good; identity and `portal_data` open |
| Data integrity | 9 | 7.2 | merge sync, tombstones, backup; no rehearsal |
| Reliability / offline | 8 | 8.0 | genuinely offline-first |
| Usability / a11y | 8 | 6.5 | solid basics; no contrast/tap/SR pass |
| Observability | 6 | 3.0 | local log only |
| CI/CD and release | 6 | 4.5 | gate and SemVer real; no remote, no auto-deploy |
| Documentation | 6 | 5.2 | excellent internal docs; no README/schema page |
| Process | 4 | 3.2 | strong for one developer |
| **Total** | **100** | **76.4** | **76 / 100** |

The missing 24 points are concentrated: **security identity (5.4)**, **observability (3.0)** and
**unmeasured testing (3.0)** account for about half of them.

## What would move it to ~90

| Fix | Area | Effort | Points |
|---|---|---|---|
| Push the repo to GitHub and let the committed workflow run | CI/CD | 20 min | +1.0 |
| Per-device sync token so `portal_data` is not open to anon | Security | 2–3 h | +2.5 |
| Login rate limit (attempts per handle/IP, exponential backoff) | Security | 1 h | +1.0 |
| CSP + `X-Content-Type-Options` + `Referrer-Policy` in `vercel.json` | Security | 30 min | +0.5 |
| Split `app.js` by screen (`quiz`, `catalog`, `account`, `stats`) | Architecture | 3–4 h | +1.5 |
| Error reporting (a tiny `/api/log` or a free sink) + uptime ping | Observability | 1–2 h | +1.5 |
| Contrast + tap-target pass, one screen-reader run on the tablet | a11y | 1 h | +1.0 |
| README + a schema/policy page | Docs | 1 h | +1.0 |
| Coverage number in CI (pytest-cov or c8 on the JS) | Testing | 1 h | +0.5 |

## Deliberately out of scope
Paying-user SLAs, on-call rotations, penetration testing, formal change management, HIPAA/GDPR
programmes, load guarantees beyond one class of students. The app is for friends; the checklist
above is the part that still pays off at that scale.
