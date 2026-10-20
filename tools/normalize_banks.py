"""Normalize quiz banks to the bilingual schema the portal expects.

Schema per question (all required except the *_en mirrors, which fall back):
    question_ar str, question_en str
    options_ar [4], options_en [4]
    explanation_ar str, explanation_en str

Legacy fields (question / options / explanation) are kept for compatibility.
Usage:
    python tools/normalize_banks.py            # rewrite data/banks/*.json
    python tools/normalize_banks.py --check    # report only, exit 1 on gaps
"""
import argparse
import glob
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANKS = os.path.join(ROOT, 'data', 'banks')
ARABIC = re.compile(r'[\u0600-\u06FF]')


def has_ar(value):
    return bool(value) and bool(ARABIC.search(value))


def normalize(q):
    q['question_en'] = (q.get('question_en') or q.get('question') or '').strip()
    q['question_ar'] = (q.get('question_ar') or '').strip()
    q['options_en'] = q.get('options_en') or q.get('options') or []
    q['options_ar'] = q.get('options_ar') or []
    q['explanation_en'] = (q.get('explanation_en') or q.get('explanation') or '').strip()
    q['explanation_ar'] = (q.get('explanation_ar') or '').strip()
    return q


def gaps(q):
    out = []
    if not has_ar(q['question_ar']):
        out.append('question_ar')
    if not q['question_en']:
        out.append('question_en')
    if len(q['options_ar']) != 4 or not all(has_ar(o) for o in q['options_ar']):
        out.append('options_ar')
    if len(q['options_en']) != 4 or not all(q['options_en']):
        out.append('options_en')
    if not has_ar(q['explanation_ar']):
        out.append('explanation_ar')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    total = 0
    bad = 0
    for path in sorted(glob.glob(os.path.join(BANKS, '*.json'))):
        with io.open(path, encoding='utf-8') as f:
            data = json.load(f)
        qs = [normalize(q) for q in data.get('questions', [])]
        data['questions'] = qs
        total += len(qs)
        bank_gaps = {}
        for q in qs:
            g = gaps(q)
            if g:
                bad += 1
                bank_gaps[q.get('id')] = g
        if not args.check:
            with io.open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write('\n')
        print('%-58s %2d qs, %d incomplete' % (os.path.basename(path)[:58], len(qs), len(bank_gaps)))
    print('---')
    print('total %d questions, %d incomplete' % (total, bad))
    return 1 if (args.check and bad) else 0


if __name__ == '__main__':
    raise SystemExit(main())
