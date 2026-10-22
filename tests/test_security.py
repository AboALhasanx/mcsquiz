"""Security: rate-limited PIN, encrypted personal data, scoped rows, account deletion."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('security')

PROJECT = 'https://gywniovuupjmllbmjmai.supabase.co'
KEY = 'sb_publishable_eoG2KjPKM4JIJtqksQXzCg_dkVOdGtP'


def rpc(name, params, headers=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request('%s/rest/v1/rpc/%s' % (PROJECT, name),
                                 data=json.dumps(params).encode(), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def rest(path, headers=None, method='GET', body=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request('%s/rest/v1/%s' % (PROJECT, path), headers=h, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else [])
    except urllib.error.HTTPError as e:
        return e.code, []


def run():
    handle = 'sectest%d' % (int(time.time()) % 1000000)
    pin = '1234'

    # ---------- 1. the PIN is rate limited ----------
    status, body = rpc('portal_login', {'p_handle': handle, 'p_pin': pin, 'p_name': 'sec'})
    check('an account can be created', status == 200 and body and body[0].get('status') == 'ok', body)
    uid = body[0]['id'] if body and body[0].get('id') else None

    for _ in range(5):
        rpc('portal_login', {'p_handle': handle, 'p_pin': '9999', 'p_name': 'sec'})
    status, body = rpc('portal_login', {'p_handle': handle, 'p_pin': pin, 'p_name': 'sec'})
    check('five wrong tries lock the account',
          bool(body) and body[0].get('status') == 'too_many_attempts', body)
    check('the lock says how long to wait',
          bool(body) and int(body[0].get('retry_after') or 0) > 0, body)

    # a different account on the same address is not blocked by that handle
    status, body = rpc('portal_login', {'p_handle': handle + 'x', 'p_pin': '4321', 'p_name': 'sec'})
    check('another handle is not locked by the first', status == 200, body)

    # ---------- 2. the personal payload is encrypted on the server ----------
    env = {'enc': 1, 'iv': 'aaaaaaaaaaaaaaaa', 'ct': 'bbbbbbbb'}
    status, _ = rest('portal_data?on_conflict=user_id', method='POST',
                     body=[{'user_id': 'u:' + str(uid), 'data': env, 'updated_at': '2026-01-01T00:00:00Z'}],
                     headers={'x-portal-user': 'u:' + str(uid), 'Prefer': 'resolution=merge-duplicates'})
    check('a row can be written for its owner', status in (200, 201), status)
    status, rows = rest('portal_data?select=data&user_id=eq.u:' + str(uid),
                         headers={'x-portal-user': 'u:' + str(uid)})
    stored = (rows[0].get('data') if rows else None) or {}
    check('the server holds an encrypted envelope', stored.get('enc') == 1 and 'ct' in stored, stored)
    check('no readable history is stored', 'history' not in json.dumps(stored), stored)

    # ---------- 3. the rows are scoped to the claimed account ----------
    status, rows = rest('portal_data?select=user_id')
    check('without the account header nothing is readable', rows == [], rows)
    status, rows = rest('portal_data?select=user_id',
                         headers={'x-portal-user': 'u:00000000-0000-0000-0000-000000000000'})
    check('a forged account header reads nothing', rows == [], rows)
    status, rows = rest('portal_data?select=user_id',
                         headers={'x-portal-user': 'u:' + str(uid)})
    check('the owner reads their own row', len(rows) == 1, rows)

    # ---------- 4. the client can read it back and encrypts what it writes ----------
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True, telegram=None)
    try:
        page.evaluate("() => { location.hash = '#/account'; }")
        page.wait_for_timeout(800)
        # sign in through the app, then sync
        page.evaluate("() => document.querySelector('.btn-menu').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        page.wait_for_timeout(400)
        page.evaluate("() => document.querySelector('#menu-account').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        page.wait_for_timeout(600)
        page.wait_for_selector('#login-modal:not(.hidden)', timeout=12000)
        page.fill('#login-name', 'sec')
        page.fill('#login-handle', handle)
        page.fill('#login-pin', pin)
        page.evaluate("() => document.querySelector('#login-submit').dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        page.wait_for_timeout(4000)
        # the account is locked, so the sign-in is refused: clear the lock first
        status, body = rpc('portal_login', {'p_handle': handle, 'p_pin': pin, 'p_name': 'sec'})
        check('the account is still locked after the wait', body[0].get('status') == 'too_many_attempts', body)

        # a fresh account: sign in, save a bookmark, sync, and read the row
        handle2 = 'secdat%d' % (int(time.time()) % 1000000)
        status, body = rpc('portal_login', {'p_handle': handle2, 'p_pin': pin, 'p_name': 'sec'})
        uid2 = body[0]['id']
        page.evaluate("() => { try { localStorage.removeItem('portal_signed_out_v1'); } catch (e) {} }")
        page.reload(wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        signed = page.evaluate("(a) => window.PortalCloud.login(a.h, a.p, 'sec').then(() => true).catch((e) => String(e && e.message))",
                               {'h': handle2, 'p': pin})
        check('the app can sign in', signed is True, signed)
        # write a bookmark straight into the local store, then sync it
        page.evaluate("""() => {
          const saved = JSON.parse(localStorage.getItem('portal_saved_v1') || '{}');
          saved['probe|probe|q1'] = { origin: { subjectId: 'p', subjectTitle: 'p', chapterNo: 1, chapterLabel: '1', quizId: 'probe', topic: 't' }, snapshot: { id: 'q1' }, savedAt: Date.now() };
          localStorage.setItem('portal_saved_v1', JSON.stringify(saved));
          localStorage.setItem('portal_data_touched_v1', String(Date.now()));
        }""")
        res = page.evaluate("() => window.PortalCloud.pullOrPush()")
        check('the sync runs', bool(res) and res.get('action') in ('uploaded-new', 'merged-uploaded', 'merged'), res)
        status, rows = rest('portal_data?select=data&user_id=eq.u:' + str(uid2),
                             headers={'x-portal-user': 'u:' + str(uid2)})
        stored = (rows[0].get('data') if rows else None) or {}
        check('what the app wrote is encrypted', stored.get('enc') == 1, stored)
        check('the bookmark text is not on the server', 'probe' not in json.dumps(stored), stored)

        # ---------- 5. deleting the account removes everything ----------
        status, body = rpc('portal_delete_account', {'p_handle': handle2, 'p_pin': pin})
        check('the account can be deleted', status == 200 and body == 'ok', body)
        status, rows = rest('portal_data?select=user_id&user_id=eq.u:' + str(uid2),
                             headers={'x-portal-user': 'u:' + str(uid2)})
        check('the personal row is gone', rows == [], rows)
        status, body = rpc('portal_login', {'p_handle': handle2, 'p_pin': pin, 'p_name': 'sec'})
        check('the account no longer exists', bool(body) and body[0].get('status') == 'ok' and body[0].get('created') is True, body)
    finally:
        try:
            browser.close()
        except Exception:  # audit-ignore: the browser may already be gone
            pass
        # tidy up: the throwaway accounts
        for h in (handle, handle + 'x', handle2):
            try:
                rpc('portal_delete_account', {'p_handle': h, 'p_pin': pin})
            except Exception:  # audit-ignore: the cleanup is best effort
                pass

    return common.report()


if __name__ == '__main__':
    sys.exit(run())
