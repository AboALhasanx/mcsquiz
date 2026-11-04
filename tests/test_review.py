# tests/test_review.py
# Phase 1: Spaced Repetition (Leitner) review store, weak items, study days, and session isolation.
# Written RED-first: fails before js/review.js exists, passes after implementation.
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import check


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        ev = page.evaluate

        # 1. Module presence
        has_module = ev("() => Boolean(window.PortalReview)")
        check("PortalReview module is registered on window", has_module)
        if not has_module:
            return

        # 2. Content hash (FNV-1a 32-bit / hex)
        h1 = ev("() => PortalReview.contentHash('ما هو جدار الحماية؟', 'برنامج أمني')")
        h2 = ev("() => PortalReview.contentHash('ما هو جدار الحماية؟', 'برنامج أمني')")
        h3 = ev("() => PortalReview.contentHash('ما هو الفيروس؟', 'برنامج ضار')")
        check("contentHash is deterministic", h1 == h2 and len(h1) > 0)
        check("contentHash differentiates distinct questions", h1 != h3)

        # 3. Deterministic day representation
        today = ev("() => PortalReview.today()")
        check("today() returns a positive integer", isinstance(today, int) and today > 19000)

        # 4. Leitner scheduling algorithm
        # 4a. Wrong answer always goes to Box 0, due tomorrow (today + 1)
        res_wrong = ev("""(today) => {
            const rec = { b: 3, d: today, n: 5, w: 1, u: 1000, h: 'abc' };
            return PortalReview.schedule(rec, false, today);
        }""", today)
        check("wrong answer demotes to box 0 and due tomorrow",
              res_wrong['b'] == 0 and res_wrong['d'] == today + 1 and res_wrong['w'] == 2 and res_wrong['n'] == 6)

        # 4b. Correct answer on a DUE item promotes by 1 box and schedules interval
        # Intervals: [1, 3, 7, 14, 30, 90]
        res_due_correct = ev("""(today) => {
            const rec = { b: 0, d: today, n: 1, w: 1, u: 1000, h: 'abc' };
            return PortalReview.schedule(rec, true, today);
        }""", today)
        check("correct on due item promotes box 0 -> 1 with interval 3 days",
              res_due_correct['b'] == 1 and res_due_correct['d'] == today + 3 and res_due_correct['n'] == 2)

        # 4c. Anti-exploitation: Correct answer on NON-DUE item does NOT promote
        res_not_due = ev("""(today) => {
            const rec = { b: 1, d: today + 5, n: 2, w: 0, u: 1000, h: 'abc' };
            return PortalReview.schedule(rec, true, today);
        }""", today)
        check("correct on non-due item does not promote box",
              res_not_due['b'] == 1 and res_not_due['d'] == today + 5 and res_not_due['n'] == 3)

        # 4d. Max box boundary (box 5 stays at box 5, interval 90 days)
        res_max_box = ev("""(today) => {
            const rec = { b: 5, d: today, n: 10, w: 0, u: 1000, h: 'abc' };
            return PortalReview.schedule(rec, true, today);
        }""", today)
        check("max box 5 remains capped at 5 and schedules 90 days",
          res_max_box['b'] == 5 and res_max_box['d'] == today + 90 and res_max_box['n'] == 11)

        # 4e. Guard against future date tampering (max +120 days)
        res_tamper = ev("""(today) => {
            const rec = { b: 5, d: today, n: 10, w: 0, u: 1000, h: 'abc' };
            return PortalReview.schedule(rec, true, today + 500);
        }""", today)
        check("future clock drift is clamped within 120 days",
              res_tamper['d'] <= (today + 500) + 120)

        # 5. Orphan detection on content change
        is_orphan_match = ev("() => PortalReview.isOrphan({ h: 'h_old' }, 'h_old')")
        is_orphan_mismatch = ev("() => PortalReview.isOrphan({ h: 'h_old' }, 'h_new')")
        check("isOrphan detects matching content hash", is_orphan_match is False)
        check("isOrphan detects modified question content", is_orphan_mismatch is True)

        # 6. Weak items query (sorted by error ratio w/n, w >= 1)
        weak_items = ev("""() => {
            const store = {
                'b1:q1': { b: 0, d: 20000, n: 10, w: 8, u: 1, h: 'h1' }, // 80% wrong
                'b1:q2': { b: 2, d: 20000, n: 10, w: 2, u: 2, h: 'h2' }, // 20% wrong
                'b1:q3': { b: 4, d: 20000, n: 5,  w: 0, u: 3, h: 'h3' }, // 0% wrong (excluded)
                'b1:q4': { b: 0, d: 20000, n: 2,  w: 2, u: 4, h: 'h4' }  // 100% wrong
            };
            return PortalReview.getWeakKeys(store);
        }""")
        check("getWeakKeys returns keys sorted by error ratio descending (only w >= 1)",
              weak_items == ['b1:q4', 'b1:q1', 'b1:q2'])

        # 7. Due items query
        due_items = ev("""(today) => {
            const store = {
                'b1:q1': { b: 0, d: today - 1, n: 1, w: 1, u: 1, h: 'h1' }, // overdue
                'b1:q2': { b: 1, d: today,     n: 1, w: 0, u: 2, h: 'h2' }, // due today
                'b1:q3': { b: 2, d: today + 1, n: 1, w: 0, u: 3, h: 'h3' }  // due tomorrow (not due)
            };
            return PortalReview.getDueKeys(store, today);
        }""", today)
        check("getDueKeys returns all items due on or before today",
              set(due_items) == {'b1:q1', 'b1:q2'})

        # 8. Merge properties (Algebraic invariants)
        # Commutative: merge(A, B) == merge(B, A)
        # Idempotent: merge(A, A) == A
        merge_tests = ev("""() => {
            const a = {
                'k1': { b: 1, d: 20000, n: 3, w: 1, u: 200, h: 'h1' },
                'k2': { b: 0, d: 20001, n: 1, w: 1, u: 100, h: 'h2' }
            };
            const b = {
                'k1': { b: 2, d: 20005, n: 4, w: 1, u: 300, h: 'h1' }, // newer u wins
                'k3': { b: 0, d: 20002, n: 1, w: 1, u: 150, h: 'h3' }
            };
            const ab = PortalReview.mergeStores(a, b);
            const ba = PortalReview.mergeStores(b, a);
            const aa = PortalReview.mergeStores(a, a);

            const isEq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
            return {
                commutative: isEq(ab, ba),
                idempotent: isEq(aa, a),
                k1_b: ab['k1'] && ab['k1'].b === 2,
                has_k2: Boolean(ab['k2']),
                has_k3: Boolean(ab['k3'])
            };
        }""")
        check("merge is commutative: merge(a, b) == merge(b, a)", merge_tests['commutative'])
        check("merge is idempotent: merge(a, a) == a", merge_tests['idempotent'])
        check("merge prefers newer record based on u", merge_tests['k1_b'] and merge_tests['has_k2'] and merge_tests['has_k3'])

        # 9. Days store and Streak computation
        streak_res = ev("""() => {
            const now = Date.now();
            const oneDay = 86400000;
            const history = [
                { t: now, n: 10, c: 10 },
                { t: now - oneDay, n: 10, c: 10 }
            ];
            const days = {};
            const d2 = new Date(now - 2 * oneDay);
            const d3 = new Date(now - 3 * oneDay);
            days[d2.getFullYear() + '-' + d2.getMonth() + '-' + d2.getDate()] = true;
            days[d3.getFullYear() + '-' + d3.getMonth() + '-' + d3.getDate()] = true;

            return PortalReview.computeCombinedStreak(history, days, now);
        }""")
        check("computeCombinedStreak unions history days and study days for 4-day streak", streak_res == 4)

        # 10. Sign-out clears review and days stores
        clear_res = ev("""() => {
            localStorage.setItem('portal_review_v1', JSON.stringify({'test': 1}));
            localStorage.setItem('portal_days_v1', JSON.stringify({'test': 2}));
            if (window.PortalCloud && window.PortalCloud.clearPersonal) {
                window.PortalCloud.clearPersonal();
            }
            return {
                review: localStorage.getItem('portal_review_v1'),
                days: localStorage.getItem('portal_days_v1')
            };
        }""")
        check("clearPersonal wipes portal_review_v1", clear_res['review'] is None)
        check("clearPersonal wipes portal_days_v1", clear_res['days'] is None)

        # 11. Cloud Bundle includes review and days
        bundle_test = ev("""() => {
            localStorage.setItem('portal_review_v1', JSON.stringify({'k_rev': { b: 1 }}));
            localStorage.setItem('portal_days_v1', JSON.stringify({'2026-10-4': true}));
            let bundle = {};
            if (window.PortalCloud && window.PortalCloud.buildLocalBundle) {
                bundle = window.PortalCloud.buildLocalBundle();
            }
            return {
                hasReview: Boolean(bundle.review && bundle.review['k_rev']),
                hasDays: Boolean(bundle.days && bundle.days['2026-10-4'])
            };
        }""")
        check("buildLocalBundle bundles review store", bundle_test['hasReview'])
        check("buildLocalBundle bundles study days", bundle_test['hasDays'])

    finally:
        browser.close()
        pw.stop()
    common.report()


if __name__ == '__main__':
    run()
