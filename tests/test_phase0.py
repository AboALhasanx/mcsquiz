# tests/test_phase0.py
# Phase 0 foundations (see qbank_features_plan.md §3). Written RED-first: every
# check below fails on the pre-fix code and must pass after the fix.
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import check

HERE = os.path.dirname(os.path.abspath(__file__))
ACH = 'portal_achievements_v1'


def spec_list():
    src = open(os.path.join(HERE, 'run_all.py'), encoding='utf-8').read()
    m = re.search(r'SPECS\s*=\s*\[(.*?)\]', src, re.S)
    return re.findall(r"'([^']+\.py)'", m.group(1)) if m else []


def run():
    # 0.1 the gate must run the achievements specs (static, no browser needed)
    specs = spec_list()
    check('the gate runs the achievements engine spec', 'test_achievements.py' in specs, specs)
    check('the gate runs the achievements flow spec', 'test_achievements_flow.py' in specs, specs)
    check('the gate runs this phase-0 spec', 'test_phase0.py' in specs, specs)

    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        ev = page.evaluate

        # ---- 0.2a sign-out wipes the achievements state (shared device) -------------
        ev("""() => {
          localStorage.setItem('%s', JSON.stringify({version:1, hasBootstrapped:true,
            unlocked:{sniper:{tier:3, unlockedAt:1, lastNotifiedTier:3}}, recentUnlocks:[]}));
          window.PortalCloud.signOut();
          window.PortalCloud.clearPersonal();
        }""" % ACH)
        check('sign-out removes the achievements state',
              ev("(k) => localStorage.getItem(k)", ACH) is None)

        # ---- 0.2b switching account on the same device wipes it ----------------------
        ev("""() => {
          localStorage.removeItem('portal_signed_out_v1');
          localStorage.setItem('portal_data_owner_v1', 'owner-A');
          localStorage.setItem('%s', JSON.stringify({version:1, hasBootstrapped:true,
            unlocked:{sniper:{tier:3, unlockedAt:1, lastNotifiedTier:3}}, recentUnlocks:[]}));
          window.PortalCloud.adopt({id:'owner-B', handle:'bb', name:'B'});
        }""" % ACH)
        check('a different account does not inherit the previous achievements',
              ev("(k) => localStorage.getItem(k)", ACH) is None)
        # control: the SAME owner re-adopting must keep its state
        ev("""() => {
          localStorage.setItem('%s', JSON.stringify({version:1, hasBootstrapped:true, unlocked:{}, recentUnlocks:[]}));
          window.PortalCloud.adopt({id:'owner-B', handle:'bb', name:'B'});
        }""" % ACH)
        check('control: the same owner keeps its achievements state',
              ev("(k) => localStorage.getItem(k)", ACH) is not None)
        ev("() => { window.PortalCloud.signOut(); window.PortalCloud.clearPersonal(); localStorage.removeItem('portal_signed_out_v1'); }")

        # ---- 0.3 a new device with synced history must not celebrate old badges ------
        def seed_history(last_perfect, old_perfect=True):
            now = int(time.time() * 1000)
            day = 86400000
            hist = [
                {'t': now - 40 * day, 'total': 15, 'correct': 15 if old_perfect else 8,
                 'pct': 100 if old_perfect else 53, 'secs': 300, 'subjectId': 's'},
                {'t': now - 35 * day, 'total': 15, 'correct': 12, 'pct': 80, 'secs': 300, 'subjectId': 's'},
                {'t': now - 30 * day, 'total': 15, 'correct': 12, 'pct': 80, 'secs': 300, 'subjectId': 's'},
                {'t': now - 20 * day, 'total': 15, 'correct': 12, 'pct': 80, 'secs': 300, 'subjectId': 's'},
                {'t': now - 15 * day, 'total': 15, 'correct': 12, 'pct': 80, 'secs': 300, 'subjectId': 's'},
                {'t': now - 10 * day, 'total': 15, 'correct': 12, 'pct': 80, 'secs': 300, 'subjectId': 's'},
                {'t': now, 'total': 10, 'correct': 10 if last_perfect else 6,
                 'pct': 100 if last_perfect else 60, 'secs': 300, 'subjectId': 's'},
            ]
            ev("(h) => { localStorage.removeItem('%s'); localStorage.setItem('portal_history_v1', JSON.stringify(h)); }" % ACH, hist)

        def finish_probe():
            return ev("""() => {
              const pill = document.getElementById('achievement-hud-pill');
              if (pill) { pill.classList.remove('is-active'); pill.classList.add('hidden'); }
              const r = window.PortalAchievements.checkAfterQuiz({}, {});
              return { n: r.length, ids: r.map(x => x.badge.id),
                       hud: !!(pill && pill.classList.contains('is-active')) };
            }""")

        seed_history(last_perfect=False)
        r = finish_probe()
        check('new device: old, already-earned badges are not re-celebrated', r['n'] == 0, r)
        check('new device: no HUD pill for old badges', not r['hud'], r)

        # control: a badge that THIS quiz really earns is still celebrated (no history before it)
        seed_history(last_perfect=True)
        ev("() => { const h = JSON.parse(localStorage.getItem('portal_history_v1')); localStorage.setItem('portal_history_v1', JSON.stringify(h.slice(-1))); }")
        r = finish_probe()
        check('control: a genuinely new badge is still celebrated', 'sniper' in r['ids'], r)

        # control: on a bootstrapped device a newly earned tier still celebrates
        seed_history(last_perfect=False, old_perfect=False)
        ev("() => window.PortalAchievements.evaluateAll()")  # bootstraps silently
        ev("""() => { const h = JSON.parse(localStorage.getItem('portal_history_v1'));
              h[h.length-1] = {t: Date.now(), total: 10, correct: 10, pct: 100, secs: 300, subjectId: 's'};
              localStorage.setItem('portal_history_v1', JSON.stringify(h)); }""")
        r = finish_probe()
        check('control: bootstrapped device celebrates a newly earned badge', 'sniper' in r['ids'], r)

        # ---- 0.5 cloud merge keeps fields it does not know yet -----------------------
        m = ev("""() => window.PortalCloud.mergeBundles(
          { updatedAt: 1, review: {k1: {b: 1, u: 1}}, shared: 'old' },
          { updatedAt: 2, days: [5, 6], shared: 'new' })""")
        check('merge keeps a field only the first bundle has', m.get('review') == {'k1': {'b': 1, 'u': 1}}, m.get('review'))
        check('merge keeps a field only the second bundle has', m.get('days') == [5, 6], m.get('days'))
        check('merge prefers the newer bundle for a shared unknown field', m.get('shared') == 'new', m.get('shared'))
        check('merge still produces the known fields',
              all(k in m for k in ('saved', 'history', 'bests', 'removed', 'clearedAt')), list(m.keys()))

        # ---- 0.4 the session knows its own kind (and a REAL quiz drives achievements) -
        ev("""() => { ['portal_history_v1','portal_saved_v1','%s'].forEach(k => localStorage.removeItem(k)); }""" % ACH)
        subs = common.subjects(page)
        sid, qid = subs[0]['id'], subs[0]['chapters'][0]
        ev("(h) => { location.hash = h; }", '#/quiz/%s/%s' % (sid, qid))
        page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        page.click('#btn-start-quiz')
        page.wait_for_timeout(500)
        check('a bank session carries kind=bank',
              ev("() => window.__portal.S.session && window.__portal.S.session.kind") == 'bank',
              ev("() => window.__portal.S.session && window.__portal.S.session.kind"))
        total = ev("() => window.__portal.S.session.questions.length")
        for _ in range(total):
            ev("""() => { const s = window.__portal.S.session;
                  window.__portal.pickOption(s.questions[s.idx].correct); }""")
            page.wait_for_timeout(80)
            page.click('#btn-next')
            page.wait_for_timeout(120)
        page.wait_for_timeout(600)
        last = ev("() => { const h = window.__portal.S.history; return h[h.length - 1] || null; }")
        check('the finished quiz is recorded in history', last is not None, last)
        check('the history entry carries kind=bank', bool(last) and last.get('kind') == 'bank', last)
        check('a real perfect quiz shows the results celebration (real code path)',
              ev("""() => { const c = document.getElementById('results-achievement-celebration');
                    return !!c && !c.classList.contains('hidden') && c.textContent.trim().length > 0; }"""))
        check('no runtime errors', not errors, errors)
    finally:
        browser.close()
        pw.stop()


if __name__ == '__main__':
    run()
    sys.exit(common.report())
