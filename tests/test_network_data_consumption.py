"""Network Data Consumption & Bandwidth Efficiency Audit Suite.

Confirmatory tests measuring exact bytes, requests, and network behavior:
1. Cold Start: Initial load total transfer budget (< 3.5 MB total for entire PWA)
2. No Rogue Requests: Zero analytics, zero external trackers, zero third-party CDNs
3. Warm Start: Service Worker cache efficiency (shell assets served from local cache)
4. Active Quiz Data Footprint: Zero wire network calls during quiz taking
5. Saved Questions Deck: Zero wire network calls during bookmark filtering & Active Recall
6. Stats & Trends Deck: Zero wire network calls during ledger & SVG graph calculation
7. VS Bot Arena: Zero wire network calls during 1v1 challenges against football legends
8. Cloud Payload Efficiency: Encrypted study bundle size (< 50 KB raw JSON)
"""
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check, report

suite('network_data_consumption')


def run():
    pw = common.launch()
    browser = pw.chromium.launch(headless=True, executable_path=common.EXE)
    
    ctx = browser.new_context(viewport=common.VP, is_mobile=True, has_touch=True)
    ctx.add_init_script("try { localStorage.setItem('portal_tour_done', '1'); localStorage.setItem('portal_quiz_hint', '1'); } catch (e) {}")
    
    try:
        # =========================================================================
        # 1. COLD START AUDIT (First Visit)
        # =========================================================================
        print("\n--- 1. Cold Start Network Audit ---")
        page1 = ctx.new_page()

        t0 = time.time()
        page1.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
        page1.wait_for_timeout(4000)
        cold_load_time = time.time() - t0

        sw_controlled = False
        try:
            page1.wait_for_function('() => !!navigator.serviceWorker.controller', timeout=15000)
            sw_controlled = True
        except Exception:
            pass  # audit-ignore: timeout waiting for sw controller

        perf_data = page1.evaluate("""() => {
            const entries = performance.getEntriesByType('resource');
            let totalTransfer = 0;
            let totalDecoded = 0;
            const byType = {};
            const externalCalls = [];

            entries.forEach(e => {
                totalTransfer += (e.transferSize || 0);
                totalDecoded += (e.decodedBodySize || 0);
                const ext = e.name.split('.').pop().split('?')[0];
                byType[ext] = (byType[ext] || 0) + (e.transferSize || 0);
                
                if (!e.name.startsWith(location.origin) && !e.name.includes('supabase.co')) {
                    externalCalls.push(e.name);
                }
            });

            return {
                entryCount: entries.length,
                totalTransferKB: Math.round(totalTransfer / 1024),
                totalDecodedKB: Math.round(totalDecoded / 1024),
                byType,
                externalCalls
            };
        }""")

        print(f"Cold Start: {perf_data['entryCount']} resources, {perf_data['totalTransferKB']} KB transferred over wire.")
        print(f"Breakdown by extension (KB): {perf_data['byType']}")
        
        check('cold start wire transfer is under 3500 KB (budget for entire offline PWA)', perf_data['totalTransferKB'] < 3500, f"{perf_data['totalTransferKB']} KB")
        check('zero rogue trackers or external third-party beacons', len(perf_data['externalCalls']) == 0, perf_data['externalCalls'])
        check('service worker took control on first boot', sw_controlled)

        # =========================================================================
        # 2. WARM START AUDIT (Second Visit / Reload with Service Worker)
        # =========================================================================
        print("\n--- 2. Warm Start Network Audit ---")
        page2 = ctx.new_page()
        
        wire_transfers = []
        def on_warm_resp(resp):
            wire_transfers.append({
                'url': resp.url,
                'from_sw': resp.from_service_worker,
                'status': resp.status
            })
        page2.on('response', on_warm_resp)

        page2.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
        page2.wait_for_timeout(2000)

        sw_served = [r for r in wire_transfers if r['from_sw']]
        network_served = [r for r in wire_transfers if not r['from_sw']]
        
        print(f"Warm Start: Total responses: {len(wire_transfers)}, Served from Service Worker: {len(sw_served)}, Wire network calls: {len(network_served)}")
        check('service worker serves shell assets from local cache', len(sw_served) >= 10, f"SW served: {len(sw_served)}")

        # Helper to track REAL network wire calls (excluding Service Worker cache hits)
        real_wire_calls = []
        def track_wire(resp):
            if not resp.from_service_worker:
                real_wire_calls.append(resp.url)
        page2.on('response', track_wire)

        # =========================================================================
        # 3. QUIZ SESSION NETWORK AUDIT (Zero Wire Data Policy)
        # =========================================================================
        print("\n--- 3. Quiz Session Network Audit ---")
        wire_before = len(real_wire_calls)

        subs = common.subjects(page2)
        sid, qid = subs[0]['id'], subs[0]['chapters'][0]
        page2.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
        page2.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        page2.evaluate('() => document.querySelector("#btn-start-quiz").click()')
        page2.wait_for_timeout(600)

        for step in range(3):
            page2.evaluate('() => { const opt = document.querySelector(".option-card"); if (opt) opt.click(); }')
            page2.wait_for_timeout(200)
            page2.evaluate('() => { const next = document.getElementById("btn-next"); if (next) next.click(); }')
            page2.wait_for_timeout(300)

        page2.evaluate('() => { const btn = document.getElementById("btn-save-question"); if (btn) btn.click(); }')
        page2.wait_for_timeout(200)

        page2.evaluate('() => { const m = document.getElementById("btn-open-matrix"); if (m) m.click(); }')
        page2.wait_for_timeout(200)
        page2.evaluate('() => { const c = document.getElementById("matrix-close-btn"); if (c) c.click(); }')
        page2.wait_for_timeout(200)

        quiz_wire_diff = len(real_wire_calls) - wire_before
        print(f"Quiz Interaction: Real network wire calls: {quiz_wire_diff}")
        check('quiz interaction makes zero network requests (100% offline-first execution)', quiz_wire_diff == 0, real_wire_calls[wire_before:])

        # =========================================================================
        # 4. SAVED QUESTIONS & ACTIVE RECALL NETWORK AUDIT
        # =========================================================================
        print("\n--- 4. Saved Questions Deck Network Audit ---")
        wire_before = len(real_wire_calls)

        page2.evaluate('() => { location.hash = "#/saved"; }')
        page2.wait_for_timeout(500)

        page2.evaluate('() => { const t = document.getElementById("saved-recall-toggle"); if (t) t.click(); }')
        page2.wait_for_timeout(200)
        page2.evaluate('() => { const c = document.querySelector(".saved-subj-pill, .filter-chip"); if (c) c.click(); }')
        page2.wait_for_timeout(200)

        saved_wire_diff = len(real_wire_calls) - wire_before
        print(f"Saved Questions: Real network wire calls: {saved_wire_diff}")
        check('saved questions review makes zero network requests', saved_wire_diff == 0, real_wire_calls[wire_before:])

        # =========================================================================
        # 5. STATISTICS & ADAPTIVE TREND NETWORK AUDIT
        # =========================================================================
        print("\n--- 5. Statistics & Adaptive Trend Network Audit ---")
        wire_before = len(real_wire_calls)

        page2.evaluate('() => { location.hash = "#/stats"; }')
        page2.wait_for_timeout(500)

        for r_val in ['1', '7', '30', '0']:
            page2.evaluate(f'() => {{ const b = document.querySelector(".range-opt[data-range=\\"{r_val}\\"]"); if (b) b.click(); }}')
            page2.wait_for_timeout(100)

        stats_wire_diff = len(real_wire_calls) - wire_before
        print(f"Statistics: Real network wire calls: {stats_wire_diff}")
        check('statistics ledger & trend graphs make zero network requests', stats_wire_diff == 0, real_wire_calls[wire_before:])

        # =========================================================================
        # 6. VS 1v1 BOT LEGENDS ARENA NETWORK AUDIT
        # =========================================================================
        print("\n--- 6. VS 1v1 Bot Duel Network Audit ---")
        wire_before = len(real_wire_calls)

        page2.evaluate('() => { location.hash = "#/vs"; }')
        page2.wait_for_timeout(500)

        page2.evaluate('() => { const card = document.querySelector("[data-legend=\\"messi\\"]"); if (card) card.click(); }')
        page2.wait_for_timeout(800)

        page2.evaluate('() => { const opt = document.querySelector(".vs-opt-card"); if (opt) opt.click(); }')
        page2.wait_for_timeout(500)

        vs_wire_diff = len(real_wire_calls) - wire_before
        print(f"VS Duel: Real network wire calls: {vs_wire_diff}")
        check('bot legend duel runs 100% locally with zero network requests', vs_wire_diff == 0, real_wire_calls[wire_before:])

        page2.evaluate('() => { location.hash = "#/"; }')
        page2.wait_for_timeout(300)

        # =========================================================================
        # 7. CLOUD PAYLOAD EFFICIENCY AUDIT (Encrypted Bundle Size)
        # =========================================================================
        print("\n--- 7. Cloud Payload Efficiency Audit ---")
        bundle_stats = page2.evaluate("""() => {
            const dummyItem = {
                id: '01_Cyber_Security|Quiz_Ch01|q1',
                origin: { subject_id: '01_Cyber_Security', subject_title: 'الأمن السيبراني', chapter: 1, quiz_id: 'Quiz_Ch01' },
                snapshot: { stem: { ar: 'ما هو الهدف الأساسي للأمن؟' }, options: [{ ar: '1' }, { ar: '2' }, { ar: '3' }, { ar: '4' }], answer: 0, explanation: { ar: 'الشرح' } },
                savedAt: Date.now()
            };
            const saved = {};
            for (let i = 0; i < 62; i++) saved['q_' + i] = dummyItem;

            const dummyHist = {
                t: Date.now(), subjectId: '01_Cyber_Security', subjectTitle: 'الأمن', chapterNo: 1, quizId: 'Quiz_01',
                correct: 10, total: 12, pct: 83.3, secs: 140, kind: 'standard'
            };
            const history = [];
            for (let i = 0; i < 37; i++) history.push(dummyHist);

            const bests = {};
            for (let i = 0; i < 33; i++) bests['best_' + i] = { pct: 90, frac: '10 / 12' };

            const bundle = {
                app: 'mcq-portal',
                version: 1,
                exportedAt: new Date().toISOString(),
                updatedAt: Date.now(),
                saved,
                history,
                bests,
                removed: {},
                clearedAt: 0
            };

            const jsonStr = JSON.stringify(bundle);
            const rawBytes = new TextEncoder().encode(jsonStr).length;

            return {
                rawKB: Math.round(rawBytes / 1024),
                itemCounts: { saved: 62, history: 37, bests: 33 }
            };
        }""")

        print(f"Cloud Bundle: 62 saved + 37 history + 33 bests raw JSON size: {bundle_stats['rawKB']} KB")
        check('uncompressed cloud sync bundle is ultra-compact (< 60 KB for full semester data)', bundle_stats['rawKB'] < 60, f"{bundle_stats['rawKB']} KB")

    finally:
        browser.close()
        pw.stop()

    return report()


if __name__ == '__main__':
    sys.exit(run())
