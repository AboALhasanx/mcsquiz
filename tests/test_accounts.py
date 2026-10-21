"""Accounts: handle login, cross-device sync, last-write-wins, device link."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('accounts')


def login(page, handle, name):
    page.evaluate("() => document.querySelector('.btn-menu').click()")
    page.wait_for_timeout(400)
    page.evaluate("() => document.querySelector('#menu-account').click()")
    page.wait_for_timeout(400)
    page.fill('#login-name', name)
    page.fill('#login-handle', handle)
    page.click('#login-submit')
    page.wait_for_timeout(3000)
    return page.evaluate('() => window.PortalCloud.account()')


def run():
    pw = common.launch()
    handle = 't%d' % (int(time.time() * 1000) % 1000000)
    name = 'طالب الاختبار'

    # ---------- device 1: create the account ----------
    b1, p1, err1 = common.new_page(pw, tour_done=True, telegram=None)
    try:
        acc1 = login(p1, handle, name)
        check('handle login creates an account', bool(acc1 and acc1['id']), acc1)
        check('account id drives the user id',
              p1.evaluate('() => window.PortalCloud.userId()') == 'u:' + acc1['id'])
        row = p1.locator('#menu-account-name').text_content()
        check('drawer shows the account name', name in (row or ''), row)

        # produce local data: save a question and finish a quiz
        subs = common.subjects(p1)
        sid, qid = subs[0]['id'], subs[0]['chapters'][0]
        p1.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
        p1.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        p1.evaluate('() => document.querySelector("#btn-start-quiz").click()')
        p1.wait_for_timeout(400)
        p1.evaluate('() => document.querySelector("#btn-save-question").click()')
        p1.wait_for_timeout(300)
        total = int((p1.locator('#question-total-label').text_content() or '0').strip())
        for _ in range(total):
            if 'hidden' not in (p1.locator('#results-view').get_attribute('class') or ''):
                break
            is_open = p1.evaluate("""() => {
              const s = window.__portal.S.session; return s.picks[s.idx] === null; }""")
            if is_open:
                common.tap(p1, p1.locator('.option-tile').first)
                p1.wait_for_timeout(120)
            p1.click('#btn-next')
            p1.wait_for_timeout(150)
        p1.evaluate("() => { try { window.PortalCloud.pushSoon(); } catch (e) {} }")
        p1.wait_for_timeout(4000)
        saved1 = p1.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('portal_saved_v1')||'{}')).length")
        hist1 = p1.evaluate("() => JSON.parse(localStorage.getItem('portal_history_v1')||'[]').length")
        check('device 1 has local study data', saved1 >= 1 and hist1 >= 1, '%s/%s' % (saved1, hist1))
    finally:
        b1.close()

    # ---------- device 2: same handle pulls the data ----------
    b2, p2, err2 = common.new_page(pw, tour_done=True, telegram=None)
    try:
        acc2 = login(p2, handle, name)
        check('the same handle returns the same account id',
              bool(acc2 and acc1 and acc2['id'] == acc1['id']), acc2)
        p2.wait_for_timeout(2500)
        saved2 = p2.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('portal_saved_v1')||'{}')).length")
        hist2 = p2.evaluate("() => JSON.parse(localStorage.getItem('portal_history_v1')||'[]').length")
        check('device 2 receives the saved questions', saved2 >= 1, saved2)
        check('device 2 receives the history', hist2 >= 1, hist2)

        # ---------- last write wins ----------
        p2.evaluate("""() => {
          const k = 'portal_saved_v1';
          const s = JSON.parse(localStorage.getItem(k) || '{}');
          s['newdevice|q|2'] = { origin: { subjectId: 'newdevice', quizId: 'q', chapterNo: 1, topic: 't' }, snapshot: { id: 2 }, savedAt: Date.now() };
          localStorage.setItem(k, JSON.stringify(s));
          window.PortalCloud.pushSoon();
        }""")
        p2.wait_for_timeout(2500)
        p1b, p1c, err3 = common.new_page(pw, tour_done=True, telegram=None)
        try:
            login(p1c, handle, name)
            p1c.wait_for_timeout(3000)
            has_new = p1c.evaluate("() => !!JSON.parse(localStorage.getItem('portal_saved_v1')||'{}')['newdevice|q|2']")
            check('the newest write wins across devices', has_new)
        finally:
            p1b.close()

        # ---------- device link: code + approval ----------
        b3, p3, err4 = common.new_page(pw, tour_done=True, telegram=None)
        try:
            p3.evaluate("() => document.querySelector('.btn-menu').click()")
            p3.wait_for_timeout(400)
            p3.evaluate("() => document.querySelector('#menu-account').click()")
            p3.wait_for_timeout(400)
            p3.locator('#login-link-device').click()
            p3.wait_for_timeout(800)
            code = (p3.locator('#link-code').text_content() or '').strip()
            check('a 6-digit link code is shown on the new device', len(code) == 6 and code.isdigit(), code)

            # approve from the signed-in device
            p2.evaluate("() => document.querySelector('.btn-menu').click()")
            p2.wait_for_timeout(300)
            p2.evaluate("() => document.querySelector('#menu-account').click()")
            p2.wait_for_timeout(300)
            p2.locator('#account-link').click()
            p2.wait_for_timeout(400)
            p2.fill('#link-code-input', code)
            p2.click('#link-yes')
            p2.wait_for_timeout(1500)

            p3.wait_for_timeout(6000)
            linked = p3.evaluate('() => window.PortalCloud.account()')
            check('new device signs in after approval', bool(linked and linked.get('id') == acc1['id']), linked)
        finally:
            b3.close()
    finally:
        b2.close()

    print('errors:', (err1 + err2)[:3], flush=True)
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
