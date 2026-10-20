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
    page.wait_for_timeout(600)
    info = page.evaluate("""() => {
      const t = document.querySelector('.option-tile');
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      const chain = [];
      let n = el;
      while (n && chain.length < 6) { chain.push(n.tagName + '.' + String(n.className).slice(0, 40) + '#' + n.id); n = n.parentElement; }
      const tile = { rect: {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)},
                     visible: getComputedStyle(t).visibility, display: getComputedStyle(t).display,
                     pointer: getComputedStyle(t).pointerEvents };
      const ov = document.querySelector('#tour-overlay');
      return { tile, point: [Math.round(cx), Math.round(cy)], top: chain,
               tourCls: ov ? ov.className : null,
               vw: window.innerWidth, vh: window.innerHeight, scrollY: Math.round(window.scrollY) };
    }""")
    print(info)
    print('errors:', errors[:3])
finally:
    browser.close()
