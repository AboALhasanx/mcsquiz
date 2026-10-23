"""PIN change: only the owner can rotate the 4-digit PIN, and the device follows it."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('pin change')

OLD = '1357'
NEW = '2468'


def open_account(page):
    page.evaluate("() => document.querySelector('.btn-menu').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(450)
    page.evaluate("() => document.querySelector('#menu-account').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(450)


def login(page, handle, pin):
    open_account(page)
    page.wait_for_selector('#login-modal:not(.hidden)', timeout=12000)
    page.fill('#login-name', 'PIN test')
    page.fill('#login-handle', handle)
    page.fill('#login-pin', pin)
    page.evaluate("() => document.querySelector('#login-submit').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(4000)


def toast(page):
    try:
        page.wait_for_function(
            "() => { const r = document.getElementById('toast-region'); return r && r.innerText.trim().length > 0; }",
            timeout=6000)
    except Exception:
        return ''
    return (page.evaluate("() => document.getElementById('toast-region').innerText") or '').strip()


def clear_toast(page):
    page.evaluate("() => { const r = document.getElementById('toast-region'); if (r) r.innerHTML = ''; }")


def try_change(page, current, new, again):
    clear_toast(page)
    page.fill('#profile-pin', current)
    page.fill('#pin-new', new)
    page.fill('#pin-new2', again)
    page.evaluate("() => document.querySelector('#pin-change').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
    page.wait_for_timeout(2500)
    return toast(page)


def run():
    pw = common.launch()
    handle = 'pc%06d' % (int(time.time() * 1000) % 1000000)
    b, p, err = common.new_page(pw, tour_done=True, telegram=None)
    try:
        # ---------- create ----------
        login(p, handle, OLD)
        acc = p.evaluate('() => window.PortalCloud.account()')
        check('the throwaway account is linked', bool(acc and acc['handle'] == handle), acc)
        p.evaluate("() => { location.hash = '#/'; }")
        p.wait_for_timeout(400)
        p.evaluate("() => { location.hash = '#/account'; }")
        p.wait_for_timeout(900)
        check('the account page offers a PIN change', p.evaluate("() => !!document.getElementById('pin-change')"))

        # ---------- guards ----------
        t = try_change(p, OLD, NEW, '1111')
        check('a mismatched confirmation is refused', 'تأكيد' in t, t)
        t = try_change(p, OLD, OLD, OLD)
        check('the same PIN is refused before the call', 'نفس' in t, t)
        t = try_change(p, '0000', NEW, NEW)
        check('a wrong current PIN is named', 'الرمز الحالي غير صحيح' in t, t)
        still = p.evaluate("() => localStorage.getItem('portal_pin_v1')")
        check('a failed change keeps the old PIN on the device', still == OLD, still)

        # ---------- real change ----------
        clear_toast(p)
        t = try_change(p, OLD, NEW, NEW)
        check('the owner can change the PIN', 'تم تغيير الرمز' in t, t)
        stored = p.evaluate("() => localStorage.getItem('portal_pin_v1')")
        check('the device stores the new PIN', stored == NEW, stored)

        # ---------- the old PIN is dead ----------
        p.evaluate("() => { window.PortalCloud.signOut(); }")
        p.wait_for_timeout(800)
        p.evaluate("() => { location.hash = '#/'; }")
        p.wait_for_timeout(300)
        login(p, handle, OLD)
        err_text = p.evaluate("() => (document.getElementById('login-error') || {}).textContent || ''")
        modal_open = p.evaluate("() => !document.getElementById('login-modal').classList.contains('hidden')")
        check('the old PIN no longer signs in', modal_open and 'غير صحيح' in err_text, err_text)

        login(p, handle, NEW)
        acc2 = p.evaluate('() => window.PortalCloud.account()')
        check('the new PIN signs in', bool(acc2 and acc2['handle'] == handle), acc2)

        # ---------- profile save accepts the new PIN ----------
        p.evaluate("() => { location.hash = '#/'; }")
        p.wait_for_timeout(300)
        p.evaluate("() => { location.hash = '#/account'; }")
        p.wait_for_timeout(900)
        p.fill('#profile-name', 'PIN renamed')
        p.fill('#profile-pin', NEW)
        clear_toast(p)
        p.evaluate("() => document.querySelector('#profile-save').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        p.wait_for_timeout(2200)
        t = toast(p)
        check('the profile saves with the new PIN', 'تم حفظ الملف' in t, t)
    finally:
        try:
            p.evaluate("() => window.PortalCloud.deleteAccount(localStorage.getItem('portal_pin_v1'))")
            p.wait_for_timeout(1500)
        except Exception:  # audit-ignore: cleanup is best effort
            pass
        b.close()

    print('errors:', err[:2], flush=True)
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
