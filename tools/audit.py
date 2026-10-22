#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deep static audit for the MCQ portal (silent failures, dead code, zombies, orphans).

Inspired by the `lsp-inspect` skill's check taxonomy
(blackwell-systems/agent-lsp: dead_symbol, silent_failure, error_wrapping,
coverage_gap, unrecovered_concurrent_entry, channel_never_closed) and the
"silent-failure-hunter" practice, but tuned to this repo's plain JS + Python,
with no LSP server needed.

    python tools/audit.py            # report + exit 1 on errors
    python tools/audit.py --json     # machine readable
    python tools/audit.py --quiet    # only the summary

Checks
  silent_failure   empty/`=> {}` catches, `catch {}` with nothing, `except: pass`
  error_swallow    `.catch(() => {})` / `.catch(function () {})` with no body
  dead_symbol      top-level function declared and never referenced
  timer_never_cleared  setInterval without clearInterval, stored setTimeout never cleared
  listener_leak    addEventListener with no removeEventListener (informational)
  orphan_id        an id in index.html never referenced by JS/CSS
  dangling_id      a `$('#id')` in JS whose id is not in index.html
  storage_orphan   a localStorage key written but never read or removed
  debug_leftover   window.__* hooks, bare console.log in js/
  todo             TODO / FIXME / XXX
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = sorted((ROOT / 'js').glob('*.js'))
CSS = sorted((ROOT / 'css').glob('*.css'))
HTML = ROOT / 'index.html'
PY = sorted((ROOT / 'tests').glob('*.py')) + sorted((ROOT / 'tools').glob('*.py'))

# third-party bundles are not ours to judge
VENDOR = {'lucide.min.js', 'qrcode.min.js'}


def read(p: Path) -> str:
    try:
        return p.read_text(encoding='utf-8')
    except Exception:
        return ''


IGNORE = 'audit-ignore'


def ignored(text: str, idx: int) -> bool:
    line_start = text.rfind('\n', 0, idx) + 1
    prev_start = text.rfind('\n', 0, max(0, line_start - 1)) + 1
    return IGNORE in text[line_start:line_start + 160] or IGNORE in text[prev_start:line_start]


def line_of(text: str, idx: int) -> int:
    return text.count('\n', 0, idx) + 1


def snippet(text: str, idx: int, n: int = 80) -> str:
    s = text[idx:idx + n].replace('\n', ' ')
    return re.sub(r'\s+', ' ', s)[:n]


