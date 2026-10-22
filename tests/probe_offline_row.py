import os
import sys

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
    page.wait_for_timeout(5000)
    try:
        page.wait_for_function('() => !!navigator.serviceWorker.controller', timeout=20000)
    except Exception:  # audit-ignore: optional wait
        pass
    page.wait_for_timeout(1500)
    page.locator('.btn-menu').first.click()
    page.wait_for_timeout(1200)
    label = page.locator('#menu-offline-label').text_content()
    badge = page.locator('#menu-offline-state').text_content()
    print('row:', label, '|', badge)
    # the prepare action must be idempotent and report success
    page.locator('#menu-offline').click()
    page.wait_for_timeout(3000)
    toasts = page.evaluate("() => Array.from(document.querySelectorAll('.portal-toast')).map((t) => t.textContent)")
    print('toasts:', toasts)
    label2 = page.locator('#menu-offline-label').text_content()
    print('row after prepare:', label2)
finally:
    browser.close()
