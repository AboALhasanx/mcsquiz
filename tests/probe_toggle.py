import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(
    pw, tour_done=True, telegram={'id': 7777, 'first_name': 'x'})
try:
    page.evaluate("() => { location.hash = '#/league'; }")
    page.wait_for_timeout(1500)
    common.mock_board(page, common.board(player=6, me_id='tg:7777'))
    page.wait_for_timeout(1200)
    info = page.evaluate("""() => ({
      ready: document.readyState,
      nav: performance.getEntriesByType('navigation').map((n) => n.type + ':' + Math.round(n.duration)),
      hash: location.hash,
      toggle: !!document.querySelector('#league-vis-toggle'),
    })""")
    print(info)
    try:
        page.locator('#league-vis-toggle').uncheck(timeout=8000)
        print('uncheck ok')
    except Exception as e:
        print('uncheck failed:', str(e).splitlines()[0])
        print([l for l in str(e).splitlines() if 'navigation' in l or 'waiting' in l][:4])
finally:
    browser.close()
