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
    real = page.evaluate("""() => window.PortalLeague.board().then(
      (r) => r.map((x) => x.user_id + ':' + x.xp))""")
    print('real board:', real)
    rows = common.board(player=6, me_id='tg:7777')
    page.evaluate(common.MOCK_CLIENT, rows)
    page.wait_for_timeout(300)
    mocked = page.evaluate("""() => window.PortalLeague.board().then(
      (r) => r.map((x) => x.user_id + ':' + x.xp))""")
    print('mocked board:', mocked)
    print('errors:', errors[:3])
finally:
    browser.close()
