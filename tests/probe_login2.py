import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
handle = 'dbg%d' % (int(time.time() * 1000) % 1000000)

def login(page, h, n):
    page.locator('.btn-menu').first.click()
    page.wait_for_timeout(400)
    page.locator('#menu-account').click()
    page.wait_for_timeout(400)
    page.fill('#login-name', n)
    page.fill('#login-handle', h)
    page.click('#login-submit')
    page.wait_for_timeout(3000)
    return page.evaluate('() => window.PortalCloud.account()')

b1, p1, e1 = common.new_page(pw, tour_done=True, telegram=None)
a1 = login(p1, handle, 'طالب')
print('acc1', a1)
b1.close()

b2, p2, e2 = common.new_page(pw, tour_done=True, telegram=None)
a2 = login(p2, handle, 'طالب')
print('acc2', a2)
print('login error:', p2.locator('#login-error').text_content(), '| hidden:', 'hidden' in (p2.locator('#login-modal').get_attribute('class') or ''))
print('rpc direct:', p2.evaluate("""async () => {
  const sb = await window.PortalCloud.sb();
  const r = await sb.rpc('portal_login', { p_handle: arguments[0], p_name: 'x' });
  return { err: r.error && r.error.message, data: r.data };
}""", handle))
b2.close()
print('errors', e1[:2], e2[:2])
