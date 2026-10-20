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
      document.querySelectorAll('.option-tile')[(s.questions[s.idx].correct + 1) % 4].click();
    }""")
    page.wait_for_timeout(300)
    page.evaluate('() => document.querySelector("#btn-open-matrix").click()')
    page.wait_for_timeout(400)
    page.evaluate('() => document.querySelector("#btn-close-matrix").click()')
    page.wait_for_timeout(300)
    # replicate tap(): centre the first tile, then inspect the hit target
    page.locator('.option-tile').first.scroll_into_view_if_needed()
    h = page.locator('.option-tile').first.element_handle()
    page.evaluate('(el) => el.scrollIntoView({ block: "center" })', h)
    page.wait_for_timeout(150)
    info = page.evaluate("""(el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const els = document.elementsFromPoint(cx, cy).slice(0, 5).map((n) => {
        const cs = getComputedStyle(n);
        return n.tagName + '.' + String(n.className).slice(0, 30)
          + ' vis=' + cs.visibility + ' op=' + cs.opacity + ' pe=' + cs.pointerEvents;
      });
      return { cx: Math.round(cx), cy: Math.round(cy),
               tile: { t: Math.round(r.top), h: Math.round(r.height) },
               scrollY: Math.round(window.scrollY), els };
    }""", h)
    print(info)
finally:
    browser.close()
