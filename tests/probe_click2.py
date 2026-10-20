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
    # answer wrong, open+close matrix (same as the failing test)
    page.evaluate("""() => {
      const s = window.__portal.S.session;
      const wrong = (s.questions[s.idx].correct + 1) % 4;
      document.querySelectorAll('.option-tile')[wrong].click();
    }""")
    page.wait_for_timeout(300)
    page.evaluate('() => document.querySelector("#btn-open-matrix").click()')
    page.wait_for_timeout(400)
    page.evaluate('() => document.querySelector("#btn-close-matrix").click()')
    page.wait_for_timeout(300)
    info = page.evaluate("""() => {
      const t = document.querySelector('.option-tile');
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      const chain = [];
      let n = el;
      while (n && chain.length < 4) {
        const cs = getComputedStyle(n);
        chain.push(n.tagName + '.' + String(n.className).slice(0, 30)
          + ' pos=' + cs.position + ' z=' + cs.zIndex);
        n = n.parentElement;
      }
      return { point: [Math.round(cx), Math.round(cy)], top: chain,
               scrollY: Math.round(window.scrollY),
               tileY: Math.round(r.top), vh: window.innerHeight };
    }""")
    print(info)
finally:
    browser.close()
