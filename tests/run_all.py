"""Run the whole portal suite against a locally served build.

    python tests/run_all.py                 # local build on :8081
    PORTAL_BASE_URL=https://mcq-portal-jade.vercel.app python tests/run_all.py

Every spec is a plain script that exits non-zero when a check fails, so the
suite is easy to run one at a time and easy to read in CI logs.
"""
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
PORT = os.environ.get('PORTAL_PORT', '8081')
SPECS = [
    'test_catalog.py',
    'test_quiz.py',
    'test_league.py',
    'test_share.py',
    'test_tour.py',
    'test_offline.py',
    'test_a11y.py',
]


def wait_for_server(url, tries=40):
    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def main():
    report = os.path.join(HERE, 'report.txt')
    if os.path.exists(report):
        os.remove(report)

    own_server = 'PORTAL_BASE_URL' not in os.environ
    server = None
    if own_server:
        server = subprocess.Popen([sys.executable, '-m', 'http.server', PORT],
                                  cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not wait_for_server('http://127.0.0.1:%s/index.html' % PORT):
            print('server did not start', flush=True)
            server.terminate()
            return 2

    env = dict(os.environ)
    env.setdefault('PORTAL_BASE_URL', 'http://127.0.0.1:%s' % PORT)

    failed = []
    try:
        for spec in SPECS:
            print('--- ' + spec, flush=True)
            res = subprocess.run([sys.executable, os.path.join(HERE, spec)],
                                 cwd=HERE, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT)
            out = res.stdout.decode('utf-8', 'replace')
            print(out, flush=True)
            if res.returncode != 0:
                failed.append(spec)
    finally:
        if server:
            server.terminate()

    print('=== summary ===', flush=True)
    if os.path.exists(report):
        rows = [l.rstrip('\n') for l in open(report, encoding='utf-8')]
        total = len(rows)
        bad = [r for r in rows if r.startswith('FAIL')]
        print('%d checks, %d failed' % (total, len(bad)), flush=True)
        for r in bad:
            print(r, flush=True)
    else:
        print('no report written', flush=True)
        failed = SPECS

    if failed:
        print('failing specs: ' + ', '.join(failed), flush=True)
        return 1
    print('all specs green', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
