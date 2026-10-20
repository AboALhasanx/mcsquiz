import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser = pw.chromium.launch(headless=True, executable_path=common.EXE)
ctx = browser.new_context(viewport=common.VP, is_mobile=True, has_touch=True)
ctx.add_init_script(
    "try { localStorage.setItem('portal_tour_done', '1');"
    " localStorage.setItem('portal_quiz_hint', '1'); } catch (e) {}")
ctx.add_init_script(common.telegram_script({'id': 424242, 'first_name': 'طيار'}))
page = ctx.new_page()
try:
    page.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
    page.wait_for_timeout(3500)
    # replicate the test: run one quiz online first
    subs = common.subjects(page)
    sid, qid = subs[0]['id'], subs[0]['chapters'][0]
    page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
    page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
    page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
    page.wait_for_timeout(400)
    # answer one question only (enough to trigger any post-answer sync)
    page.evaluate("""() => {
      const s = window.__portal.S.session;
      document.querySelectorAll('.option-tile')[(s.questions[s.idx].correct + 1) % 4].click();
    }""")
    page.wait_for_timeout(400)
    print('history online:',
          page.evaluate('() => (window.__portal.S.history || []).length'))
    ctx.set_offline(True)
    t0 = time.time()
    page.evaluate("() => { location.hash = '#/league'; }")
    for i in range(6):
        page.wait_for_timeout(4000)
        st = page.evaluate("""() => ({
          empty: !document.querySelector('#league-empty-state').classList.contains('hidden'),
          off: !document.querySelector('#league-offline-note').classList.contains('hidden'),
          rows: document.querySelector('#league-board').childElementCount,
          cache: !!(window.__portal.S.leagueRows),
        })""")
        print(round(time.time() - t0), st)
        if st['empty'] or st['off']:
            break
finally:
    browser.close()
