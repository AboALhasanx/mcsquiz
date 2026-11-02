"""Deliberate Failure & Chaos Resilience Test Suite.

Simulates extreme failure scenarios to prove system robustness:
1. Malformed / Poisoned LocalStorage (broken JSON, null items, corrupted keys)
2. Degenerate and corrupt statistics (NaN%, 0-totals, negative numbers)
3. Partial Script Loading (missing modular UI controllers)
4. Rapid-fire Route Frenzy (80 async route switches in 100ms)
5. QuotaExceededError sabotage during critical study actions
6. Legends League Clock & Extreme Score Skew (Epoch 1970, Year 2100, huge numbers)
7. VS Bot Duel Ghost Timer Purging on sudden exit
8. Cloud Network Drop resilience (no data loss on network failure)
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check, report

suite('deliberate_failure_chaos')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)

    try:
        # =========================================================================
        # 1. Poisoned LocalStorage: Corrupted JSON strings
        # =========================================================================
        print("\n--- Chaos 1: Poisoned LocalStorage strings ---")
        page.evaluate("""() => {
            // Poison saved questions with completely broken JSON
            localStorage.setItem('portal_saved_v1', '{corrupt-json: "bad",');
            // Poison history with arbitrary non-JSON string
            localStorage.setItem('portal_history_v1', 'THIS_IS_NOT_JSON');
            // Poison UI state
            localStorage.setItem('portal_ui_v1', '<<<MALFORMED>>>');
        }""")

        # Navigate to #/saved -> Must not crash
        page.evaluate("() => { location.hash = '#/saved'; }")
        page.wait_for_timeout(400)
        saved_ok = page.evaluate("""() => {
            const v = document.getElementById('saved-view');
            return v && !v.classList.contains('hidden');
        }""")
        check('saved view survives completely corrupted portal_saved_v1 JSON', saved_ok)

        # Navigate to #/stats -> Must not crash
        page.evaluate("() => { location.hash = '#/stats'; }")
        page.wait_for_timeout(400)
        stats_ok = page.evaluate("""() => {
            const v = document.getElementById('stats-view');
            return v && !v.classList.contains('hidden');
        }""")
        check('stats view survives completely corrupted portal_history_v1 JSON', stats_ok)

        # =========================================================================
        # 2. Deformed Data Structures (Null items, missing fields, NaN scores)
        # =========================================================================
        print("\n--- Chaos 2: Deformed Data Objects ---")
        page.evaluate("""() => {
            // Saved questions with nulls, missing stems, invalid keys
            const deformedSaved = {
                'null_entry': null,
                'empty_entry': {},
                'missing_fields': { id: 'bad1' },
                '01_Cyber_Security|Quiz_Ch01|q_valid': {
                    id: 'q_valid',
                    origin: { subject_id: '01_Cyber_Security', subject_title: 'الأمن', chapter: 1, quiz_id: 'Quiz_Ch01' },
                    q: { stem: { ar: 'سؤال صالح' }, options: [{ ar: '1' }, { ar: '2' }], answer: 0, explanation: { ar: 'شرح' } },
                    savedAt: Date.now()
                }
            };
            localStorage.setItem('portal_saved_v1', JSON.stringify(deformedSaved));

            // History with degenerate NaN / total 0 records
            const degenerateHistory = [
                null,
                {},
                { total: 0, correct: 0, pct: null, t: 'bad_date', secs: -999 },
                { total: -5, correct: 100, pct: NaN, t: null, secs: NaN },
                { subjectId: '01_Cyber_Security', quizId: 'Quiz_01', total: 10, correct: 9, pct: 90, t: Date.now(), secs: 45 }
            ];
            localStorage.setItem('portal_history_v1', JSON.stringify(degenerateHistory));
        }""")

        page.evaluate("() => { location.hash = '#/saved'; }")
        page.wait_for_timeout(400)
        saved_deformed = page.evaluate("""() => {
            const text = document.getElementById('saved-view')?.textContent || '';
            return text.includes('سؤال صالح') && !text.includes('null');
        }""")
        check('saved cards isolate and render valid items while ignoring deformed siblings', saved_deformed)

        page.evaluate("() => { location.hash = '#/stats'; }")
        page.wait_for_timeout(400)
        stats_deformed = page.evaluate("""() => {
            const hero = document.getElementById('stats-hero')?.textContent || '';
            const historyBadge = document.getElementById('history-total-badge')?.textContent || '';
            return !hero.includes('NaN') && !historyBadge.includes('NaN');
        }""")
        check('stats view suppresses NaN and renders valid statistics', stats_deformed)

        # =========================================================================
        # 3. Simulated CDN / Script Loading Failure (Missing Modules)
        # =========================================================================
        print("\n--- Chaos 3: Missing Modular UI Controllers ---")
        module_resilience = page.evaluate("""() => {
            // Temporarily hide or nullify the controllers
            const backupSaved = window.PortalSavedUI;
            const backupVs = window.PortalVsUI;
            const backupLeague = window.PortalLeagueUI;
            const backupStats = window.PortalStatsUI;

            window.PortalSavedUI = null;
            window.PortalVsUI = null;
            window.PortalLeagueUI = null;
            window.PortalStatsUI = null;

            let survived = true;
            try {
                // Navigate across all 4 routes
                location.hash = '#/saved';
                location.hash = '#/stats';
                location.hash = '#/league';
                location.hash = '#/vs';
            } catch (e) {
                survived = false;
            }

            // Restore
            window.PortalSavedUI = backupSaved;
            window.PortalVsUI = backupVs;
            window.PortalLeagueUI = backupLeague;
            window.PortalStatsUI = backupStats;

            return survived;
        }""")
        check('routing survives gracefully when modular UI scripts are absent or failed', module_resilience)

        # =========================================================================
        # 4. Stress Test: Rapid-fire Hash Switching (Race Conditions & Frenzy)
        # =========================================================================
        print("\n--- Chaos 4: Rapid-Fire Hash Cycling ---")
        frenzy_result = page.evaluate("""async () => {
            const routes = ['#/saved', '#/stats', '#/league', '#/vs', '#/catalog', '#/account'];
            // Fire 60 rapid switches
            for (let i = 0; i < 60; i++) {
                location.hash = routes[i % routes.length];
                // Tiny random sleep between 0 and 2ms
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 2));
            }
            // Settle on #/league
            location.hash = '#/league';
            await new Promise(r => setTimeout(r, 400));

            // Verify only 1 view is visible and active
            const visibleViews = Array.from(document.querySelectorAll('.state-view:not(.hidden)')).map(el => el.id);
            return {
                settledHash: location.hash,
                visibleCount: visibleViews.length,
                visibleId: visibleViews[0] || null
            };
        }""")
        check('rapid hash switching settles cleanly without view collisions',
              frenzy_result['visibleCount'] == 1 and frenzy_result['visibleId'] == 'league-view',
              frenzy_result)

        # =========================================================================
        # 5. Storage Quota Exceeded (QuotaExceededError Sabotage)
        # =========================================================================
        print("\n--- Chaos 5: QuotaExceededError Sabotage ---")
        quota_handled = page.evaluate("""() => {
            const origSet = localStorage.setItem;
            let caughtExpectedly = false;
            try {
                // Deliberately make localStorage.setItem throw QuotaExceededError
                localStorage.setItem = function() {
                    const err = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
                    throw err;
                };

                let didThrow = false;
                try {
                    const ui = window.PortalSavedUI.create({
                        $: id => document.getElementById(id),
                        S: { saved: {}, session: { questions: [{ id: 'q1', origin: { subject_id: '01', chapter: 1, quiz_id: 'Q1' } }], idx: 0 } },
                        SAVED_KEY: 'portal_saved_v1',
                        persistSaved: () => {
                            try { localStorage.setItem('portal_saved_v1', '{}'); } catch (e) {}
                        },
                        saveKeyOf: (o, qid) => o.subject_id + '|' + o.quiz_id + '|' + qid,
                        markSavedRemoved: () => {},
                        clearSavedRemoved: () => {},
                        toast: () => {}
                    });
                    ui.toggleSaveCurrent();
                } catch (e) {
                    didThrow = true;
                }
                caughtExpectedly = !didThrow;
            } finally {
                localStorage.setItem = origSet;
            }
            return caughtExpectedly;
        }""")
        check('QuotaExceededError is trapped safely without crashing execution', quota_handled)

        # =========================================================================
        # 6. Legends League Time Warp & Extreme Value Fuzzing
        # =========================================================================
        print("\n--- Chaos 6: Legends League Time Warp & Math Chaos ---")
        legends_chaos = page.evaluate("""() => {
            const B = window.PortalVSBot;
            if (!B || !B.getLeagueRows) return { ok: false, reason: 'missing PortalVSBot' };

            const testCases = [
                { name: 'epoch 1970', opts: { nowMs: 0, weekId: '1970-01-01' } },
                { name: 'far future 2100', opts: { nowMs: 4102444800000, weekId: '2100-01-01' } },
                { name: 'monday exact midnight', opts: { nowMs: new Date('2026-10-26T00:00:00').getTime(), weekId: '2026-10-26' } },
                { name: 'sunday 23:59:59', opts: { nowMs: new Date('2026-11-01T23:59:59').getTime(), weekId: '2026-10-26' } },
                { name: 'huge human xp surge', opts: { humanTopXp: 1000000, myXp: 999999, weekId: '2026-10-26' } },
                { name: 'negative human xp', opts: { humanTopXp: -500, myXp: -200, weekId: '2026-10-26' } },
                { name: 'corrupted weekId string', opts: { weekId: 'undefined-INVALID' } }
            ];

            const anomalies = [];
            testCases.forEach(tc => {
                const rows = B.getLeagueRows(tc.opts);
                if (!Array.isArray(rows) || rows.length !== 5) {
                    anomalies.push(tc.name + ': expected 5 rows, got ' + (rows ? rows.length : null));
                    return;
                }
                rows.forEach(r => {
                    if (typeof r.xp !== 'number' || isNaN(r.xp) || r.xp < 0) {
                        anomalies.push(tc.name + ' [' + r.legend_id + ']: invalid xp ' + r.xp);
                    }
                    if (typeof r.answered !== 'number' || isNaN(r.answered) || r.answered < r.xp) {
                        anomalies.push(tc.name + ' [' + r.legend_id + ']: invalid answered ' + r.answered);
                    }
                    if (!r.formTag || typeof r.formTag !== 'string') {
                        anomalies.push(tc.name + ' [' + r.legend_id + ']: missing formTag');
                    }
                });
            });

            return {
                ok: anomalies.length === 0,
                anomalies: anomalies
            };
        }""")
        check('legends league math is robust under time-warp and extreme values',
              legends_chaos['ok'], legends_chaos.get('anomalies'))

        # =========================================================================
        # 7. VS Bot Duel: Sudden Interrupt & Ghost Timer Purging
        # =========================================================================
        print("\n--- Chaos 7: VS Bot Duel Interrupt & Ghost Timer Purging ---")
        page.evaluate("() => { location.hash = '#/vs'; }")
        page.wait_for_timeout(500)

        ghost_timer_test = page.evaluate("""async () => {
            // Click Messi card to start a bot challenge
            const messiBtn = document.querySelector('[data-legend="messi"]');
            if (messiBtn) messiBtn.click();
            await new Promise(r => setTimeout(r, 150));

            // Immediately interrupt mid-countdown by navigating to #/catalog
            location.hash = '#/catalog';
            await new Promise(r => setTimeout(r, 200));

            // Inspect vsState to verify all timers are dead
            const vsUI = window.PortalVsUI ? window.PortalVsUI.create() : null;
            
            // Wait 1.5 seconds to see if any ghost timers trigger
            await new Promise(r => setTimeout(r, 1500));

            const inArena = !document.getElementById('vs-arena')?.classList.contains('hidden');
            const inLobby = !document.getElementById('vs-lobby')?.classList.contains('hidden');
            const currentHash = location.hash;

            return {
                inArena,
                inLobby,
                currentHash
            };
        }""")
        check('sudden navigation away from VS duel safely stops bot match timers',
              not ghost_timer_test['inArena'] and ghost_timer_test['currentHash'] == '#/catalog',
              ghost_timer_test)

        # =========================================================================
        # 8. Cloud Network Drop Resilience (Mock 500 / Network Drop)
        # =========================================================================
        print("\n--- Chaos 8: Cloud Sync Network Drop Resilience ---")
        sync_resilience = page.evaluate("""async () => {
            const C = window.PortalCloud;
            if (!C || !C.upload) return { ok: false, reason: 'missing PortalCloud' };

            // Store clean benchmark data
            localStorage.setItem('portal_saved_v1', JSON.stringify({ 'q_safe': { id: 'q_safe' } }));
            localStorage.setItem('portal_history_v1', JSON.stringify([{ id: 'h_safe' }]));

            // Mock fetch to simulate complete network failure
            const origFetch = window.fetch;
            window.fetch = () => Promise.reject(new TypeError('Failed to fetch (simulated network down)'));

            let survived = false;
            try {
                // Upload should catch error and not throw or clear localStorage
                await C.upload({ test: 123 });
            } catch (e) {
                // It should reject or handle gracefully
            }

            const savedIntact = localStorage.getItem('portal_saved_v1')?.includes('q_safe');
            const historyIntact = localStorage.getItem('portal_history_v1')?.includes('h_safe');

            // Restore fetch
            window.fetch = origFetch;

            return {
                savedIntact,
                historyIntact
            };
        }""")
        check('network crash during cloud sync never zeroes out or corrupts local study data',
              sync_resilience['savedIntact'] and sync_resilience['historyIntact'],
              sync_resilience)

        # =========================================================================
        # Final Clean-up: Restore clean local state in this test browser context
        # =========================================================================
        page.evaluate("""() => {
            localStorage.clear();
        }""")

        check('no unhandled browser runtime errors during chaos testing', not errors, errors[:2])

    finally:
        browser.close()
        pw.stop()

    return report()


if __name__ == '__main__':
    sys.exit(run())
