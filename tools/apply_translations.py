"""Merge Arabic translations into a quiz bank.

    python tools/apply_translations.py --bank data/banks/<bank>.json --tr tools/translations/<file>.json

The translation file is { "<question id>": { question_ar, options_ar[4], explanation_ar } }.
Only the keys present are overwritten; the English side is never touched.
"""
import argparse
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', required=True)
    ap.add_argument('--tr', required=True)
    args = ap.parse_args()

    bank_path = args.bank if os.path.isabs(args.bank) else os.path.join(ROOT, args.bank)
    tr_path = args.tr if os.path.isabs(args.tr) else os.path.join(ROOT, args.tr)

    with io.open(bank_path, encoding='utf-8') as f:
        bank = json.load(f)
    with io.open(tr_path, encoding='utf-8') as f:
        tr = json.load(f)

    filled = 0
    missing = []
    for q in bank.get('questions', []):
        entry = tr.get(str(q.get('id')))
        if not entry:
            missing.append(q.get('id'))
            continue
        if entry.get('question_ar'):
            q['question_ar'] = entry['question_ar'].strip()
        opts = entry.get('options_ar')
        if isinstance(opts, list) and len(opts) == 4:
            q['options_ar'] = [o.strip() for o in opts]
        elif opts:
            print('WARN %s: options_ar needs 4 items' % q.get('id'))
        if entry.get('explanation_ar'):
            q['explanation_ar'] = entry['explanation_ar'].strip()
        filled += 1

    with io.open(bank_path, 'w', encoding='utf-8') as f:
        json.dump(bank, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('applied %d/%d to %s' % (filled, len(bank.get('questions', [])), os.path.basename(bank_path)))
    if missing:
        print('still untranslated:', ', '.join(str(x) for x in missing[:12]),
              '…' if len(missing) > 12 else '')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
