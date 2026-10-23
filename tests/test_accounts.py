"""Accounts: username + 4-digit PIN, sync, last-write-wins, profile, device link."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('accounts')

PIN = '4271'


def open_account(page):
    page.evaluate("() => document.querySelector('.btn-menu').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(450)
    page.evaluate("() => document.querySelector('#menu-account').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(450)


def login(page, handle, name, pin=PIN):
    open_account(page)
    page.wait_for_selector('#login-modal:not(.hidden)', timeout=12000)
    page.fill('#login-name', name)
    page.fill('#login-handle', handle)
    page.fill('#login-pin', pin)
    page.evaluate("() => document.querySelector('#login-submit').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(3500)


def run():
    pw = common.launch()
    handle = 't%d' % (int(time.time() * 1000) % 1000000)
    name = 'طالب الاختبار'

    # ---------- device 1 ----------
    b1, p1, err1 = common.new_page(pw, tour_done=True, telegram=None)
    try:
        login(p1, handle, name)
        acc1 = p1.evaluate('() => window.PortalCloud.account()')
        check('username + PIN creates an account', bool(acc1 and acc1['id']), acc1)
        check('user id derives from the account',
              p1.evaluate('() => window.PortalCloud.userId()') == 'u:' + acc1['id'])
        check('drawer shows the name', name in (p1.locator('#menu-account-name').text_content() or ''))

        # wrong pin must be rejected
        open_account(p1)
        p1.wait_for_selector('#account-view:not(.hidden)', timeout=12000)
        # signing out now asks first: accept the warning and remember it appeared
        seen = {}
        p1.once('dialog', lambda d: (seen.update({'msg': d.message}), d.accept()))
        p1.evaluate("() => document.querySelector('#account-logout').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        p1.wait_for_timeout(800)
        check('signing out warns before it happens', 'تسجيل الخروج' in (seen.get('msg') or ''), seen.get('msg'))
        login(p1, handle, name, pin='1111')
        check('a wrong PIN is rejected', not p1.evaluate('() => !!window.PortalCloud.account()'),
              p1.locator('#login-error').text_content())

        # correct pin again
        login(p1, handle, name)
        check('the right PIN signs in again',
              p1.evaluate('() => window.PortalCloud.account()')['id'] == acc1['id'])

        # profile: rename + pick an avatar
        open_account(p1)
        p1.wait_for_selector('#account-view:not(.hidden)', timeout=12000)
        check('profile editor is shown', 'hidden' not in (p1.locator('#account-profile').get_attribute('class') or ''))
        check('the username is labelled as permanent',
              'لا يمكن تغييره' in (p1.locator('#profile-handle').locator('xpath=..').inner_text() or ''))
        p1.fill('#profile-name', 'اسم جديد')
        p1.evaluate("() => document.querySelectorAll('#avatar-grid .avatar-choice')[1].dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        p1.evaluate("() => document.querySelector('#profile-save').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        p1.wait_for_timeout(2500)
        acc_after = p1.evaluate('() => window.PortalCloud.account()')
        check('the display name is editable', acc_after.get('name') == 'اسم جديد', acc_after)
        check('the avatar is saved', 'assets/avatars/' in (acc_after.get('avatar') or ''), acc_after)

        # test-side cleanup: close every sheet so the quiz is tappable
        p1.evaluate('''() => {
          document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
          document.querySelectorAll('.drawer').forEach((d) => d.classList.remove('open'));
          document.querySelector('#drawer-overlay').classList.remove('active');
          if (location.hash === '#/account') location.hash = '#/';
        }''')
        p1.wait_for_timeout(500)

        # study data (for sync)
        subs = common.subjects(p1)
        sid, qid = subs[0]['id'], subs[0]['chapters'][0]
        p1.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
        p1.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        p1.evaluate("() => document.querySelector('#btn-start-quiz').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        p1.wait_for_timeout(500)
        p1.evaluate("() => document.querySelector('#btn-save-question').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        p1.wait_for_timeout(400)
        total = int((p1.locator('#question-total-label').text_content() or '0').strip())
        for _ in range(total):
            if 'hidden' not in (p1.locator('#results-view').get_attribute('class') or ''):
                break
            is_open = p1.evaluate("() => { const s = window.__portal.S.session; return s.picks[s.idx] === null; }")
            if is_open:
                common.tap(p1, p1.locator('.option-tile').first)
                p1.wait_for_timeout(120)
            p1.click('#btn-next')
            p1.wait_for_timeout(150)
        p1.evaluate('() => window.PortalCloud.pushSoon()')
        p1.wait_for_timeout(4000)
        saved1 = p1.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('portal_saved_v1')||'{}')).length")
        hist1 = p1.evaluate("() => JSON.parse(localStorage.getItem('portal_history_v1')||'[]').length")
        check('device 1 has study data', saved1 >= 1 and hist1 >= 1, '%s/%s' % (saved1, hist1))
    finally:
        b1.close()

    # ---------- device 2: same username + pin pulls the data ----------
    b2, p2, err2 = common.new_page(pw, tour_done=True, telegram=None)
    try:
        login(p2, handle, 'اسم جديد')
        acc2 = p2.evaluate('() => window.PortalCloud.account()')
        check('same username returns the same account', bool(acc2 and acc2['id'] == acc1['id']), acc2)
        p2.wait_for_timeout(3000)
        saved2 = p2.evaluate("() => Object.keys(JSON.parse(localStorage.getItem('portal_saved_v1')||'{}')).length")
        hist2 = p2.evaluate("() => JSON.parse(localStorage.getItem('portal_history_v1')||'[]').length")
        check('device 2 receives the saved questions', saved2 >= 1, saved2)
        check('device 2 receives the history', hist2 >= 1, hist2)

        # last write wins
        p2.evaluate("""() => {
          const s = JSON.parse(localStorage.getItem('portal_saved_v1') || '{}');
          s['newdevice|q|9'] = { origin: { subjectId: 'newdevice', quizId: 'q', chapterNo: 1, topic: 't' }, snapshot: { id: 9 }, savedAt: Date.now() };
          localStorage.setItem('portal_saved_v1', JSON.stringify(s));
          window.PortalCloud.pushSoon();
        }""")
        p2.wait_for_timeout(3000)
        b3, p3, err3 = common.new_page(pw, tour_done=True, telegram=None)
        try:
            login(p3, handle, 'اسم جديد')
            p3.wait_for_timeout(3500)
            check('the newest write wins across devices',
                  p3.evaluate("() => !!JSON.parse(localStorage.getItem('portal_saved_v1')||'{}')['newdevice|q|9']"))
        finally:
            b3.close()

        # ---------- device link: 4-digit code + QR ----------
        b4, p4, err4 = common.new_page(pw, tour_done=True, telegram=None)
        try:
            open_account(p4)
            p4.wait_for_selector('#login-modal:not(.hidden)', timeout=12000)
            p4.evaluate("() => document.querySelector('#login-link-device').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
            p4.wait_for_timeout(1500)
            code = (p4.locator('#link-code').text_content() or '').strip()
            check('the link code has six digits', len(code) == 6 and code.isdigit(), code)
            check('a QR is rendered for the link', p4.locator('#link-qr svg').count() == 1)

            # the QR carries #/link?code=NNNNNN: opening that URL must put all six
            # digits in the field (a \d{4} match here silently truncated it)
            base = os.environ.get('PORTAL_BASE_URL', 'http://127.0.0.1:8081')
            p2.goto(base + '/#/link?code=123456', wait_until='domcontentloaded')
            p2.wait_for_timeout(2500)
            prefill = p2.evaluate("() => (document.getElementById('link-code-input') || {}).value")
            check('the QR link pre-fills all six digits', prefill == '123456', prefill)
            p2.evaluate("() => { location.hash = '#/account'; }")
            p2.wait_for_timeout(800)

            open_account(p2)
            p2.wait_for_selector('#account-view:not(.hidden)', timeout=12000)
            p2.evaluate("() => document.querySelector('#account-link').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
            p2.wait_for_selector('#link-modal:not(.hidden)', timeout=12000)
            p2.fill('#link-code-input', code)
            p2.evaluate("() => document.querySelector('#link-yes').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
            p2.wait_for_timeout(2000)
            p4.wait_for_timeout(7000)
            linked = p4.evaluate('() => window.PortalCloud.account()')
            check('the approved device signs in', bool(linked and linked['id'] == acc1['id']), linked)
        finally:
            b4.close()

        # leave the portal as we found it: delete the throwaway account
        try:
            p2.evaluate("() => window.PortalCloud.deleteAccount('4271').catch(() => null)")
            p2.wait_for_timeout(1500)
        except Exception:  # audit-ignore: cleanup is best effort
            pass
    finally:
        b2.close()

    print('errors:', (err1 + err2)[:2], flush=True)
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
