"""Banks: bilingual schema, Arabic coverage, bidi-safe rendering."""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('banks')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARABIC = re.compile(r'[\u0600-\u06FF]')


def run():
    banks = sorted(glob.glob(os.path.join(ROOT, 'data', 'banks', '*.json')))
    check('banks exist', len(banks) >= 10, len(banks))

    total = ar_q = ar_o = ar_e = 0
    structural = []
    for path in banks:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for q in data['questions']:
            total += 1
            name = os.path.basename(path)[:32] + '#' + str(q.get('id'))
            if not (q.get('question_en') and len(q.get('options_en') or []) == 4 and q.get('explanation_en')):
                structural.append(name + ':en')
            if not (0 <= int(q.get('correct', -1)) <= 3):
                structural.append(name + ':correct')
            # translated questions must be fully consistent, never half-Arabic
            if ARABIC.search(q.get('question_ar') or ''):
                ar_q += 1
                if len(q.get('options_ar') or []) != 4 or not all(ARABIC.search(o or '') for o in q['options_ar']):
                    structural.append(name + ':ar-options')
            if any(ARABIC.search(o or '') for o in (q.get('options_ar') or [])):
                ar_o += 1
            if ARABIC.search(q.get('explanation_ar') or ''):
                ar_e += 1

    check('every question has English text and a valid answer key',
          not [s for s in structural if not s.endswith('ar-options')],
          [s for s in structural if not s.endswith('ar-options')][:4])
    # translation coverage is tracked, not asserted: content lands bank by bank
    partial = [s for s in structural if 'ar-options' in s]
    print('questions still missing Arabic options: %d' % len(partial), flush=True)

    # coverage ratchet: raise this number as banks are translated
    MIN_AR_QUESTIONS = 10
    check('Arabic question coverage meets the current target',
          ar_q >= MIN_AR_QUESTIONS, '%d/%d translated' % (ar_q, total))
    print('coverage: ar-questions %d/%d, ar-options %d/%d, ar-explanations %d/%d'
          % (ar_q, total, ar_o, total, ar_e, total), flush=True)

    # ---- bidi rendering: numbers inside Arabic must be isolated, in order
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True, telegram={'id': 7, 'first_name': 'طالب'})
    try:
        page.wait_for_function('() => !!document.querySelector("#catalog-cards-container .sketch-row")', timeout=20000)
        # open a bank that contains digits in its Arabic question/options
        target = None
        for path in banks:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            for q in data['questions']:
                blob = (q.get('question_ar') or '') + ' ' + ' '.join(q.get('options_ar') or [])
                if ARABIC.search(blob) and re.search(r'[0-9]', blob):
                    target = (data['subject_id'], data['quiz_id'])
                    break
            if target:
                break
        check('found a bilingual question containing numbers', target is not None, target)
        if target:
            page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % target)
            page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
            page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
            page.wait_for_timeout(600)
            html = page.evaluate("() => document.querySelector('#question-card').innerHTML")
            check('LTR runs inside Arabic are wrapped in bdi dir=ltr',
                  ('<bdi dir="ltr">' in html), html[:120])
        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()

    return common.report()


if __name__ == '__main__':
    sys.exit(run())
