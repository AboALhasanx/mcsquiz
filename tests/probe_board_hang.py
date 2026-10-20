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
    subs = common.subjects(page)
    sid, qid = subs[0]['id'], subs[0]['chapters'][0]
    page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
    page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
    page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
    page.wait_for_timeout(400)
    total = int((page.locator('#question-total-label').text_content() or '0').strip())
    for _ in range(total):
        if 'hidden' not in (page.locator('#results-view').get_attribute('class') or ''):
            break
        is_open = page.evaluate("""() => {
          const s = window.__portal.S.session; return s.picks[s.idx] === null; }""")
        if is_open:
            common.tap(page, page.locator('.option-tile').first)
            page.wait_for_timeout(100)
        page.click('#btn-next')
        page.wait_for_timeout(120)
    print('finished:', 'hidden' not in (page.locator('#results-view').get_attribute('class') or ''))
    ctx.set_offline(True)
    out = page.evaluate("""() => Promise.race([
      window.PortalLeague.board().then((r) => 'resolved:' + r.length, (e) => 'rejected:' + e.message),
      new Promise((res) => setTimeout(() => res('TIMEOUT-12s'), 12000)),
    ])""")
    print('board():', out)
finally:
    browser.close()
