#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regenerate the service worker's precache list from what is on disk.

The list is explicit on purpose (an install must not silently miss a file),
but a hand-kept list drifts. This rewrites the CORE array in sw.js and prints
what changed.

    python tools/sync_sw_core.py          # rewrite sw.js
    python tools/sync_sw_core.py --check  # only report the drift
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SW = ROOT / 'sw.js'


def wanted() -> list:
    items = ['./', './index.html', './manifest.json']
    items += ['./css/%s' % p.name for p in sorted((ROOT / 'css').glob('*.css'))]
    items += ['./js/%s' % p.name for p in sorted((ROOT / 'js').glob('*.js'))]
    items += ['./js/vendor/npm/%s' % p.name for p in sorted((ROOT / 'js/vendor/npm').glob('*.js'))]
    items += ['./assets/fonts/%s' % p.name for p in sorted((ROOT / 'assets/fonts').glob('*.woff2'))]
    for name in ('icon-192.png', 'icon-512.png', 'brand-icon-light.png', 'brand-icon-dark.png', 'avatar-default.svg'):
        if (ROOT / 'assets' / name).exists():
            items.append('./assets/%s' % name)
    items += ['./assets/avatars/%s' % p.name for p in sorted((ROOT / 'assets/avatars').glob('*.png'))]
    items += ['./assets/%s' % p.name for p in sorted((ROOT / 'assets').glob('animal-*.svg'))]
    items.append('./data/index.json')
    items += ['./data/banks/%s' % p.name for p in sorted((ROOT / 'data/banks').glob('*.json'))]
    items += ['./sounds/%s' % p.name for p in sorted((ROOT / 'sounds').glob('*.mp3'))]
    seen = set()
    out = []
    for i in items:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    text = SW.read_text(encoding='utf-8')
    m = re.search(r'const CORE = \[(.*?)\n\];', text, re.S)
    if not m:
        print('CORE array not found in sw.js')
        return 1
    current = re.findall(r"'([^']+)'", m.group(1))
    target = wanted()
    added = [i for i in target if i not in current]
    removed = [i for i in current if i not in target]
    print('precache: %d entries (now %d)' % (len(current), len(target)))
    for i in added:
        print('  + %s' % i)
    for i in removed:
        print('  - %s' % i)
    if args.check:
        return 1 if (added or removed) else 0
    block = '\n' + '\n'.join("  '%s'," % i for i in target)
    SW.write_text(text[:m.start(1)] + block + text[m.end(1):], encoding='utf-8', newline='\n')
    print('sw.js updated')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
