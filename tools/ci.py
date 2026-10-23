#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One local CI gate: static audit, runtime-neutral checks, then the full suite.

    python tools/ci.py            # audit + suite, exit 1 on any failure
    python tools/ci.py --fast     # audit only

The suite is pointed at a locally served copy on its own port, so it never
depends on a dev server that happens to be running.
"""
import argparse
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = os.environ.get('CI_PORT', '8099')


def run(cmd, env=None, cwd=ROOT):
    print('\n$ ' + ' '.join(cmd), flush=True)
    return subprocess.call(cmd, cwd=str(cwd), env=env)


def wait(url, tries=40):
    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--fast', action='store_true', help='audit only')
    args = ap.parse_args()

    rc = run([sys.executable, 'tools/audit.py'])
    if rc != 0:
        print('\nCI: audit failed (new findings — fix them or accept the baseline deliberately)')
        return 1
    if args.fast:
        print('\nCI: audit clean')
        return 0

    server = subprocess.Popen([sys.executable, '-m', 'http.server', PORT],
                              cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait('http://127.0.0.1:%s/' % PORT):
            print('CI: the local server did not start')
            return 1
        env = dict(os.environ)
        env['PORTAL_BASE_URL'] = 'http://127.0.0.1:%s' % PORT
        rc = run([sys.executable, 'tests/run_all.py'], env=env)
        # the specs create real accounts; their own cleanup is best effort, so
        # sweep the synthetic ones. A missing management token must not fail CI.
        run([sys.executable, 'tools/clean_qa_users.py'], env=env)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    print('\nCI: ' + ('green' if rc == 0 else 'failed'))
    return rc


if __name__ == '__main__':
    raise SystemExit(main())
