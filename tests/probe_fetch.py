import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser = pw.chromium.launch(headless=True, executable_path=common.EXE)
ctx = browser.new_context(viewport=common.VP, is_mobile=True, has_touch=True)
ctx.add_init_script(
    "try { localStorage.setItem('portal_tour_done', '1'); } catch (e) {}")
page = ctx.new_page()
try:
    page.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
    page.wait_for_timeout(3000)
    ctx.set_offline(True)
    t0 = time.time()
    try:
        r = page.evaluate("""() => fetch('https://gywniovuupjmllbmjmai.supabase.co/rest/v1/league_xp?select=*&limit=1')
          .then((x) => 'resolved:' + x.status).catch((e) => 'rejected:' + e.message)""")
        print(round(time.time() - t0, 1), r)
    except Exception as e:
        print(round(time.time() - t0, 1), 'eval-timeout')
finally:
    browser.close()
