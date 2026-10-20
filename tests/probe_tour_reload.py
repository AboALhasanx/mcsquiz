import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(
    pw, tour_done=False, telegram={'id': 3, 'first_name': 'x'})
try:
    page.wait_for_selector('#tour-overlay:not(.hidden)', timeout=25000)
    # walk to the end quickly
    for _ in range(30):
        nxt = page.evaluate("""() => {
          const tip = document.querySelector('#tour-tip');
          const r = tip.getBoundingClientRect();
          if (r.width < 5) return null;
          return document.querySelector('#tour-btn-next').textContent;
        }""")
        if nxt is None:
            break
        if nxt == 'إنهاء':
            page.evaluate('() => document.querySelector("#tour-btn-next").click()')
            page.wait_for_timeout(600)
            break
        page.evaluate('() => document.querySelector("#tour-btn-next").click()')
        page.wait_for_timeout(700)
    print('flag before reload:',
          page.evaluate("() => localStorage.getItem('portal_tour_done')"))
    print('overlay before reload:',
          page.evaluate("() => document.querySelector('#tour-overlay').className"))
    page.goto(common.APP, wait_until='domcontentloaded')
    page.wait_for_timeout(2000)
    print('flag after reload:',
          page.evaluate("() => localStorage.getItem('portal_tour_done')"))
    print('overlay after reload:',
          page.evaluate("() => document.querySelector('#tour-overlay').className"))
    print('tour title after reload:',
          page.evaluate("() => document.querySelector('#tour-tip-title').textContent"))
    print('tour step after reload:',
          page.evaluate("() => document.querySelector('#tour-tip-progress').textContent"))
    print('errors:', errors[:3])
finally:
    browser.close()