class Audit:
    def __init__(self):
        self.findings = []

    def add(self, severity, check, path, line, finding, fix=''):
        self.findings.append({
            'severity': severity, 'check': check, 'file': str(path), 'line': line,
            'finding': finding, 'fix': fix,
        })

    # ---------------- checks ----------------
    def silent_failures(self):
        for p in JS:
            if p.name in VENDOR:
                continue
            text = read(p)
            # an empty catch around storage/feature probing is the accepted
            # pattern; around a network call it hides a real failure
            def body_before(idx):
                j = text.rfind('try', 0, idx)
                if j < 0:
                    return ''
                open_brace = text.find('{', j)
                if open_brace < 0 or open_brace > idx:
                    return ''
                depth = 0
                for k in range(open_brace, len(text)):
                    if text[k] == '{':
                        depth += 1
                    elif text[k] == '}':
                        depth -= 1
                        if depth == 0:
                            return text[open_brace:k]
                return text[j:idx]
            for m in re.finditer(r'catch\s*(?:\([^)]*\))?\s*\{\s*\}', text):
                if ignored(text, m.start()):
                    continue
                body = body_before(m.start())
                net = bool(re.search(r'fetch\(|\.rpc\(|await |pullOrPush|upload\(|download\(|sb\.', body))
                self.add('warning' if net else 'info', 'silent_failure', p, line_of(text, m.start()),
                         ('network call swallowed: the failure disappears' if net else 'optional guard (no-op catch)'),
                         'log it or surface a toast' if net else '')
            for m in re.finditer(r'\.catch\s*\(\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[\w$]+\s*=>)\s*\{\s*\}\s*\)', text):
                window = text[max(0, m.start() - 300):m.start()]
                net = bool(re.search(r'fetch\(|\.rpc\(|PortalContent|PortalLeague|download|upload|pullOrPush|sb\.', window))
                self.add('warning' if net else 'info', 'error_swallow', p, line_of(text, m.start()),
                         ('network rejection swallowed' if net else 'optional call rejection ignored (no-op)'),
                         'keep the failure visible' if net else '')
            # try { ... } catch (e) { /* comment only */ }
            for m in re.finditer(r'catch\s*\([^)]*\)\s*\{\s*(?://[^\n]*\s*)?\}', text):
                if not re.search(r'catch\s*(\([^)]*\))?\s*\{\s*\}', text[m.start():m.start() + 60]):
                    self.add('info', 'silent_failure', p, line_of(text, m.start()),
                             'catch with only a comment', 'log the error or explain why it is safe')
        for p in PY:
            text = read(p)
            for m in re.finditer(r'except\s+Exception\s*:\s*\n\s*pass|except\s*:\s*\n\s*pass', text):
                if ignored(text, m.start()):
                    continue
                self.add('warning', 'silent_failure', p, line_of(text, m.start()),
                         'bare except with pass', 'narrow the exception or report it')

    def dead_symbols(self):
        # only top-level `function name(` in js/ (app.js and friends) and module exports
        all_js = {p.name: read(p) for p in JS if p.name not in VENDOR}
        everything = '\n'.join(all_js.values())
        for name, text in all_js.items():
            p = ROOT / 'js' / name
            for m in re.finditer(r'^\s{0,2}function\s+([A-Za-z_$][\w$]*)\s*\(', text, re.M):
                fn = m.group(1)
                # any mention outside the declaration counts (call, callback
                # reference, bindClick('id', fn), string lookup)
                rest = text[:m.start()] + text[m.end():]
                refs = len(re.findall(r'\b' + re.escape(fn) + r'\b', rest))
                if refs == 0:
                    self.add('info', 'dead_symbol', p, line_of(text, m.start()),
                             'function `%s` is declared and never used' % fn, 'remove it')

    def timers(self):
        for p in JS:
            if p.name in VENDOR:
                continue
            text = read(p)
            intervals = re.findall(r'setInterval\s*\(', text)
            clears = re.findall(r'clearInterval\s*\(', text)
            if len(intervals) > len(clears) and not ignored(text, text.find('setInterval')):
                self.add('warning', 'timer_never_cleared', p, line_of(text, text.find('setInterval')),
                         '%d setInterval vs %d clearInterval' % (len(intervals), len(clears)),
                         'keep a handle and clear it when the screen or session ends')
            stored = re.findall(r'(\w+)\s*=\s*setTimeout\s*\(', text)
            for var in set(stored):
                if 'clearTimeout(' + var + ')' not in text and 'clearTimeout(%s)' % var not in text:
                    self.add('info', 'timer_never_cleared', p, line_of(text, text.find(var + ' = setTimeout')),
                             'timeout `%s` is stored and never cleared' % var, 'clear it on teardown')
            adds = len(re.findall(r'addEventListener\s*\(', text))
            removes = len(re.findall(r'removeEventListener\s*\(', text))
            if adds > 20 and removes == 0:
                self.add('info', 'listener_leak', p, 1,
                         '%d addEventListener and no removeEventListener' % adds,
                         'expected for a single-page shell; watch for per-session listeners')

    def dom_ids(self):
        html = read(HTML)
        html_ids = set(re.findall(r'\bid="([^"]+)"', html))
        js_all = '\n'.join(read(p) for p in JS if p.name not in VENDOR)
        css_all = '\n'.join(read(p) for p in CSS)
        for i in sorted(html_ids):
            if i in js_all or i in css_all:
                continue
            self.add('info', 'orphan_id', HTML, line_of(html, html.find('id="%s"' % i)),
                     'id `%s` is in the markup but no JS/CSS uses it' % i, 'remove it or use it')
        for m in re.finditer(r"\$\(\s*'#([A-Za-z0-9_-]+)'\s*\)", js_all):
            if m.group(1) not in html_ids:
                self.add('warning', 'dangling_id', ROOT / 'js', 0,
                         'JS looks up `#%s`, which index.html does not define' % m.group(1),
                         'add the element or fix the id')

    def storage(self):
        js_all = '\n'.join(read(p) for p in JS if p.name not in VENDOR)
        keys = set(re.findall(r"['\"](portal_[a-z0-9_]+)['\"]", js_all))
        for k in sorted(keys):
            writes = len(re.findall(r"setItem\(\s*['\"]" + re.escape(k) + r"['\"]", js_all))
            reads = len(re.findall(r"getItem\(\s*['\"]" + re.escape(k) + r"['\"]", js_all))
            removes = len(re.findall(r"removeItem\(\s*['\"]" + re.escape(k) + r"['\"]", js_all))
            if writes and not reads:
                self.add('warning', 'storage_orphan', ROOT / 'js', 0,
                         '`%s` is written but never read' % k, 'drop it or read it somewhere')
            elif reads and not removes and not writes:
                self.add('info', 'storage_orphan', ROOT / 'js', 0,
                         '`%s` is read but nothing writes it' % k, 'check the writer')
            elif writes and reads and not removes:
                self.add('info', 'storage_orphan', ROOT / 'js', 0,
                         '`%s` has no removal path' % k, 'fine for a preference; otherwise add a reset')

    def leftovers(self):
        for p in JS:
            if p.name in VENDOR:
                continue
            text = read(p)
            for m in re.finditer(r'window\.__[A-Za-z0-9_]+', text):
                if ignored(text, m.start()):
                    continue
                self.add('warning', 'debug_leftover', p, line_of(text, m.start()),
                         'debug hook `%s` left in the shipped code' % m.group(0), 'remove it')
            for m in re.finditer(r'^\s*console\.log\s*\(', text, re.M):
                self.add('info', 'debug_leftover', p, line_of(text, m.start()),
                         'console.log in shipped code', 'use the debug logger')
        for p in list(JS) + list(PY):
            if p.name in VENDOR or p.name.startswith('test_'):
                continue
            text = read(p)
            for m in re.finditer(r'\b(TODO|FIXME|XXX)\b', text):
                self.add('info', 'todo', p, line_of(text, m.start()), 'unfinished marker', 'resolve or ticket it')

    def run(self):
        self.silent_failures()
        self.dead_symbols()
        self.timers()
        self.dom_ids()
        self.storage()
        self.leftovers()
        return self.findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--write-baseline', action='store_true',
                    help='accept the current findings as the known baseline')
    args = ap.parse_args()

    findings = Audit().run()
    order = {'error': 0, 'warning': 1, 'info': 2}
    findings.sort(key=lambda f: (order[f['severity']], f['check'], f['file']))

    def fp(f):
        return '%s|%s|%s|%s' % (f['check'], os.path.relpath(f['file'], ROOT).replace('\\', '/'), f['severity'], f['finding'])

    baseline_path = ROOT / '.audit-baseline.json'
    known = set()
    if baseline_path.exists():
        try:
            known = set(json.loads(baseline_path.read_text(encoding='utf-8')).get('known', []))
        except Exception:
            known = set()
    if args.write_baseline:
        payload = {'known': sorted({fp(f) for f in findings})}
        baseline_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('baseline written: %d known findings' % len(payload['known']))
        return 0

    new = [f for f in findings if fp(f) not in known]
    counts = {s: sum(1 for f in new if f['severity'] == s) for s in ('error', 'warning', 'info')}
    total = {s: sum(1 for f in findings if f['severity'] == s) for s in ('error', 'warning', 'info')}

    if args.json:
        print(json.dumps({'counts': counts, 'total': total, 'findings': new}, ensure_ascii=False, indent=2))
    elif not args.quiet:
        for f in new:
            loc = '%s:%d' % (os.path.relpath(f['file'], ROOT), f['line']) if f['line'] else os.path.relpath(f['file'], ROOT)
            print('[%-7s] %-20s %-38s %s' % (f['severity'], f['check'], loc, f['finding']))
            if f['fix']:
                print('           -> %s' % f['fix'])

    summary = ('new: %d errors, %d warnings, %d info  (all: %d/%d/%d)'
               % (counts['error'], counts['warning'], counts['info'],
                  total['error'], total['warning'], total['info']))
    if args.json:
        sys.stderr.write(summary + '\n')
    else:
        print('\n' + summary)
    return 1 if (counts['error'] or counts['warning']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
