import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(
    pw, tour_done=True, telegram={'id': 7777, 'first_name': 'x'})
try:
    page.evaluate("() => { location.hash = '#/league'; }")
    page.wait_for_timeout(1200)
    common.mock_board(page, common.board(player=6, me_id='tg:7777'))
    page.locator('#league-vis-toggle').uncheck()
    page.wait_for_timeout(900)
    box = page.locator('#league-vis-toggle').bounding_box()
    print('box:', box)
    state0 = page.evaluate("""() => ({
      checked: document.querySelector('#league-vis-toggle').checked,
      disabled: document.querySelector('#league-vis-toggle').disabled,
      rows: window.__mockRows.map((r) => r.user_id + ':' + r.xp + ':' + r.hidden),
    })""")
    print('before click:', state0)
    if box:
        page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.wait_for_timeout(900)
    state1 = page.evaluate("""() => ({
      checked: document.querySelector('#league-vis-toggle').checked,
      podiumMe: document.querySelectorAll('.podium-slot.is-me').length,
      rowMe: document.querySelectorAll('.league-row.is-me').length,
      meSub: (document.querySelector('.league-me-sub') || {}).textContent,
      rows: window.__mockRows.map((r) => r.user_id + ':' + r.xp + ':' + r.hidden),
      toasts: Array.from(document.querySelectorAll('.portal-toast')).map((t) => t.textContent),
    })""")
    print('after click:', state1)
    print('errors:', errors[:3])
finally:
    browser.close()
