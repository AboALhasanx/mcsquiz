#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bump the version the standard way (SemVer + Keep a Changelog).

    python tools/release.py patch --note "fix: the quiz clock stops on leave"
    python tools/release.py minor --note "feat: account export"
    python tools/release.py major

It updates VERSION, manifest.json, the service worker's VERSION (the cache name
follows it), the app's SHELL_VERSION, and moves the CHANGELOG's Unreleased
section under the new number with today's date. It does not deploy.
"""
import argparse
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(p: Path) -> str:
    return p.read_text(encoding='utf-8')


def write(p: Path, s: str) -> None:
    p.write_text(s, encoding='utf-8', newline='\n')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('part', choices=['major', 'minor', 'patch'])
    ap.add_argument('--note', default='', help='one line for the changelog entry')
    args = ap.parse_args()

    version = read(ROOT / 'VERSION').strip()
    major, minor, patch = (int(x) for x in version.split('.'))
    if args.part == 'major':
        major, minor, patch = major + 1, 0, 0
    elif args.part == 'minor':
        minor, patch = minor + 1, 0
    else:
        patch += 1
    new = '%d.%d.%d' % (major, minor, patch)

    write(ROOT / 'VERSION', new + '\n')

    sw = read(ROOT / 'sw.js')
    sw = re.sub(r"const VERSION = '[^']+';", "const VERSION = '%s';" % new, sw, count=1)
    write(ROOT / 'sw.js', sw)

    app = read(ROOT / 'js' / 'app.js')
    app = re.sub(r"SHELL_VERSION = '[^']+'", "SHELL_VERSION = '%s'" % new, app, count=1)
    write(ROOT / 'js' / 'app.js', app)

    manifest = json.loads(read(ROOT / 'manifest.json'))
    manifest['version'] = new
    write(ROOT / 'manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    changelog = read(ROOT / 'CHANGELOG.md')
    today = datetime.date.today().isoformat()
    entry = '## [%s] — %s\n\n### Changed\n- %s\n' % (new, today, args.note or 'maintenance release')
    changelog = changelog.replace('## [Unreleased]\n', '## [Unreleased]\n\n' + entry + '\n', 1)
    write(ROOT / 'CHANGELOG.md', changelog)

    print('version %s -> %s' % (version, new))
    print('next: python tools/ci.py && npx -y vercel@latest --prod --yes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
