import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(pw, tour_done=True, telegram=None)
try:
    page.wait_for_timeout(800)
    # open the login modal from the drawer
    page.locator('.btn-menu').first.click()
    page.wait_for_timeout(500)
    page.locator('#menu-account').click()
    page.wait_for_timeout(600)
    print('login modal open:', 'hidden' not in (page.locator('#login-modal').get_attribute('class') or ''))
    handle = 'test%d' % (int(__import__('time').time()) % 100000)
    page.fill('#login-name', 'طالب تجربة')
    page.fill('#login-handle', handle)
    page.click('#login-submit')
    page.wait_for_timeout(3500)
    acc = page.evaluate("() => window.PortalCloud.account()")
    print('account:', acc)
    print('user id:', page.evaluate("() => window.PortalCloud.userId()"))
    print('drawer row:', page.locator('#menu-account-name').text_content(), '|', page.locator('#menu-account-sub').text_content())
    # league should now list this account
    page.evaluate("() => { location.hash = '#/league'; }")
    page.wait_for_timeout(3000)
    txt = page.locator('#league-view').inner_text()
    print('league mentions name:', 'طالب تجربة' in txt)
    print('errors:', errors[:3])
finally:
    browser.close()
