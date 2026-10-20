import os
import sys

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
    # exactly like the spec: offline FIRST, then saved, then league
    ctx.set_offline(True)
    page.evaluate("() => { location.hash = '#/saved'; }")
    page.wait_for_timeout(800)
    page.evaluate("""() => {
      window.__log = ['nav-to-league'];
      const L = window.PortalLeague;
      const orig = L.board.bind(L);
      L.board = (...a) => {
        window.__log.push('board-call');
        return orig(...a).then((r) => { window.__log.push('board-ok:' + r.length); return r; },
                               (e) => { window.__log.push('board-err:' + String(e.message || e).slice(0, 60)); throw e; });
      };
      location.hash = '#/league';
    }""")
    for i in range(6):
        page.wait_for_timeout(4000)
        st = page.evaluate("""() => ({
          log: window.__log,
          rows: document.querySelector('#league-board').childElementCount,
          empty: !document.querySelector('#league-empty-state').classList.contains('hidden'),
          off: !document.querySelector('#league-offline-note').classList.contains('hidden'),
          cache: !!window.__portal.S.leagueRows,
        })""")
        print(i, st)
        if st['empty'] or st['off'] or st['rows']:
            break
finally:
    browser.close()
