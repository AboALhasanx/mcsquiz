#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Apply a SQL file to the content portal through the Supabase Management API.

    python tools/db_apply.py db/001_security_hardening.sql

The file is executed as one transaction; a failure leaves the database
untouched. The access token is read from the local MCP auth store
(%USERPROFILE%\\.local\\share\\opencode\\mcp-auth.json) and refreshed when it
has expired.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = os.environ.get('SUPABASE_PROJECT', 'gywniovuupjmllbmjmai')
API = 'https://api.supabase.com/v1'
AUTH = Path(os.environ.get('MCP_AUTH', Path.home() / '.local/share/opencode/mcp-auth.json'))


def tokens() -> dict:
    data = json.loads(AUTH.read_text(encoding='utf-8'))
    return data['supabase']['tokens']


def refresh() -> dict:
    """Refresh the MCP OAuth token (it expires after a day)."""
    data = json.loads(AUTH.read_text(encoding='utf-8'))
    sb = data['supabase']
    ci = sb['clientInfo']
    body = urllib.parse.urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': sb['tokens']['refreshToken'],
        'client_id': ci['clientId'],
        'client_secret': ci['clientSecret'],
    }).encode()
    req = urllib.request.Request(API + '/oauth/token', data=body,
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=60) as r:
        fresh = json.loads(r.read().decode())
    sb['tokens']['accessToken'] = fresh['access_token']
    if fresh.get('refresh_token'):
        sb['tokens']['refreshToken'] = fresh['refresh_token']
    if fresh.get('expires_in'):
        sb['tokens']['expiresAt'] = time.time() + int(fresh['expires_in'])
    AUTH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return sb['tokens']


def query(sql: str, tok: str):
    req = urllib.request.Request(
        '%s/projects/%s/database/query' % (API, PROJECT),
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    if not path.is_absolute():
        path = ROOT / path
    sql = path.read_text(encoding='utf-8')

    tok = tokens()['accessToken']
    status, body = query(sql, tok)
    if status == 401:
        tok = refresh()['accessToken']
        status, body = query(sql, tok)
    if status not in (200, 201):
        print('FAILED (%s): %s' % (status, body[:600]))
        return 1
    print('applied %s' % path.name)
    print(body[:400])
    return 0


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (used by refresh)
    raise SystemExit(main())
