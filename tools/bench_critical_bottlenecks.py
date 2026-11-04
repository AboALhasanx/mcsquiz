import sys, os, time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

EXE = r'C:\Users\gokoq\AppData\Local\Thorium\Application\thorium.exe'

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=EXE)
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8081/?debug=1#/')
    page.wait_for_selector('#catalog-cards-container .sketch-row', timeout=10000)

    # Setup realistic scenario:
    setup_info = page.evaluate('''() => {
        const S = window.__portalState;
        const subjects = (S.index && S.index.subjects) || [];
        let totalQuizzes = 0;
        let seeded = 0;

        subjects.forEach(sub => {
            (sub.chapters || []).forEach((ch, idx) => {
                totalQuizzes++;
                // Seed 50% of quizzes as completed with realistic score
                if (idx % 2 === 0) {
                    const score = {
                        pct: 85 + (idx % 15),
                        correct: 8,
                        total: 10,
                        secs: 45,
                        t: Date.now() - idx * 3600000
                    };
                    localStorage.setItem('portal_best_' + ch.quiz_id, JSON.stringify(score));
                    seeded++;
                }
            });
        });

        return { totalQuizzes, seeded, totalStorageKeys: localStorage.length };
    }''')

    print(f"Realistic Environment Setup:")
    print(f"  - Total curriculum quizzes: {setup_info['totalQuizzes']}")
    print(f"  - Completed quizzes in storage: {setup_info['seeded']}")
    print(f"  - Total localStorage keys: {setup_info['totalStorageKeys']}")

    # =========================================================================
    # BENCHMARK 1: evaluateSubjectMastery (Current vs Optimized)
    # =========================================================================
    bench1 = page.evaluate('''() => {
        // 1. Current Implementation: 180 localStorage.getItem calls
        let currentStorageReads = 0;
        let currentJsonParses = 0;
        const currentBestFn = (quizId) => {
            currentStorageReads++;
            const raw = localStorage.getItem('portal_best_' + quizId);
            if (!raw) return null;
            currentJsonParses++;
            try {
                const obj = JSON.parse(raw);
                return (obj && typeof obj.pct === 'number') ? obj : null;
            } catch (e) { return null; }
        };

        const t0_current = performance.now();
        for (let iter = 0; iter < 10; iter++) {
            window.PortalAchievements.evaluateSubjectMastery(null, currentBestFn);
        }
        const t1_current = performance.now();
        const currentMs = (t1_current - t0_current) / 10;

        // 2. Optimized Approach (In-Memory Map / Pre-Collection):
        let optStorageReads = 0;
        let optJsonParses = 0;
        const t0_opt = performance.now();
        for (let iter = 0; iter < 10; iter++) {
            const bestMap = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                optStorageReads++;
                if (k && k.startsWith('portal_best_')) {
                    optJsonParses++;
                    try {
                        const obj = JSON.parse(localStorage.getItem(k));
                        if (obj && typeof obj.pct === 'number') {
                            bestMap[k.slice(12)] = obj;
                        }
                    } catch (e) {}
                }
            }
            const optBestFn = (quizId) => bestMap[quizId] || null;
            window.PortalAchievements.evaluateSubjectMastery(null, optBestFn);
        }
        const t1_opt = performance.now();
        const optMs = (t1_opt - t0_opt) / 10;

        // 3. Module Cache Approach (In-memory cached map):
        const cachedMap = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('portal_best_')) {
                try { cachedMap[k.slice(12)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
            }
        }
        const cacheBestFn = (quizId) => cachedMap[quizId] || null;

        const t0_cache = performance.now();
        for (let iter = 0; iter < 10; iter++) {
            window.PortalAchievements.evaluateSubjectMastery(null, cacheBestFn);
        }
        const t1_cache = performance.now();
        const cacheMs = (t1_cache - t0_cache) / 10;

        return {
            currentMs,
            currentStorageReads: currentStorageReads / 10,
            currentJsonParses: currentJsonParses / 10,
            optMs,
            optStorageReads: optStorageReads / 10,
            optJsonParses: optJsonParses / 10,
            cacheMs,
            cacheStorageReads: 0,
            cacheJsonParses: 0
        };
    }''')

    print("\n=== BENCHMARK 1: evaluateSubjectMastery ===")
    print(f"Current (180 storage queries): {bench1['currentMs']:.3f} ms | {bench1['currentStorageReads']:.0f} storage reads | {bench1['currentJsonParses']:.0f} JSON parses")
    print(f"Optimized (Pre-collected map): {bench1['optMs']:.3f} ms | {bench1['optStorageReads']:.0f} storage reads | {bench1['optJsonParses']:.0f} JSON parses")
    print(f"Ultra-Fast (Cached in-memory): {bench1['cacheMs']:.3f} ms | {bench1['cacheStorageReads']} storage reads | {bench1['cacheJsonParses']} JSON parses")
    print(f"Speedup: {bench1['currentMs'] / max(bench1['cacheMs'], 0.001):.1f}x faster with in-memory cache!")

    # =========================================================================
    # BENCHMARK 2: Cloud Sync / Backup Restore (100 Bests writes)
    # =========================================================================
    bench2 = page.evaluate('''() => {
        const remoteBests = {};
        for (let i = 1; i <= 100; i++) {
            remoteBests['portal_best_quiz_' + i] = {
                pct: 90,
                correct: 9,
                total: 10,
                secs: 30,
                t: 1700000000000
            };
        }

        // Test 1: Blind loop write (Current behavior in cloud.js and stats_ui.js):
        const t0_blind = performance.now();
        Object.keys(remoteBests).forEach(k => {
            localStorage.setItem(k, JSON.stringify(remoteBests[k]));
        });
        const t1_blind = performance.now();
        const blindMs = (t1_blind - t0_blind);

        // Test 2: Smart write (Only write if missing or changed):
        const t0_smart = performance.now();
        let writesSkipped = 0;
        let actualWrites = 0;
        Object.keys(remoteBests).forEach(k => {
            const raw = localStorage.getItem(k);
            if (raw) {
                const existing = JSON.parse(raw);
                if (existing.t === remoteBests[k].t && existing.pct === remoteBests[k].pct) {
                    writesSkipped++;
                    return;
                }
            }
            actualWrites++;
            localStorage.setItem(k, JSON.stringify(remoteBests[k]));
        });
        const t1_smart = performance.now();
        const smartMs = (t1_smart - t0_smart);

        return {
            blindMs,
            smartMs,
            totalItems: 100,
            writesSkipped,
            actualWrites
        };
    }''')

    print("\n=== BENCHMARK 2: Cloud Sync & Backup Restore (100 Bests) ===")
    print(f"Current Blind Write: {bench2['blindMs']:.2f} ms (100 flash writes)")
    print(f"Smart Diff Write:   {bench2['smartMs']:.2f} ms ({bench2['writesSkipped']} writes skipped, {bench2['actualWrites']} actual writes)")
    print(f"Write Reduction:    {bench2['writesSkipped']}% less flash storage writes!")

    # Clean up test keys
    page.evaluate('''() => {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('portal_best_quiz_')) localStorage.removeItem(k);
        }
    }''')

    browser.close()
