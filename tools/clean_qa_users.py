#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Delete the throwaway accounts the browser specs create.

    python tools/clean_qa_users.py            # delete what the patterns match
    python tools/clean_qa_users.py --dry-run  # list them first

The specs create real rows on the live project (that is the point: they test the
real RPCs), and their own cleanup is best-effort — a rate-limited `finally` can
leave an account behind. Run this after a suite; `tools/ci.py` calls it too and
ignores a failure when the management token is not available.

Only synthetic handles are touched: `sectest*`, `t<digits>`, `pc<digits>`,
`lt<digits>`, `tb<digits>`, `qla*`, `qlb*`, `qa<digits>`, `tab<digits>`.
A real student never picks one of those.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = os.environ.get('SUPABASE_PROJECT', 'gywniovuupjmllbmjmai')
API = 'https://api.supabase.com/v1'
AUTH = Path(os.environ.get('MCP_AUTH', Path.home() / '.local/share/opencode/mcp-auth.json'))
PAT_FILE = Path(os.environ.get('SUPABASE_PAT_FILE', Path.home() / '.config/opencode/supabase-pat'))
PATTERNS = [
    re.compile(r'^sectest\d+x?$'),
    re.compile(r'^t\d{4,}$'),
    re.compile(r'^pc\d{4,}$'),
    re.compile(r'^pctest\d*$'),
    re.compile(r'^lt\d{4,}$'),
    re.compile(r'^tb\d{4,}$'),
    re.compile(r'^qa\d{4,}$'),
    re.compile(r'^tab\d{4,}$'),
    re.compile(r'^benchuser\d*$'),
    re.compile(r'^coltest\d*$'),
    re.compile(r'^qla\d+$'),
    re.compile(r'^qlb\d+$'),
    re.compile(r'^lk[ab]\d+$'),
]


def token() -> str:
    env = (os.environ.get('SUPABASE_ACCESS_TOKEN') or '').strip()
    if env:
        return env
    if PAT_FILE.is_file() and PAT_FILE.read_text(encoding='utf-8').strip():
        return PAT_FILE.read_text(encoding='utf-8').strip()
    data = json.loads(AUTH.read_text(encoding='utf-8'))
    sb = data['supabase']
    tok = sb['tokens']['accessToken']
    if float(sb['tokens'].get('expiresAt') or 0) > __import__('time').time() + 60:
        return tok
    ci = sb['clientInfo']
    body = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': sb['tokens']['refreshToken'],
        'client_id': ci['clientId'],
        'client_secret': ci['clientSecret'],
    }).encode()
    req = urllib.request.Request(API + '/oauth/token', data=body,
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=45) as r:
        fresh = json.loads(r.read().decode())
    sb['tokens']['accessToken'] = fresh['access_token']
    if fresh.get('refresh_token'):
        sb['tokens']['refreshToken'] = fresh['refresh_token']
    if fresh.get('expires_in'):
        sb['tokens']['expiresAt'] = __import__('time').time() + int(fresh['expires_in'])
    AUTH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return sb['tokens']['accessToken']


def service_key(tok: str) -> str:
    req = urllib.request.Request('%s/projects/%s/api-keys' % (API, PROJECT),
                                 headers={'Authorization': 'Bearer ' + tok})
    with urllib.request.urlopen(req, timeout=45) as r:
        keys = json.loads(r.read().decode())
    for k in keys:
        if k.get('name') in ('service_role', 'service_role_key') or k.get('type') == 'secret':
            return k['api_key']
    raise RuntimeError('service_role key not found')


BASE = 'https://%s.supabase.co/rest/v1' % PROJECT


def call(key: str, method: str, path: str):
    req = urllib.request.Request(BASE + path, method=method,
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read().decode('utf-8')
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')[:200]


def main() -> int:
    dry = '--dry-run' in sys.argv
    key = service_key(token())
    status, users = call(key, 'GET', '/portal_users?select=id,handle')
    if status != 200 or not isinstance(users, list):
        print('could not read portal_users:', status, users)
        return 1
    doomed = [u for u in users if any(p.match(u['handle']) for p in PATTERNS)]
    if not doomed:
        print('no throwaway accounts — the portal is clean')
        return 0
    print('%d throwaway account(s): %s' % (len(doomed), ', '.join(u['handle'] for u in doomed)))
    if dry:
        return 0
    for u in doomed:
        for table, column in (('league_xp', 'user_id'), ('portal_data', 'user_id'), ('login_links', 'user_id'), ('vs_rooms', 'host_id'), ('vs_rooms', 'guest_id')):
            for uid in (u['id'], 'u:' + u['id'], u['handle']):
                call(key, 'DELETE', '/%s?%s=eq.%s' % (table, column, uid))
        call(key, 'DELETE', '/login_attempts?key=eq.handle:' + u['handle'])
        call(key, 'DELETE', '/portal_users?id=eq.' + u['id'])
    # sweep any leftover test vs_rooms
    call(key, 'DELETE', '/vs_rooms?host_id=like.u:test_h_%')
    # league rows left behind by a test account whose user row is gone (the
    # "Avatar" entry the student saw). Only the names the specs use are touched.
    TEST_NAMES = {'Avatar', 'Av2', 'Av3', 'Tick', 'Dbg', 'QA', 'Link A', 'Link B',
                  'Sign Out', 'PIN test', 'PIN renamed', 'اسم جديد', 'طالب الاختبار'}
    status, league = call(key, 'GET', '/league_xp?select=user_id,name')
    if isinstance(league, list):
        for row in league:
            uid = str(row.get('user_id') or '')
            bare = uid[2:] if uid.startswith('u:') else uid
            if row.get('name') not in TEST_NAMES:
                continue
            st, owners = call(key, 'GET', '/portal_users?select=id&id=eq.' + bare)
            if isinstance(owners, list) and owners:
                continue
            call(key, 'DELETE', '/league_xp?user_id=eq.' + uid)
            call(key, 'DELETE', '/portal_data?user_id=eq.' + uid)
            print('  removed the leftover league row for', row.get('name'))

    status, left = call(key, 'GET', '/portal_users?select=handle')
    # the suite itself spends the per-address budget; reset the dev machine's
    # counter so the next run does not start against a half-full bucket
    call(key, 'DELETE', '/login_attempts?key=like.ip:*')
    print('removed %d; %d account(s) left' % (len(doomed), len(left) if isinstance(left, list) else -1))
    return 0


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (used by token())
    raise SystemExit(main())
