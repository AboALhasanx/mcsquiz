import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(pw, tour_done=True, telegram=None)
try:
    page.locator('.btn-menu').first.click()
    page.wait_for_timeout(400)
    page.locator('#menu-account').click()
    page.wait_for_timeout(500)
    handle = 'pr%d' % (int(time.time()) % 100000)
    page.fill('#login-name', 'مستخدم تجربة')
    page.fill('#login-handle', handle)
    page.click('#login-submit')
    page.wait_for_timeout(3000)
    out = page.evaluate("""async () => {
      const L = window.PortalLeague;
      const res = { account: window.PortalCloud.account(), linked: L.linked(), uid: null, sync: null, board: null };
      try { res.uid = L.userId ? L.userId() : 'n/a'; } catch (e) {}
      try { res.sync = await L.syncWeek(); } catch (e) { res.sync = 'ERR ' + e.message; }
      try { res.board = (await L.board()).length; } catch (e) { res.board = 'ERR ' + e.message; }
      return res;
    }""")
    print(out)
    print('errors:', errors[:3])
finally:
    browser.close()
