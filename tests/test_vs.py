"""1v1 Real-Time Competitive Mode (VS Mode): deterministic seeding, speed scoring, room RPCs."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('vs_mode')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        page.wait_for_function('() => !!window.PortalVS', timeout=20000)
        check('PortalVS is exposed on window', page.evaluate('() => !!window.PortalVS'))

        # 1. Deterministic Mulberry32 PRNG & Question Picking
        res_same_seed = page.evaluate("""() => {
          const vs = window.PortalVS;
          const questions = [
            { id: 1, text: 'Q1' }, { id: 2, text: 'Q2' }, { id: 3, text: 'Q3' },
            { id: 4, text: 'Q4' }, { id: 5, text: 'Q5' }, { id: 6, text: 'Q6' },
            { id: 7, text: 'Q7' }, { id: 8, text: 'Q8' }, { id: 9, text: 'Q9' },
            { id: 10, text: 'Q10' }
          ];
          const pick1 = vs.pickVsQuestions(questions, 777123, 5).map(q => q.id);
          const pick2 = vs.pickVsQuestions(questions, 777123, 5).map(q => q.id);
          const pickDiff = vs.pickVsQuestions(questions, 999456, 5).map(q => q.id);
          return {
            equal: JSON.stringify(pick1) === JSON.stringify(pick2),
            pick1: pick1,
            different: JSON.stringify(pick1) !== JSON.stringify(pickDiff)
          };
        }""")
        check('same seed produces identical question selection', res_same_seed['equal'], res_same_seed['pick1'])
        check('different seed produces different selection', res_same_seed['different'])

        # 2. Speed-based Scoring Formula
        scores = page.evaluate("""() => {
          const vs = window.PortalVS;
          return {
            wrong: vs.computeScore(false, 1000, 12000, false),
            fast: vs.computeScore(true, 1000, 12000, false),
            slow: vs.computeScore(true, 11000, 12000, false),
            finalFast: vs.computeScore(true, 1000, 12000, true),
            finalSlow: vs.computeScore(true, 11000, 12000, true)
          };
        }""")
        check('wrong answer yields 0 points', scores['wrong'] == 0, scores['wrong'])
        check('fast answer scores higher than slow answer', scores['fast'] > scores['slow'], '%s vs %s' % (scores['fast'], scores['slow']))
        check('fast answer is in 900-1000 range', 900 <= scores['fast'] <= 1000, scores['fast'])
        check('final round doubles the score', scores['finalFast'] == scores['fast'] * 2, '%s vs %s' % (scores['finalFast'], scores['fast']))

        # 3. Live RPC Room Creation & Joining
        room_info = page.evaluate("""async () => {
          const vs = window.PortalVS;
          const hostId = 'u:test_h_' + Date.now();
          const created = await vs.createRoom('01_Cyber_Security', 'Quiz_Ch01', hostId, 'مضيف تجريبي');
          const guestId = 'u:test_g_' + Date.now();
          const joined = await vs.joinRoom(created.code, guestId, 'ضيف تجريبي');
          return { created, joined };
        }""")
        created = room_info['created']
        joined = room_info['joined']

        check('createRoom returns 4-digit code', bool(created and len(str(created.get('code', ''))) == 4), created)
        check('createRoom returns seed', bool(created and created.get('seed') > 0), created.get('seed'))
        check('joinRoom accepts the 4-digit code', bool(joined and joined.get('ok')), joined)
        check('joinRoom assigns guest role', joined.get('role') == 'guest', joined.get('role'))
        check('both participants receive the identical seed', joined.get('seed') == created.get('seed'), '%s vs %s' % (joined.get('seed'), created.get('seed')))

        # 4. Finish Match RPC
        finish_res = page.evaluate("""async (roomId) => {
          const vs = window.PortalVS;
          return await vs.finishMatch(roomId, 4200, 3100, 'u:host');
        }""", created['room_id'])
        check('finishMatch marks match completed', bool(finish_res and finish_res.get('ok')), finish_res)

        # 5. UI Route & Lobby Rendering
        page.evaluate("() => { location.hash = '#/vs'; }")
        page.wait_for_function("() => !document.getElementById('vs-view').classList.contains('hidden')", timeout=5000)
        check('navigating to #/vs reveals #vs-view', not page.evaluate("() => document.getElementById('vs-view').classList.contains('hidden')"))
        check('lobby screen is active', not page.evaluate("() => document.getElementById('vs-lobby').classList.contains('hidden')"))

        # Verify legends challenge shelf
        check('PortalVSBot is exposed on window', page.evaluate("() => !!window.PortalVSBot"))
        legend_count = page.evaluate("() => window.PortalVSBot.getLegends().length")
        check('5 football legends available in bot engine', legend_count == 5, legend_count)
        rendered_cards = page.locator(".vs-legend-card").count()
        check('5 legend challenge cards rendered in lobby', rendered_cards == 5, rendered_cards)

        # Verify subject options in lobby
        opt_count = page.evaluate("() => document.getElementById('vs-select-subject').options.length")
        check('subject select is populated with options', opt_count > 1, opt_count)

        # 6. PIN Input Auto-Advance
        page.click('#vs-pin-1')
        page.keyboard.type('4')
        active_id = page.evaluate("() => document.activeElement ? document.activeElement.id : ''")
        check('typing in pin-1 focuses pin-2', active_id == 'vs-pin-2', active_id)

        # 7. Menu Item Link
        menu_vs_href = page.evaluate("() => { const a = document.getElementById('menu-vs'); return a ? a.getAttribute('href') : ''; }")
        check('drawer menu item points to #/vs', menu_vs_href == '#/vs', menu_vs_href)

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
        pw.stop()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
