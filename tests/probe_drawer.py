import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(
    pw, tour_done=True, telegram={'id': 9, 'first_name': 'x'})
try:
    subs = common.subjects(page)
    sid, qid = subs[0]['id'], subs[0]['chapters'][0]
    page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
    page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
    page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
    page.wait_for_timeout(500)
    page.evaluate("""() => {
      const s = window.__portal.S.session;
      const wrong = (s.questions[s.idx].correct + 1) % 4;
      document.querySelectorAll('.option-tile')[wrong].click();
    }""")
    page.wait_for_timeout(300)
    page.evaluate('() => document.querySelector("#btn-open-matrix").click()')
    page.wait_for_timeout(400)
    before = page.evaluate("""() => ({
      drawer: document.querySelector('#matrix-drawer').className,
      overlay: document.querySelector('#drawer-overlay').className,
    })""")
    print('open:', before)
    page.evaluate('() => document.querySelector("#btn-close-matrix").click()')
    page.wait_for_timeout(400)
    after = page.evaluate("""() => ({
      drawer: document.querySelector('#matrix-drawer').className,
      overlay: document.querySelector('#drawer-overlay').className,
      overlayVisible: getComputedStyle(document.querySelector('#drawer-overlay')).visibility,
    })""")
    print('closed:', after)
finally:
    browser.close()
