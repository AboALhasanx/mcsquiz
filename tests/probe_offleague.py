import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser = pw.chromium.launch(headless=True, executable_path=common.EXE)
ctx = browser.new_context(viewport=common.VP, is_mobile=True, has_touch=True)
ctx.add_init_script(
    "try { localStorage.setItem('portal_tour_done', '1');"
    " localStorage.setItem('portal_quiz_hint', '1'); } catch (e) {}")
ctx.add_init_script(common.telegram_script({'id': 424242, 'first_name': 'طيار'}))
page = ctx.new_page()
try:
    page.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
    page.wait_for_timeout(3500)
    ctx.set_offline(True)
    page.evaluate("() => { location.hash = '#/league'; }")
    page.wait_for_timeout(3000)
    print('LEAGUE TEXT:')
    print(page.locator('#league-view').inner_text())
    print('---')
    print('empty class:', page.locator('#league-empty-state').get_attribute('class'))
    print('offline class:', page.locator('#league-offline-note').get_attribute('class'))
    print('me:', (page.locator('.league-me-sub').text_content() or '').strip())
finally:
    browser.close()
